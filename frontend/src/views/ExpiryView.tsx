import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  Search,
  RotateCcw,
  Layers,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Printer,
  X,
  Package,
  ShieldAlert,
  MapPin,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { SupplierReturnModal } from '../components/SupplierReturnModal';
import { BatchTraceabilityModal } from '../components/BatchTraceabilityModal';
import { usePharmacyLiveSync } from '../hooks/usePharmacyLiveSync';
import { getLocalSuppliers } from '../utils/localDatabase';

interface ExpiryViewProps {
  onNavigateToInventory?: () => void;
}

export const ExpiryView: React.FC<ExpiryViewProps> = ({ onNavigateToInventory }) => {
  // Filters & Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [scopeAllBatches, setScopeAllBatches] = useState(false); // false: expiring soon (180 days), true: all batches in stock
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedTier, setSelectedTier] = useState<string>('ALL');

  // Suppliers list
  const [suppliers, setSuppliers] = useState<any[]>([]);

  // Data & Loading
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [selectedTraceBatch, setSelectedTraceBatch] = useState<string | null>(null);
  const [returnBatchItem, setReturnBatchItem] = useState<any | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Available years list (e.g. current year - 1 up to +7 years)
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => {
    const years = [];
    for (let y = currentYear - 1; y <= currentYear + 7; y++) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  // Fetch Suppliers
  const fetchSuppliers = async () => {
    try {
      const localSups = await getLocalSuppliers();
      if (localSups && localSups.length > 0) {
        setSuppliers(localSups);
      }
      if (navigator.onLine) {
        const serverSups = await apiRequest<any[]>('/inventory/suppliers');
        if (serverSups) {
          setSuppliers(serverSups);
        }
      }
    } catch (e) {
      console.warn('Could not load suppliers:', e);
    }
  };

  // Fetch Expiry Data from Backend
  const fetchExpiryData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      if (selectedSupplierId) params.append('supplierId', selectedSupplierId);
      if (selectedYear) params.append('year', selectedYear);
      if (selectedMonth) params.append('month', selectedMonth);
      if (scopeAllBatches) params.append('allBatches', 'true');
      if (selectedTier && selectedTier !== 'ALL') params.append('tier', selectedTier);

      const res = await apiRequest<any>(`/inventory/smart-expiry-summary?${params.toString()}`);
      setData(res);
    } catch (err: any) {
      console.error('Failed to load expiry summary:', err);
      setError(err.message || 'حدث خطأ أثناء تحميل بيانات الصلاحية');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchExpiryData();
    }, 250);
    return () => clearTimeout(timer);
  }, [searchTerm, selectedYear, selectedMonth, selectedSupplierId, scopeAllBatches, selectedTier]);

  // Live Sync
  usePharmacyLiveSync(() => {
    fetchExpiryData();
  });

  const handlePrint = () => {
    window.print();
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setSelectedYear('');
    setSelectedMonth('');
    setSelectedSupplierId('');
    setSelectedTier('ALL');
    setScopeAllBatches(false);
  };

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    selectedYear ||
    selectedMonth ||
    selectedSupplierId ||
    selectedTier !== 'ALL' ||
    scopeAllBatches
  );

  const batches = data?.batches || [];
  const summary = data?.summary || {};
  const tiers = summary?.tiers || {};

  return (
    <div className="flex flex-col gap-5 pb-16 print:p-0">
      {/* Page Title & Control Header */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
              <Clock className="w-5 h-5 text-amber-300" />
            </div>
            <h1 className="text-xl font-black tracking-tight">إدارة وبحث الإكسباير والصلاحيات الذكية</h1>
            <span className="px-2.5 py-0.5 bg-amber-400/20 text-amber-300 border border-amber-400/30 rounded-full text-[11px] font-mono font-bold">
              Smart Expiry & Returns
            </span>
          </div>
          <p className="text-xs text-purple-200/90 pr-12">
            البحث في كافة تواريخ الانتهاء، تتبع مسارات الوجبات، تقييم المخاطر المالية، وإرجاع الوجبات للمذاخر بضغطة زر
          </p>
        </div>

        <div className="flex items-center gap-2 self-end md:self-center shrink-0">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-black backdrop-blur-sm border border-white/10 transition-all cursor-pointer shadow-xs"
            title="طباعة كشف الإكسباير الحالي"
          >
            <Printer className="w-4 h-4 text-purple-200" />
            <span>طباعة الكشف</span>
          </button>

          <button
            onClick={fetchExpiryData}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-black backdrop-blur-sm border border-white/10 transition-all cursor-pointer shadow-xs"
            title="تحديث البيانات الآن"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          {onNavigateToInventory && (
            <button
              onClick={onNavigateToInventory}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600/80 hover:bg-purple-600 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-xs"
            >
              <Package className="w-4 h-4" />
              <span>المخزن الرئيسي</span>
            </button>
          )}
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div
          className={`p-4 rounded-2xl flex items-center justify-between gap-2 text-xs font-black animate-in fade-in ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="p-1 hover:bg-black/5 rounded-lg cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Financial Exposure KPI Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Card 1: Total Cost at Risk */}
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs text-slate-500 font-bold block">إجمالي قيمة الخطر (سعر الشراء)</span>
            <div className="text-2xl font-black text-rose-600 font-mono">
              {Number(summary.totalAtRiskCost || 0).toLocaleString()}{' '}
              <span className="text-xs font-sans font-bold text-slate-600">د.ع</span>
            </div>
            <span className="text-[11px] text-slate-400 block">
              قيمة الأدوية المنتهية أو المعرضة للانتهاء
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
            <ShieldAlert className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: Batches at Risk */}
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs text-slate-500 font-bold block">عدد الوجبات المعرضة للانتهاء</span>
            <div className="text-2xl font-black text-amber-600 font-mono">
              {summary.totalBatchesAtRisk || 0}{' '}
              <span className="text-xs font-sans font-bold text-slate-600">وجبة</span>
            </div>
            <span className="text-[11px] text-slate-400 block">
              من أصل {summary.totalBatches || 0} وجبة مطابقة للبحث
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Potential Selling Loss */}
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs text-slate-500 font-bold block">قيمة البيع المتوقعة للوجبات المهددة</span>
            <div className="text-2xl font-black text-indigo-600 font-mono">
              {Number(summary.totalAtRiskSelling || 0).toLocaleString()}{' '}
              <span className="text-xs font-sans font-bold text-slate-600">د.ع</span>
            </div>
            <span className="text-[11px] text-slate-400 block">
              الأرباح المتوقعة المحمية في حال تم تصريفها أو إرجاعها
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <Clock className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Advanced Search & Filtering Box */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4 print:hidden">
        {/* Row 1: Search Bar & Scope Toggle */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          {/* Text Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث بالاسم، المادة العلمية، الباركود، رقم الوجبة، المذخر، أو تاريخ مثل 05/2026 أو 2026..."
              className="w-full pl-3 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:border-purple-600 focus:bg-white focus:outline-hidden transition-all shadow-inner"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute left-3 top-3 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Scope Selector: All Batches vs Expiring Soon */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-2xl shrink-0 self-start lg:self-auto">
            <button
              onClick={() => setScopeAllBatches(false)}
              className={`px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                !scopeAllBatches
                  ? 'bg-purple-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⚠️ المعرضة للانتهاء قريباً (6 أشهر)
            </button>
            <button
              onClick={() => setScopeAllBatches(true)}
              className={`px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                scopeAllBatches
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📦 كافة الوجبات بالمخزن (شامل)
            </button>
          </div>
        </div>

        {/* Row 2: Selectors (Year, Month, Supplier) */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
          {/* Year Filter */}
          <div className="flex items-center gap-1.5 min-w-[140px]">
            <span className="text-xs font-bold text-slate-500 shrink-0">السنة:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 focus:outline-hidden focus:border-purple-600"
            >
              <option value="">كل السنوات</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          {/* Month Filter */}
          <div className="flex items-center gap-1.5 min-w-[140px]">
            <span className="text-xs font-bold text-slate-500 shrink-0">الشهر:</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 focus:outline-hidden focus:border-purple-600"
            >
              <option value="">كل الأشهر</option>
              <option value="1">01 - كانون الثاني (يناير)</option>
              <option value="2">02 - شباط (فبراير)</option>
              <option value="3">03 - آذار (مارس)</option>
              <option value="4">04 - نيسان (أبريل)</option>
              <option value="5">05 - أيار (مايو)</option>
              <option value="6">06 - حزيران (يونيو)</option>
              <option value="7">07 - تموز (يوليو)</option>
              <option value="8">08 - آب (أغسطس)</option>
              <option value="9">09 - أيلول (سبتمبر)</option>
              <option value="10">10 - تشرين الأول (أكتوبر)</option>
              <option value="11">11 - تشرين الثاني (نوفمبر)</option>
              <option value="12">12 - كانون الأول (ديسمبر)</option>
            </select>
          </div>

          {/* Supplier Filter */}
          <div className="flex items-center gap-1.5 min-w-[200px] flex-1 max-w-sm">
            <span className="text-xs font-bold text-slate-500 shrink-0">المذخر / المورد:</span>
            <select
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 focus:outline-hidden focus:border-purple-600 truncate"
            >
              <option value="">كل المذاخر والموردين</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer mr-auto transition-all"
            >
              <X className="w-3.5 h-3.5 text-slate-500" />
              <span>إلغاء الفلاتر</span>
            </button>
          )}
        </div>

        {/* Row 3: Expiry Tiers Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <span className="text-xs font-black text-slate-600 ml-1">تصنيف الفئات:</span>

          <button
            onClick={() => setSelectedTier('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
              selectedTier === 'ALL'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            الكل ({data?.summary?.totalBatches ?? batches.length})
          </button>

          <button
            onClick={() => setSelectedTier(selectedTier === 'EXPIRED' ? 'ALL' : 'EXPIRED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              selectedTier === 'EXPIRED'
                ? 'bg-rose-600 text-white shadow-xs ring-2 ring-rose-300'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            <span>❌ منتهي الصلاحية</span>
            <span className="px-1.5 py-0.2 bg-black/10 rounded-md font-mono">
              {tiers.EXPIRED?.count || 0}
            </span>
          </button>

          <button
            onClick={() => setSelectedTier(selectedTier === 'DAYS_30' ? 'ALL' : 'DAYS_30')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              selectedTier === 'DAYS_30'
                ? 'bg-red-600 text-white shadow-xs ring-2 ring-red-300'
                : 'bg-red-50 text-red-700 hover:bg-red-100'
            }`}
          >
            <span>🔴 أقل من 30 يوم</span>
            <span className="px-1.5 py-0.2 bg-black/10 rounded-md font-mono">
              {tiers.DAYS_30?.count || 0}
            </span>
          </button>

          <button
            onClick={() => setSelectedTier(selectedTier === 'DAYS_60' ? 'ALL' : 'DAYS_60')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              selectedTier === 'DAYS_60'
                ? 'bg-orange-600 text-white shadow-xs ring-2 ring-orange-300'
                : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
            }`}
          >
            <span>🟠 31 - 60 يوم</span>
            <span className="px-1.5 py-0.2 bg-black/10 rounded-md font-mono">
              {tiers.DAYS_60?.count || 0}
            </span>
          </button>

          <button
            onClick={() => setSelectedTier(selectedTier === 'DAYS_90' ? 'ALL' : 'DAYS_90')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              selectedTier === 'DAYS_90'
                ? 'bg-amber-600 text-white shadow-xs ring-2 ring-amber-300'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            <span>🟡 61 - 90 يوم</span>
            <span className="px-1.5 py-0.2 bg-black/10 rounded-md font-mono">
              {tiers.DAYS_90?.count || 0}
            </span>
          </button>

          <button
            onClick={() => setSelectedTier(selectedTier === 'DAYS_180' ? 'ALL' : 'DAYS_180')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              selectedTier === 'DAYS_180'
                ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-300'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            <span>🟢 91 - 180 يوم</span>
            <span className="px-1.5 py-0.2 bg-black/10 rounded-md font-mono">
              {tiers.DAYS_180?.count || 0}
            </span>
          </button>

          <button
            onClick={() => setSelectedTier(selectedTier === 'YEAR_1' ? 'ALL' : 'YEAR_1')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              selectedTier === 'YEAR_1'
                ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-300'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            <span>🔵 6 - 12 شهر</span>
            <span className="px-1.5 py-0.2 bg-black/10 rounded-md font-mono">
              {tiers.YEAR_1?.count || 0}
            </span>
          </button>

          <button
            onClick={() => setSelectedTier(selectedTier === 'SAFE' ? 'ALL' : 'SAFE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              selectedTier === 'SAFE'
                ? 'bg-slate-700 text-white shadow-xs ring-2 ring-slate-400'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>🛡️ أكثر من سنة (+1 Yr)</span>
            <span className="px-1.5 py-0.2 bg-black/10 rounded-md font-mono">
              {tiers.SAFE?.count || 0}
            </span>
          </button>
        </div>
      </div>

      {/* Main Results Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden print:border-none print:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-[11px] text-slate-500 font-black uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th className="p-4">الدواء (Medicine)</th>
                <th className="p-4">رقم الوجبة (Batch)</th>
                <th className="p-4">مكان الرف</th>
                <th className="p-4">تاريخ الصلاحية</th>
                <th className="p-4">الكمية بالمخزن</th>
                <th className="p-4">قيمة الخطر (سعر الشراء)</th>
                <th className="p-4">المذخر الأصلي</th>
                <th className="p-4 text-center print:hidden">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-16 text-center text-slate-400">
                    <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <span className="font-bold">جاري البحث وفحص تواريخ الصلاحية والوجبات...</span>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-rose-500">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-500" />
                    <span className="font-bold">{error}</span>
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-16 text-center text-slate-400">
                    <CheckCircle2 className="w-12 h-12 stroke-1 text-emerald-500 mx-auto mb-3" />
                    <p className="font-black text-slate-700 text-sm mb-1">
                      لا توجد أدوية أو وجبات مطابقة للبحث أو الفلتر المحدد
                    </p>
                    <p className="text-xs text-slate-400">
                      جرب تغيير الكلمات المفتاحية أو اختر نطاقاً زمنياً أوسع.
                    </p>
                  </td>
                </tr>
              ) : (
                batches.map((b: any) => {
                  const isExp = b.expiryTier === 'EXPIRED';
                  const isUnder30 = b.expiryTier === 'DAYS_30';
                  const isUnder60 = b.expiryTier === 'DAYS_60';
                  const isUnder90 = b.expiryTier === 'DAYS_90';
                  const isUnder180 = b.expiryTier === 'DAYS_180';
                  const isYear1 = b.expiryTier === 'YEAR_1';
                  const isSafe = b.expiryTier === 'SAFE';

                  return (
                    <tr
                      key={b.batchId}
                      className={`transition-colors ${
                        isExp
                          ? 'bg-rose-50/50 hover:bg-rose-50/80'
                          : isUnder30
                          ? 'bg-red-50/30 hover:bg-red-50/60'
                          : 'hover:bg-slate-50/60'
                      }`}
                    >
                      {/* Medicine Info */}
                      <td className="p-4">
                        <div className="space-y-0.5">
                          <b className="text-slate-900 text-sm font-black block">{b.tradeName}</b>
                          {b.scientificName && (
                            <span className="text-[11px] text-slate-500 block font-mono">
                              {b.scientificName}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 font-bold block">
                            {b.dosageForm} {b.strength}
                          </span>
                        </div>
                      </td>

                      {/* Batch Number Pill */}
                      <td className="p-4">
                        <button
                          onClick={() => setSelectedTraceBatch(b.batchNumber)}
                          className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1"
                          title="انقر لتتبع مسار الوجبة بالتفصيل"
                        >
                          <Layers className="w-3 h-3 text-purple-500" />
                          <span>#{b.batchNumber}</span>
                        </button>
                      </td>

                      {/* Shelf Location */}
                      <td className="p-4">
                        {b.shelfLocation ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold font-mono">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            {b.shelfLocation}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-[11px]">غير محدد</span>
                        )}
                      </td>

                      {/* Expiry Date & Remaining Days Badge */}
                      <td className="p-4">
                        <div className="space-y-1 font-mono">
                          <b className="text-slate-900 font-black text-xs block">{b.expiryFormatted}</b>
                          {isExp ? (
                            <span className="px-2 py-0.5 bg-rose-600 text-white rounded-full text-[10px] font-black inline-block font-sans">
                              ❌ منتهي ({Math.abs(b.daysUntilExpiry)} يوم مضى)
                            </span>
                          ) : isUnder30 ? (
                            <span className="px-2 py-0.5 bg-red-100 text-red-800 border border-red-200 rounded-full text-[10px] font-black inline-block font-sans">
                              🔴 {b.daysUntilExpiry} يوم متبقي
                            </span>
                          ) : isUnder60 ? (
                            <span className="px-2 py-0.5 bg-orange-100 text-orange-800 border border-orange-200 rounded-full text-[10px] font-black inline-block font-sans">
                              🟠 {b.daysUntilExpiry} يوم متبقي
                            </span>
                          ) : isUnder90 ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-full text-[10px] font-black inline-block font-sans">
                              🟡 {b.daysUntilExpiry} يوم متبقي
                            </span>
                          ) : isUnder180 ? (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full text-[10px] font-black inline-block font-sans">
                              🟢 {b.daysUntilExpiry} يوم متبقي
                            </span>
                          ) : isYear1 ? (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 border border-blue-200 rounded-full text-[10px] font-black inline-block font-sans">
                              🔵 {b.daysUntilExpiry} يوم متبقي (6-12 شهر)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-full text-[10px] font-black inline-block font-sans">
                              🛡️ {b.daysUntilExpiry} يوم (+1 سنة)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Quantity Remaining */}
                      <td className="p-4">
                        <div className="space-y-0.5 font-mono">
                          <b className="text-slate-900 font-black text-sm">{b.packsRemaining}</b>{' '}
                          <span className="text-[11px] text-slate-500 font-sans">علبة</span>
                          {b.stripsRemaining > 0 && (
                            <span className="text-[11px] text-purple-600 font-bold block font-sans">
                              + {b.stripsRemaining} شريط
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Total Cost Value at Risk */}
                      <td className="p-4 font-mono">
                        <b className={`text-sm font-black block ${isSafe ? 'text-slate-700' : 'text-rose-700'}`}>
                          {Number(b.totalCostValue).toLocaleString()} د.ع
                        </b>
                        <span className="text-[10px] text-slate-400 block font-sans">
                          (سعر الشراء: {Number(b.purchasePricePack).toLocaleString()} د.ع)
                        </span>
                      </td>

                      {/* Supplier & Invoice */}
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

                      {/* Action Buttons */}
                      <td className="p-4 text-center print:hidden">
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
                            title="تتبع مسار التشغيلة بالكامل"
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

      {/* Supplier Return Modal */}
      {returnBatchItem && (
        <SupplierReturnModal
          batch={returnBatchItem}
          onClose={() => setReturnBatchItem(null)}
          onSuccess={(res) => {
            setReturnBatchItem(null);
            setActionMessage({
              type: 'success',
              text: `تم إرجاع ${res?.returnedPacks || ''} علبة إلى المذخر بنجاح وتم تسجيل سند الإرجاع وخصم الدين!`,
            });
            fetchExpiryData();
          }}
        />
      )}

      {/* Batch Traceability Modal */}
      {selectedTraceBatch && (
        <BatchTraceabilityModal
          batchNumber={selectedTraceBatch}
          onClose={() => setSelectedTraceBatch(null)}
          onRecallChanged={() => {
            fetchExpiryData();
          }}
        />
      )}
    </div>
  );
};
