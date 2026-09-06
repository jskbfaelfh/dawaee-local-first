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
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { roundTo250 } from '../utils/currency';
import { usePharmacyLiveSync } from '../hooks/usePharmacyLiveSync';
import { SmartSearchModal } from '../components/SmartSearchModal';
import {
  cacheInventoryLocally,
  searchLocalInventory,
  deductLocalInventoryStock,
  saveOfflineSale,
  getPendingSales,
  removePendingSale,
  generateOfflineInvoiceNumber,
  type OfflineSaleRecord,
} from '../utils/posOfflineDb';
import { getLocalDailySummary } from '../utils/localDatabase';

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
        const unitPrice = Number(batch.sellingPriceUnit) || defaultUnitPrice;
        const pricePerUnit = isPack ? packPrice / unitsPerPk : unitPrice;

        const lineCost = pricePerUnit * deductUnits;
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
      const unitPrice = Number(latest.sellingPriceUnit) || defaultUnitPrice;
      const pricePerUnit = isPack ? packPrice / unitsPerPk : unitPrice;
      const lineCost = pricePerUnit * unitsLeft;
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
    const price = isPack ? defaultPackPrice : defaultUnitPrice;
    calculatedTotal = price * quantity;
    breakdown.push({
      batchNumber: '—',
      qty: quantity,
      unitPrice: price,
      lineTotal: calculatedTotal,
    });
  }

  const effectiveUnitPrice = quantity > 0 ? calculatedTotal / quantity : isPack ? defaultPackPrice : defaultUnitPrice;
  return { totalPrice: calculatedTotal, effectiveUnitPrice, breakdown };
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

  // Return state
  const [returnItemId, setReturnItemId] = useState('');
  const [returnUnitType, setReturnUnitType] = useState<'PACK' | 'STRIP'>('PACK');
  const [returnQty, setReturnQty] = useState(1);
  const [returnReason, setReturnReason] = useState('');

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

  // Sync offline sales to cloud
  const syncPendingSales = async () => {
    if (isSyncing || !navigator.onLine) return;
    try {
      const pending = await getPendingSales();
      if (pending.length === 0) return;

      setIsSyncing(true);
      const syncPayload = {
        sales: pending.map((s) => ({
          offlineId: s.offlineId,
          offlineInvoiceNumber: s.invoiceNumber,
          items: s.payload.items,
          discountAmount: s.payload.discountAmount,
          createdAt: s.createdAt,
        })),
      };

      const res = await apiRequest<any>('/pos/sync-offline', {
        method: 'POST',
        body: JSON.stringify(syncPayload),
      });

      if (res.results && Array.isArray(res.results)) {
        for (const r of res.results) {
          if (r.success) {
            await removePendingSale(r.offlineId);
          }
        }
      }

      await refreshPendingCount();
      setMessage({
        type: 'success',
        text: `تمت مزامنة (${res.syncedCount}) فواتير تم بيعها أثناء انقطاع الإنترنت بنجاح مع السحابة! ☁️✅`,
      });
    } catch (err: any) {
      console.warn('Sync failed or postponed:', err);
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

  // Search medicines (Online with seamless Offline fallback)
  useEffect(() => {
    if (searchTerm.trim().length === 0) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      if (navigator.onLine) {
        try {
          const data = await apiRequest<SearchMedicine[]>(`/inventory?search=${encodeURIComponent(searchTerm)}`);
          setSearchResults(Array.isArray(data) ? data : []);
          return;
        } catch (err) {
          console.warn('Online search failed, falling back to local IndexedDB', err);
        }
      }

      // Offline search fallback
      try {
        const localData = await searchLocalInventory(searchTerm);
        setSearchResults(localData);
      } catch (err) {
        console.error('Offline search error:', err);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const addToCart = (med: SearchMedicine, unitType: 'PACK' | 'STRIP', specificBatch?: ActiveBatchInfo) => {
    let packPrice = Number(med.sellingPricePack) || 0;
    let unitPrice = Number(med.sellingPriceUnit) || 0;

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
      unitPrice = med.unitsPerPack > 1 ? Math.round(packPrice / med.unitsPerPack) : packPrice;
      med.sellingPricePack = packPrice;
      med.sellingPriceUnit = unitPrice;
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
          defaultSellingPriceUnit: Number(med.sellingPriceUnit),
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
        setCart([]);
        setDiscountAmount(0);
        setDiscountPercent('');
        setMessage({ type: 'success', text: `تم إتمام عملية البيع بنجاح! رقم الفاتورة: ${result.invoiceNumber}` });
        setLoading(false);
        searchInputRef.current?.focus();
        return;
      } catch (err: any) {
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

      const offlineRecord: OfflineSaleRecord = {
        offlineId,
        invoiceNumber: offlineInvoiceNum,
        payload,
        displayItems,
        subtotal,
        discountAmount,
        totalAmount: total,
        createdAt: new Date().toISOString(),
        cashierName: 'كاشير (محلي)',
      };

      // 1. Save to local IndexedDB pending queue
      await saveOfflineSale(offlineRecord);

      // 2. Deduct stock from local IndexedDB
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
        isOffline: true,
      });

      setCart([]);
      setDiscountAmount(0);
      setDiscountPercent('');
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

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnItemId) return;

    try {
      const res = await apiRequest<any>('/pos/return', {
        method: 'POST',
        body: JSON.stringify({
          inventoryItemId: returnItemId,
          unitType: returnUnitType,
          quantity: Number(returnQty),
          reason: returnReason,
        }),
      });

      setMessage({ type: 'success', text: res.message });
      setShowReturnModal(false);
      setReturnItemId('');
      setReturnQty(1);
      setReturnReason('');
    } catch (err: any) {
      alert(err.message || 'فشل إرجاع المادة');
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
            onClick={() => setShowReturnModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-black text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-xl border border-amber-200 transition-all cursor-pointer active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            <span>إرجاع</span>
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
                              {Number(med.sellingPriceUnit).toLocaleString()} د.ع
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
                              {b.qty} × {Number(b.unitPrice).toLocaleString()} د.ع
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="font-mono font-bold text-slate-700">{Math.round(item.unitPrice).toLocaleString()} د.ع</span>
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
                    {item.totalPrice.toLocaleString()} د.ع
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
                        <span>{it.quantity} {it.unitType === 'PACK' ? 'علبة' : 'شريط'} × {Number(it.unitPrice).toLocaleString()} د.ع</span>
                        {it.batchNumber && (
                          <span className="text-indigo-700 font-mono font-bold bg-indigo-50 px-1 py-0.2 rounded border border-indigo-200 text-[9px]">
                            وجبة: {it.batchNumber}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="font-black text-slate-900 self-center font-mono">
                      {Number(it.totalPrice).toLocaleString()} د.ع
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

      {/* Return Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-amber-600" />
                إرجاع دواء للمخزن
              </h3>
              <button onClick={() => setShowReturnModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleReturnSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم المادة المرجعة</label>
                <input
                  type="text"
                  placeholder="اكتب اسم الدواء للبحث..."
                  onChange={async (e) => {
                    if (e.target.value.length > 1) {
                      const res = await apiRequest<any[]>(`/inventory?search=${encodeURIComponent(e.target.value)}`);
                      if (res.length > 0) setReturnItemId(res[0].id);
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نوع الوحدة</label>
                  <select
                    value={returnUnitType}
                    onChange={(e) => setReturnUnitType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="PACK">علبة</option>
                    <option value="STRIP">شريط</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الكمية المرجعة</label>
                  <input
                    type="number"
                    min="1"
                    value={returnQty}
                    onChange={(e) => setReturnQty(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">سبب الإرجاع (اختياري)</label>
                <input
                  type="text"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="مثال: تبديل جرعة، زائد عن الحاجة..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold"
                >
                  تأكيد الإرجاع واسترداد المبلغ
                </button>
                <button
                  type="button"
                  onClick={() => setShowReturnModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
                >
                  إلغاء
                </button>
              </div>
            </form>
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
                  <td className="text-left py-1">{Number(item.unitPrice).toLocaleString()}</td>
                  <td className="text-left py-1">{Number(item.totalPrice).toLocaleString()}</td>
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
    </>
  );
};
