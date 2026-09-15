import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Printer,
  DollarSign,
  AlertCircle,
  Package,
  Layers,
  X,
  WifiOff,
  Zap,
  Maximize2,
  Minimize2,
  Lock,
  Mic,
  Sparkles,
  Building2,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  CreditCard,
  Wallet,
  History,
  FileText,
  UserCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { roundTo250, calculateStripPrice } from '../utils/currency';
import { usePharmacyLiveSync } from '../hooks/usePharmacyLiveSync';
import { SmartSearchModal } from '../components/SmartSearchModal';
import {
  cacheInventoryLocally,
  searchLocalInventory,
  deductLocalInventoryStock,
  getPendingSales,
  generateOfflineInvoiceNumber,
  type OfflineSaleRecord,
} from '../utils/posOfflineDb';
import { getLocalDailySummary, recordLocalSale } from '../utils/localDatabase';
import { queueOutboxOperation, processOutboxQueue } from '../utils/outboxQueue';

interface ActiveBatchInfo {
  id: string;
  batchNumber: string;
  expiryFormatted: string;
  sellingPricePack: number;
  sellingPriceUnit: number;
  purchasePricePack: number;
  quantityUnitsRemaining: number;
  availablePacks: number;
  availableStrips: number;
}

interface SearchMedicine {
  id: string;
  medicineId: string;
  customName?: string;
  tradeName: string;
  scientificName: string;
  unitsPerPack: number;
  sellingPricePack: number;
  sellingPriceUnit: number;
  availablePacks: number;
  availableStrips: number;
  totalUnitsRemaining: number;
  validUnitsRemaining?: number;
  barcode?: string;
  dosageForm?: string;
  strength?: string;
  shelfLocation?: string;
  activeBatches?: ActiveBatchInfo[];
}

interface BatchPortion {
  batchNumber: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

interface CartItem {
  inventoryItemId: string;
  inventoryBatchId?: string;
  batchNumber?: string;
  customName?: string;
  tradeName: string;
  scientificName: string;
  shelfLocation?: string;
  unitType: 'PACK' | 'STRIP';
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitsPerPack: number;
  activeBatches?: ActiveBatchInfo[];
  defaultSellingPricePack: number;
  defaultSellingPriceUnit: number;
  breakdown?: BatchPortion[];
}

function calculateDynamicItemTotals(
  activeBatches: ActiveBatchInfo[] | undefined,
  defaultPackPrice: number,
  defaultUnitPrice: number,
  unitsPerPack: number,
  quantity: number,
  unitType: 'PACK' | 'STRIP',
  forcedBatchId?: string,
): { totalPrice: number; effectiveUnitPrice: number; breakdown: BatchPortion[] } {
  const isPack = unitType === 'PACK';
  const unitsPerPk = Number(unitsPerPack) || 1;
  const totalUnitsNeeded = isPack ? quantity * unitsPerPk : quantity;

  let unitsLeft = totalUnitsNeeded;
  let calculatedTotal = 0;
  const breakdown: BatchPortion[] = [];

  let sortedBatches = [...(activeBatches || [])];
  if (forcedBatchId) {
    sortedBatches.sort((a, b) => (a.id === forcedBatchId ? -1 : b.id === forcedBatchId ? 1 : 0));
  }

  if (sortedBatches.length > 0) {
    for (const batch of sortedBatches) {
      if (unitsLeft <= 0) break;
      const availUnits = Number(batch.quantityUnitsRemaining) || 0;
      if (availUnits > 0) {
        const deductUnits = Math.min(availUnits, unitsLeft);
        const packPrice = Number(batch.sellingPricePack) || defaultPackPrice;
        const rawUnitPrice = Number(batch.sellingPriceUnit) || (unitsPerPk > 1 ? calculateStripPrice(packPrice, unitsPerPk) : defaultUnitPrice);
        const unitPrice = roundTo250(rawUnitPrice);
        const pricePerUnit = isPack ? packPrice / unitsPerPk : unitPrice;

        const lineCost = isPack ? Math.round(pricePerUnit * deductUnits) : roundTo250(pricePerUnit * deductUnits);
        calculatedTotal += lineCost;
        unitsLeft -= deductUnits;

        const portionQty = isPack ? Math.round((deductUnits / unitsPerPk) * 100) / 100 : deductUnits;
        const portionPrice = isPack ? packPrice : unitPrice;
        breakdown.push({
          batchNumber: batch.batchNumber || '—',
          qty: portionQty,
          unitPrice: portionPrice,
          lineTotal: lineCost,
        });
      }
    }

    if (unitsLeft > 0) {
      const latest = sortedBatches[sortedBatches.length - 1];
      const packPrice = Number(latest.sellingPricePack) || defaultPackPrice;
      const rawUnitPrice = Number(latest.sellingPriceUnit) || (unitsPerPk > 1 ? calculateStripPrice(packPrice, unitsPerPk) : defaultUnitPrice);
      const unitPrice = roundTo250(rawUnitPrice);
      const pricePerUnit = isPack ? packPrice / unitsPerPk : unitPrice;
      const lineCost = isPack ? Math.round(pricePerUnit * unitsLeft) : roundTo250(pricePerUnit * unitsLeft);
      calculatedTotal += lineCost;

      const portionQty = isPack ? Math.round((unitsLeft / unitsPerPk) * 100) / 100 : unitsLeft;
      const portionPrice = isPack ? packPrice : unitPrice;
      breakdown.push({
        batchNumber: latest.batchNumber || '—',
        qty: portionQty,
        unitPrice: portionPrice,
        lineTotal: lineCost,
      });
    }
  } else {
    const rawUnitPrice = defaultUnitPrice || (unitsPerPk > 1 ? calculateStripPrice(defaultPackPrice, unitsPerPk) : defaultPackPrice);
    const unitPrice = roundTo250(rawUnitPrice);
    const price = isPack ? defaultPackPrice : unitPrice;
    calculatedTotal = price * quantity;
    breakdown.push({
      batchNumber: '—',
      qty: quantity,
      unitPrice: price,
      lineTotal: calculatedTotal,
    });
  }

  const finalTotal = isPack ? Math.round(calculatedTotal) : roundTo250(calculatedTotal);
  const effectiveUnitPrice = quantity > 0
    ? (isPack ? Math.round(finalTotal / quantity) : roundTo250(finalTotal / quantity))
    : (isPack ? defaultPackPrice : roundTo250(defaultUnitPrice));

  return { totalPrice: finalTotal, effectiveUnitPrice, breakdown };
}

export const PosView: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMedicine[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [discountPercent, setDiscountPercent] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [completedSale, setCompletedSale] = useState<any | null>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showShiftSummary, setShowShiftSummary] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<any | null>(null);
  const [showShiftCloseModal, setShowShiftCloseModal] = useState(false);
  const [actualCashInput, setActualCashInput] = useState<number | ''>('');
  const [openingCashInput, setOpeningCashInput] = useState<number | ''>('');
  const [shiftCloseNotes, setShiftCloseNotes] = useState('');
  const [closingShift, setClosingShift] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setClosingShift(true);
    try {
      const res = await apiRequest<any>('/pos/shifts/close', {
        method: 'POST',
        body: JSON.stringify({
          actualCash: Number(actualCashInput) || 0,
          openingCash: Number(openingCashInput) || 0,
          notes: shiftCloseNotes.trim() || undefined,
        }),
      });
      setMessage({ type: 'success', text: res.message || 'تم إغلاق الوردية بنجاح' });
      setShowShiftCloseModal(false);
      setActualCashInput('');
      setOpeningCashInput('');
      setShiftCloseNotes('');
    } catch (err: any) {
      alert(err.message || 'فشل إغلاق الوردية');
    } finally {
      setClosingShift(false);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Offline & Sync state
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSalesCount, setPendingSalesCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Cloud WebSockets Real-Time Sync Hook
  const { isConnected: isLiveSyncConnected } = usePharmacyLiveSync((eventType, _data) => {
    if (eventType === 'STOCK_UPDATED' || eventType === 'STOCK_ENTERED') {
      if (searchTerm.trim().length > 0) {
        apiRequest<SearchMedicine[]>(`/inventory?search=${encodeURIComponent(searchTerm)}`)
          .then((res) => setSearchResults(res))
          .catch(() => {});
      }
    }
  });

  // Quick Direct Return System State
  const [returnSearchTerm, setReturnSearchTerm] = useState('');
  const [returnSearchResults, setReturnSearchResults] = useState<SearchMedicine[]>([]);
  const [returnSearching, setReturnSearching] = useState(false);
  const [selectedReturnMed, setSelectedReturnMed] = useState<SearchMedicine | null>(null);
  const [returnUnitType, setReturnUnitType] = useState<'PACK' | 'STRIP'>('PACK');
  const [returnQty, setReturnQty] = useState<number>(1);
  const [returnRefundAmount, setReturnRefundAmount] = useState<number | ''>('');
  const [isManualRefundAmount, setIsManualRefundAmount] = useState(false);
  const [returnCondition, setReturnCondition] = useState<'RESALEABLE' | 'DAMAGED'>('RESALEABLE');
  const [returnPaymentMethod, setReturnPaymentMethod] = useState<'CASH' | 'ZAIN_CASH' | 'QI_CARD'>('CASH');
  const [returnReason, setReturnReason] = useState('المريض لم يعد بحاجة له');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  const [completedReturnReceipt, setCompletedReturnReceipt] = useState<any | null>(null);
  const [returnModalTab, setReturnModalTab] = useState<'NEW_RETURN' | 'RECENT_RETURNS'>('NEW_RETURN');
  const [recentReturns, setRecentReturns] = useState<any[]>([]);
  const [loadingRecentReturns, setLoadingRecentReturns] = useState(false);
  const returnSearchInputRef = useRef<HTMLInputElement>(null);

  // Customer Name & Sales Ledger History State
  const [customerName, setCustomerName] = useState('');
  const [showSalesHistoryModal, setShowSalesHistoryModal] = useState(false);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [loadingSalesHistory, setLoadingSalesHistory] = useState(false);
  const [salesHistorySearch, setSalesHistorySearch] = useState('');
  const [collapsedInvoices, setCollapsedInvoices] = useState<Record<string, boolean>>({});


  const fetchSalesHistory = async (searchQuery?: string) => {
    setLoadingSalesHistory(true);
    const q = searchQuery !== undefined ? searchQuery : salesHistorySearch;
    if (navigator.onLine) {
      try {
        const endpoint = `/pos/sales?limit=50${q.trim() ? `&search=${encodeURIComponent(q.trim())}` : ''}`;
        const data = await apiRequest<any[]>(endpoint);
        setSalesHistory(Array.isArray(data) ? data : []);
        setLoadingSalesHistory(false);
        return;
      } catch (err) {
        console.warn('Online sales history fetch failed, reading local database:', err);
      }
    }
    try {
      const { getLocalMasterDb } = await import('../utils/localDatabase');
      const db = await getLocalMasterDb();
      const tx = db.transaction('sales_history', 'readonly');
      const store = tx.objectStore('sales_history');
      const req = store.getAll();
      req.onsuccess = () => {
        let all: any[] = req.result || [];
        if (q.trim()) {
          const term = q.trim().toLowerCase();
          all = all.filter(
            (s) =>
              (s.invoiceNumber || '').toLowerCase().includes(term) ||
              (s.customerName || '').toLowerCase().includes(term) ||
              (s.cashierName || '').toLowerCase().includes(term),
          );
        }
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setSalesHistory(all);
        setLoadingSalesHistory(false);
      };
      req.onerror = () => setLoadingSalesHistory(false);
    } catch (e) {
      console.error('Local sales history error:', e);
      setLoadingSalesHistory(false);
    }
  };

  // Smart Search & Voice AI state
  const [showSmartSearch, setShowSmartSearch] = useState(false);
  const [smartSearchAutoVoice, setSmartSearchAutoVoice] = useState(false);

  // Cross-Branch Stock Check State
  const [crossStockModalMed, setCrossStockModalMed] = useState<SearchMedicine | null>(null);
  const [crossStockResults, setCrossStockResults] = useState<any[]>([]);
  const [crossStockLoading, setCrossStockLoading] = useState<boolean>(false);

  const handleCheckCrossStock = async (med: SearchMedicine) => {
    setCrossStockModalMed(med);
    setCrossStockLoading(true);
    try {
      const res = await apiRequest<any[]>(`/chain/cross-stock/${med.medicineId}`);
      setCrossStockResults(res || []);
    } catch {
      setCrossStockResults([]);
    } finally {
      setCrossStockLoading(false);
    }
  };

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Refresh pending offline sales counter
  const refreshPendingCount = async () => {
    try {
      const pending = await getPendingSales();
      setPendingSalesCount(pending.length);
    } catch (e) {
      console.error('Failed to get pending sales', e);
    }
  };

  // Sync offline sales & operations to cloud via unified Outbox
  const syncPendingSales = async () => {
    if (isSyncing || !navigator.onLine) return;
    try {
      setIsSyncing(true);
      const { syncedCount, failedCount } = await processOutboxQueue();
      await refreshPendingCount();

      if (syncedCount > 0) {
        setMessage({
          type: 'success',
          text: `تمت مزامنة (${syncedCount}) عملية أوفلاين بنجاح مع السحابة! ☁️✅`,
        });
      }
      if (failedCount > 0) {
        setMessage({
          type: 'error',
          text: `تنبيه: تعذر مزامنة ${failedCount} عملية أوفلاين. يرجى التحقق من حالة الاتصال.`,
        });
      }
    } catch (err: any) {
      console.warn('Outbox sync failed or postponed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Focus search bar on load & warm local IndexedDB cache
  useEffect(() => {
    searchInputRef.current?.focus();

    const warmCache = async () => {
      if (navigator.onLine) {
        try {
          const fullInv = await apiRequest<SearchMedicine[]>('/inventory');
          if (Array.isArray(fullInv) && fullInv.length > 0) {
            await cacheInventoryLocally(fullInv);
          }
        } catch (err) {
          console.warn('Could not warm inventory cache from server', err);
        }
      }
      refreshPendingCount();
    };
    warmCache();
  }, []);

  // Online / Offline Listeners & Auto-Sync
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncPendingSales();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Search medicines (Online with seamless Offline fallback) — Strictly available items only
  useEffect(() => {
    if (searchTerm.trim().length === 0) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      if (navigator.onLine) {
        try {
          const data = await apiRequest<SearchMedicine[]>(`/inventory?availableOnly=true&search=${encodeURIComponent(searchTerm)}`);
          const available = (Array.isArray(data) ? data : []).filter((med) => {
            const units = Number(med.validUnitsRemaining ?? med.totalUnitsRemaining ?? 0);
            const pks = Number(med.availablePacks ?? 0);
            const strs = Number(med.availableStrips ?? 0);
            return units > 0 || pks > 0 || strs > 0;
          });
          setSearchResults(available);
          return;
        } catch (err) {
          console.warn('Online search failed, falling back to local IndexedDB', err);
        }
      }

      // Offline search fallback
      try {
        const localData = await searchLocalInventory(searchTerm);
        const available = (Array.isArray(localData) ? localData : []).filter((med) => {
          const units = Number(med.validUnitsRemaining ?? med.totalUnitsRemaining ?? 0);
          const pks = Number(med.availablePacks ?? 0);
          const strs = Number(med.availableStrips ?? 0);
          return units > 0 || pks > 0 || strs > 0;
        });
        setSearchResults(available);
      } catch (err) {
        console.error('Offline search error:', err);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const addToCart = (med: SearchMedicine, unitType: 'PACK' | 'STRIP', specificBatch?: ActiveBatchInfo) => {
    let packPrice = Number(med.sellingPricePack) || 0;
    let unitPrice = roundTo250(Number(med.sellingPriceUnit) || (med.unitsPerPack > 1 ? calculateStripPrice(packPrice, med.unitsPerPack) : packPrice));

    // If medicine from Master Catalog has no price set yet, prompt cashier
    if (packPrice === 0 && unitPrice === 0) {
      const input = window.prompt(
        `الدواء (${med.tradeName}) من الدليل المركزي غير مسعر في مخزنك بعد.\nأدخل سعر البيع بالدينار العراقي:`,
        '5000',
      );
      if (!input || isNaN(Number(input)) || Number(input) <= 0) {
        return;
      }
      packPrice = Number(input);
      unitPrice = med.unitsPerPack > 1 ? calculateStripPrice(packPrice, med.unitsPerPack) : packPrice;
      med.sellingPricePack = packPrice;
      med.sellingPriceUnit = unitPrice;
    }

    const unitsPerPk = Number(med.unitsPerPack) || 1;
    const isPack = unitType === 'PACK';
    const totalAvailUnits = specificBatch
      ? Number(specificBatch.quantityUnitsRemaining || 0)
      : (med.activeBatches?.reduce((sum, b) => sum + Math.max(0, Number(b.quantityUnitsRemaining || 0)), 0) ?? Number(med.totalUnitsRemaining || 0));

    // Strict Pharmaceutical Stock Safety: Block adding 0-stock medicine
    if (totalAvailUnits <= 0) {
      alert(`عذراً، دواء (${med.tradeName}) غير متوفر في المخزون حالياً (الرصيد: 0). يرجى إدخال وتثبيت فاتورة شراء للمادة أولاً لتسجيل الوجبات وتحديث الرصيد.`);
      return;
    }

    const batchId = specificBatch?.id;
    const batchNumber = specificBatch?.batchNumber;

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.inventoryItemId === med.id && item.unitType === unitType && item.inventoryBatchId === batchId,
      );

      if (existingIndex > -1) {
        const current = prev[existingIndex];
        const newQty = current.quantity + 1;
        const unitsNeeded = isPack ? newQty * unitsPerPk : newQty;

        if (totalAvailUnits > 0 && unitsNeeded > totalAvailUnits) {
          alert(`عذراً، الكمية المطلوبة تتجاوز الرصيد المتوفر في المخزن لدواء (${med.tradeName}). المتوفر: ${med.availablePacks || Math.floor(totalAvailUnits / unitsPerPk)} علبة (${totalAvailUnits} وحدة).`);
          return prev;
        }

        const { totalPrice, effectiveUnitPrice, breakdown } = calculateDynamicItemTotals(
          current.activeBatches,
          current.defaultSellingPricePack,
          current.defaultSellingPriceUnit,
          current.unitsPerPack,
          newQty,
          unitType,
          current.inventoryBatchId,
        );

        const updated = [...prev];
        updated[existingIndex] = {
          ...current,
          quantity: newQty,
          unitPrice: effectiveUnitPrice,
          totalPrice,
          breakdown,
        };
        return updated;
      }

      const { totalPrice, effectiveUnitPrice, breakdown } = calculateDynamicItemTotals(
        med.activeBatches,
        packPrice,
        unitPrice,
        med.unitsPerPack,
        1,
        unitType,
        batchId,
      );

      return [
        ...prev,
        {
          inventoryItemId: med.id,
          inventoryBatchId: batchId,
          batchNumber,
          customName: med.customName,
          tradeName: med.tradeName,
          scientificName: med.scientificName,
          shelfLocation: med.shelfLocation,
          unitType,
          quantity: 1,
          unitPrice: effectiveUnitPrice,
          totalPrice,
          unitsPerPack: med.unitsPerPack,
          activeBatches: med.activeBatches,
          defaultSellingPricePack: Number(med.sellingPricePack),
          defaultSellingPriceUnit: roundTo250(Number(med.sellingPriceUnit) || (med.unitsPerPack > 1 ? calculateStripPrice(Number(med.sellingPricePack), med.unitsPerPack) : Number(med.sellingPricePack))),
          breakdown,
        },
      ];
    });

    setSearchTerm('');
    setSearchResults([]);
    searchInputRef.current?.focus();
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart((prev) => {
      const item = prev[index];
      const newQty = item.quantity + delta;

      if (newQty <= 0) {
        return prev.filter((_, i) => i !== index);
      }

      if (delta > 0) {
        const isPack = item.unitType === 'PACK';
        const unitsPerPk = Number(item.unitsPerPack) || 1;
        const totalUnitsAvail = item.activeBatches?.reduce((sum, b) => sum + Math.max(0, Number(b.quantityUnitsRemaining || 0)), 0) ?? 0;
        const unitsNeeded = isPack ? newQty * unitsPerPk : newQty;
        if (totalUnitsAvail > 0 && unitsNeeded > totalUnitsAvail) {
          alert(`الكمية المطلوبة تتجاوز الرصيد المتوفر في المخزن (${totalUnitsAvail} وحدة).`);
          return prev;
        }
      }

      const { totalPrice, effectiveUnitPrice, breakdown } = calculateDynamicItemTotals(
        item.activeBatches,
        item.defaultSellingPricePack,
        item.defaultSellingPriceUnit,
        item.unitsPerPack,
        newQty,
        item.unitType,
        item.inventoryBatchId,
      );

      const updated = [...prev];
      updated[index] = {
        ...item,
        quantity: newQty,
        unitPrice: effectiveUnitPrice,
        totalPrice,
        breakdown,
      };
      return updated;
    });
  };

  const removeItem = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  useEffect(() => {
    if (discountPercent !== '' && Number(discountPercent) > 0) {
      setDiscountAmount(roundTo250(subtotal * (Number(discountPercent) / 100)));
    }
  }, [subtotal, discountPercent]);

  const total = Math.max(0, roundTo250(subtotal - discountAmount));

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    setLoading(true);
    setMessage(null);

    const payload = {
      discountAmount: Number(discountAmount || 0),
      customerName: customerName.trim() || undefined,
      items: cart.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        inventoryBatchId: item.inventoryBatchId,
        unitType: item.unitType,
        quantity: item.quantity,
      })),
    };

    // Try online checkout first ONLY if truly online
    if (isOnline && navigator.onLine) {
      try {
        const result = await apiRequest<any>('/pos/checkout', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        setCompletedSale(result);

        // Record in local sales history for shift summary (marked as synced)
        recordLocalSale({
          offlineId: result.id || crypto.randomUUID(),
          invoiceNumber: result.invoiceNumber,
          payload,
          items: result.items || [],
          subtotal: result.subtotal || subtotal,
          discountAmount: result.discountAmount || discountAmount,
          totalAmount: result.totalAmount || total,
          createdAt: result.createdAt || new Date().toISOString(),
          cashierName: result.cashierName || 'كاشير',
          customerName: customerName.trim() || undefined,
          isSynced: true,
        }).catch(() => {});

        setCart([]);
        setDiscountAmount(0);
        setDiscountPercent('');
        setCustomerName('');
        setMessage({ type: 'success', text: `تم إتمام عملية البيع بنجاح! رقم الفاتورة: ${result.invoiceNumber}` });
        setLoading(false);
        searchInputRef.current?.focus();
        return;
      } catch (err: any) {
        // If it's a business/client rejection (400 Bad Request out of stock, 403, 404), do NOT fallback to offline. Alert user!
        if (err?.status && err.status >= 400 && err.status < 500) {
          setMessage({ type: 'error', text: err.message || 'فشلت عملية البيع' });
          alert(err.message || 'فشلت عملية البيع: يرجى التحقق من توفر المخزون وصحة البيانات');
          setLoading(false);
          return;
        }

        console.warn('Server checkout failed or connection lost, switching to Offline Mode', err);
        setIsOnline(false);
      }
    }

    // === OFFLINE CHECKOUT FALLBACK ===
    try {
      const offlineInvoiceNum = generateOfflineInvoiceNumber();
      const offlineId = crypto.randomUUID();

      const displayItems = cart.map((it, idx) => ({
        id: `off-item-${idx}`,
        tradeName: it.tradeName,
        scientificName: it.scientificName,
        unitType: it.unitType,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        batchNumber: it.batchNumber,
      }));

      // Build explicit batch allocations from cart breakdown
      const allocatedBatches: any[] = [];
      for (const it of cart) {
        const isPack = it.unitType === 'PACK';
        const unitsPerPk = Number(it.unitsPerPack) || 1;
        if (it.breakdown && it.breakdown.length > 0 && it.activeBatches) {
          for (const bPortion of it.breakdown) {
            const bObj = it.activeBatches.find((b) => b.batchNumber === bPortion.batchNumber);
            allocatedBatches.push({
              inventoryItemId: it.inventoryItemId,
              batchId: bObj?.id || it.inventoryBatchId,
              batchNumber: bPortion.batchNumber,
              units: isPack ? bPortion.qty * unitsPerPk : bPortion.qty,
              unitPrice: bPortion.unitPrice,
              costPricePack: bObj?.purchasePricePack || 0,
            });
          }
        } else if (it.inventoryBatchId || it.batchNumber) {
          allocatedBatches.push({
            inventoryItemId: it.inventoryItemId,
            batchId: it.inventoryBatchId,
            batchNumber: it.batchNumber,
            units: isPack ? it.quantity * unitsPerPk : it.quantity,
            unitPrice: it.unitPrice,
          });
        }
      }

      const offlineRecord: OfflineSaleRecord = {
        offlineId,
        invoiceNumber: offlineInvoiceNum,
        payload: {
          ...payload,
          allocatedBatches,
        },
        displayItems,
        subtotal,
        discountAmount,
        totalAmount: total,
        createdAt: new Date().toISOString(),
        cashierName: 'كاشير (محلي)',
        customerName: customerName.trim() || undefined,
      };

      // 1. Record sale locally in IndexedDB sales_history (for shift summary) and pending_sales
      await recordLocalSale({
        offlineId,
        invoiceNumber: offlineInvoiceNum,
        payload: offlineRecord.payload,
        items: displayItems,
        subtotal,
        discountAmount,
        totalAmount: total,
        createdAt: offlineRecord.createdAt,
        cashierName: 'كاشير (محلي)',
        customerName: customerName.trim() || undefined,
        isSynced: false,
      });

      // 2. Queue in unified Outbox for background cloud sync
      const saleSyncPayload = {
        sales: [
          {
            offlineId,
            offlineInvoiceNumber: offlineInvoiceNum,
            items: payload.items,
            allocatedBatches,
            discountAmount,
            customerName: customerName.trim() || undefined,
            createdAt: offlineRecord.createdAt,
          },
        ],
      };
      await queueOutboxOperation('SALE', '/pos/sync-offline', saleSyncPayload);

      // 3. Deduct stock from local IndexedDB
      await deductLocalInventoryStock(cart);

      // 3. Complete sale UI
      setCompletedSale({
        id: offlineId,
        invoiceNumber: offlineInvoiceNum,
        items: displayItems,
        subtotal,
        discountAmount,
        totalAmount: total,
        createdAt: offlineRecord.createdAt,
        cashierName: 'كاشير (محلي)',
        customerName: customerName.trim() || undefined,
        isOffline: true,
      });

      setCart([]);
      setDiscountAmount(0);
      setDiscountPercent('');
      setCustomerName('');
      await refreshPendingCount();

      setMessage({
        type: 'success',
        text: `⚡ تم إتمام البيع محلياً (بدون إنترنت) بنجاح! رقم الوصل: ${offlineInvoiceNum}`,
      });
    } catch (offlineErr: any) {
      setMessage({ type: 'error', text: offlineErr.message || 'فشل إتمام البيع محلياً' });
    } finally {
      setLoading(false);
      searchInputRef.current?.focus();
    }
  };

  // Quick Return Helper: Select medicine
  const handleSelectReturnMed = (med: SearchMedicine) => {
    setSelectedReturnMed(med);
    setReturnSearchTerm('');
    setReturnSearchResults([]);
    setReturnUnitType('PACK');
    setReturnQty(1);
    setIsManualRefundAmount(false);
    const defaultPrice = Number(med.sellingPricePack || 0);
    setReturnRefundAmount(defaultPrice);
  };

  // Recalculate default refund amount when unitType or qty changes (unless cashier edited manually)
  useEffect(() => {
    if (!selectedReturnMed || isManualRefundAmount) return;
    const unitPrice = returnUnitType === 'PACK'
      ? Number(selectedReturnMed.sellingPricePack || 0)
      : Number(selectedReturnMed.sellingPriceUnit || 0);
    setReturnRefundAmount(roundTo250(unitPrice * Number(returnQty || 1)));
  }, [selectedReturnMed, returnUnitType, returnQty, isManualRefundAmount]);

  // Fetch recent returns history
  const fetchRecentReturns = async () => {
    setLoadingRecentReturns(true);
    try {
      const data = await apiRequest<any[]>('/pos/returns?limit=30');
      setRecentReturns(Array.isArray(data) ? data : []);
    } catch {
      setRecentReturns([]);
    } finally {
      setLoadingRecentReturns(false);
    }
  };

  useEffect(() => {
    if (showReturnModal) {
      fetchRecentReturns();
      setTimeout(() => returnSearchInputRef.current?.focus(), 150);
    }
  }, [showReturnModal]);

  // Keyboard shortcut F4 for Quick Return
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F4') {
        e.preventDefault();
        setShowReturnModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Search medicines for return
  useEffect(() => {
    if (!returnSearchTerm.trim()) {
      setReturnSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setReturnSearching(true);
      try {
        if (navigator.onLine) {
          const res = await apiRequest<SearchMedicine[]>(`/inventory?search=${encodeURIComponent(returnSearchTerm)}`);
          setReturnSearchResults(Array.isArray(res) ? res : []);
        } else {
          const localRes = await searchLocalInventory(returnSearchTerm);
          setReturnSearchResults(Array.isArray(localRes) ? localRes : []);
        }
      } catch (e) {
        console.error('Error searching for return item', e);
      } finally {
        setReturnSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [returnSearchTerm]);

  // Process Quick Direct Return Submit
  const handleProcessQuickReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReturnMed) return;

    const numQty = Number(returnQty);
    if (!numQty || numQty <= 0) {
      alert('يرجى تحديد كمية صحيحة أكبر من صفر');
      return;
    }

    setReturnSubmitting(true);
    try {
      const payload = {
        inventoryItemId: selectedReturnMed.id,
        unitType: returnUnitType,
        quantity: numQty,
        refundAmount: Number(returnRefundAmount || 0),
        reason: returnReason.trim() || 'إرجاع سريع',
        itemCondition: returnCondition,
        paymentMethod: returnPaymentMethod,
        notes: returnNotes.trim() || undefined,
      };

      if (isOnline && navigator.onLine) {
        try {
          const res = await apiRequest<any>('/pos/return', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

          setCompletedReturnReceipt(res);
          setShowReturnModal(false);
          setSelectedReturnMed(null);
          setReturnSearchTerm('');
          setReturnQty(1);
          setReturnRefundAmount('');
          setIsManualRefundAmount(false);
          setReturnNotes('');

          await fetchShiftSummary();
          setShowShiftSummary(false);

          setMessage({
            type: 'success',
            text: res.message || 'تم إتمام عملية الإرجاع بنجاح!',
          });
          return;
        } catch (err: any) {
          if (err?.status && err.status >= 400 && err.status < 500) {
            alert(err.message || 'فشل إتمام عملية الإرجاع');
            setReturnSubmitting(false);
            return;
          }
          console.warn('Online return failed, falling back to offline outbox queue:', err);
        }
      }

      // Offline Return Fallback Queue
      const { queueOutboxOperation } = await import('../utils/outboxQueue');
      await queueOutboxOperation('RETURN', '/pos/return', payload);

      const localReturnReceipt = {
        id: `local-ret-${Date.now()}`,
        returnId: `local-ret-${Date.now()}`,
        tradeName: selectedReturnMed.customName || selectedReturnMed.tradeName,
        scientificName: selectedReturnMed.scientificName,
        unitType: returnUnitType,
        quantity: numQty,
        refundAmount: Number(returnRefundAmount || 0),
        reason: returnReason.trim() || 'إرجاع سريع',
        itemCondition: returnCondition,
        paymentMethod: returnPaymentMethod,
        notes: returnNotes.trim() || undefined,
        createdAt: new Date().toISOString(),
        isPendingSync: true,
      };

      setCompletedReturnReceipt(localReturnReceipt);
      setShowReturnModal(false);
      setSelectedReturnMed(null);
      setReturnSearchTerm('');
      setReturnQty(1);
      setReturnRefundAmount('');
      setIsManualRefundAmount(false);
      setReturnNotes('');

      setMessage({
        type: 'success',
        text: 'تم تسجيل عملية الإرجاع محلياً! وسيتم مزامنتها تلقائياً عند توفر الإنترنت 📡',
      });
    } catch (err: any) {
      alert(err.message || 'فشل إتمام عملية الإرجاع محلياً');
    } finally {
      setReturnSubmitting(false);
    }
  };

  const fetchShiftSummary = async () => {
    if (navigator.onLine) {
      try {
        const data = await apiRequest<any>('/pos/daily-summary');
        setShiftSummary(data);
        setShowShiftSummary(true);
        return;
      } catch (err) {}
    }

    try {
      const localData = await getLocalDailySummary();
      setShiftSummary(localData);
      setShowShiftSummary(true);
    } catch (err: any) {
      alert(err.message || 'فشل جلب ملخص الوردية محلياً');
    }
  };

  return (
    <>
      <div className="flex flex-col min-h-0 lg:h-[calc(100vh-80px)] gap-3 sm:gap-4 print:hidden w-full max-w-full overflow-x-hidden">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-xs w-full max-w-full">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <h1 className="text-lg sm:text-xl font-black text-slate-900 flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <span>الكاشير</span>
          </h1>

          {/* Offline / Online Connectivity Indicator */}
          {isOnline ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs sm:text-sm font-black shadow-2xs">
              {isLiveSyncConnected ? (
                <>
                  <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <span>مزامنة لحظية (Live)</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>متصل بالسحابة</span>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs sm:text-sm font-black shadow-2xs">
              <WifiOff className="w-4 h-4 text-amber-700" />
              <span>محلي (أوفلاين)</span>
            </div>
          )}

          {/* Pending Sales Sync Button */}
          {pendingSalesCount > 0 && (
            <button
              onClick={syncPendingSales}
              disabled={!isOnline || isSyncing}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl text-xs sm:text-sm font-black transition-all shadow-xs cursor-pointer active:scale-95"
              title="مزامنة الفواتير غير المرفوعة مع السيرفر"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>مزامنة ({pendingSalesCount})</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <button
            onClick={toggleFullscreen}
            className="hidden sm:flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl border border-indigo-200 transition-all cursor-pointer active:scale-95"
            title={isFullscreen ? 'الخروج من ملء الشاشة' : 'وضع ملء الشاشة (Kiosk Mode)'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span className="hidden md:inline">{isFullscreen ? 'تصغير' : 'ملء الشاشة'}</span>
          </button>

          <button
            onClick={() => {
              setShowSalesHistoryModal(true);
              fetchSalesHistory();
            }}
            className="flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-black text-indigo-900 bg-indigo-50 hover:bg-indigo-100 rounded-xl border border-indigo-200 transition-all cursor-pointer active:scale-95 shadow-2xs"
            title="استعراض والبحث في جميع الفواتير السابقة والزبائن"
          >
            <FileText className="w-4 h-4 text-indigo-600" />
            <span>سجل الفواتير 📄</span>
          </button>

          <button
            onClick={() => setShowReturnModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-black text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-xl border border-amber-300 transition-all cursor-pointer active:scale-95 shadow-2xs"
            title="إرجاع مباشر سريع بدون فاتورة (F4)"
          >
            <RotateCcw className="w-4 h-4 text-amber-700" />
            <span>إرجاع سريع (F4)</span>
          </button>

          <button
            onClick={fetchShiftSummary}
            className="flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-black text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-300 transition-all cursor-pointer active:scale-95"
          >
            <DollarSign className="w-4 h-4" />
            <span>اليومية</span>
          </button>

          <button
            onClick={async () => {
              await fetchShiftSummary();
              setShowShiftCloseModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-black text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-200 transition-all cursor-pointer active:scale-95 shadow-2xs"
            title="إغلاق وردية الكاشير ومطابقة نقد الدرج"
          >
            <Lock className="w-4 h-4" />
            <span>إغلاق الوردية</span>
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg flex items-center gap-2 text-sm font-medium ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="mr-auto text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Grid: Search & Catalog on Right, Cart on Left */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
        {/* Right Section: Fast Search & Results (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50/70 flex items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="ابحث بالاسم أو امسح الباركود..."
                className="w-full pr-12 pl-4 py-3 sm:py-3.5 bg-white border-2 border-slate-200 rounded-2xl text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm sm:text-base font-black shadow-xs transition-all"
              />
            </div>

            {/* Voice Search Button */}
            <button
              type="button"
              onClick={() => {
                setSmartSearchAutoVoice(true);
                setShowSmartSearch(true);
              }}
              className="h-12 sm:h-13 px-4 sm:px-5 bg-rose-50 hover:bg-rose-100 text-rose-700 border-2 border-rose-200 rounded-2xl transition-all cursor-pointer shadow-2xs active:scale-95 flex items-center gap-2 text-xs sm:text-sm font-black shrink-0"
              title="البحث الصوتي الذكي (Voice AI)"
            >
              <Mic className="w-4 h-4 sm:w-5 sm:h-5 text-rose-600 animate-pulse" />
              <span className="hidden sm:inline">صوتي 🎙️</span>
            </button>

            {/* Smart Clinical Search Button */}
            <button
              type="button"
              onClick={() => {
                setSmartSearchAutoVoice(false);
                setShowSmartSearch(true);
              }}
              className="h-12 sm:h-13 px-4 sm:px-5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-2 border-indigo-200 rounded-2xl transition-all cursor-pointer shadow-2xs active:scale-95 flex items-center gap-2 text-xs sm:text-sm font-black shrink-0"
              title="البحث باللغة الطبيعية والبدائل (AI Co-Pilot)"
            >
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" />
              <span className="hidden md:inline">مساعد ذكي 🧠</span>
            </button>
          </div>

          {/* Results List */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 divide-y divide-slate-100">
            {searchResults.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
                <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center mb-3">
                  <Package className="w-8 h-8 text-slate-400 stroke-[1.5]" />
                </div>
                {searchTerm.trim().length > 0 ? (
                  <>
                    <p className="text-base font-black text-slate-700">لا يوجد دواء مطابق في مخزن الصيدلية</p>
                    <p className="text-xs text-slate-400 mt-1">تأكد من كتابة الاسم أو امسح الباركود، أو ابحث في المساعد الذكي</p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-black text-slate-600">امسح الباركود أو ابحث عن العلاج</p>
                    <p className="text-xs text-slate-400 mt-1">تظهر أدوية المخزن وأسعار العلب والأشرطة فوراً</p>
                  </>
                )}
              </div>
            ) : (
              searchResults.map((med) => {
                const hasMultipleBatches = med.activeBatches && med.activeBatches.length > 1;

                return (
                  <div key={med.id} className="p-3 sm:p-4 hover:bg-slate-50/90 rounded-2xl transition-all border-b border-slate-100 last:border-0">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-900 text-base sm:text-lg">{med.tradeName}</span>
                          {med.shelfLocation && (
                            <span className="px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs font-black font-mono shadow-2xs">
                              📍 {med.shelfLocation}
                            </span>
                          )}
                          {med.customName && (
                            <span className="px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-xl text-xs font-black">
                              🏷️ {med.customName}
                            </span>
                          )}
                          {med.totalUnitsRemaining <= 0 ? (
                            <span className="text-xs px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-black">
                              نافد
                            </span>
                          ) : (
                            <span className="text-xs px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-black">
                              متوفر: {med.availablePacks} علبة و {med.availableStrips} شريط
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCheckCrossStock(med);
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-black flex items-center gap-1 cursor-pointer transition-colors shadow-2xs active:scale-95"
                            title="فحص توفر هذا الدواء في باقي فروع السلسلة"
                          >
                            <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                            <span>فحص بالفروع</span>
                          </button>
                        </div>
                        <div className="text-xs sm:text-sm text-slate-500 font-medium mt-1 truncate">
                          {med.scientificName}
                          {med.strength && <span className="mx-1.5 text-slate-700 font-bold">• {med.strength}</span>}
                          {med.dosageForm && <span className="text-slate-500">({med.dosageForm})</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Add Pack Button */}
                        <button
                          onClick={() => addToCart(med, 'PACK')}
                          className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-black shadow-md shadow-emerald-700/20 active:scale-95 transition-all cursor-pointer"
                        >
                          <Plus className="w-4 h-4 stroke-[3]" />
                          <span>علبة</span>
                          <span className="font-mono font-bold bg-emerald-700/50 px-2 py-0.5 rounded-lg text-emerald-100">
                            {Number(med.sellingPricePack).toLocaleString()} د.ع
                          </span>
                        </button>

                        {/* Add Strip Button (Only if units per pack > 1) */}
                        {med.unitsPerPack > 1 && (
                          <button
                            onClick={() => addToCart(med, 'STRIP')}
                            className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-black shadow-md shadow-blue-700/20 active:scale-95 transition-all cursor-pointer"
                          >
                            <Layers className="w-4 h-4 stroke-[2.5]" />
                            <span>شريط</span>
                            <span className="font-mono font-bold bg-blue-700/50 px-2 py-0.5 rounded-lg text-blue-100">
                              {roundTo250(Number(med.sellingPriceUnit) || calculateStripPrice(Number(med.sellingPricePack), med.unitsPerPack)).toLocaleString()} د.ع
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Batch Selector if multiple batches exist with differing prices */}
                    {hasMultipleBatches && (
                      <div className="mt-2.5 pt-2.5 border-t border-dashed border-slate-200 flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-slate-500">اختر تشغيلة محددة:</span>
                        {med.activeBatches?.map((batch) => (
                          <button
                            key={batch.id}
                            type="button"
                            onClick={() => addToCart(med, 'PACK', batch)}
                            className="px-3 py-1.5 bg-white hover:bg-emerald-50 text-slate-800 hover:text-emerald-950 border border-slate-200 hover:border-emerald-300 rounded-xl text-xs font-black transition-all cursor-pointer shadow-2xs flex items-center gap-2 active:scale-95"
                            title="إضافة هذه الوجبة المحددة مباشرة إلى السلة"
                          >
                            <span className="font-mono">تشغيلة: {batch.batchNumber || '—'}</span>
                            <span className="font-mono text-emerald-700">{Number(batch.sellingPricePack).toLocaleString()} د.ع</span>
                            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">{batch.availablePacks} علب</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Left Section: Active Invoice / Cart (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col bg-white rounded-2xl border-2 border-slate-200 shadow-md overflow-hidden">
          {/* Cart Header */}
          <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h2 className="font-black text-slate-900 flex items-center gap-2.5 text-base sm:text-lg">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <span>السلة</span>
            </h2>
            <span className="text-sm font-black px-3.5 py-1 bg-slate-200 text-slate-800 rounded-full font-mono">
              {cart.length} مواد
            </span>
          </div>

          {/* Cart Items Table */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 divide-y divide-slate-100 min-h-0 space-y-1">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
                <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center mb-3">
                  <ShoppingCart className="w-8 h-8 text-slate-400 stroke-[1.5]" />
                </div>
                <p className="text-base font-black text-slate-600">السلة فارغة</p>
                <p className="text-xs text-slate-400 mt-1">اختر أدوية من القائمة للبدء بالبيع</p>
              </div>
            ) : (
              cart.map((item, idx) => (
                <div key={`${item.inventoryItemId}-${item.unitType}-${item.inventoryBatchId || ''}`} className="py-2.5 sm:py-3 flex items-center justify-between gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-slate-900 text-sm sm:text-base truncate flex items-center gap-1.5 flex-wrap">
                      <span>{item.tradeName}</span>
                      {item.shelfLocation && (
                        <span className="text-amber-900 font-black text-xs bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200 font-mono">
                          📍 {item.shelfLocation}
                        </span>
                      )}
                      {item.batchNumber && (
                        <span className="text-indigo-900 font-black text-xs bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-200 font-mono">
                          تشغيلة: {item.batchNumber}
                        </span>
                      )}
                      {item.customName && (
                        <span className="text-amber-800 font-black text-xs bg-amber-50 px-1.5 py-0.5 rounded-md">
                          ({item.customName})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600 mt-1 flex-wrap">
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-black shadow-2xs ${item.unitType === 'PACK' ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : 'bg-blue-100 text-blue-900 border border-blue-300'}`}>
                        {item.unitType === 'PACK' ? 'علبة' : 'شريط'}
                      </span>
                      {item.breakdown && item.breakdown.length > 1 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {item.breakdown.map((b, bi) => (
                            <span key={bi} className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-lg border border-slate-300 text-xs font-mono font-bold">
                              {b.qty} × {roundTo250(Number(b.unitPrice)).toLocaleString()} د.ع
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="font-mono font-bold text-slate-700">{roundTo250(item.unitPrice).toLocaleString()} د.ع</span>
                      )}
                    </div>
                  </div>

                  {/* Quantity Controls */}
                  <div className="flex items-center gap-1.5 bg-slate-100 rounded-2xl p-1 border border-slate-200 shadow-2xs shrink-0">
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, -1)}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white hover:bg-rose-50 hover:text-rose-700 text-slate-800 flex items-center justify-center shadow-xs cursor-pointer active:scale-90 transition-all font-black"
                    >
                      <Minus className="w-4 h-4 stroke-[3]" />
                    </button>
                    <span className="w-7 sm:w-8 text-center font-black text-base sm:text-lg text-slate-900 font-mono">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, 1)}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white hover:bg-emerald-50 hover:text-emerald-700 text-slate-800 flex items-center justify-center shadow-xs cursor-pointer active:scale-90 transition-all font-black"
                    >
                      <Plus className="w-4 h-4 stroke-[3]" />
                    </button>
                  </div>

                  {/* Line Total */}
                  <div className="w-20 sm:w-24 text-left font-black text-sm sm:text-base text-slate-900 font-mono shrink-0">
                    {roundTo250(item.totalPrice).toLocaleString()} د.ع
                  </div>

                  {/* Remove Button */}
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                    title="حذف من السلة"
                  >
                    <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Cart Footer & Checkout */}
          <div className="p-3.5 sm:p-4 border-t-2 border-slate-200 bg-slate-50/90 space-y-3 shrink-0">
            {/* Subtotal */}
            <div className="flex justify-between items-center text-sm sm:text-base font-black text-slate-700">
              <span>المجموع قبل الخصم:</span>
              <span className="text-base sm:text-lg font-black font-mono text-slate-900">{subtotal.toLocaleString()} د.ع</span>
            </div>

            {/* Discount */}
            <div className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-xl border border-slate-200">
              <span className="text-sm font-black text-slate-700">الخصم:</span>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discountPercent === '' ? '' : discountPercent}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setDiscountPercent('');
                        setDiscountAmount(0);
                      } else {
                        const pct = Number(val);
                        setDiscountPercent(pct);
                        setDiscountAmount(roundTo250(subtotal * (pct / 100)));
                      }
                    }}
                    placeholder="%"
                    className="w-20 h-10 px-3 pr-7 bg-white border-2 border-slate-300 rounded-xl text-left text-sm font-black text-rose-600 focus:outline-hidden focus:border-emerald-500 font-mono"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">%</span>
                </div>
                <input
                  type="number"
                  min="0"
                  step="250"
                  value={discountAmount || ''}
                  onChange={(e) => {
                    setDiscountAmount(Number(e.target.value));
                    setDiscountPercent('');
                  }}
                  placeholder="مبلغ الخصم"
                  className="w-28 h-10 px-3 bg-white border-2 border-slate-300 rounded-xl text-left text-sm font-black text-rose-600 focus:outline-hidden focus:border-emerald-500 font-mono"
                />
              </div>
            </div>

            {/* Customer Name Input (Optional) */}
            <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-slate-200">
              <UserCheck className="w-4 h-4 text-indigo-600 shrink-0" />
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="اسم المشتري / العميل (اختياري)..."
                className="w-full text-xs sm:text-sm font-bold text-slate-800 focus:outline-hidden bg-transparent"
              />
            </div>

            {/* Total */}
            <div className="flex justify-between items-center py-2.5 px-3.5 bg-emerald-50 rounded-xl border-2 border-emerald-200 text-slate-900">
              <span className="text-base sm:text-lg font-black text-emerald-950">المبلغ الإجمالي:</span>
              <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-700">{total.toLocaleString()} د.ع</span>
            </div>

            {/* Checkout Button */}
            <button
              type="button"
              onClick={handleCheckout}
              disabled={cart.length === 0 || loading}
              className="w-full h-14 sm:h-16 bg-emerald-600 hover:bg-emerald-700 active:scale-98 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-2xl font-black text-lg sm:text-xl shadow-lg shadow-emerald-700/25 flex items-center justify-center gap-3 transition-all cursor-pointer"
            >
              {loading ? (
                <RefreshCw className="w-6 h-6 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
                  <span>إتمام البيع ({total.toLocaleString()} د.ع)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Sale Success / Receipt Modal */}
      {completedSale && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in fade-in duration-200">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-black text-slate-900">تم البيع بنجاح</h3>
              <p className="text-xs text-slate-500 mt-1">رقم الفاتورة: {completedSale.invoiceNumber}</p>
            </div>

            <div className="mt-4 p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs text-slate-600 border border-slate-200">
              <div className="flex justify-between">
                <span>الوقت:</span>
                <span>{new Date(completedSale.createdAt).toLocaleTimeString('ar-IQ')}</span>
              </div>
              <div className="flex justify-between">
                <span>الكاشير:</span>
                <span>{completedSale.cashierName || 'الكاشير'}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200">
                <span>الواصل:</span>
                <span className="text-emerald-700 font-mono text-sm">{Number(completedSale.totalAmount).toLocaleString()} د.ع</span>
              </div>
            </div>

            {completedSale.items && completedSale.items.length > 0 && (
              <div className="mt-3 divide-y divide-slate-100 border-t border-b border-slate-200 py-1 max-h-48 overflow-y-auto">
                <div className="text-[10px] font-bold text-slate-400 mb-1">المواد:</div>
                {completedSale.items.map((it: any, i: number) => (
                  <div key={i} className="py-1.5 flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-slate-800">{it.tradeName}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
                        <span>{it.quantity} {it.unitType === 'PACK' ? 'علبة' : 'شريط'} × {roundTo250(Number(it.unitPrice)).toLocaleString()} د.ع</span>
                        {it.batchNumber && (
                          <span className="text-indigo-700 font-mono font-bold bg-indigo-50 px-1 py-0.2 rounded border border-indigo-200 text-[9px]">
                            وجبة: {it.batchNumber}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="font-black text-slate-900 self-center font-mono">
                      {roundTo250(Number(it.totalPrice)).toLocaleString()} د.ع
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 mt-6">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-base font-black flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95 transition-all"
              >
                <Printer className="w-5 h-5" />
                <span>طباعة الوصل</span>
              </button>
              <button
                type="button"
                onClick={() => setCompletedSale(null)}
                className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-base font-black flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95 transition-all"
              >
                <Plus className="w-5 h-5" />
                <span>بيع جديد</span>
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Shift Summary Drawer */}
      {showShiftSummary && shiftSummary && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                ملخص وردية اليوم
              </h3>
              <button onClick={() => setShowShiftSummary(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">عدد الفواتير الصادرة:</span>
                <span className="font-bold text-slate-900">{shiftSummary.totalInvoices}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">مجموع المبيعات:</span>
                <span className="font-bold text-slate-900">{shiftSummary.totalSalesRevenue.toLocaleString()} د.ع</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">إجمالي الخصومات:</span>
                <span className="font-bold text-rose-600">{shiftSummary.totalDiscounts.toLocaleString()} د.ع</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">إجمالي المرتجعات:</span>
                <span className="font-bold text-amber-600">{shiftSummary.totalRefunds.toLocaleString()} د.ع</span>
              </div>
              <div className="flex justify-between py-2 bg-emerald-50 px-3 rounded-lg text-emerald-900 font-extrabold text-base">
                <span>صافي الكاش في الدرج:</span>
                <span>{shiftSummary.netCashInDrawer.toLocaleString()} د.ع</span>
              </div>
            </div>

            <button
              onClick={() => setShowShiftSummary(false)}
              className="w-full mt-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
      </div>

      {/* Thermal Receipt UI - Only visible during print */}
      {completedSale && (
        <div className="hidden print:block w-[80mm] text-black bg-white text-[12px] leading-tight font-sans mx-auto" dir="rtl">
          <div className="text-center mb-3">
            <h2 className="font-bold text-lg mb-1">صيدليتي</h2>
            <p className="text-[10px] text-gray-600">وصل مبيعات</p>
            <p className="text-[10px] text-gray-600 font-mono mt-1">{completedSale.invoiceNumber}</p>
          </div>
          
          <div className="border-t border-b border-dashed border-gray-400 py-1 mb-2 text-[10px] flex justify-between">
            <span>التاريخ: {new Date(completedSale.createdAt).toLocaleString('ar-IQ')}</span>
            <span>الكاشير: {completedSale.cashierName || 'الكاشير'}</span>
          </div>

          <table className="w-full text-[11px] mb-2">
            <thead>
              <tr className="border-b border-gray-400">
                <th className="text-right py-1">المادة</th>
                <th className="text-center py-1">الكمية</th>
                <th className="text-left py-1">السعر</th>
                <th className="text-left py-1">المجموع</th>
              </tr>
            </thead>
            <tbody>
              {completedSale.items?.map((item: any) => (
                <tr key={item.id} className="border-b border-dotted border-gray-300">
                  <td className="py-1">
                    <div className="font-bold">{item.tradeName}</div>
                    <div className="text-[9px] text-gray-600">
                      {item.unitType === 'PACK' ? 'علبة' : 'شريط'}
                      {item.batchNumber ? ` (تشغيلة: ${item.batchNumber})` : ''}
                    </div>
                  </td>
                  <td className="text-center py-1">{item.quantity}</td>
                  <td className="text-left py-1">{roundTo250(Number(item.unitPrice)).toLocaleString()}</td>
                  <td className="text-left py-1">{roundTo250(Number(item.totalPrice)).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-between items-center text-[11px] mb-1">
            <span>المجموع:</span>
            <span>{Number(completedSale.subtotal).toLocaleString()} د.ع</span>
          </div>
          {Number(completedSale.discountAmount) > 0 && (
            <div className="flex justify-between items-center text-[11px] mb-1">
              <span>الخصم:</span>
              <span>{Number(completedSale.discountAmount).toLocaleString()} د.ع</span>
            </div>
          )}
          <div className="flex justify-between items-center text-[13px] font-bold mt-1 pt-1 border-t border-gray-400">
            <span>الإجمالي:</span>
            <span>{Number(completedSale.totalAmount).toLocaleString()} د.ع</span>
          </div>
          
          <div className="text-center mt-5 text-[10px] text-gray-600">
            <p>شكراً لزيارتكم</p>
            <p>تم تطوير النظام بواسطة Antigravity</p>
          </div>
        </div>
      )}

      {/* Quick Direct Return Thermal Slip - Only visible during print */}
      {completedReturnReceipt && (
        <div className="hidden print:block w-[80mm] text-black bg-white text-[12px] leading-tight font-sans mx-auto" dir="rtl">
          <div className="text-center mb-3">
            <h2 className="font-bold text-lg mb-1">صيدليتي</h2>
            <div className="inline-block px-2 py-0.5 border border-black font-bold text-[11px] mb-1">
              وصل إرجاع دواء رسمي (Refund Slip)
            </div>
            <p className="text-[10px] text-gray-600 font-mono mt-1">
              #RET-{completedReturnReceipt.returnId?.slice(0, 8).toUpperCase()}
            </p>
          </div>

          <div className="border-t border-b border-dashed border-gray-400 py-1 mb-2 text-[10px] flex justify-between">
            <span>التاريخ: {new Date(completedReturnReceipt.createdAt).toLocaleString('ar-IQ')}</span>
            <span>الكاشير: {completedReturnReceipt.cashierName || 'الكاشير'}</span>
          </div>

          <div className="space-y-1.5 text-[11px] mb-3">
            <div className="flex justify-between font-bold">
              <span>الدواء المرجع:</span>
              <span>{completedReturnReceipt.tradeName}</span>
            </div>
            {completedReturnReceipt.scientificName && (
              <div className="text-[9px] text-gray-600 text-left">
                {completedReturnReceipt.scientificName}
              </div>
            )}
            <div className="flex justify-between">
              <span>الكمية والوحدة:</span>
              <span className="font-mono">
                {completedReturnReceipt.quantity} {completedReturnReceipt.unitType === 'PACK' ? 'علبة' : 'شريط'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>حالة الدواء:</span>
              <span className="font-bold">
                {completedReturnReceipt.itemCondition === 'RESALEABLE'
                  ? '🟢 سليم (أُعيد للمخزون)'
                  : '🔴 تالف (معزول خارج الرف)'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>طريقة رد المبلغ:</span>
              <span>
                {completedReturnReceipt.paymentMethod === 'CASH'
                  ? 'نقداً من كاش الدرج'
                  : completedReturnReceipt.paymentMethod === 'ZAIN_CASH'
                  ? 'زين كاش'
                  : 'كي كارد'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>سبب الإرجاع:</span>
              <span>{completedReturnReceipt.reason || 'إرجاع سريع'}</span>
            </div>
            {completedReturnReceipt.notes && (
              <div className="text-[10px] text-gray-700 bg-gray-50 p-1 rounded border border-gray-200">
                ملاحظات: {completedReturnReceipt.notes}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center text-[13px] font-bold mt-2 pt-2 border-t-2 border-dashed border-black">
            <span>المبلغ المسترد للمريض:</span>
            <span>{Number(completedReturnReceipt.refundAmount || 0).toLocaleString()} د.ع</span>
          </div>

          <div className="text-center mt-5 text-[10px] text-gray-600">
            <p>تم تدقيق حالة العبوة ومطابقة حركة الصندوق</p>
            <p>نظام دوائي لإدارة الصيدليات</p>
          </div>
        </div>
      )}

      {/* Quick Direct Return Modal (F4) */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 shrink-0 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shadow-xs">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
                    <span>الإرجاع المباشر السريع</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 font-bold border border-amber-200">
                      F4
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    إرجاع مباشر بدون فاتورة، فحص سلامة المخزون وتوثيق حركة الكاش
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowReturnModal(false);
                  setSelectedReturnMed(null);
                  setReturnSearchTerm('');
                  setReturnSearchResults([]);
                }}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 cursor-pointer transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-100/70 px-4 sm:px-5 pt-2 gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setReturnModalTab('NEW_RETURN')}
                className={`pb-2.5 px-3 text-xs sm:text-sm font-black border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  returnModalTab === 'NEW_RETURN'
                    ? 'border-amber-600 text-amber-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
                <span>إرجاع مادة جديدة</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setReturnModalTab('RECENT_RETURNS');
                  fetchRecentReturns();
                }}
                className={`pb-2.5 px-3 text-xs sm:text-sm font-black border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  returnModalTab === 'RECENT_RETURNS'
                    ? 'border-amber-600 text-amber-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <History className="w-4 h-4" />
                <span>سجل إرجاعات الوردية ({recentReturns.length})</span>
              </button>
            </div>

            {/* Tab 1: New Return Form */}
            {returnModalTab === 'NEW_RETURN' && (
              <form onSubmit={handleProcessQuickReturn} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
                {/* Medicine Search & Selection */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">
                    اختر الدواء المراد إرجاعه * (بحث بالاسم أو الباركود)
                  </label>

                  {!selectedReturnMed ? (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                          ref={returnSearchInputRef}
                          type="text"
                          value={returnSearchTerm}
                          onChange={(e) => setReturnSearchTerm(e.target.value)}
                          placeholder="اكتب اسم الدواء، أو امسح الباركود مباشرة..."
                          className="w-full pr-10 pl-4 py-3 bg-slate-50 border border-slate-300 rounded-2xl text-slate-900 font-bold focus:outline-hidden focus:border-amber-500 focus:bg-white text-sm"
                        />
                        {returnSearching && (
                          <RefreshCw className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-600 animate-spin" />
                        )}
                      </div>

                      {/* Results List */}
                      {returnSearchResults.length > 0 && (
                        <div className="max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                          {returnSearchResults.map((med) => (
                            <button
                              key={med.id}
                              type="button"
                              onClick={() => handleSelectReturnMed(med)}
                              className="w-full p-3 text-right hover:bg-amber-50/70 transition-all flex items-center justify-between gap-3 cursor-pointer group"
                            >
                              <div>
                                <div className="font-black text-slate-900 group-hover:text-amber-900 text-sm">
                                  {med.customName || med.tradeName}
                                </div>
                                {med.scientificName && (
                                  <div className="text-[11px] text-slate-500 font-medium">
                                    {med.scientificName}
                                  </div>
                                )}
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  1 علبة = {med.unitsPerPack || 1} شريط
                                </div>
                              </div>

                              <div className="text-left shrink-0">
                                <div className="font-mono font-black text-amber-900 text-xs">
                                  علبة: {Number(med.sellingPricePack || 0).toLocaleString()} د.ع
                                </div>
                                {Number(med.unitsPerPack) > 1 && (
                                  <div className="font-mono text-[10px] text-slate-500">
                                    شريط: {Number(med.sellingPriceUnit || 0).toLocaleString()} د.ع
                                  </div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {returnSearchTerm.trim().length > 1 && returnSearchResults.length === 0 && !returnSearching && (
                        <div className="p-4 bg-slate-50 rounded-2xl text-center text-slate-400 font-medium border border-slate-200">
                          لم يتم العثور على دواء يطابق البحث
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Selected Medicine Banner */
                    <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-2xl flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-900 text-sm">
                            {selectedReturnMed.customName || selectedReturnMed.tradeName}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 bg-amber-200 text-amber-900 rounded-lg font-bold">
                            تم اختياره
                          </span>
                        </div>
                        {selectedReturnMed.scientificName && (
                          <div className="text-[11px] text-slate-600 font-medium mt-0.5">
                            {selectedReturnMed.scientificName}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-500 mt-1 font-mono">
                          سعر العلبة: {Number(selectedReturnMed.sellingPricePack || 0).toLocaleString()} د.ع • 
                          سعر الشريط: {Number(selectedReturnMed.sellingPriceUnit || 0).toLocaleString()} د.ع
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReturnMed(null);
                          setReturnSearchTerm('');
                          setTimeout(() => returnSearchInputRef.current?.focus(), 100);
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-all shrink-0"
                      >
                        تغيير الدواء
                      </button>
                    </div>
                  )}
                </div>

                {selectedReturnMed && (
                  <>
                    {/* Unit & Quantity Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Unit Type Selection */}
                      <div>
                        <label className="block font-bold text-slate-700 mb-1.5">وحدة الإرجاع *</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setReturnUnitType('PACK');
                              setIsManualRefundAmount(false);
                            }}
                            className={`p-2.5 rounded-xl border text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
                              returnUnitType === 'PACK'
                                ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <Package className="w-4 h-4" />
                            <span>علبة كاملة (Pack)</span>
                          </button>

                          {Number(selectedReturnMed.unitsPerPack) > 1 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setReturnUnitType('STRIP');
                                setIsManualRefundAmount(false);
                              }}
                              className={`p-2.5 rounded-xl border text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
                                returnUnitType === 'STRIP'
                                  ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <Layers className="w-4 h-4" />
                              <span>شريط (Strip)</span>
                            </button>
                          ) : (
                            <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 text-center font-bold">
                              غير قابل للتجزئة
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Quantity Input */}
                      <div>
                        <label className="block font-bold text-slate-700 mb-1.5">الكمية المرجعة *</label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setReturnQty((prev) => Math.max(1, prev - 1));
                              setIsManualRefundAmount(false);
                            }}
                            className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black flex items-center justify-center cursor-pointer active:scale-95 transition-all text-base shrink-0"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            value={returnQty}
                            onChange={(e) => {
                              const val = Math.max(1, Number(e.target.value) || 1);
                              setReturnQty(val);
                              setIsManualRefundAmount(false);
                            }}
                            className="flex-1 p-2.5 text-center font-mono font-black text-base bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:border-amber-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setReturnQty((prev) => prev + 1);
                              setIsManualRefundAmount(false);
                            }}
                            className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black flex items-center justify-center cursor-pointer active:scale-95 transition-all text-base shrink-0"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Refund Amount (Editable Unit / Total Price) */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-bold text-slate-700">المبلغ المسترد للمريض (د.ع) *</label>
                        {isManualRefundAmount && (
                          <button
                            type="button"
                            onClick={() => setIsManualRefundAmount(false)}
                            className="text-[11px] text-indigo-600 hover:underline font-bold"
                          >
                            استعادة السعر القياسي
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          required
                          min="0"
                          step="250"
                          value={returnRefundAmount}
                          onChange={(e) => {
                            setIsManualRefundAmount(true);
                            setReturnRefundAmount(e.target.value === '' ? '' : Number(e.target.value));
                          }}
                          className={`w-full p-3 font-mono font-black text-base rounded-xl border text-slate-900 focus:outline-hidden ${
                            isManualRefundAmount
                              ? 'bg-amber-50/50 border-amber-300 focus:border-amber-500'
                              : 'bg-slate-50 border-slate-300 focus:border-amber-500'
                          }`}
                        />
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400">
                          د.ع
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                        <span>
                          السعر القياسي للـ {returnUnitType === 'PACK' ? 'علبة' : 'شريط'}:{' '}
                          {Number(
                            returnUnitType === 'PACK'
                              ? selectedReturnMed.sellingPricePack
                              : selectedReturnMed.sellingPriceUnit
                          ).toLocaleString()}{' '}
                          د.ع
                        </span>
                        {isManualRefundAmount && (
                          <span className="text-amber-800 font-bold">⚠️ تم تعديل السعر يدوياً</span>
                        )}
                      </div>
                    </div>

                    {/* Item Condition / Disposition (Safety of Stock) */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1.5">
                        تحديد مصير الدواء المرجع (سلامة المخزون) 🛡️ *
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {/* Resaleable */}
                        <div
                          onClick={() => setReturnCondition('RESALEABLE')}
                          className={`p-3 rounded-2xl border-2 cursor-pointer transition-all flex items-start gap-3 ${
                            returnCondition === 'RESALEABLE'
                              ? 'bg-emerald-50/70 border-emerald-500 text-emerald-950 shadow-xs'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                              returnCondition === 'RESALEABLE'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            <ShieldCheck className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-black text-xs text-slate-900 flex items-center gap-1.5">
                              <span>🟢 سليم وصالح للبيع</span>
                              {returnCondition === 'RESALEABLE' && (
                                <span className="text-[10px] px-1.5 py-0.2 bg-emerald-200 text-emerald-900 rounded-md font-bold">
                                  محدد
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 leading-normal mt-0.5">
                              يُعاد فوراً إلى المخزون النشط ورصيد الرف ككمية قابلة للبيع.
                            </p>
                          </div>
                        </div>

                        {/* Damaged / Quarantined */}
                        <div
                          onClick={() => setReturnCondition('DAMAGED')}
                          className={`p-3 rounded-2xl border-2 cursor-pointer transition-all flex items-start gap-3 ${
                            returnCondition === 'DAMAGED'
                              ? 'bg-rose-50/70 border-rose-500 text-rose-950 shadow-xs'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                              returnCondition === 'DAMAGED'
                                ? 'bg-rose-600 text-white'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            <AlertTriangle className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-black text-xs text-slate-900 flex items-center gap-1.5">
                              <span>🔴 تالف أو منتهي الصلاحية</span>
                              {returnCondition === 'DAMAGED' && (
                                <span className="text-[10px] px-1.5 py-0.2 bg-rose-200 text-rose-900 rounded-md font-bold">
                                  معزول
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 leading-normal mt-0.5">
                              يُعزل في التوالف ولا يعاد للبيع، مع توثيقه وخصم كاش الوردية.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Cash & Shift Audit: Payment Method */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1.5">
                        طريقة رد المبلغ وأثرها على كاش الوردية 💰 *
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setReturnPaymentMethod('CASH')}
                          className={`p-2.5 rounded-xl border text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            returnPaymentMethod === 'CASH'
                              ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <Wallet className="w-4 h-4" />
                          <span>نقداً من الدرج</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setReturnPaymentMethod('ZAIN_CASH')}
                          className={`p-2.5 rounded-xl border text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            returnPaymentMethod === 'ZAIN_CASH'
                              ? 'bg-purple-700 text-white border-purple-700 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <Zap className="w-4 h-4" />
                          <span>زين كاش</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setReturnPaymentMethod('QI_CARD')}
                          className={`p-2.5 rounded-xl border text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            returnPaymentMethod === 'QI_CARD'
                              ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <CreditCard className="w-4 h-4" />
                          <span>كي كارد</span>
                        </button>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {returnPaymentMethod === 'CASH'
                          ? '💡 سيُخصم المبلغ المسترد تلقائياً من صافي كاش الدرج (Net Cash) في تقرير اليومية وتسليم الوردية.'
                          : '💡 المعاملة إلكترونية ولا تؤثر على الكاش الورقي داخل الدرج.'}
                      </div>
                    </div>

                    {/* Common Reasons Chips */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1.5">سبب الإرجاع *</label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {[
                          'المريض لم يعد بحاجة له',
                          'خطأ في شراء الدواء',
                          'تحسس أو عدم ملائمة المريض',
                          'تالف أو عيب مصنعي',
                          'تغيير الطبيب للعلاج',
                        ].map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => setReturnReason(chip)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                              returnReason === chip
                                ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-transparent'
                            }`}
                          >
                            {chip}
                          </button>
                        ))}
                      </div>

                      <input
                        type="text"
                        required
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        placeholder="أو اكتب سبب الإرجاع..."
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 focus:outline-hidden focus:border-amber-500"
                      />
                    </div>

                    {/* Notes (Optional) */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1.5">ملاحظات إضافية (اختياري)</label>
                      <textarea
                        rows={2}
                        value={returnNotes}
                        onChange={(e) => setReturnNotes(e.target.value)}
                        placeholder="وصف حالة العبوة، سلامة الغطاء، أو أي ملاحظات أخرى..."
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 focus:outline-hidden focus:border-amber-500 resize-none"
                      />
                    </div>
                  </>
                )}

                {/* Footer Buttons */}
                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setShowReturnModal(false);
                      setSelectedReturnMed(null);
                      setReturnSearchTerm('');
                      setReturnSearchResults([]);
                    }}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer transition-all"
                  >
                    إلغاء
                  </button>

                  <button
                    type="submit"
                    disabled={!selectedReturnMed || returnRefundAmount === '' || returnSubmitting}
                    className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded-xl font-black shadow-xs active:scale-95 transition-all cursor-pointer flex items-center gap-2"
                  >
                    {returnSubmitting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4" />
                    )}
                    <span>
                      تأكيد الإرجاع وصرف{' '}
                      {selectedReturnMed && returnRefundAmount !== ''
                        ? `(${Number(returnRefundAmount).toLocaleString()} د.ع)`
                        : ''}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {/* Tab 2: Recent Returns History */}
            {returnModalTab === 'RECENT_RETURNS' && (
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-600">
                    قائمة العمليات المسجلة في الوردية الحالية
                  </span>
                  <button
                    onClick={fetchRecentReturns}
                    className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingRecentReturns ? 'animate-spin' : ''}`} />
                    <span>تحديث</span>
                  </button>
                </div>

                {loadingRecentReturns ? (
                  <div className="py-12 text-center text-xs font-bold text-slate-500 flex flex-col items-center gap-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-amber-600" />
                    <span>جاري تحميل سجل الإرجاعات...</span>
                  </div>
                ) : recentReturns.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 font-bold text-xs">
                    لا توجد إرجاعات مسجلة في هذا الشفت حتى الآن.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {recentReturns.map((ret) => (
                      <div
                        key={ret.id}
                        className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 text-sm">{ret.tradeName}</span>
                            <span className="text-[10px] px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md font-mono font-bold">
                              {ret.quantity} {ret.unitType === 'PACK' ? 'علبة' : 'شريط'}
                            </span>
                            {ret.itemCondition === 'RESALEABLE' ? (
                              <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md font-bold flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" />
                                <span>سليم (بالمخزن)</span>
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 bg-rose-100 text-rose-800 rounded-md font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                <span>تالف (معزول)</span>
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3">
                            <span>الكاشير: {ret.cashierName || 'الكاشير'}</span>
                            <span>•</span>
                            <span>{new Date(ret.createdAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span>•</span>
                            <span>السبب: {ret.reason || 'إرجاع سريع'}</span>
                          </div>

                          {ret.notes && (
                            <div className="text-[10px] text-slate-600 bg-white p-1.5 rounded-lg border border-slate-200 mt-1.5">
                              ملاحظات: {ret.notes}
                            </div>
                          )}
                        </div>

                        <div className="text-left shrink-0">
                          <div className="font-mono font-black text-amber-900 text-sm">
                            {Number(ret.refundAmount || 0).toLocaleString()} د.ع
                          </div>
                          <div className="text-[10px] text-slate-500 font-bold mt-0.5">
                            {ret.paymentMethod === 'CASH'
                              ? '💵 نقداً'
                              : ret.paymentMethod === 'ZAIN_CASH'
                              ? '📱 زين كاش'
                              : '💳 كي كارد'}
                          </div>
                          <button
                            type="button"
                            onClick={() => setCompletedReturnReceipt(ret)}
                            className="mt-1 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-300 text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1"
                          >
                            <Printer className="w-3 h-3 text-slate-500" />
                            <span>عرض الوصل</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Completed Return Receipt Modal (On-Screen Preview & Thermal Print Trigger) */}
      {completedReturnReceipt && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-black">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-sm">تم الإرجاع بنجاح</h3>
                  <p className="text-xs text-slate-500">وصل الإرجاع وتوثيق كاش الدرج</p>
                </div>
              </div>

              <button
                onClick={() => setCompletedReturnReceipt(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Receipt Details Card */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500">الدواء المرجع:</span>
                <span className="font-black text-slate-900 text-sm">{completedReturnReceipt.tradeName}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">الكمية والوحدة:</span>
                <span className="font-mono font-bold text-slate-800">
                  {completedReturnReceipt.quantity}{' '}
                  {completedReturnReceipt.unitType === 'PACK' ? 'علبة' : 'شريط'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">حالة الدواء ومصيره:</span>
                {completedReturnReceipt.itemCondition === 'RESALEABLE' ? (
                  <span className="font-bold text-emerald-700 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>سليم (أُعيد للرف وللمخزون)</span>
                  </span>
                ) : (
                  <span className="font-bold text-rose-700 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>تالف (معزول خارج الرصيد)</span>
                  </span>
                )}
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">طريقة رد المبلغ:</span>
                <span className="font-bold text-slate-800">
                  {completedReturnReceipt.paymentMethod === 'CASH'
                    ? '💵 نقداً من الدرج (حُسم من الكاش)'
                    : completedReturnReceipt.paymentMethod === 'ZAIN_CASH'
                    ? '📱 زين كاش'
                    : '💳 كي كارد'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">الكاشير المسؤول:</span>
                <span className="font-bold text-slate-800">{completedReturnReceipt.cashierName || 'الكاشير'}</span>
              </div>

              <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm font-black">
                <span className="text-slate-900">المبلغ المسترد للمريض:</span>
                <span className="font-mono text-amber-900 text-base">
                  {Number(completedReturnReceipt.refundAmount || 0).toLocaleString()} د.ع
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-xs cursor-pointer shadow-xs active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الوصل الحراري</span>
              </button>

              <button
                type="button"
                onClick={() => setCompletedReturnReceipt(null)}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs cursor-pointer active:scale-95 transition-all"
              >
                تم / إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shift Closing & Cash Handover Modal */}
      {showShiftCloseModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center font-black">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">إغلاق الوردية ومطابقة نقد الدرج</h3>
                  <p className="text-xs text-slate-400">تسليم الكاش بين الورديات وتوثيق العجز أو الزيادة</p>
                </div>
              </div>
              <button
                onClick={() => setShowShiftCloseModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCloseShift} className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
              {/* Shift Stats Summary */}
              <div className="grid grid-cols-2 gap-2 p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-slate-500">مبيعات الوردية:</span>
                  <div className="font-black text-slate-900 font-mono text-sm">
                    {Number(shiftSummary?.totalSalesRevenue || 0).toLocaleString()} د.ع
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">الإرجاعات:</span>
                  <div className="font-bold text-rose-600 font-mono">
                    {Number(shiftSummary?.totalRefunds || 0).toLocaleString()} د.ع
                  </div>
                </div>
                <div className="col-span-2 pt-2 border-t border-slate-200 flex justify-between items-center">
                  <span className="font-bold text-slate-700">صافي الكاش المتولد من المبيعات:</span>
                  <span className="font-black text-emerald-700 font-mono text-base">
                    {Number(shiftSummary?.netCashInDrawer || 0).toLocaleString()} د.ع
                  </span>
                </div>
              </div>

              {/* Cash Reconciliation Inputs */}
              <div className="space-y-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    الكاش الافتتاحي في الدرج (الفكة / رصيد بداية الوردية)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="250"
                    value={openingCashInput}
                    onChange={(e) => setOpeningCashInput(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="مثال: 50000 (اختياري)"
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold text-slate-800 focus:outline-hidden focus:border-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    الكاش الفعلي الموجود في الدرج الآن (بعد الجرد اليدوي) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="250"
                    value={actualCashInput}
                    onChange={(e) => setActualCashInput(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="أدخل المبلغ الفعلي بعد عد النقود"
                    className="w-full p-3 bg-rose-50/50 border-2 border-rose-300 rounded-xl font-mono font-black text-lg text-slate-900 focus:outline-hidden focus:border-rose-600"
                  />
                </div>

                {/* Live Difference Badge */}
                {actualCashInput !== '' && (
                  <div
                    className={`p-3 rounded-xl border flex items-center justify-between font-bold ${
                      Number(actualCashInput) === (Number(openingCashInput || 0) + Number(shiftSummary?.netCashInDrawer || 0))
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : Number(actualCashInput) > (Number(openingCashInput || 0) + Number(shiftSummary?.netCashInDrawer || 0))
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-rose-50 text-rose-800 border-rose-200'
                    }`}
                  >
                    <span>نتيجة المطابقة:</span>
                    <span className="font-mono text-sm">
                      {Number(actualCashInput) === (Number(openingCashInput || 0) + Number(shiftSummary?.netCashInDrawer || 0))
                        ? '✅ مطابق تماماً (0 د.ع)'
                        : Number(actualCashInput) > (Number(openingCashInput || 0) + Number(shiftSummary?.netCashInDrawer || 0))
                        ? `🔺 زيادة نقدية: +${(
                            Number(actualCashInput) -
                            (Number(openingCashInput || 0) + Number(shiftSummary?.netCashInDrawer || 0))
                          ).toLocaleString()} د.ع`
                        : `🔻 عجز نقدي: ${(
                            Number(actualCashInput) -
                            (Number(openingCashInput || 0) + Number(shiftSummary?.netCashInDrawer || 0))
                          ).toLocaleString()} د.ع`}
                    </span>
                  </div>
                )}

                <div>
                  <label className="block font-bold text-slate-700 mb-1">ملاحظات تسليم الوردية</label>
                  <textarea
                    rows={2}
                    value={shiftCloseNotes}
                    onChange={(e) => setShiftCloseNotes(e.target.value)}
                    placeholder="أي ملاحظات حول الكاشير المستلم، الفكة، النواقص..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 focus:outline-hidden focus:border-rose-500 resize-none"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowShiftCloseModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={closingShift || actualCashInput === ''}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl font-black shadow-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {closingShift ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  <span>تأكيد إغلاق الوردية وتوثيق المطابقة</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Voice & Natural Language Smart Search Modal */}
      {showSmartSearch && (
        <SmartSearchModal
          autoStartVoice={smartSearchAutoVoice}
          onClose={() => setShowSmartSearch(false)}
          onAddToCart={(med, unitType) => {
            const mappedMed: SearchMedicine = {
              id: med.id,
              medicineId: med.id,
              customName: med.tradeName,
              tradeName: med.tradeName,
              scientificName: med.scientificName || '',
              unitsPerPack: med.unitsPerPack || 1,
              sellingPricePack: Number(med.sellingPricePack || 0),
              sellingPriceUnit: Number(med.sellingPriceUnit || 0),
              availablePacks: med.availablePacks || 0,
              availableStrips: med.availableStrips || 0,
              totalUnitsRemaining: med.totalUnitsRemaining || 0,
            };
            addToCart(mappedMed, unitType === 'PACK' ? 'PACK' : 'STRIP');
            setMessage({ type: 'success', text: `تمت إضافة (${med.tradeName}) إلى الفاتورة` });
            setTimeout(() => setMessage(null), 2500);
          }}
        />
      )}

      {/* Cross-Branch Stock Modal */}
      {crossStockModalMed && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-sm">
                    توفر الدواء في شبكة الفروع
                  </h3>
                  <div className="text-xs text-indigo-700 font-black">
                    {crossStockModalMed.tradeName}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setCrossStockModalMed(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {crossStockLoading ? (
              <div className="py-8 text-center text-xs font-bold text-slate-500 flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
                <span>جاري فحص الأرصدة الحية في كافة الفروع...</span>
              </div>
            ) : crossStockResults.length === 0 ? (
              <div className="py-8 text-center text-xs font-bold text-slate-400">
                لا توجد فروع أخرى مربوطة حالياً ضمن السلسلة
              </div>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {crossStockResults.map((br) => (
                  <div
                    key={br.tenantId}
                    className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                      br.isCurrent
                        ? 'bg-slate-50 border-slate-200 opacity-80'
                        : br.isAvailable
                        ? 'bg-emerald-50/70 border-emerald-200'
                        : 'bg-rose-50/50 border-rose-100'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-xs text-slate-900">{br.pharmacyName}</span>
                        {br.isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded-md font-bold">
                            الفرع الحالي
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-bold mt-0.5">
                        {br.governorate} • {br.district} {br.phone && `• 📞 ${br.phone}`}
                      </div>
                      {br.shelfLocation && (
                        <div className="text-[10px] text-amber-800 font-bold mt-0.5">
                          📍 موقع الرف: {br.shelfLocation}
                        </div>
                      )}
                    </div>

                    <div className="text-left shrink-0">
                      {br.isAvailable ? (
                        <div className="text-emerald-800 font-black text-xs">
                          <span className="font-mono text-sm">{br.availablePacks}</span> علبة{' '}
                          {br.availableStrips > 0 && `و ${br.availableStrips} شريط`}
                        </div>
                      ) : (
                        <div className="text-rose-600 font-bold text-xs">
                          غير متوفر ❌
                        </div>
                      )}
                      {br.sellingPricePack > 0 && (
                        <div className="text-[10px] text-slate-500 font-mono font-bold">
                          السعر: {br.sellingPricePack.toLocaleString()} د.ع
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setCrossStockModalMed(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black cursor-pointer shadow-xs"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sales History & Invoices Archive Modal */}
      {showSalesHistoryModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 shrink-0 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shadow-xs">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
                    <span>سجل الفواتير وأرشيف المبيعات</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-800 font-bold border border-indigo-200">
                      {salesHistory.length} فاتورة
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    استعراض الفواتير الصادرة، أسماء الزبائن، تفاصيل الأدوية، وحالة المزامنة
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowSalesHistoryModal(false);
                }}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 cursor-pointer transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Bar */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={salesHistorySearch}
                  onChange={(e) => {
                    setSalesHistorySearch(e.target.value);
                    fetchSalesHistory(e.target.value);
                  }}
                  placeholder="ابحث برقم الفاتورة، اسم الزبون، أو الكاشير..."
                  className="w-full pr-10 pl-4 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-hidden focus:border-indigo-500 shadow-2xs"
                />
              </div>

              <button
                type="button"
                onClick={() => fetchSalesHistory()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${loadingSalesHistory ? 'animate-spin' : ''}`} />
                <span>تحديث السجل</span>
              </button>
            </div>

            {/* Sales List Table */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingSalesHistory ? (
                <div className="py-16 text-center text-xs font-bold text-slate-500 flex flex-col items-center gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
                  <span>جاري تحميل سجل الفواتير...</span>
                </div>
              ) : salesHistory.length === 0 ? (
                <div className="py-16 text-center text-slate-400 font-bold text-xs">
                  لا توجد فواتير مبيعات مطابقة للبحث
                </div>
              ) : (
                <div className="space-y-3">
                  {salesHistory.map((s) => {
                    const saleKey = s.id || s.offlineId || s.invoiceNumber;
                    const isCollapsed = !!collapsedInvoices[saleKey];
                    const itemsList = Array.isArray(s.items) ? s.items : [];

                    return (
                      <div
                        key={saleKey}
                        className="p-4 bg-white hover:bg-slate-50/50 rounded-2xl border border-slate-200 transition-all shadow-xs flex flex-col gap-3 text-xs"
                      >
                        {/* Header Row: Invoice summary, customer, amounts, actions */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-black text-slate-900 text-sm">{s.invoiceNumber}</span>
                              {s.customerName ? (
                                <span className="text-xs px-2.5 py-0.5 bg-indigo-50 text-indigo-900 rounded-lg font-black border border-indigo-200 flex items-center gap-1">
                                  <UserCheck className="w-3 h-3 text-indigo-600" />
                                  <span>الزبون: {s.customerName}</span>
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg font-bold">
                                  زبون عام
                                </span>
                              )}

                              {s.isSynced === false || s.isOffline ? (
                                <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-900 rounded-md font-bold">
                                  أوفلاين 📡
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md font-bold">
                                  متزامن مع السحابة ✅
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-500 flex items-center gap-3 font-medium">
                              <span>الكاشير: {s.cashierName || 'الكاشير'}</span>
                              <span>•</span>
                              <span>{new Date(s.createdAt).toLocaleString('ar-IQ')}</span>
                              <span>•</span>
                              <span className="font-bold text-slate-700">
                                {s.itemsCount || itemsList.length} مواد
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5">
                            <div className="text-left">
                              <div className="font-mono font-black text-emerald-700 text-base">
                                {Number(s.totalAmount || 0).toLocaleString()} د.ع
                              </div>
                              {Number(s.discountAmount || 0) > 0 && (
                                <div className="text-[10px] font-bold text-rose-600 font-mono text-left">
                                  خصم: -{Number(s.discountAmount).toLocaleString()} د.ع
                                </div>
                              )}
                            </div>

                            {/* Toggle Items Button */}
                            <button
                              type="button"
                              onClick={() => {
                                setCollapsedInvoices((prev) => ({
                                  ...prev,
                                  [saleKey]: !prev[saleKey],
                                }));
                              }}
                              className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-all"
                              title={isCollapsed ? 'عرض المواد' : 'إخفاء المواد'}
                            >
                              {isCollapsed ? (
                                <>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>عرض المواد</span>
                                </>
                              ) : (
                                <>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                  <span>إخفاء المواد</span>
                                </>
                              )}
                            </button>

                            {/* Print Receipt Button */}
                            <button
                              type="button"
                              onClick={() => {
                                setCompletedSale(s);
                                setShowSalesHistoryModal(false);
                              }}
                              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95 transition-all"
                              title="عرض الوصل وإعادة الطباعة الحرارية"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>الوصل 🖨️</span>
                            </button>
                          </div>
                        </div>

                        {/* Items Sub-Table (Expanded by Default) */}
                        {!isCollapsed && (
                          <div className="mt-1 pt-2.5 border-t border-slate-100">
                            {itemsList.length > 0 ? (
                              <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-slate-50/50">
                                <table className="w-full text-right text-xs">
                                  <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200 text-[11px]">
                                    <tr>
                                      <th className="py-2 px-3">اسم المادة / الدواء</th>
                                      <th className="py-2 px-3 text-center">الكمية</th>
                                      <th className="py-2 px-3 text-center">الوحدة</th>
                                      <th className="py-2 px-3 text-left">سعر المفرد</th>
                                      <th className="py-2 px-3 text-left">المجموع</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-200/60 font-medium">
                                    {itemsList.map((item: any, idx: number) => {
                                      const lineTotal = Number(
                                        item.totalPrice !== undefined
                                          ? item.totalPrice
                                          : Number(item.unitPrice || 0) * Number(item.quantity || 1),
                                      );
                                      return (
                                        <tr key={item.id || idx} className="hover:bg-indigo-50/30 transition-colors">
                                          <td className="py-2 px-3 font-bold text-slate-800">
                                            <div className="flex items-center gap-1.5">
                                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                                              <span>{item.tradeName || item.customName || 'دواء'}</span>
                                            </div>
                                          </td>
                                          <td className="py-2 px-3 text-center font-mono font-black text-indigo-700">
                                            {item.quantity}
                                          </td>
                                          <td className="py-2 px-3 text-center">
                                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-slate-200 text-slate-700">
                                              {item.unitType === 'PACK'
                                                ? 'علبة'
                                                : item.unitType === 'STRIP'
                                                ? 'شريط'
                                                : item.unitType || 'وحدة'}
                                            </span>
                                          </td>
                                          <td className="py-2 px-3 text-left font-mono text-slate-600">
                                            {Number(item.unitPrice || 0).toLocaleString()} د.ع
                                          </td>
                                          <td className="py-2 px-3 text-left font-mono font-black text-emerald-800">
                                            {lineTotal.toLocaleString()} د.ع
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : s.id ? (
                              <div className="py-2 text-center text-[11px] text-slate-400 flex items-center justify-center gap-2">
                                <span>لم يتم تحميل تفاصيل المواد</span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      const details = await apiRequest<any>(`/pos/sales/${s.id}`);
                                      if (details?.items) {
                                        setSalesHistory((prev) =>
                                          prev.map((row) => (row.id === s.id ? { ...row, items: details.items } : row)),
                                        );
                                      }
                                    } catch (e) {
                                      console.error(e);
                                    }
                                  }}
                                  className="text-indigo-600 font-bold hover:underline cursor-pointer"
                                >
                                  (اضغط لتحميل المواد)
                                </button>
                              </div>
                            ) : (
                              <div className="py-1 text-center text-[11px] text-slate-400">
                                لا توجد تفاصيل مواد لهذه الفاتورة
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
