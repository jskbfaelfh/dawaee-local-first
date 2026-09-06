import React, { useState, useEffect } from 'react';
import {
  Package,
  AlertTriangle,
  Clock,
  Search,
  Edit,
  RefreshCw,
  X,
  CheckCircle2,
  Filter,
  Layers,
  Building2,
  Barcode,
  RotateCcw,
  Mic,
  Sparkles,
  MapPin,
  Plus,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { roundTo250, calculateStripPrice } from '../utils/currency';
import { usePharmacyLiveSync } from '../hooks/usePharmacyLiveSync';
import { BarcodeGeneratorModal } from '../components/BarcodeGeneratorModal';
import { BatchTraceabilityModal } from '../components/BatchTraceabilityModal';
import { SupplierReturnModal } from '../components/SupplierReturnModal';
import { SmartSearchModal } from '../components/SmartSearchModal';
import { AddUnregisteredMedicineModal } from '../components/AddUnregisteredMedicineModal';
import { SmartExpiryInput } from '../components/SmartExpiryInput';
import {
  getLocalInventory,
  saveLocalInventoryBulk,
  getLocalSuppliers,
  saveLocalSuppliers,
} from '../utils/localDatabase';

type TabType = 'INVENTORY' | 'SMART_EXPIRY' | 'BATCH_TRACE';

export const InventoryView: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabType>('INVENTORY');

  // 1. Main Inventory State
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'LOW_STOCK' | 'EXPIRING_SOON'>('ALL');

  // Exact real-time counts from local DB / backend summary
  const [totalCount, setTotalCount] = useState<number>(0);
  const [lowStockCount, setLowStockCount] = useState<number>(0);
  const [expiringCount, setExpiringCount] = useState<number>(0);

  // Suppliers filter
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');

  // 2. Modals state
  const [selectedTraceBatch, setSelectedTraceBatch] = useState<string | null>(null);
  const [returnBatchItem, setReturnBatchItem] = useState<any | null>(null);
  const [showSmartSearch, setShowSmartSearch] = useState(false);
  const [smartSearchAutoVoice, setSmartSearchAutoVoice] = useState(false);
  const [showAddMedModal, setShowAddMedModal] = useState(false);

  // Master Catalog Search Integration (28,500 Medicines)
  const [catalogResults, setCatalogResults] = useState<any[]>([]);
  const [quickAddMed, setQuickAddMed] = useState<any | null>(null);
  const [savingQuickAdd, setSavingQuickAdd] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    sellingPricePack: 0,
    sellingPriceUnit: 0,
    purchasePricePack: 0,
    quantityPacks: 10,
    unitsPerPack: 1,
    shelfLocation: '',
    batchNumber: 'BATCH-01',
    expiryMonth: 12,
    expiryYear: new Date().getFullYear() + 2,
  });

  // Edit price & unit settings modal state
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [shelfFilter, setShelfFilter] = useState('');
  const [editForm, setEditForm] = useState({
    customName: '',
    sellingPricePack: 0,
    sellingPriceUnit: 0,
    minAlertUnits: 5,
    shelfLocation: '',
  });

  // Batches details modal state
  const [batchesItem, setBatchesItem] = useState<any | null>(null);
  const [batchesList, setBatchesList] = useState<any[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // Barcode generator modal state
  const [barcodeItem, setBarcodeItem] = useState<any | null>(null);

  // 3. Smart Expiry State
  const [smartExpiryData, setSmartExpiryData] = useState<any | null>(null);
  const [loadingSmartExpiry, setLoadingSmartExpiry] = useState(false);
  const [selectedExpiryTier, setSelectedExpiryTier] = useState<string>('ALL');
  const [expirySearch, setExpirySearch] = useState('');

  // 4. Batch Trace Search in dedicated tab
  const [traceSearchInput, setTraceSearchInput] = useState('');

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch summary counts (Local-first calculation with server sync)
  const fetchSummaryCounts = async () => {
    try {
      const local = await getLocalInventory();
      if (local && local.summary) {
        setTotalCount(local.summary.total || 0);
        setLowStockCount(local.summary.lowStock || 0);
        setExpiringCount(local.summary.expiring || 0);
      }
    } catch (e) {
      console.warn('Local summary calculation error:', e);
    }

    if (navigator.onLine) {
      try {
        const summary = await apiRequest<any>('/inventory/summary');
        if (summary) {
          setTotalCount(Number(summary.totalCount ?? summary.totalMedicines ?? 0));
          setLowStockCount(Number(summary.lowStockCount ?? 0));
          setExpiringCount(Number(summary.expiringSoonCount ?? 0));
        }
      } catch (err) {
        console.warn('Could not refresh server summary:', err);
      }
    }
  };

  // Fetch Inventory (Local-First with server sync)
  const fetchInventory = async () => {
    setLoading(true);
    try {
      const localData = await getLocalInventory();
      if (localData && localData.items && localData.items.length > 0) {
        setItems(localData.items);
      }

      if (navigator.onLine) {
        try {
          const queryParams = new URLSearchParams();
          if (searchTerm.trim()) queryParams.append('search', searchTerm.trim());
          if (selectedSupplierId) queryParams.append('supplierId', selectedSupplierId);
          if (shelfFilter.trim()) queryParams.append('shelfLocation', shelfFilter.trim());

          const serverItems = await apiRequest<any[]>(`/inventory?${queryParams.toString()}`);
          if (serverItems) {
            setItems(serverItems);
            if (!searchTerm && !selectedSupplierId && !shelfFilter) {
              setTotalCount(serverItems.length);
              const low = serverItems.filter(it => (it.totalUnitsRemaining || 0) <= (it.minAlertUnits || 5)).length;
              setLowStockCount(low);
              saveLocalInventoryBulk(serverItems).catch(console.error);
            }

            // If no local items match, automatically search the 28,500 Master Catalog by barcode or name
            if (serverItems.length === 0 && searchTerm.trim().length >= 2) {
              try {
                const catMeds = await apiRequest<any[]>(`/medicines/search?q=${encodeURIComponent(searchTerm.trim())}`);
                setCatalogResults(catMeds || []);
              } catch {
                setCatalogResults([]);
              }
            } else {
              setCatalogResults([]);
            }
          }
        } catch (serverErr) {
          console.warn('Server inventory fetch unavailable, operating on local data', serverErr);
        }
      }
    } catch (err: any) {
      console.warn('Fetch inventory error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Suppliers List
  const fetchSuppliers = async () => {
    try {
      const localSups = await getLocalSuppliers();
      if (localSups && localSups.length > 0) {
        setSuppliers(localSups);
      }

      if (navigator.onLine) {
        try {
          const serverSups = await apiRequest<any[]>('/inventory/suppliers');
          if (serverSups) {
            setSuppliers(serverSups);
            saveLocalSuppliers(serverSups).catch(console.error);
          }
        } catch (supErr) {
          console.warn('Server suppliers fetch unavailable, operating on local data', supErr);
        }
      }
    } catch (err) {
      console.warn('Fetch suppliers error:', err);
    }
  };

  // Fetch Smart Expiry Summary
  const fetchSmartExpiry = async () => {
    setLoadingSmartExpiry(true);
    try {
      const data = await apiRequest<any>('/inventory/smart-expiry-summary');
      setSmartExpiryData(data);
    } catch (err: any) {
      console.warn('Smart expiry summary unavailable offline:', err);
    } finally {
      setLoadingSmartExpiry(false);
    }
  };

  useEffect(() => {
    fetchInventory();
    fetchSuppliers();
    fetchSummaryCounts();
    fetchSmartExpiry();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchInventory();
    }, 250);
    return () => clearTimeout(timer);
  }, [searchTerm, selectedSupplierId, shelfFilter]);

  usePharmacyLiveSync(() => {
    fetchInventory();
    fetchSummaryCounts();
    fetchSmartExpiry();
  });

  const handleOpenQuickAdd = async (med: any) => {
    setQuickAddMed(med);
    const units = Number(med.defaultUnitsPerPack) || 1;
    const currentYear = new Date().getFullYear();

    let history: any = null;
    try {
      const lookupKey = med.id || med.barcode;
      history = await apiRequest<any>(`/inventory/medicine-last-history/${encodeURIComponent(lookupKey)}`);
    } catch (e) {}

    const defaultUnits = Number(history?.unitsPerPack || units);
    const purchasePrice = Number(history?.purchasePricePack || med.defaultPurchasePrice || 0);
    const sellingPack = Number(history?.sellingPricePack || 0);
    let sellingUnit = Number(history?.sellingPriceUnit || 0);
    if (sellingUnit === 0 && sellingPack > 0 && defaultUnits > 0) {
      sellingUnit = Math.round(sellingPack / defaultUnits);
    }

    setQuickAddForm({
      sellingPricePack: sellingPack,
      sellingPriceUnit: sellingUnit,
      purchasePricePack: purchasePrice,
      quantityPacks: 10,
      unitsPerPack: defaultUnits,
      shelfLocation: history?.shelfLocation || '',
      batchNumber: 'BATCH-01',
      expiryMonth: history?.expiryMonth || 12,
      expiryYear: history?.expiryYear || currentYear + 2,
    });
  };

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddMed) return;
    setSavingQuickAdd(true);
    try {
      await apiRequest('/inventory/bulk-entry', {
        method: 'POST',
        body: JSON.stringify({
          items: [
            {
              medicineId: quickAddMed.id,
              customName: quickAddMed.tradeName,
              unitsPerPack: Number(quickAddForm.unitsPerPack) || 1,
              quantityPacks: Number(quickAddForm.quantityPacks) || 1,
              sellingPricePack: Number(quickAddForm.sellingPricePack) || 0,
              sellingPriceUnit: Number(quickAddForm.sellingPriceUnit) || 0,
              purchasePricePack: Number(quickAddForm.purchasePricePack) || 0,
              expiryMonth: Number(quickAddForm.expiryMonth) || 12,
              expiryYear: Number(quickAddForm.expiryYear) || (new Date().getFullYear() + 2),
              batchNumber: quickAddForm.batchNumber?.trim() || 'BATCH-01',
              shelfLocation: quickAddForm.shelfLocation?.trim() || undefined,
            },
          ],
        }),
      });
      setMessage({
        type: 'success',
        text: `تمت إضافة (${quickAddMed.tradeName}) إلى مخزنك وتسعيره بنجاح! 📦✨`,
      });
      setQuickAddMed(null);
      setCatalogResults([]);
      setSearchTerm('');
      await fetchInventory();
      await fetchSummaryCounts();
    } catch (err: any) {
      alert(err.message || 'فشل حفظ الدواء في المخزن');
    } finally {
      setSavingQuickAdd(false);
    }
  };

  const openEditModal = (item: any) => {
    setEditingItem(item);
    setEditForm({
      customName: item.customName || '',
      sellingPricePack: Number(item.sellingPricePack || 0),
      sellingPriceUnit: Number(item.sellingPriceUnit || 0),
      minAlertUnits: Number(item.minAlertUnits || 5),
      shelfLocation: item.shelfLocation || '',
    });
  };

  const handleUpdatePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    try {
      await apiRequest(`/inventory/${editingItem.id}/price`, {
        method: 'PATCH',
        body: JSON.stringify({
          customName: editForm.customName || undefined,
          sellingPricePack: Number(editForm.sellingPricePack),
          sellingPriceUnit: Number(editForm.sellingPriceUnit),
          minAlertUnits: Number(editForm.minAlertUnits),
          shelfLocation: editForm.shelfLocation ? editForm.shelfLocation.trim() : null,
        }),
      });

      setMessage({ type: 'success', text: `تم تحديث سعر وموقع رف (${editingItem.tradeName}) بنجاح` });
      setEditingItem(null);
      fetchInventory();
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      alert(err.message || 'فشل تحديث السعر');
    }
  };

  const viewBatches = async (item: any) => {
    setBatchesItem(item);
    setLoadingBatches(true);
    try {
      const data = await apiRequest<any[]>(`/inventory/${item.id}/batches`);
      setBatchesList(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBatches(false);
    }
  };

  // Filtered Smart Expiry Batches
  const filteredExpiryBatches = (smartExpiryData?.batches || []).filter((b: any) => {
    if (selectedExpiryTier !== 'ALL' && b.expiryTier !== selectedExpiryTier) return false;
    if (expirySearch.trim()) {
      const q = expirySearch.toLowerCase();
      const matchName = b.tradeName?.toLowerCase().includes(q);
      const matchSci = b.scientificName?.toLowerCase().includes(q);
      const matchBatch = b.batchNumber?.toLowerCase().includes(q);
      const matchSupp = b.supplierName?.toLowerCase().includes(q);
      return matchName || matchSci || matchBatch || matchSupp;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-5 pb-16">
      {/* View Sub-Tabs Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2 bg-white rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setCurrentTab('INVENTORY')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
              currentTab === 'INVENTORY'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>المخزن</span>
            <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[10px]">{totalCount}</span>
          </button>

          <button
            onClick={() => {
              setCurrentTab('SMART_EXPIRY');
              fetchSmartExpiry();
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
              currentTab === 'SMART_EXPIRY'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'text-purple-900 bg-purple-50/70 hover:bg-purple-100'
            }`}
          >
            <Clock className="w-4 h-4 text-amber-300" />
            <span>الصلاحيات والإرجاع</span>
            {smartExpiryData?.summary?.totalBatchesAtRisk > 0 && (
              <span className="px-1.5 py-0.5 bg-rose-500 text-white rounded-full text-[10px] font-mono font-bold">
                {smartExpiryData.summary.totalBatchesAtRisk}
              </span>
            )}
          </button>

          <button
            onClick={() => setCurrentTab('BATCH_TRACE')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
              currentTab === 'BATCH_TRACE'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>تتبع الوجبات</span>
          </button>
        </div>

        <button
          onClick={() => {
            fetchInventory();
            fetchSmartExpiry();
            fetchSummaryCounts();
          }}
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all cursor-pointer shrink-0"
          title="تحديث البيانات"
        >
          <RefreshCw className={`w-4 h-4 ${loading || loadingSmartExpiry ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {message && (
        <div
          className={`p-4 rounded-2xl flex items-center gap-2 text-xs font-black animate-in fade-in ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 1: MAIN INVENTORY & BARCODE                           */}
      {/* ========================================================= */}
      {currentTab === 'INVENTORY' && (
        <div className="space-y-5">
          {/* Fast Overview Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Card 1: Total Medicines */}
            <button
              onClick={() => setActiveFilter('ALL')}
              className={`p-4 rounded-2xl border text-right transition-all cursor-pointer ${
                activeFilter === 'ALL'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md ring-2 ring-indigo-400 ring-offset-2'
                  : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-bold text-xs opacity-90">كل المواد</div>
                <Package className="w-5 h-5 opacity-80" />
              </div>
              <div className="text-xl font-black mt-1.5 font-mono">
                {totalCount} <span className="text-xs font-normal">مادة</span>
              </div>
              <div className="mt-1 text-[11px] opacity-75">
                {activeFilter === 'ALL' ? '● الكل' : 'عرض الكل'}
              </div>
            </button>

            {/* Card 2: Low Stock Alerts */}
            <button
              onClick={() => setActiveFilter('LOW_STOCK')}
              className={`p-4 rounded-2xl border text-right transition-all cursor-pointer ${
                activeFilter === 'LOW_STOCK'
                  ? 'bg-amber-500 text-white border-amber-500 shadow-md ring-2 ring-amber-400 ring-offset-2'
                  : 'bg-amber-50 text-amber-950 border-amber-200 hover:border-amber-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-bold text-xs">النواقص</div>
                <AlertTriangle className="w-5 h-5 text-amber-700" />
              </div>
              <div className="text-xl font-black mt-1.5 text-amber-950 font-mono">
                {lowStockCount} <span className="text-xs font-normal">مادة</span>
              </div>
              <div className="mt-1 text-[11px] text-amber-800">
                {activeFilter === 'LOW_STOCK' ? (
                  <span className="text-amber-900 font-bold bg-amber-200/70 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                    <Filter className="w-3 h-3" />
                    النواقص
                  </span>
                ) : (
                  'النواقص'
                )}
              </div>
            </button>

            {/* Card 3: Expiring Soon */}
            <button
              onClick={() => setActiveFilter('EXPIRING_SOON')}
              className={`p-4 rounded-2xl border text-right transition-all cursor-pointer ${
                activeFilter === 'EXPIRING_SOON'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-md ring-2 ring-rose-400 ring-offset-2'
                  : 'bg-rose-50 text-rose-950 border-rose-200 hover:border-rose-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-bold text-xs">قريبة الانتهاء</div>
                <Clock className="w-5 h-5 text-rose-700" />
              </div>
              <div className="text-xl font-black mt-1.5 text-rose-950 font-mono">
                {expiringCount} <span className="text-xs font-normal">وجبة</span>
              </div>
              <div className="mt-1 text-[11px] text-rose-800">
                {activeFilter === 'EXPIRING_SOON' ? (
                  <span className="text-rose-900 font-bold bg-rose-200/70 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                    <Filter className="w-3 h-3" />
                    قريبة الانتهاء
                  </span>
                ) : (
                  'أقل من 3 أشهر'
                )}
              </div>
            </button>
          </div>

          {/* Search & Supplier Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full md:w-auto flex-1 max-w-lg">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="بحث بالاسم أو الباركود..."
                  className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:bg-white focus:outline-hidden"
                />
              </div>

              {/* Voice Search */}
              <button
                type="button"
                onClick={() => {
                  setSmartSearchAutoVoice(true);
                  setShowSmartSearch(true);
                }}
                className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-black flex items-center gap-1 shrink-0 cursor-pointer active:scale-95 shadow-2xs"
                title="البحث الصوتي"
              >
                <Mic className="w-4 h-4 text-rose-600 animate-pulse" />
                <span className="hidden sm:inline">صوتي 🎙️</span>
              </button>

              {/* Smart Clinical Search */}
              <button
                type="button"
                onClick={() => {
                  setSmartSearchAutoVoice(false);
                  setShowSmartSearch(true);
                }}
                className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-black flex items-center gap-1 shrink-0 cursor-pointer active:scale-95 shadow-2xs"
                title="مساعد ذكي"
              >
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span className="hidden md:inline">مساعد ذكي</span>
              </button>

              {/* Add New Unregistered Medicine Button */}
              <button
                type="button"
                onClick={() => setShowAddMedModal(true)}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center gap-1 shrink-0 cursor-pointer active:scale-95 shadow-xs"
                title="إضافة دواء جديد"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">دواء جديد +</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus-within:border-amber-500 focus-within:bg-white transition-all">
                <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
                <input
                  type="text"
                  value={shelfFilter}
                  onChange={(e) => setShelfFilter(e.target.value)}
                  placeholder="الرف..."
                  className="w-full md:w-44 text-xs font-bold text-slate-800 placeholder:text-slate-400 bg-transparent focus:outline-hidden"
                />
                {shelfFilter && (
                  <button
                    type="button"
                    onClick={() => setShelfFilter('')}
                    className="p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full md:w-56 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:border-indigo-600 focus:bg-white focus:outline-hidden"
                >
                  <option value="">كل المذاخر</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Master Catalog Search Results (28,500 Medicines) */}
          {catalogResults.length > 0 && (
            <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-blue-50 border-2 border-indigo-300 rounded-3xl p-5 shadow-sm animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-indigo-200">
                <div className="flex items-center gap-2.5">
                  <span className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                    <Sparkles className="w-5 h-5" />
                  </span>
                  <div>
                    <h4 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
                      تم العثور في الدليل المركزي العام ({catalogResults.length} مادة)
                    </h4>
                    <p className="text-xs text-indigo-700 font-medium">
                      هذا الدواء مسجل في الدليل الموحد وغير مضاف لمخزن صيدليتك بعد. اضغط "إضافة لمخزني" لتسعيره وإدخاله فوراً!
                    </p>
                  </div>
                </div>
                <span className="self-start sm:self-auto text-xs font-mono font-black text-indigo-700 bg-white border border-indigo-200 px-3 py-1.5 rounded-xl shadow-2xs">
                  كود البحث: {searchTerm}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 max-h-96 overflow-y-auto pr-1">
                {catalogResults.map((med) => (
                  <div
                    key={med.id}
                    className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-xs flex flex-col justify-between gap-3 hover:border-indigo-400 hover:shadow-md transition-all group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h5 className="font-black text-slate-900 text-sm group-hover:text-indigo-600 transition-colors">
                          {med.tradeName}
                        </h5>
                        <span className="text-[11px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md shrink-0">
                          {med.dosageForm || 'عام'}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 mb-2">
                        المادة الفعالة: <b className="text-slate-800 font-bold">{med.scientificName || med.tradeName}</b>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        {med.barcode ? (
                          <span className="font-mono bg-indigo-50 text-indigo-800 font-black px-2 py-0.5 rounded-md border border-indigo-200">
                            🏷️ {med.barcode}
                          </span>
                        ) : (
                          <span className="text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">بدون باركود</span>
                        )}
                        {med.strength && (
                          <span className="font-mono bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded-md border border-emerald-200">
                            العيار: {med.strength}
                          </span>
                        )}
                        <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md font-bold">
                          التعبئة: {med.defaultUnitsPerPack || 1} شريط/علبة
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenQuickAdd(med)}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all active:scale-95 shadow-xs cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>+ إضافة إلى مخزني وتسعيره</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inventory Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500 font-black uppercase tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="p-4">الدواء والرف</th>
                    <th className="p-4">الباركود</th>
                    <th className="p-4">الرصيد</th>
                    <th className="p-4">سعر البيع</th>
                    <th className="p-4">الوجبات</th>
                    <th className="p-4 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-400">
                        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        جاري التحميل...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-400">
                        <Package className="w-12 h-12 stroke-1 text-slate-300 mx-auto mb-2" />
                        لا توجد نتائج
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Name & Shelf */}
                        <td className="p-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <b className="text-slate-900 text-sm font-black">
                                {item.customName || item.tradeName}
                              </b>
                              {item.shelfLocation ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-300/80 rounded-md text-[10px] font-black font-mono shadow-2xs">
                                  <MapPin className="w-3 h-3 text-amber-600" />
                                  الرف: {item.shelfLocation}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-300 font-bold">
                                  (الرف غير محدد)
                                </span>
                              )}
                            </div>
                            {item.scientificName && (
                              <span className="text-[11px] text-slate-500 block font-mono">
                                {item.scientificName}
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400 font-bold block">
                              {item.dosageForm} {item.strength} • {item.unitsPerPack} شريط بالعلبة
                            </span>
                          </div>
                        </td>

                        {/* Barcode */}
                        <td className="p-4">
                          {item.barcode ? (
                            <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg inline-block">
                              {item.barcode}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-[11px]">—</span>
                          )}
                        </td>

                        {/* Quantity */}
                        <td className="p-4">
                          {Number(item.validUnitsRemaining ?? (item.activeBatches?.length ? item.totalUnitsRemaining : 0)) === 0 && Number(item.expiredUnitsRemaining || 0) > 0 ? (
                            <div className="space-y-1">
                              <span className="text-xs font-black text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg inline-block font-mono">
                                0 علبة صالحة
                              </span>
                              <span className="text-[10px] text-rose-600 font-bold block">
                                ⚠️ {Math.floor(Number(item.expiredUnitsRemaining) / (item.unitsPerPack || 1))} علبة منتهية
                              </span>
                            </div>
                          ) : (
                            <div className="space-y-0.5 font-mono">
                              <b className="text-slate-900 font-black text-sm">
                                {Math.floor((item.validUnitsRemaining ?? item.totalUnitsRemaining ?? 0) / (item.unitsPerPack || 1))}
                              </b>{' '}
                              <span className="text-[11px] text-slate-500">علبة</span>
                              {(item.validUnitsRemaining ?? item.totalUnitsRemaining ?? 0) % (item.unitsPerPack || 1) > 0 && (
                                <span className="text-[11px] text-indigo-600 font-bold block">
                                  + {(item.validUnitsRemaining ?? item.totalUnitsRemaining ?? 0) % (item.unitsPerPack || 1)} شريط
                                </span>
                              )}
                              {Number(item.expiredUnitsRemaining || 0) > 0 && (
                                <span className="text-[10px] text-rose-600 font-bold block">
                                  ({Math.floor(Number(item.expiredUnitsRemaining) / (item.unitsPerPack || 1))} منتهية)
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Prices */}
                        <td className="p-4">
                          <div className="space-y-0.5 font-mono">
                            <b className="text-slate-900 font-black text-xs block">
                              {Number(item.sellingPricePack || 0).toLocaleString()} د.ع{' '}
                              <span className="text-[10px] text-slate-400 font-sans">/ علبة</span>
                            </b>
                            <span className="text-emerald-700 font-bold text-[11px] block">
                              {roundTo250(Number(item.sellingPriceUnit || 0)).toLocaleString()} د.ع{' '}
                              <span className="text-[10px] text-slate-400 font-sans">/ شريط</span>
                            </span>
                          </div>
                        </td>

                        {/* Batches Preview */}
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {(item.activeBatches || item.batches) && (item.activeBatches || item.batches).length > 0 ? (
                              (item.activeBatches || item.batches).slice(0, 2).map((b: any, idx: number) => (
                                <button
                                  key={idx}
                                  onClick={() => setSelectedTraceBatch(b.batchNumber)}
                                  className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer"
                                  title="انقر لتتبع رحلة هذه التشغيلة كاملة"
                                >
                                  #{b.batchNumber} {b.expiryFormatted && `(${b.expiryFormatted})`}
                                </button>
                              ))
                            ) : Number(item.expiredUnitsRemaining || 0) > 0 ? (
                              <span className="text-[10px] text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200">
                                ⚠️ وجبة منتهية الصلاحية
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">لا توجد وجبات نشطة</span>
                            )}
                            <button
                              onClick={() => viewBatches(item)}
                              className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold underline mr-1 cursor-pointer"
                            >
                              عرض كل الوجبات ({(item.activeBatches || item.batches)?.length || 0})
                            </button>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => openEditModal(item)}
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all cursor-pointer"
                              title="تعديل السعر والاسم"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setBarcodeItem(item)}
                              className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl transition-all cursor-pointer"
                              title="طباعة ليبل باركود"
                            >
                              <Barcode className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: SMART EXPIRY MANAGEMENT & SUPPLIER RETURNS          */}
      {/* ========================================================= */}
      {currentTab === 'SMART_EXPIRY' && (
        <div className="space-y-5 animate-in fade-in duration-150">
          {/* Header & Financial Exposure Cards */}
          <div className="p-6 bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 rounded-3xl text-white shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-purple-800/60">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center font-black">
                  <Clock className="w-6 h-6 text-amber-300 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-black flex items-center gap-2">
                    <span>إدارة الصلاحية الذكية والإرجاع للمذاخر</span>
                    <span className="px-2 py-0.5 bg-purple-400/20 text-purple-200 border border-purple-400/30 rounded-full text-[10px] font-bold">
                      Smart Expiry & Returns
                    </span>
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    تحديد الأدوية المعرضة للانتهاء، تقييم حجم الخسائر المالية المحتملة، وإرجاعها للمذخر بضغطة زر
                  </p>
                </div>
              </div>

              {/* Total Financial Risk Indicator */}
              <div className="p-3 bg-purple-900/60 border border-purple-700/60 rounded-2xl text-left font-mono">
                <span className="text-[10px] text-purple-300 block font-sans font-bold">
                  إجمالي قيمة المخزون المعرض للانتهاء (سعر الشراء):
                </span>
                <b className="text-xl font-black text-amber-300">
                  {Number(smartExpiryData?.summary?.totalAtRiskCost || 0).toLocaleString()} د.ع
                </b>
              </div>
            </div>

            {/* 5 Expiry Tiers Fast Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {/* Tier 1: EXPIRED */}
              <button
                onClick={() => setSelectedExpiryTier(selectedExpiryTier === 'EXPIRED' ? 'ALL' : 'EXPIRED')}
                className={`p-3 rounded-2xl border text-right transition-all cursor-pointer ${
                  selectedExpiryTier === 'EXPIRED'
                    ? 'bg-rose-600 text-white border-rose-400 shadow-md ring-2 ring-rose-400'
                    : 'bg-rose-950/40 text-rose-200 border-rose-800/60 hover:bg-rose-900/50'
                }`}
              >
                <span className="text-[10px] font-bold block opacity-90">❌ منتهي الصلاحية</span>
                <b className="text-base font-black font-mono mt-1 block">
                  {smartExpiryData?.summary?.tiers?.EXPIRED?.count || 0} وجبة
                </b>
                <span className="text-[10px] opacity-75 font-mono">
                  {Number(smartExpiryData?.summary?.tiers?.EXPIRED?.totalCost || 0).toLocaleString()} د.ع
                </span>
              </button>

              {/* Tier 2: DAYS_30 */}
              <button
                onClick={() => setSelectedExpiryTier(selectedExpiryTier === 'DAYS_30' ? 'ALL' : 'DAYS_30')}
                className={`p-3 rounded-2xl border text-right transition-all cursor-pointer ${
                  selectedExpiryTier === 'DAYS_30'
                    ? 'bg-red-600 text-white border-red-400 shadow-md ring-2 ring-red-400'
                    : 'bg-red-950/40 text-red-200 border-red-800/60 hover:bg-red-900/50'
                }`}
              >
                <span className="text-[10px] font-bold block opacity-90">🔴 أقل من 30 يوم</span>
                <b className="text-base font-black font-mono mt-1 block">
                  {smartExpiryData?.summary?.tiers?.DAYS_30?.count || 0} وجبة
                </b>
                <span className="text-[10px] opacity-75 font-mono">
                  {Number(smartExpiryData?.summary?.tiers?.DAYS_30?.totalCost || 0).toLocaleString()} د.ع
                </span>
              </button>

              {/* Tier 3: DAYS_60 */}
              <button
                onClick={() => setSelectedExpiryTier(selectedExpiryTier === 'DAYS_60' ? 'ALL' : 'DAYS_60')}
                className={`p-3 rounded-2xl border text-right transition-all cursor-pointer ${
                  selectedExpiryTier === 'DAYS_60'
                    ? 'bg-orange-600 text-white border-orange-400 shadow-md ring-2 ring-orange-400'
                    : 'bg-orange-950/40 text-orange-200 border-orange-800/60 hover:bg-orange-900/50'
                }`}
              >
                <span className="text-[10px] font-bold block opacity-90">🟠 31 - 60 يوم</span>
                <b className="text-base font-black font-mono mt-1 block">
                  {smartExpiryData?.summary?.tiers?.DAYS_60?.count || 0} وجبة
                </b>
                <span className="text-[10px] opacity-75 font-mono">
                  {Number(smartExpiryData?.summary?.tiers?.DAYS_60?.totalCost || 0).toLocaleString()} د.ع
                </span>
              </button>

              {/* Tier 4: DAYS_90 */}
              <button
                onClick={() => setSelectedExpiryTier(selectedExpiryTier === 'DAYS_90' ? 'ALL' : 'DAYS_90')}
                className={`p-3 rounded-2xl border text-right transition-all cursor-pointer ${
                  selectedExpiryTier === 'DAYS_90'
                    ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400'
                    : 'bg-amber-950/40 text-amber-200 border-amber-800/60 hover:bg-amber-900/50'
                }`}
              >
                <span className="text-[10px] font-bold block opacity-90">🟡 61 - 90 يوم</span>
                <b className="text-base font-black font-mono mt-1 block">
                  {smartExpiryData?.summary?.tiers?.DAYS_90?.count || 0} وجبة
                </b>
                <span className="text-[10px] opacity-75 font-mono">
                  {Number(smartExpiryData?.summary?.tiers?.DAYS_90?.totalCost || 0).toLocaleString()} د.ع
                </span>
              </button>

              {/* Tier 5: DAYS_180 */}
              <button
                onClick={() => setSelectedExpiryTier(selectedExpiryTier === 'DAYS_180' ? 'ALL' : 'DAYS_180')}
                className={`p-3 rounded-2xl border text-right transition-all cursor-pointer ${
                  selectedExpiryTier === 'DAYS_180'
                    ? 'bg-emerald-700 text-white border-emerald-400 shadow-md ring-2 ring-emerald-400'
                    : 'bg-emerald-950/40 text-emerald-200 border-emerald-800/60 hover:bg-emerald-900/50'
                }`}
              >
                <span className="text-[10px] font-bold block opacity-90">🟢 91 - 180 يوم</span>
                <b className="text-base font-black font-mono mt-1 block">
                  {smartExpiryData?.summary?.tiers?.DAYS_180?.count || 0} وجبة
                </b>
                <span className="text-[10px] opacity-75 font-mono">
                  {Number(smartExpiryData?.summary?.tiers?.DAYS_180?.totalCost || 0).toLocaleString()} د.ع
                </span>
              </button>
            </div>
          </div>

          {/* Search Filter */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between gap-3">
            <div className="relative w-full max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <input
                type="text"
                value={expirySearch}
                onChange={(e) => setExpirySearch(e.target.value)}
                placeholder="ابحث في الأدوية المعرضة للانتهاء بالاسم أو الوجبة أو المذخر..."
                className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:border-purple-600 focus:bg-white focus:outline-hidden"
              />
            </div>

            {selectedExpiryTier !== 'ALL' && (
              <button
                onClick={() => setSelectedExpiryTier('ALL')}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                إلغاء فلتر الفئة ({selectedExpiryTier})
              </button>
            )}
          </div>

          {/* Smart Expiry Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500 font-black uppercase tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="p-4">الدواء (Medicine)</th>
                    <th className="p-4">رقم الوجبة (Batch)</th>
                    <th className="p-4">تاريخ الصلاحية</th>
                    <th className="p-4">الكمية بالمخزن</th>
                    <th className="p-4">قيمة الخسارة (شراء)</th>
                    <th className="p-4">المذخر الأصلي</th>
                    <th className="p-4 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingSmartExpiry ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400">
                        <div className="w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        جاري فحص وتحليل تواريخ الصلاحية للمخزون...
                      </td>
                    </tr>
                  ) : filteredExpiryBatches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400">
                        <CheckCircle2 className="w-12 h-12 stroke-1 text-emerald-500 mx-auto mb-2" />
                        ممتاز! لا توجد أدوية معرضة للانتهاء ضمن الفئة المحددة
                      </td>
                    </tr>
                  ) : (
                    filteredExpiryBatches.map((b: any) => {
                      const isExp = b.expiryTier === 'EXPIRED';
                      return (
                        <tr
                          key={b.batchId}
                          className={`transition-colors ${
                            isExp ? 'bg-rose-50/40 hover:bg-rose-50/70' : 'hover:bg-slate-50/60'
                          }`}
                        >
                          {/* Medicine */}
                          <td className="p-4">
                            <div className="space-y-0.5">
                              <b className="text-slate-900 text-sm font-black block">{b.tradeName}</b>
                              {b.scientificName && (
                                <span className="text-[11px] text-slate-500 block font-mono">
                                  {b.scientificName}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 font-bold">
                                {b.dosageForm} {b.strength}
                              </span>
                            </div>
                          </td>

                          {/* Batch Pill (Clickable) */}
                          <td className="p-4">
                            <button
                              onClick={() => setSelectedTraceBatch(b.batchNumber)}
                              className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer"
                              title="انقر لتتبع مسار الوجبة بالتفصيل"
                            >
                              #{b.batchNumber}
                            </button>
                          </td>

                          {/* Expiry Date & Badge */}
                          <td className="p-4">
                            <div className="space-y-1 font-mono">
                              <b className="text-slate-900 font-black text-xs block">{b.expiryFormatted}</b>
                              {isExp ? (
                                <span className="px-2 py-0.5 bg-rose-600 text-white rounded-full text-[10px] font-black inline-block font-sans">
                                  ❌ منتهي ({Math.abs(b.daysUntilExpiry)} يوم مضى)
                                </span>
                              ) : b.daysUntilExpiry <= 30 ? (
                                <span className="px-2 py-0.5 bg-red-100 text-red-800 border border-red-200 rounded-full text-[10px] font-black inline-block font-sans">
                                  🔴 {b.daysUntilExpiry} يوم متبقي
                                </span>
                              ) : b.daysUntilExpiry <= 60 ? (
                                <span className="px-2 py-0.5 bg-orange-100 text-orange-800 border border-orange-200 rounded-full text-[10px] font-black inline-block font-sans">
                                  🟠 {b.daysUntilExpiry} يوم متبقي
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-full text-[10px] font-black inline-block font-sans">
                                  🟡 {b.daysUntilExpiry} يوم متبقي
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Quantity */}
                          <td className="p-4">
                            <div className="space-y-0.5 font-mono">
                              <b className="text-slate-900 font-black text-sm">{b.packsRemaining}</b>{' '}
                              <span className="text-[11px] text-slate-500">علبة</span>
                              {b.stripsRemaining > 0 && (
                                <span className="text-[11px] text-purple-600 font-bold block">
                                  + {b.stripsRemaining} شريط
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Total Cost Value at Risk */}
                          <td className="p-4 font-mono">
                            <b className="text-rose-700 font-black text-sm block">
                              {Number(b.totalCostValue).toLocaleString()} د.ع
                            </b>
                            <span className="text-[10px] text-slate-400 block font-sans">
                              (سعر الشراء: {Number(b.purchasePricePack).toLocaleString()} د.ع)
                            </span>
                          </td>

                          {/* Supplier */}
                          <td className="p-4">
                            <div className="space-y-0.5">
                              <b className="text-slate-800 text-xs font-bold block">
                                {b.supplierName || 'غير مسجل (مباشر)'}
                              </b>
                              {b.purchaseInvoiceNumber && (
                                <span className="text-[10px] text-slate-400 font-mono block">
                                  فاتورة: #{b.purchaseInvoiceNumber}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setReturnBatchItem(b)}
                                className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95"
                                title="إرجاع هذه الكمية للمذخر وخصمها من حسابه"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>إرجاع للمذخر</span>
                              </button>

                              <button
                                onClick={() => setSelectedTraceBatch(b.batchNumber)}
                                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all cursor-pointer"
                                title="تتبع مسار التشغيلة"
                              >
                                <Layers className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: BATCH TRACEABILITY SEARCH & RECALL                  */}
      {/* ========================================================= */}
      {currentTab === 'BATCH_TRACE' && (
        <div className="space-y-5 animate-in fade-in duration-150">
          <div className="p-6 bg-slate-900 rounded-3xl text-white shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center font-black">
                <Layers className="w-5 h-5 text-indigo-300" />
              </div>
              <div>
                <h3 className="text-base font-black">
                  نظام تتبع مسار الوجبات وسحب التشغيلات الطبية (Batch Journey & Recall)
                </h3>
                <p className="text-xs text-slate-400">
                  تتبع رحلة أي تشغيلة بالكامل عبر 4 مراحل: المذخر ➔ المخزن ➔ فواتير المبيعات ➔ المرتجعات
                </p>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (traceSearchInput.trim()) {
                  setSelectedTraceBatch(traceSearchInput.trim());
                }
              }}
              className="flex items-center gap-2 max-w-xl"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                <input
                  type="text"
                  value={traceSearchInput}
                  onChange={(e) => setTraceSearchInput(e.target.value)}
                  placeholder="أدخل رقم التشغيلة (Batch Number)..."
                  className="w-full pl-3 pr-9 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-mono font-bold text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>
              <button
                type="submit"
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black cursor-pointer transition-all shadow-md active:scale-95"
              >
                تتبع الوجبة
              </button>
            </form>
          </div>

          <div className="p-8 bg-white rounded-3xl border border-slate-200 text-center space-y-3">
            <Layers className="w-12 h-12 stroke-1 text-indigo-500 mx-auto" />
            <h4 className="text-base font-black text-slate-900">
              تتبع أي تشغيلة دوائية برقم الوجبة
            </h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              أدخل رقم الوجبة أعلاه أو انقر على أي رقم Batch في جداول المخزون وفواتير الشراء لفتح المخطط الزمني الكامل للرحلة.
            </p>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODALS                                                    */}
      {/* ========================================================= */}

      {/* 1. Full Batch Journey Traceability Modal */}
      {selectedTraceBatch && (
        <BatchTraceabilityModal
          batchNumber={selectedTraceBatch}
          onClose={() => setSelectedTraceBatch(null)}
          onRecallChanged={() => {
            fetchInventory();
            fetchSmartExpiry();
          }}
        />
      )}

      {/* 2. One-Click Supplier Return Modal */}
      {returnBatchItem && (
        <SupplierReturnModal
          batch={returnBatchItem}
          onClose={() => setReturnBatchItem(null)}
          onSuccess={(res) => {
            setMessage({ type: 'success', text: res.message || 'تم إرجاع الدواء للمذخر بنجاح' });
            fetchSmartExpiry();
            fetchInventory();
          }}
        />
      )}

      {/* 3. Edit Price & Custom Name Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-4 bg-indigo-600 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">تعديل سعر وبيانات المادة</h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1 hover:bg-white/20 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdatePrice} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الاسم التجاري المخصص:</label>
                <input
                  type="text"
                  value={editForm.customName}
                  onChange={(e) => setEditForm({ ...editForm, customName: e.target.value })}
                  placeholder={editingItem.tradeName}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر بيع الباكيت:</label>
                  <input
                    type="number"
                    min={0}
                    step={250}
                    value={editForm.sellingPricePack}
                    onChange={(e) => setEditForm({ ...editForm, sellingPricePack: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر بيع الشريط:</label>
                  <input
                    type="number"
                    min={0}
                    step={250}
                    value={editForm.sellingPriceUnit}
                    onChange={(e) => setEditForm({ ...editForm, sellingPriceUnit: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold"
                    required
                  />
                </div>
              </div>

              {/* Shelf Location & Grid Coordinates */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-black text-slate-800 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-amber-600" />
                    موقع الرف والتخزين (Grid Coordinates):
                  </label>
                  {editForm.shelfLocation && (
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, shelfLocation: '' })}
                      className="text-[10px] text-rose-500 hover:underline cursor-pointer font-bold"
                    >
                      مسح
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={editForm.shelfLocation}
                  onChange={(e) => setEditForm({ ...editForm, shelfLocation: e.target.value })}
                  placeholder="مثال: A-01 أو B-03 أو ❄️ ثلاجة"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-black text-slate-900 focus:bg-white focus:border-indigo-600"
                />

                {/* Quick Coordinate Generator */}
                <div className="mt-2 p-2.5 bg-slate-50 rounded-2xl border border-slate-200/90 space-y-2">
                  <span className="text-[10px] font-bold text-slate-500 block">
                    ⚡ مولّد الإحداثيات السريع للرفوف:
                  </span>

                  {/* 1. Cabinets / Sections */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-bold ml-1">الخزانة:</span>
                    {['A', 'B', 'C', 'D', 'E', 'G', 'H', '❄️ ثلاجة', 'مخزن'].map((cab) => (
                      <button
                        key={cab}
                        type="button"
                        onClick={() => {
                          if (cab.includes('ثلاجة')) {
                            setEditForm({ ...editForm, shelfLocation: '❄️ ثلاجة' });
                          } else if (cab === 'مخزن') {
                            setEditForm({ ...editForm, shelfLocation: 'مخزن-01' });
                          } else {
                            const curr = editForm.shelfLocation || '';
                            const parts = curr.split('-');
                            const newShelf = parts[1] || '01';
                            setEditForm({ ...editForm, shelfLocation: `${cab}-${newShelf}` });
                          }
                        }}
                        className="px-2 py-1 bg-white hover:bg-amber-100 hover:text-amber-900 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 cursor-pointer shadow-2xs transition-all active:scale-95"
                      >
                        {cab}
                      </button>
                    ))}
                  </div>

                  {/* 2. Shelves */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-bold ml-1">الرف:</span>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((num) => {
                      const numStr = String(num).padStart(2, '0');
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => {
                            const curr = editForm.shelfLocation || 'A-01';
                            const cab = curr.split('-')[0] || 'A';
                            setEditForm({ ...editForm, shelfLocation: `${cab}-${numStr}` });
                          }}
                          className="px-2 py-1 bg-white hover:bg-amber-100 hover:text-amber-900 border border-slate-200 rounded-lg text-[10px] font-mono font-bold text-slate-700 cursor-pointer shadow-2xs transition-all active:scale-95"
                        >
                          {num}
                        </button>
                      );
                    })}
                  </div>

                  {/* 3. Presets & Free text tip */}
                  <div className="flex items-center justify-between gap-1 flex-wrap pt-1.5 border-t border-slate-200/60">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] text-slate-400 font-bold ml-1">شائع:</span>
                      {['A-01', 'A-02', 'B-01', 'B-02', 'C-01', '❄️ ثلاجة', 'درج القطرات'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setEditForm({ ...editForm, shelfLocation: preset })}
                          className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-md text-[9px] font-bold cursor-pointer transition-all"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium pt-0.5">
                    💡 يمكنك كتابة أي رقم أو اسم رف تريده بحرية في الحقل أعلاه بدون قيود (مثال: A-15 أو مخزن-3 أو درج 8).
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">حد تنبيه النواقص (أشرطة):</label>
                <input
                  type="number"
                  min={1}
                  value={editForm.minAlertUnits}
                  onChange={(e) => setEditForm({ ...editForm, minAlertUnits: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer shadow-xs"
                >
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Item Batches Details Modal */}
      {batchesItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm">تشغيلات ووجبات ({batchesItem.tradeName})</h3>
                <span className="text-[10px] text-slate-400 font-mono">
                  {batchesItem.dosageForm} {batchesItem.strength}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setBatchesItem(null)}
                className="p-1 hover:bg-white/20 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-3">
              {loadingBatches ? (
                <div className="p-8 text-center text-slate-400 text-xs font-bold">جاري تحميل الوجبات...</div>
              ) : batchesList.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs font-bold">لا توجد وجبات مسجلة لهذا الدواء</div>
              ) : (
                batchesList.map((b) => (
                  <div key={b.id} className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <b className="font-mono text-sm text-slate-900 font-black">#{b.batchNumber}</b>
                        {b.isRecalled && (
                          <span className="px-2 py-0.5 bg-rose-100 text-rose-700 border border-rose-200 rounded-md text-[10px] font-black">
                            ⛔ مسحوبة
                          </span>
                        )}
                        {(b.isExpired || new Date(b.expiryDate) < new Date()) && (
                          <span className="px-2 py-0.5 bg-rose-100 text-rose-700 border border-rose-200 rounded-md text-[10px] font-black">
                            ⚠️ منتهية الصلاحية
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <span>الصلاحية: <b className="text-slate-800 font-mono">{new Date(b.expiryDate).toLocaleDateString('ar-IQ')}</b></span>
                        <span>•</span>
                        <span>شراء: <b className="text-emerald-700 font-mono font-bold">{Number(b.purchasePricePack).toLocaleString()} د.ع</b></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-left font-mono">
                        <b className="text-indigo-600 font-black text-sm block">
                          {Math.floor((b.quantityUnitsRemaining || 0) / (batchesItem.unitsPerPack || 1))} علبة
                        </b>
                        {(b.quantityUnitsRemaining || 0) % (batchesItem.unitsPerPack || 1) > 0 && (
                          <span className="text-[10px] text-slate-500 font-bold block">
                            + {(b.quantityUnitsRemaining || 0) % (batchesItem.unitsPerPack || 1)} شريط
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          setBatchesItem(null);
                          setSelectedTraceBatch(b.batchNumber);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-black transition-all cursor-pointer"
                      >
                        تتبع الرحلة ➔
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. Barcode Label Generator Modal */}
      {barcodeItem && (
        <BarcodeGeneratorModal item={barcodeItem} onClose={() => setBarcodeItem(null)} />
      )}

      {/* 6. AI Voice & Natural Language Smart Search Modal */}
      {showSmartSearch && (
        <SmartSearchModal
          autoStartVoice={smartSearchAutoVoice}
          onClose={() => setShowSmartSearch(false)}
        />
      )}

      {/* 7. Add Unregistered Medicine Modal */}
      {showAddMedModal && (
        <AddUnregisteredMedicineModal
          initialSearch={searchTerm}
          onClose={() => setShowAddMedModal(false)}
          onSuccess={(newMed) => {
            setMessage({
              type: 'success',
              text: `تم تسجيل (${newMed.tradeName}) بنجاح! يمكنك الآن إدخال وجبته وأسعاره من صفحة المشتريات`,
            });
            fetchInventory();
            fetchSummaryCounts();
          }}
        />
      )}

      {/* 8. Quick Add & Price Medicine From Master Catalog Modal */}
      {quickAddMed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100 mb-4">
              <div>
                <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                  من الدليل المركزي الموحد (28 ألف مادة) 💊
                </span>
                <h3 className="font-black text-lg text-slate-900 mt-1.5">{quickAddMed.tradeName}</h3>
                <p className="text-xs text-slate-500 font-medium">
                  {quickAddMed.scientificName || quickAddMed.tradeName} {quickAddMed.strength && `• ${quickAddMed.strength}`}
                </p>
                {quickAddMed.barcode && (
                  <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md inline-block mt-1">
                    الباركود: {quickAddMed.barcode}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setQuickAddMed(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleQuickAddSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سعر البيع للباكيت (د.ع) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="250"
                    required
                    value={quickAddForm.sellingPricePack || ''}
                    onChange={(e) => {
                      const packPrice = Number(e.target.value) || 0;
                      const units = Number(quickAddForm.unitsPerPack) || 1;
                      setQuickAddForm((prev) => ({
                        ...prev,
                        sellingPricePack: packPrice,
                        sellingPriceUnit: units > 1 ? calculateStripPrice(packPrice, units) : packPrice,
                      }));
                    }}
                    placeholder="مثال: 5000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر البيع للشريط/الوحدة (د.ع)</label>
                  <input
                    type="number"
                    min="0"
                    step="250"
                    value={quickAddForm.sellingPriceUnit || ''}
                    onChange={(e) =>
                      setQuickAddForm((prev) => ({ ...prev, sellingPriceUnit: Number(e.target.value) || 0 }))
                    }
                    placeholder="مثال: 2500"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    رصيد الباكيتات الحالي <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={quickAddForm.quantityPacks || ''}
                    onChange={(e) =>
                      setQuickAddForm((prev) => ({ ...prev, quantityPacks: Number(e.target.value) || 0 }))
                    }
                    placeholder="مثال: 10"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">عدد الأشرطة/الوحدات في الباكيت</label>
                  <input
                    type="number"
                    min="1"
                    value={quickAddForm.unitsPerPack || 1}
                    onChange={(e) => {
                      const units = Number(e.target.value) || 1;
                      const packPrice = Number(quickAddForm.sellingPricePack) || 0;
                      setQuickAddForm((prev) => ({
                        ...prev,
                        unitsPerPack: units,
                        sellingPriceUnit: units > 1 ? calculateStripPrice(packPrice, units) : packPrice,
                      }));
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر الشراء للباكيت (اختياري)</label>
                  <input
                    type="number"
                    min="0"
                    step="250"
                    value={quickAddForm.purchasePricePack || ''}
                    onChange={(e) =>
                      setQuickAddForm((prev) => ({ ...prev, purchasePricePack: Number(e.target.value) || 0 }))
                    }
                    placeholder="مثال: 3500"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">موقع الرف (Shelf)</label>
                  <input
                    type="text"
                    value={quickAddForm.shelfLocation}
                    onChange={(e) => setQuickAddForm((prev) => ({ ...prev, shelfLocation: e.target.value }))}
                    placeholder="مثال: A-04"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  شهر / سنة الصلاحية (1-12 و 20XX)
                </label>
                <SmartExpiryInput
                  month={quickAddForm.expiryMonth}
                  year={quickAddForm.expiryYear}
                  onChange={(m, y) =>
                    setQuickAddForm((prev) => ({ ...prev, expiryMonth: m, expiryYear: y }))
                  }
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setQuickAddMed(null)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-800 text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingQuickAdd}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md shadow-indigo-200 transition-all cursor-pointer disabled:opacity-50"
                >
                  {savingQuickAdd ? 'جاري الحفظ...' : 'حفظ وإدخال للمخزن 🚀'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
