import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart,
  ShoppingBag,
  RefreshCw,
  Calendar,
  Package,
  FileSpreadsheet,
  Printer,
  Search,
  Users,
  CreditCard,
  AlertTriangle,
  Layers,
  Brain,
  Zap,
  Clock,
  Award,
  ShieldAlert,
  Phone,
  RotateCcw,
  MapPin,
  MessageSquare,
  Copy,
  Check,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { BatchTraceabilityModal } from '../components/BatchTraceabilityModal';
import { SupplierReturnModal } from '../components/SupplierReturnModal';

export const ReportsView: React.FC = () => {
  const today = new Date().toISOString().slice(0, 10);
  const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  // Active Tab: 'shortages' | 'inventory' | 'sold' | 'debts' | 'financial' | 'net_profit' | 'dead_stock' | 'forecast'
  const [activeTab, setActiveTab] = useState<'shortages' | 'inventory' | 'sold' | 'debts' | 'financial' | 'net_profit' | 'dead_stock' | 'forecast'>('shortages');

  // Date Range States
  const [periodPreset, setPeriodPreset] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('month');
  const [from, setFrom] = useState(firstDayOfMonth);
  const [to, setTo] = useState(today);
  const [deadStockDays, setDeadStockDays] = useState<number>(90);

  // Profitability Sorting: 'PROFIT' | 'VOLUME' | 'MARGIN' | 'LOW_MARGIN'
  const [profitSortBy, setProfitSortBy] = useState<'PROFIT' | 'VOLUME' | 'MARGIN' | 'LOW_MARGIN'>('PROFIT');

  // Shortages State & Filters
  const [shortagesReport, setShortagesReport] = useState<any | null>(null);
  const [shortageSupplierFilter, setShortageSupplierFilter] = useState<string>('ALL');
  const [shortageSeverityFilter, setShortageSeverityFilter] = useState<string>('ALL');
  const [copiedSupplierId, setCopiedSupplierId] = useState<string | null>(null);

  // Modal Triggers for Dead Stock
  const [selectedTraceBatch, setSelectedTraceBatch] = useState<string | null>(null);
  const [returnBatchItem, setReturnBatchItem] = useState<any | null>(null);

  // Search filter inside tables
  const [tableSearch, setTableSearch] = useState('');

  // Loading States
  const [loading, setLoading] = useState(false);

  // Data States
  const [financialData, setFinancialData] = useState<any | null>(null);
  const [netProfitReport, setNetProfitReport] = useState<any | null>(null);
  const [deadStockReport, setDeadStockReport] = useState<any | null>(null);
  const [forecastReport, setForecastReport] = useState<any | null>(null);
  const [topMedicines, setTopMedicines] = useState<any[]>([]);
  const [inventoryValuation, setInventoryValuation] = useState<any | null>(null);
  const [currentStocktake, setCurrentStocktake] = useState<any[]>([]);
  const [profitabilityReport, setProfitabilityReport] = useState<any | null>(null);
  const [soldStocktake, setSoldStocktake] = useState<any[]>([]);
  const [debtsReport, setDebtsReport] = useState<any | null>(null);

  // Set Preset Date Ranges
  const handleSetPreset = (preset: 'today' | 'week' | 'month' | 'year') => {
    setPeriodPreset(preset);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    setTo(todayStr);

    if (preset === 'today') {
      setFrom(todayStr);
    } else if (preset === 'week') {
      const pastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setFrom(pastWeek.toISOString().slice(0, 10));
    } else if (preset === 'month') {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      setFrom(firstOfMonth.toISOString().slice(0, 10));
    } else if (preset === 'year') {
      const firstOfYear = new Date(now.getFullYear(), 0, 1);
      setFrom(firstOfYear.toISOString().slice(0, 10));
    }
  };

  const fetchReports = async () => {
    setLoading(true);
    try {
      if (activeTab === 'shortages') {
        const queryParams = new URLSearchParams();
        if (shortageSupplierFilter && shortageSupplierFilter !== 'ALL') {
          queryParams.append('supplierId', shortageSupplierFilter);
        }
        if (shortageSeverityFilter && shortageSeverityFilter !== 'ALL') {
          queryParams.append('severity', shortageSeverityFilter);
        }
        const shortages = await apiRequest<any>(`/inventory/shortages-by-supplier?${queryParams.toString()}`);
        setShortagesReport(shortages);
      } else if (activeTab === 'inventory') {
        const [val, stock] = await Promise.all([
          apiRequest<any>('/reports/inventory-valuation'),
          apiRequest<any[]>('/reports/stocktake/current'),
        ]);
        setInventoryValuation(val);
        setCurrentStocktake(stock || []);
      } else if (activeTab === 'sold') {
        const sold = await apiRequest<any>(`/reports/stocktake/sold?from=${from}&to=${to}`);
        setProfitabilityReport(sold);
        setSoldStocktake(sold?.items || []);
      } else if (activeTab === 'debts') {
        const debts = await apiRequest<any>(`/reports/debts/summary?from=${from}&to=${to}`);
        setDebtsReport(debts);
      } else if (activeTab === 'financial') {
        const [fin, top, val] = await Promise.all([
          apiRequest<any>(`/reports/financial?from=${from}&to=${to}`),
          apiRequest<any[]>(`/reports/top-selling?from=${from}&to=${to}&limit=10`),
          apiRequest<any>('/reports/inventory-valuation'),
        ]);
        setFinancialData(fin);
        setTopMedicines(top || []);
        setInventoryValuation(val);
      } else if (activeTab === 'net_profit') {
        const profit = await apiRequest<any>(`/reports/net-profit?from=${from}&to=${to}`);
        setNetProfitReport(profit);
      } else if (activeTab === 'dead_stock') {
        const dead = await apiRequest<any>(`/reports/dead-stock?days=${deadStockDays}`);
        setDeadStockReport(dead);
      } else if (activeTab === 'forecast') {
        const forecast = await apiRequest<any>('/reports/smart-stock-forecast');
        setForecastReport(forecast);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [activeTab, from, to, deadStockDays, shortageSupplierFilter, shortageSeverityFilter]);

  // WhatsApp and Copy Helpers for Supplier Shortages
  const generateWhatsAppMessage = (supplierGroup: any) => {
    let msg = `*طلبية نواقص صيدلية (دوائي)* 🌿\n`;
    msg += `المذخر: *${supplierGroup.supplierName}*\n`;
    msg += `التاريخ: ${new Date().toLocaleDateString('ar-IQ')}\n`;
    msg += `-----------------------------\n`;

    supplierGroup.items.forEach((it: any, idx: number) => {
      const severityIcon = it.severity === 'OUT_OF_STOCK' ? '🔴 نافد' : it.severity === 'AT_MINIMUM' ? '🟠 بالحد' : '🟡 وشيك';
      msg += `${idx + 1}. *${it.tradeName}* (${it.dosageForm || ''} ${it.strength || ''})\n`;
      msg += `   - الكمية المطلوبة: *${it.suggestedOrderPacks} علبة*\n`;
      msg += `   - الرصيد الحالي: ${it.availablePacks} علبة (${severityIcon})\n`;
    });

    msg += `-----------------------------\n`;
    msg += `يرجى تأكيد الاستلام وتجهيز الطلبية. شكراً جزيلاً!`;
    return msg;
  };

  const openWhatsApp = (supplierGroup: any) => {
    const msg = generateWhatsAppMessage(supplierGroup);
    let phone = supplierGroup.supplierPhone ? supplierGroup.supplierPhone.replace(/[^0-9]/g, '') : '';
    if (phone.startsWith('07')) {
      phone = '964' + phone.slice(1);
    }
    const url = phone
      ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const copySupplierOrder = (supplierGroup: any, key: string) => {
    const msg = generateWhatsAppMessage(supplierGroup);
    navigator.clipboard.writeText(msg);
    setCopiedSupplierId(key);
    setTimeout(() => setCopiedSupplierId(null), 2500);
  };

  // Export CSV Helper
  const exportToCSV = (filename: string, rows: (string | number)[][], headers: string[]) => {
    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join(
        '\n',
      );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filtered Lists
  const filteredCurrentStock = currentStocktake.filter(
    (item) =>
      !tableSearch ||
      item.tradeName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
      item.scientificName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
      item.customName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
      item.barcode?.includes(tableSearch),
  );

  const filteredSoldStock = (soldStocktake || [])
    .filter(
      (item) =>
        !tableSearch ||
        item.tradeName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
        item.scientificName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
        item.barcode?.includes(tableSearch),
    )
    .sort((a, b) => {
      if (profitSortBy === 'PROFIT') {
        return Number(b.totalProfit || 0) - Number(a.totalProfit || 0);
      }
      if (profitSortBy === 'VOLUME') {
        return (Number(b.soldPacks || 0) + Number(b.soldStrips || 0)) - (Number(a.soldPacks || 0) + Number(a.soldStrips || 0));
      }
      if (profitSortBy === 'MARGIN') {
        return Number(b.profitMarginPercent || 0) - Number(a.profitMarginPercent || 0);
      }
      if (profitSortBy === 'LOW_MARGIN') {
        return Number(a.profitMarginPercent || 0) - Number(b.profitMarginPercent || 0);
      }
      return 0;
    });

  const filteredDeadStock = (deadStockReport?.items || []).filter(
    (item: any) =>
      !tableSearch ||
      item.tradeName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
      item.scientificName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
      item.barcode?.includes(tableSearch) ||
      item.supplierName?.toLowerCase().includes(tableSearch.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-5 pb-12 font-sans">
      {/* 1. Header & Tabs */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1.5 rounded-2xl w-full md:w-auto overflow-x-auto">
          <button
            onClick={() => setActiveTab('shortages')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'shortages'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-rose-700 hover:text-rose-900 bg-rose-50/60 hover:bg-rose-100/80 font-black'
            }`}
          >
            <Package className="w-4 h-4 text-rose-500" />
            <span>النواقص</span>
          </button>

          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'inventory'
                ? 'bg-white text-indigo-950 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Package className="w-4 h-4 text-indigo-600" />
            الجرد
          </button>

          <button
            onClick={() => setActiveTab('sold')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'sold'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>الأرباح</span>
          </button>

          <button
            onClick={() => setActiveTab('debts')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'debts'
                ? 'bg-white text-indigo-950 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <CreditCard className="w-4 h-4 text-rose-600" />
            الديون
          </button>

          <button
            onClick={() => setActiveTab('financial')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'financial'
                ? 'bg-white text-indigo-950 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <PieChart className="w-4 h-4 text-purple-600" />
            المبيعات
          </button>

          <button
            onClick={() => setActiveTab('net_profit')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'net_profit'
                ? 'bg-white text-indigo-950 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <DollarSign className="w-4 h-4 text-emerald-600" />
            صافي الأرباح
          </button>

          <button
            onClick={() => setActiveTab('dead_stock')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'dead_stock'
                ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>الراكد</span>
          </button>

          <button
            onClick={() => setActiveTab('forecast')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'forecast'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md'
                : 'text-indigo-600 hover:text-indigo-900 font-black'
            }`}
          >
            <Brain className="w-4 h-4 text-amber-300 animate-pulse" />
            التنبؤ الذكي
          </button>
        </div>

        {/* Action Tools: Print */}
        <div className="flex items-center gap-2 self-end md:self-auto">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            طباعة
          </button>
          <button
            onClick={fetchReports}
            className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Periodic Filters (For Sold, Debts, and Financial tabs) */}
      {activeTab !== 'inventory' && activeTab !== 'shortages' && activeTab !== 'dead_stock' && activeTab !== 'forecast' && (
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
          {/* Quick Presets */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-400 ml-1">الفترة:</span>
            {[
              { id: 'today', label: 'اليوم' },
              { id: 'week', label: 'آخر 7 أيام' },
              { id: 'month', label: 'هذا الشهر' },
              { id: 'year', label: 'هذه السنة' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => handleSetPreset(p.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  periodPreset === p.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date Picker Range */}
          <div className="flex items-center gap-2 text-xs font-bold">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>من:</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPeriodPreset('custom');
              }}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
            />
            <span>إلى:</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPeriodPreset('custom');
              }}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
            />
          </div>
        </div>
      )}

      {/* 3. Tab Contents */}

      {/* TAB 0: قائمة النواقص المسندة للمذاخر (Shortages & Supplier Reorder List) */}
      {activeTab === 'shortages' && (
        <div className="flex flex-col gap-5">
          {/* Top Filter & Action Bar */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
            {/* Severity Quick Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                الحالة:
              </span>
              <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-2xl">
                {[
                  { id: 'ALL', label: `الكل (${shortagesReport?.summary?.totalShortagesCount || 0})`, color: 'bg-slate-900 text-white' },
                  { id: 'OUT_OF_STOCK', label: `نافد (${shortagesReport?.summary?.outOfStockCount || 0})`, color: 'bg-rose-600 text-white' },
                  { id: 'AT_MINIMUM', label: `بالحد (${shortagesReport?.summary?.atMinCount || 0})`, color: 'bg-amber-600 text-white' },
                  { id: 'NEAR_MINIMUM', label: `وشيك (${shortagesReport?.summary?.nearMinCount || 0})`, color: 'bg-yellow-500 text-white' },
                ].map((sev) => (
                  <button
                    key={sev.id}
                    onClick={() => setShortageSeverityFilter(sev.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      shortageSeverityFilter === sev.id
                        ? `${sev.color} shadow-md scale-102`
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    {sev.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Supplier Picker & Search & Export */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Supplier Dropdown */}
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                <Users className="w-4 h-4 text-slate-500 shrink-0" />
                <select
                  value={shortageSupplierFilter}
                  onChange={(e) => setShortageSupplierFilter(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-800 focus:outline-hidden cursor-pointer"
                >
                  <option value="ALL">كل المذاخر</option>
                  {(shortagesReport?.suppliers || []).map((s: any) => (
                    <option key={s.supplierId || 'UNASSIGNED'} value={s.supplierId || 'UNASSIGNED'}>
                      {s.supplierName} ({s.totalItemsCount})
                    </option>
                  ))}
                </select>
              </div>

              {/* Table search */}
              <div className="relative w-48 sm:w-56">
                <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="بحث..."
                  className="w-full pr-9 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold placeholder:text-slate-400 focus:outline-hidden focus:bg-white"
                />
              </div>

              {/* Export Button */}
              <button
                onClick={() => {
                  if (!shortagesReport?.allItems || shortagesReport.allItems.length === 0) return;
                  const rows = shortagesReport.allItems.map((it: any, idx: number) => [
                    idx + 1,
                    it.tradeName,
                    it.scientificName || '',
                    it.barcode || '',
                    it.shelfLocation || '',
                    it.availablePacks,
                    it.availableStrips,
                    it.minAlertPacks,
                    it.severityLabelAr,
                    it.purchasePricePack,
                    it.suggestedOrderPacks,
                    it.supplierName,
                    it.supplierPhone || '',
                  ]);
                  exportToCSV(
                    'قائمة_النواقص',
                    rows,
                    ['#', 'الدواء', 'الاسم العلمي', 'الباركود', 'الرف', 'علب', 'أشرطة', 'الحد الأدنى', 'الحالة', 'الشراء', 'المقترح', 'المذخر', 'الهاتف'],
                  );
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                تصدير Excel
              </button>
            </div>
          </div>

          {/* 4 Summary Risk KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* 1. Out of stock */}
            <div className="bg-rose-50/90 p-4.5 rounded-3xl border border-rose-200 shadow-xs">
              <div className="flex items-center justify-between text-rose-900 text-xs font-black">
                <span>نافد</span>
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              </div>
              <div className="text-2xl font-black text-rose-950 mt-1.5 font-mono">
                {shortagesReport?.summary?.outOfStockCount || 0}{' '}
                <span className="text-xs font-sans">صنف</span>
              </div>
            </div>

            {/* 2. At Minimum */}
            <div className="bg-amber-50/90 p-4.5 rounded-3xl border border-amber-200 shadow-xs">
              <div className="flex items-center justify-between text-amber-900 text-xs font-black">
                <span>بالحد</span>
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-black text-amber-950 mt-1.5 font-mono">
                {shortagesReport?.summary?.atMinCount || 0}{' '}
                <span className="text-xs font-sans">صنف</span>
              </div>
            </div>

            {/* 3. Near Minimum */}
            <div className="bg-yellow-50/90 p-4.5 rounded-3xl border border-yellow-200 shadow-xs">
              <div className="flex items-center justify-between text-yellow-900 text-xs font-black">
                <span>وشيك</span>
                <ShieldAlert className="w-4 h-4 text-yellow-600" />
              </div>
              <div className="text-2xl font-black text-yellow-950 mt-1.5 font-mono">
                {shortagesReport?.summary?.nearMinCount || 0}{' '}
                <span className="text-xs font-sans">صنف</span>
              </div>
            </div>

            {/* 4. Suppliers Count */}
            <div className="bg-slate-900 text-white p-4.5 rounded-3xl border border-slate-800 shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-300 text-xs font-black">
                <span>المذاخر</span>
                <Users className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-black text-white mt-1.5 font-mono">
                {shortagesReport?.summary?.suppliersCount || 0}{' '}
                <span className="text-xs font-sans text-slate-400">مذخر</span>
              </div>
            </div>
          </div>

          {/* Supplier Groups / Cards */}
          <div className="space-y-6">
            {!shortagesReport?.suppliers || shortagesReport.suppliers.length === 0 ? (
              <div className="p-12 bg-white rounded-3xl border border-slate-200 text-center space-y-2">
                <Check className="w-12 h-12 text-emerald-500 mx-auto" />
                <h4 className="text-base font-black text-slate-900">ممتاز جداً! لا توجد نواقص مطابقة</h4>
                <p className="text-xs text-slate-500 font-bold">
                  جميع الأدوية في الصيدلية متوفرة بأرصدة كافية وأعلى من الحد الأدنى.
                </p>
              </div>
            ) : (
              shortagesReport.suppliers.map((supplierGroup: any) => {
                const groupKey = supplierGroup.supplierId || 'UNASSIGNED';
                const isCopied = copiedSupplierId === groupKey;

                // Filter items by tableSearch
                const displayItems = (supplierGroup.items || []).filter((it: any) => {
                  if (!tableSearch) return true;
                  const q = tableSearch.toLowerCase();
                  return (
                    it.tradeName?.toLowerCase().includes(q) ||
                    it.scientificName?.toLowerCase().includes(q) ||
                    it.barcode?.includes(q) ||
                    it.shelfLocation?.toLowerCase().includes(q)
                  );
                });

                if (displayItems.length === 0 && tableSearch) return null;

                return (
                  <div key={groupKey} className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                    {/* Supplier Header */}
                    <div className="p-4 bg-slate-50/90 border-b border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-indigo-100 text-indigo-700 rounded-2xl flex items-center justify-center font-black shrink-0">
                          <Users className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-black text-slate-900 text-base">
                              {supplierGroup.supplierName}
                            </h3>
                            {supplierGroup.supplierPhone && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-200/70 text-slate-700 rounded-lg text-xs font-mono font-bold">
                                <Phone className="w-3 h-3 text-slate-500" />
                                {supplierGroup.supplierPhone}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs font-bold flex-wrap">
                            <span className="text-slate-500">
                              عدد المواد الناقصة: <b className="text-slate-900 font-mono">{supplierGroup.totalItemsCount}</b>
                            </span>
                            <span>•</span>
                            <span className="text-rose-600 font-mono">
                              🔴 {supplierGroup.outOfStockCount} نافد
                            </span>
                            <span>•</span>
                            <span className="text-amber-600 font-mono">
                              🟠 {supplierGroup.atMinCount} بالحد
                            </span>
                            <span>•</span>
                            <span className="text-yellow-600 font-mono">
                              🟡 {supplierGroup.nearMinCount} وشيك
                            </span>
                            <span>•</span>
                            <span className="text-slate-600">
                              التكلفة التقديرية: <b className="text-emerald-700 font-mono">{Number(supplierGroup.estimatedTotalCost).toLocaleString()} د.ع</b>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons for this Supplier */}
                      <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                        <button
                          onClick={() => copySupplierOrder(supplierGroup, groupKey)}
                          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs ${
                            isCopied
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                          title="نسخ الطلبية"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isCopied ? 'تم النسخ!' : 'نسخ'}</span>
                        </button>

                        <button
                          onClick={() => openWhatsApp(supplierGroup)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-md shadow-emerald-600/30 active:scale-95"
                          title="إرسال واتساب"
                        >
                          <MessageSquare className="w-4 h-4" />
                          <span>واتساب 📲</span>
                        </button>
                      </div>
                    </div>

                    {/* Table of Shortage Items */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-100/75 text-slate-700 font-bold border-b border-slate-200">
                          <tr>
                            <th className="p-3 w-10 text-center">#</th>
                            <th className="p-3">الدواء</th>
                            <th className="p-3 text-center">الرف</th>
                            <th className="p-3 text-center">الرصيد</th>
                            <th className="p-3 text-center">الحد الأدنى</th>
                            <th className="p-3 text-center">الحالة</th>
                            <th className="p-3 text-center">سعر الشراء</th>
                            <th className="p-3 text-center bg-indigo-50/50 text-indigo-950 font-black">المقترح</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                          {displayItems.map((it: any, idx: number) => {
                            const isOut = it.severity === 'OUT_OF_STOCK';
                            const isAtMin = it.severity === 'AT_MINIMUM';

                            return (
                              <tr key={it.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                                <td className="p-3">
                                  <div className="font-bold text-slate-900">{it.tradeName}</div>
                                  <div className="text-[10px] text-slate-400 font-mono">
                                    {it.scientificName} {it.dosageForm && `• ${it.dosageForm}`} {it.strength && `• ${it.strength}`}
                                  </div>
                                </td>
                                <td className="p-3 text-center">
                                  {it.shelfLocation ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-300 rounded-md text-[10px] font-black font-mono shadow-2xs">
                                      <MapPin className="w-3 h-3 text-amber-600" />
                                      {it.shelfLocation}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-300 font-sans">غير محدد</span>
                                  )}
                                </td>
                                <td className="p-3 text-center font-bold">
                                  <span className={isOut ? 'text-rose-600 font-black' : isAtMin ? 'text-amber-800 font-black' : 'text-slate-800 font-black'}>
                                    {it.availablePacks} علبة
                                  </span>
                                  {it.availableStrips > 0 && (
                                    <span className="text-[10px] text-blue-700 font-bold mr-1">+ {it.availableStrips} شريط</span>
                                  )}
                                </td>
                                <td className="p-3 text-center font-mono text-slate-700">
                                  <span className="px-2 py-0.5 bg-slate-100 rounded-md text-xs font-bold">
                                    {it.minAlertPacks} علبة ({it.minAlertUnits} شريط)
                                  </span>
                                </td>
                                <td className="p-3 text-center">
                                  {isOut ? (
                                    <span className="px-2.5 py-1 bg-rose-100 text-rose-800 border border-rose-200 rounded-full text-[10px] font-black inline-block">
                                      نافد (0)
                                    </span>
                                  ) : isAtMin ? (
                                    <span className="px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-200 rounded-full text-[10px] font-black inline-block">
                                      بالحد
                                    </span>
                                  ) : (
                                    <span className="px-2.5 py-1 bg-yellow-100 text-yellow-900 border border-yellow-200 rounded-full text-[10px] font-black inline-block">
                                      وشيك
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-center font-mono text-slate-700">
                                  {Number(it.purchasePricePack).toLocaleString()} د.ع
                                </td>
                                <td className="p-3 text-center bg-indigo-50/50">
                                  <span className="px-3 py-1 bg-indigo-600 text-white rounded-xl text-xs font-black font-mono shadow-xs inline-block">
                                    📦 {it.suggestedOrderPacks} علبة
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 1: جرد المخزون الحالي */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Inventory KPI Summary */}
          {inventoryValuation && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div className="text-xs text-slate-400 font-bold">المواد</div>
                <div className="text-2xl font-black text-slate-900 mt-1">
                  {inventoryValuation.totalDistinctItems} مادة
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div className="text-xs text-slate-400 font-bold">كلفة المخزن</div>
                <div className="text-xl font-black text-amber-900 mt-1">
                  {Number(inventoryValuation.totalCostValue).toLocaleString()} د.ع
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div className="text-xs text-slate-400 font-bold">قيمة البيع</div>
                <div className="text-xl font-black text-blue-900 mt-1">
                  {Number(inventoryValuation.totalRetailValue).toLocaleString()} د.ع
                </div>
              </div>

              <div className="bg-emerald-50/80 p-4 rounded-2xl border border-emerald-200 shadow-xs">
                <div className="text-xs text-emerald-800 font-bold">الربح المتوقع</div>
                <div className="text-2xl font-black text-emerald-900 mt-1">
                  {Number(inventoryValuation.expectedProfit).toLocaleString()} د.ع
                </div>
              </div>
            </div>
          )}

          {/* Search & Export Toolbar */}
          <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="بحث..."
                className="w-full pr-9 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold placeholder:text-slate-400 focus:outline-hidden focus:bg-white"
              />
            </div>

            <button
              onClick={() =>
                exportToCSV(
                  'جرد_المخزون',
                  filteredCurrentStock.map((i, idx) => [
                    idx + 1,
                    i.tradeName,
                    i.scientificName,
                    i.fullPacksRemaining,
                    i.looseUnitsRemaining,
                    i.totalUnitsRemaining,
                    Number(i.avgCostPack).toFixed(0),
                    Number(i.sellingPricePack),
                    Number(i.totalCostValue).toFixed(0),
                    Number(i.totalRetailValue).toFixed(0),
                  ]),
                  ['#', 'الدواء', 'الاسم العلمي', 'العلب', 'الأشرطة المتبقية', 'إجمالي القطع', 'شراء', 'بيع', 'كلفة', 'بيع'],
                )
              }
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              تصدير Excel
            </button>
          </div>

          {/* Stocktake Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-10 text-center">#</th>
                    <th className="p-3">الدواء</th>
                    <th className="p-3">الاسم العلمي</th>
                    <th className="p-3 text-center">العلب</th>
                    <th className="p-3 text-center">الأشرطة</th>
                    <th className="p-3 text-center">شراء العلبة</th>
                    <th className="p-3 text-center">بيع العلبة</th>
                    <th className="p-3">الكلفة</th>
                    <th className="p-3">البيع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredCurrentStock.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد مواد مطابقة للبحث
                      </td>
                    </tr>
                  ) : (
                    filteredCurrentStock.map((item, idx) => (
                      <tr key={item.inventoryItemId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                        <td className="p-3">
                          <div className="font-bold text-slate-900">{item.tradeName}</div>
                          {item.customName && (
                            <div className="text-[10px] text-amber-700 font-bold">({item.customName})</div>
                          )}
                        </td>
                        <td className="p-3 text-slate-500">{item.scientificName}</td>
                        <td className="p-3 text-center font-bold text-slate-900">{item.fullPacksRemaining}</td>
                        <td className="p-3 text-center font-bold text-blue-700">
                          {item.looseUnitsRemaining} / {item.unitsPerPack}
                        </td>
                        <td className="p-3 text-center text-slate-600">
                          {Number(item.avgCostPack).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 text-center font-bold text-emerald-700">
                          {Number(item.sellingPricePack).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 text-amber-950 font-bold">
                          {Number(item.totalCostValue).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 text-emerald-900 font-black">
                          {Number(item.totalRetailValue).toLocaleString()} د.ع
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

      {/* TAB 2: تحليل ربحية كل منتج ومقارنة حجم المبيعات بالأرباح الحقيقية */}
      {activeTab === 'sold' && (
        <div className="space-y-5">
          {/* Top 4 Profitability Analytics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Card 1: Total Profit */}
            <div className="bg-emerald-50/80 p-5 rounded-3xl border border-emerald-200 shadow-xs">
              <div className="flex items-center justify-between text-emerald-800 text-xs font-black">
                <span>الأرباح</span>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-emerald-950 mt-2 font-mono">
                {Number(profitabilityReport?.summary?.totalProfit || 0).toLocaleString()} د.ع
              </div>
              <div className="text-[11px] text-emerald-700 font-bold mt-1">
                {Number(profitabilityReport?.summary?.totalSoldPacks || 0).toLocaleString()} علبة مباعة
              </div>
            </div>

            {/* Card 2: Total Revenue & Cost */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>المبيعات</span>
                <DollarSign className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-slate-900 mt-2 font-mono">
                {Number(profitabilityReport?.summary?.totalRevenue || 0).toLocaleString()} د.ع
              </div>
              <div className="text-[11px] text-slate-500 font-bold mt-1">
                الكلفة: {Number(profitabilityReport?.summary?.totalCost || 0).toLocaleString()} د.ع
              </div>
            </div>

            {/* Card 3: Average Profit Margin */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>هامش الربح</span>
                <PieChart className="w-4 h-4 text-purple-600" />
              </div>
              <div className="text-2xl font-black text-purple-950 mt-2 font-mono">
                {profitabilityReport?.summary?.averageProfitMargin || 0}%
              </div>
              <div className="text-[11px] text-slate-500 font-bold mt-1">
                {profitabilityReport?.summary?.distinctMedicinesCount || 0} دواء
              </div>
            </div>

            {/* Card 4: Top Profit vs Top Volume Insight */}
            <div className="bg-linear-to-br from-indigo-900 to-slate-900 text-white p-4.5 rounded-3xl border border-indigo-800 shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between text-[11px] font-black text-indigo-200">
                <span className="flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-amber-400" />
                  الأفضل
                </span>
                <span className="text-[10px] bg-amber-400/20 text-amber-300 px-1.5 py-0.5 rounded-md font-bold">
                  AI
                </span>
              </div>
              <div className="space-y-1.5 mt-2 text-xs">
                {profitabilityReport?.summary?.topProfitMedicine && (
                  <div className="flex items-center justify-between bg-white/10 px-2.5 py-1 rounded-xl">
                    <span className="text-indigo-200 font-bold">الأعلى ربحاً:</span>
                    <span className="font-black text-amber-300 truncate max-w-[130px]" title={profitabilityReport.summary.topProfitMedicine.tradeName}>
                      {profitabilityReport.summary.topProfitMedicine.tradeName} ({Number(profitabilityReport.summary.topProfitMedicine.totalProfit).toLocaleString()} د.ع)
                    </span>
                  </div>
                )}
                {profitabilityReport?.summary?.topVolumeMedicine && (
                  <div className="flex items-center justify-between bg-white/10 px-2.5 py-1 rounded-xl">
                    <span className="text-indigo-200 font-bold">الأكثر مبيعاً:</span>
                    <span className="font-black text-emerald-300 truncate max-w-[130px]" title={profitabilityReport.summary.topVolumeMedicine.tradeName}>
                      {profitabilityReport.summary.topVolumeMedicine.tradeName} ({profitabilityReport.summary.topVolumeMedicine.soldPacks} علبة)
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Search, Sort & Export Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-3xl border border-slate-200 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-64">
                <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="بحث..."
                  className="w-full pr-9 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold placeholder:text-slate-400 focus:outline-hidden focus:bg-white"
                />
              </div>

              {/* Sorting Chips */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl">
                <span className="text-[11px] font-bold text-slate-500 px-2">الترتيب:</span>
                <button
                  onClick={() => setProfitSortBy('PROFIT')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    profitSortBy === 'PROFIT'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  الأعلى ربحاً
                </button>
                <button
                  onClick={() => setProfitSortBy('VOLUME')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    profitSortBy === 'VOLUME'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  الأكثر مبيعاً
                </button>
                <button
                  onClick={() => setProfitSortBy('MARGIN')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    profitSortBy === 'MARGIN'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  أعلى هامش %
                </button>
                <button
                  onClick={() => setProfitSortBy('LOW_MARGIN')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    profitSortBy === 'LOW_MARGIN'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  أقل هامش %
                </button>
              </div>
            </div>

            <button
              onClick={() =>
                exportToCSV(
                  `الأرباح_${from}_الى_${to}`,
                  filteredSoldStock.map((i, idx) => [
                    idx + 1,
                    i.tradeName,
                    i.scientificName || '',
                    i.barcode || '',
                    i.soldPacks,
                    i.soldStrips,
                    i.invoicesCount,
                    Number(i.totalCost),
                    Number(i.totalRevenue),
                    Number(i.totalProfit),
                    `${i.profitMarginPercent}%`,
                    Number(i.profitPerPack),
                    `${i.profitContributionPercent}%`,
                  ]),
                  ['#', 'الدواء', 'الاسم العلمي', 'الباركود', 'علب', 'أشرطة', 'فواتير', 'كلفة', 'مبيعات', 'ربح', 'هامش %', 'ربح العلبة', 'مساهمة %'],
                )
              }
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              تصدير Excel
            </button>
          </div>

          {/* Product Profitability Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-10 text-center">#</th>
                    <th className="p-3">الدواء</th>
                    <th className="p-3">الاسم العلمي</th>
                    <th className="p-3 text-center">الكمية</th>
                    <th className="p-3 text-center">الفواتير</th>
                    <th className="p-3">الكلفة</th>
                    <th className="p-3">المبيعات</th>
                    <th className="p-3 bg-emerald-50/50 text-emerald-950 font-black">الربح</th>
                    <th className="p-3 text-center">الهامش %</th>
                    <th className="p-3 text-center">ربح العلبة</th>
                    <th className="p-3 text-center">المساهمة %</th>
                    <th className="p-3 text-center">التقييم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredSoldStock.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد مبيعات في هذه الفترة
                      </td>
                    </tr>
                  ) : (
                    filteredSoldStock.map((item, idx) => (
                      <tr key={item.medicineId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                        <td className="p-3">
                          <div className="font-bold text-slate-900">{item.tradeName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{item.dosageForm} {item.barcode && `• ${item.barcode}`}</div>
                        </td>
                        <td className="p-3 text-slate-500">{item.scientificName}</td>
                        <td className="p-3 text-center">
                          <span className="font-black text-slate-900">{item.soldPacks} علبة</span>
                          {item.soldStrips > 0 && (
                            <span className="text-[11px] text-blue-700 font-bold mr-1">+ {item.soldStrips} شريط</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-bold text-slate-600">{item.invoicesCount}</td>
                        <td className="p-3 text-amber-950 font-mono font-bold">
                          {Number(item.totalCost).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 text-slate-900 font-mono font-black">
                          {Number(item.totalRevenue).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 bg-emerald-50/50 font-mono font-black text-emerald-800 text-sm">
                          {Number(item.totalProfit).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-mono font-black text-xs ${
                              item.profitMarginPercent >= 35 ? 'text-emerald-700' : item.profitMarginPercent >= 20 ? 'text-blue-700' : 'text-amber-700'
                            }`}>
                              {item.profitMarginPercent}%
                            </span>
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  item.profitMarginPercent >= 35 ? 'bg-emerald-500' : item.profitMarginPercent >= 20 ? 'bg-blue-500' : 'bg-amber-500'
                                }`}
                                style={{ width: `${Math.min(100, item.profitMarginPercent)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-700">
                          {Number(item.profitPerPack).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-indigo-700">
                          {item.profitContributionPercent}%
                        </td>
                        <td className="p-3 text-center">
                          {item.profitMarginPercent >= 40 && item.soldPacks >= 10 ? (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-black flex items-center justify-center gap-1 w-fit mx-auto">
                              ذهبي 🌟
                            </span>
                          ) : item.profitMarginPercent >= 40 ? (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full text-[10px] font-black flex items-center justify-center gap-1 w-fit mx-auto">
                              عالي الهامش 💎
                            </span>
                          ) : item.soldPacks >= 20 ? (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-black flex items-center justify-center gap-1 w-fit mx-auto">
                              كميات 📦
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold">
                              عادي
                            </span>
                          )}
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

      {/* TAB 3: كشف الديون وحسابات المشتريات */}
      {activeTab === 'debts' && (
        <div className="space-y-4">
          {debtsReport && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div className="text-xs text-slate-400 font-bold">المشتريات</div>
                <div className="text-2xl font-black text-slate-900 mt-1">
                  {Number(debtsReport.summary.totalPurchases).toLocaleString()} د.ع
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div className="text-xs text-slate-400 font-bold">الواصل</div>
                <div className="text-2xl font-black text-emerald-800 mt-1">
                  {Number(debtsReport.summary.totalPaid).toLocaleString()} د.ع
                </div>
              </div>

              <div className="bg-rose-50/80 p-4 rounded-2xl border border-rose-200 shadow-xs">
                <div className="text-xs text-rose-800 font-bold">الديون</div>
                <div className="text-2xl font-black text-rose-900 mt-1">
                  {Number(debtsReport.summary.totalRemainingDebt).toLocaleString()} د.ع
                </div>
              </div>
            </div>
          )}

          {/* Suppliers Debt Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-indigo-600" />
                ديون المذاخر
              </h3>

              {debtsReport?.suppliers && (
                <button
                  onClick={() =>
                    exportToCSV(
                      `ديون_المذاخر_${from}_الى_${to}`,
                      debtsReport.suppliers.map((s: any, idx: number) => [
                        idx + 1,
                        s.supplierName,
                        s.phone || 'غير مسجل',
                        s.invoicesCount,
                        Number(s.totalPurchases),
                        Number(s.totalPaid),
                        Number(s.remainingDebt),
                      ]),
                      ['#', 'المذخر', 'الهاتف', 'الفواتير', 'المشتريات', 'الواصل', 'الباقي'],
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  تصدير Excel
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-10 text-center">#</th>
                    <th className="p-3">المذخر</th>
                    <th className="p-3">الهاتف</th>
                    <th className="p-3 text-center">الفواتير</th>
                    <th className="p-3">المشتريات</th>
                    <th className="p-3">الواصل</th>
                    <th className="p-3">الباقي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {(!debtsReport?.suppliers || debtsReport.suppliers.length === 0) ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد فواتير أو ديون للمذاخر في هذه الفترة
                      </td>
                    </tr>
                  ) : (
                    debtsReport.suppliers.map((sup: any, idx: number) => (
                      <tr key={sup.supplierId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                        <td className="p-3 font-bold text-slate-900 text-sm">{sup.supplierName}</td>
                        <td className="p-3 text-slate-500 font-mono">{sup.phone || '—'}</td>
                        <td className="p-3 text-center font-bold text-slate-700">{sup.invoicesCount}</td>
                        <td className="p-3 text-slate-900 font-bold">
                          {Number(sup.totalPurchases).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 text-emerald-700 font-bold">
                          {Number(sup.totalPaid).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 text-rose-700 font-black">
                          {Number(sup.remainingDebt).toLocaleString()} د.ع
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

      {/* TAB 4: كشف الأرباح والتقرير المالي */}
      {activeTab === 'financial' && financialData && (
        <div className="space-y-5">
          {/* Top 4 Financial KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>المبيعات</span>
                <DollarSign className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-slate-900 mt-2">
                {Number(financialData.sales.netRevenue).toLocaleString()} د.ع
              </div>
              <div className="text-[11px] text-slate-400 mt-1 font-bold">
                {financialData.sales.totalInvoices} فاتورة
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>الكلفة</span>
                <ShoppingBag className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-black text-amber-900 mt-2">
                {Number(financialData.profitability.costOfGoodsSold).toLocaleString()} د.ع
              </div>
              <div className="text-[11px] text-slate-400 mt-1 font-bold">
                المرتجع: {Number(financialData.returns.totalRefunds).toLocaleString()} د.ع
              </div>
            </div>

            <div className="bg-emerald-50/70 p-5 rounded-2xl border border-emerald-200 shadow-xs">
              <div className="flex items-center justify-between text-emerald-800 text-xs font-bold">
                <span>الربح</span>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-3xl font-black text-emerald-900 mt-2">
                {Number(financialData.profitability.grossProfit).toLocaleString()} د.ع
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>الهامش %</span>
                <PieChart className="w-4 h-4 text-purple-600" />
              </div>
              <div className="text-3xl font-black text-purple-900 mt-2">
                {financialData.profitability.profitMarginPercent}%
              </div>
            </div>
          </div>

          {/* Top 10 Best Selling Medicines */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-slate-600" />
                الأكثر مبيعاً
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100/75 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-12 text-center">#</th>
                    <th className="p-3">الدواء</th>
                    <th className="p-3">الاسم العلمي</th>
                    <th className="p-3 text-center">العلب</th>
                    <th className="p-3 text-center">الأشرطة</th>
                    <th className="p-3 text-center">الفواتير</th>
                    <th className="p-3">المبيعات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topMedicines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد مبيعات في هذه الفترة
                      </td>
                    </tr>
                  ) : (
                    topMedicines.map((item, idx) => (
                      <tr key={item.medicineId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 text-center font-bold text-slate-400">{idx + 1}</td>
                        <td className="p-3">
                          <div className="font-bold text-slate-900 text-sm">{item.tradeName}</div>
                          <div className="text-[10px] text-slate-500">{item.dosageForm || ''}</div>
                        </td>
                        <td className="p-3 text-slate-600 font-medium">{item.scientificName}</td>
                        <td className="p-3 text-center font-black text-slate-800">{item.soldPacks}</td>
                        <td className="p-3 text-center font-black text-blue-700">{item.soldStrips}</td>
                        <td className="p-3 text-center text-slate-600 font-bold">{item.invoicesCount}</td>
                        <td className="p-3 font-black text-emerald-800 text-sm">
                          {Number(item.totalRevenue).toLocaleString()} د.ع
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

      {/* 5. Net Profit (P&L) Tab View */}
      {activeTab === 'net_profit' && netProfitReport && (
        <div className="flex flex-col gap-5">
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>المبيعات</span>
                <DollarSign className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-xl font-black text-slate-900 mt-2 font-mono">
                {Number(netProfitReport.revenue.netSales).toLocaleString()} د.ع
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>الكلفة</span>
                <ShoppingBag className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-xl font-black text-amber-900 mt-2 font-mono">
                {Number(netProfitReport.cogs).toLocaleString()} د.ع
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>مجمل الربح</span>
                <TrendingUp className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-xl font-black text-indigo-900 mt-2 font-mono">
                {Number(netProfitReport.grossProfit).toLocaleString()} د.ع
              </div>
            </div>

            <div className="bg-rose-50/60 p-4 rounded-2xl border border-rose-200 shadow-xs">
              <div className="flex items-center justify-between text-rose-800 text-xs font-bold">
                <span>المصاريف</span>
                <TrendingDown className="w-4 h-4 text-rose-600" />
              </div>
              <div className="text-xl font-black text-rose-700 mt-2 font-mono">
                {Number(netProfitReport.expenses.total).toLocaleString()} د.ع
              </div>
            </div>

            <div className="bg-emerald-600 text-white p-4 rounded-2xl shadow-md">
              <div className="flex items-center justify-between text-emerald-100 text-xs font-bold">
                <span>صافي الربح</span>
                <DollarSign className="w-4 h-4 text-emerald-200" />
              </div>
              <div className="text-2xl font-black mt-2 font-mono">
                {Number(netProfitReport.netProfit).toLocaleString()} د.ع
              </div>
              <div className="text-[11px] text-emerald-100 mt-1 font-bold">
                الهامش: {netProfitReport.netProfitMarginPercent}%
              </div>
            </div>
          </div>

          {/* Expenses Breakdown by Category */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-600" />
                المصاريف حسب الفئة
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100/75 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">الفئة</th>
                    <th className="p-3">المبلغ</th>
                    <th className="p-3 text-center">النسبة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {Object.keys(netProfitReport.expenses.byCategory || {}).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد مصاريف مسجلة
                      </td>
                    </tr>
                  ) : (
                    Object.entries(netProfitReport.expenses.byCategory).map(([cat, amt]: any) => {
                      const pct =
                        netProfitReport.expenses.total > 0
                          ? ((Number(amt) / netProfitReport.expenses.total) * 100).toFixed(1)
                          : '0';
                      return (
                        <tr key={cat} className="hover:bg-slate-50">
                          <td className="p-3 font-bold text-slate-900">{cat}</td>
                          <td className="p-3 font-mono font-black text-rose-600 text-sm">
                            {Number(amt).toLocaleString()} د.ع
                          </td>
                          <td className="p-3 text-center font-mono font-bold text-slate-600">{pct}%</td>
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

      {/* 6. Dead Stock (Stagnant Inventory & Frozen Capital Discovery) Tab View */}
      {activeTab === 'dead_stock' && (
        <div className="flex flex-col gap-5">
          {/* Top Threshold & Action Bar */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-600" />
                المدة:
              </span>
              <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-2xl">
                {[
                  { days: 30, label: '30 يوم' },
                  { days: 60, label: '60 يوم' },
                  { days: 90, label: '90 يوم' },
                  { days: 120, label: '120 يوم' },
                  { days: 180, label: '180 يوم' },
                  { days: 9999, label: 'لم يُبع' },
                ].map((d) => (
                  <button
                    key={d.days}
                    onClick={() => setDeadStockDays(d.days)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      deadStockDays === d.days
                        ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30 scale-102'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-60">
                <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="بحث..."
                  className="w-full pr-9 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold placeholder:text-slate-400 focus:outline-hidden focus:bg-white"
                />
              </div>

              <button
                onClick={() => {
                  if (!filteredDeadStock || filteredDeadStock.length === 0) return;
                  const rows = filteredDeadStock.map((it: any, idx: number) => [
                    idx + 1,
                    it.tradeName,
                    it.scientificName || '',
                    it.barcode || '',
                    it.packsRemaining,
                    it.stripsRemaining,
                    Number(it.avgCostPack),
                    Number(it.stagnantCapital),
                    it.lastSoldAt ? new Date(it.lastSoldAt).toLocaleDateString('ar-IQ') : 'لم يُباع',
                    it.daysSinceLastSale !== null ? `${it.daysSinceLastSale} يوم` : '—',
                    it.expiryFormatted || '—',
                    it.daysUntilExpiry !== null ? `${it.daysUntilExpiry} يوم` : '—',
                    it.supplierName || 'غير محدد',
                    it.supplierPhone || '—',
                  ]);
                  exportToCSV(
                    `الراكد_${deadStockDays}يوم`,
                    rows,
                    ['#', 'الدواء', 'الاسم العلمي', 'الباركود', 'العلب', 'الأشرطة', 'الشراء', 'المجمد', 'آخر بيع', 'الركود', 'الصلاحية', 'المتبقي', 'المذخر', 'الهاتف'],
                  );
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                تصدير Excel
              </button>
            </div>
          </div>

          {/* 4 Summary Risk KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Total Frozen Capital */}
            <div className="bg-rose-50/80 p-5 rounded-3xl border border-rose-200 shadow-xs">
              <div className="flex items-center justify-between text-rose-900 text-xs font-black">
                <span>رأس المال الراكد</span>
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              </div>
              <div className="text-2xl font-black text-rose-950 mt-2 font-mono">
                {Number(deadStockReport?.summary?.totalStagnantCapital || 0).toLocaleString()} د.ع
              </div>
            </div>

            {/* 2. Total Stagnant Items & Packs */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
                <span>المواد الراكدة</span>
                <Package className="w-4 h-4 text-slate-400" />
              </div>
              <div className="text-2xl font-black text-slate-900 mt-2 font-mono">
                {deadStockReport?.summary?.totalStagnantItemsCount || 0} صنف
              </div>
              <div className="text-[11px] text-slate-500 font-bold mt-1">
                {Number(deadStockReport?.summary?.totalPacksCount || 0).toLocaleString()} علبة
              </div>
            </div>

            {/* 3. Stagnant Stock with Expiry Risk */}
            <div className="bg-amber-50/80 p-5 rounded-3xl border border-amber-200 shadow-xs">
              <div className="flex items-center justify-between text-amber-900 text-xs font-black">
                <span>راكد قارب الانتهاء</span>
                <ShieldAlert className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-black text-amber-950 mt-2 font-mono">
                {Number(deadStockReport?.summary?.stagnantCapitalNearExpiry || 0).toLocaleString()} د.ع
              </div>
            </div>

            {/* 4. Top Stagnant Supplier */}
            <div className="bg-slate-900 text-white p-4.5 rounded-3xl border border-slate-800 shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between text-[11px] font-black text-slate-300">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  أعلى مذخر راكد
                </span>
              </div>
              <div className="mt-2 text-xs">
                {deadStockReport?.summary?.topSuppliers && deadStockReport.summary.topSuppliers.length > 0 ? (
                  <div className="space-y-1">
                    <div className="font-black text-amber-300 truncate" title={deadStockReport.summary.topSuppliers[0].name}>
                      {deadStockReport.summary.topSuppliers[0].name}
                    </div>
                    <div className="text-[11px] text-slate-300 font-mono">
                      {Number(deadStockReport.summary.topSuppliers[0].frozenCapital).toLocaleString()} د.ع
                    </div>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[11px]">لا توجد بيانات</span>
                )}
              </div>
            </div>
          </div>

          {/* Dead Stock Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-10 text-center">#</th>
                    <th className="p-3">الدواء</th>
                    <th className="p-3">الاسم العلمي</th>
                    <th className="p-3 text-center">الكمية</th>
                    <th className="p-3 text-center">سعر الشراء</th>
                    <th className="p-3 bg-rose-50/50 text-rose-950 font-black">المجمد</th>
                    <th className="p-3 text-center">آخر بيع</th>
                    <th className="p-3 text-center">الصلاحية</th>
                    <th className="p-3">المذخر</th>
                    <th className="p-3 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {filteredDeadStock.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد أدوية راكدة
                      </td>
                    </tr>
                  ) : (
                    filteredDeadStock.map((it: any, idx: number) => {
                      const isExpired = it.daysUntilExpiry !== null && it.daysUntilExpiry <= 0;
                      const isCriticallyClose = it.daysUntilExpiry !== null && it.daysUntilExpiry > 0 && it.daysUntilExpiry <= 60;
                      const isMediumRisk = it.daysUntilExpiry !== null && it.daysUntilExpiry > 60 && it.daysUntilExpiry <= 120;

                      return (
                        <tr key={it.inventoryItemId} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                          <td className="p-3">
                            <div className="font-bold text-slate-900">{it.tradeName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {it.dosageForm} {it.barcode && `• ${it.barcode}`}
                            </div>
                          </td>
                          <td className="p-3 text-slate-500">{it.scientificName || '—'}</td>
                          <td className="p-3 text-center font-bold">
                            <span className="text-slate-900 font-black">{it.packsRemaining} علبة</span>
                            {it.stripsRemaining > 0 && (
                              <span className="text-[10px] text-blue-700 font-bold mr-1">+ {it.stripsRemaining} شريط</span>
                            )}
                          </td>
                          <td className="p-3 text-center font-mono text-slate-700">
                            {Number(it.avgCostPack).toLocaleString()} د.ع
                          </td>
                          <td className="p-3 bg-rose-50/50 font-mono font-black text-rose-700 text-sm">
                            {Number(it.stagnantCapital).toLocaleString()} د.ع
                          </td>
                          <td className="p-3 text-center">
                            {it.lastSoldAt ? (
                              <div className="flex flex-col items-center">
                                <span className="font-mono text-slate-700 font-bold">
                                  {new Date(it.lastSoldAt).toLocaleDateString('ar-IQ')}
                                </span>
                                {it.daysSinceLastSale !== null && (
                                  <span className="text-[10px] text-rose-600 font-bold">
                                    منذ {it.daysSinceLastSale} يوم
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-md text-[10px] font-black">
                                لم يُبع
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="font-mono font-bold text-xs text-slate-800">
                                {it.expiryFormatted || '—'}
                              </span>
                              {isExpired ? (
                                <span className="px-2 py-0.5 bg-rose-600 text-white rounded-full text-[9px] font-black">
                                  منتهي ❌
                                </span>
                              ) : isCriticallyClose ? (
                                <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-full text-[9px] font-black">
                                  باقي {it.daysUntilExpiry} يوم
                                </span>
                              ) : isMediumRisk ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[9px] font-bold">
                                  باقي {it.daysUntilExpiry} يوم
                                </span>
                              ) : (
                                <span className="text-[10px] text-emerald-600 font-bold">
                                  آمن ({it.daysUntilExpiry} يوم)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="font-bold text-slate-800">{it.supplierName || 'غير محدد'}</div>
                            {it.supplierPhone && (
                              <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-400" />
                                {it.supplierPhone}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => setReturnBatchItem(it)}
                                className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[11px] font-bold shadow-xs cursor-pointer transition-all"
                                title="إرجاع للمذخر"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>إرجاع</span>
                              </button>
                              {it.oldestBatchNumber && (
                                <button
                                  onClick={() => setSelectedTraceBatch(it.oldestBatchNumber)}
                                  className="p-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                                  title="تتبع"
                                >
                                  تتبع
                                </button>
                              )}
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

      {/* TAB 7: SMART STOCK FORECAST & RUNOUT PREDICTION */}
      {activeTab === 'forecast' && (
        <div className="space-y-6">
          {/* AI Banner */}
          <div className="bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 rounded-3xl border border-slate-800 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-2xl flex items-center justify-center font-black shrink-0">
                <Brain className="w-7 h-7 text-amber-300 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-black flex items-center gap-2">
                  <span>التنبؤ الذكي بالنواقص</span>
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-mono font-bold">
                    AI
                  </span>
                </h3>
                <p className="text-xs text-slate-300 font-medium">
                  حساب الاستهلاك اليومي وتحديد موعد نفاد المواد والكميات المقترحة
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                const rows = (forecastReport?.items || []).map((it: any) => [
                  it.tradeName,
                  it.scientificName || '',
                  it.barcode || '',
                  it.currentStockPacks,
                  it.soldPacksLast30Days,
                  it.dailySalesVelocity,
                  it.daysLeft === 999 ? 'راكد' : it.daysLeft,
                  it.suggestedReorderPacks,
                  it.status,
                ]);
                exportToCSV(
                  'تنبؤ_النواقص',
                  rows,
                  ['الدواء', 'الاسم العلمي', 'الباركود', 'الرصيد', 'مبيعات 30 يوم', 'المعدل اليومي', 'الأيام المتبقية', 'الطلب المقترح', 'الحالة'],
                );
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md shadow-indigo-900/40 cursor-pointer transition-all shrink-0"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير Excel</span>
            </button>
          </div>

          {/* KPI Risk Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Critical: <= 3.5 days */}
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl shadow-xs">
              <div className="text-[11px] font-bold text-rose-800 flex items-center justify-between">
                <span>حرجة (خلال 3 أيام)</span>
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              </div>
              <div className="text-2xl font-black text-rose-950 mt-1 font-mono">
                {forecastReport?.summary?.criticalCount || 0}{' '}
                <span className="text-xs font-sans">دواء</span>
              </div>
              <div className="text-[10px] text-rose-600 font-bold mt-0.5">⚠️ طلبية عاجلة</div>
            </div>

            {/* Running Low: <= 10 days */}
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl shadow-xs">
              <div className="text-[11px] font-bold text-amber-800 flex items-center justify-between">
                <span>وشيكة (خلال 10 أيام)</span>
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-black text-amber-950 mt-1 font-mono">
                {forecastReport?.summary?.runningLowCount || 0}{' '}
                <span className="text-xs font-sans">دواء</span>
              </div>
              <div className="text-[10px] text-amber-700 font-bold mt-0.5">طلبية الأسبوع</div>
            </div>

            {/* Out of Stock: 0 packs */}
            <div className="bg-slate-100 border border-slate-300 p-4 rounded-2xl shadow-xs">
              <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span>نافدة تماماً</span>
                <Package className="w-4 h-4 text-slate-500" />
              </div>
              <div className="text-2xl font-black text-slate-900 mt-1 font-mono">
                {forecastReport?.summary?.outOfStockCount || 0}{' '}
                <span className="text-xs font-sans">دواء</span>
              </div>
              <div className="text-[10px] text-slate-500 font-bold mt-0.5">الرصيد صفر</div>
            </div>

            {/* Total Monitored */}
            <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-2xl shadow-xs">
              <div className="text-[11px] font-bold text-indigo-800 flex items-center justify-between">
                <span>المواد المراقبة</span>
                <Zap className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-indigo-950 mt-1 font-mono">
                {forecastReport?.summary?.totalTrackedMedicines || 0}{' '}
                <span className="text-xs font-sans">دواء</span>
              </div>
              <div className="text-[10px] text-indigo-600 font-bold mt-0.5">حركة نشطة</div>
            </div>
          </div>

          {/* Search Filter */}
          <div className="flex items-center gap-2 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="بحث بالاسم أو الباركود..."
              className="w-full bg-transparent text-xs font-bold text-slate-900 focus:outline-hidden"
            />
          </div>

          {/* Prediction Matrix Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">الدواء</th>
                    <th className="p-3">الرصيد</th>
                    <th className="p-3">مبيعات 30 يوم</th>
                    <th className="p-3">المعدل اليومي</th>
                    <th className="p-3 text-center">المتبقي</th>
                    <th className="p-3 text-center">المقترح للطلب</th>
                    <th className="p-3 text-center">الخطورة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {!(forecastReport?.items) || forecastReport.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد بيانات حركة كافية
                      </td>
                    </tr>
                  ) : (
                    forecastReport.items
                      .filter(
                        (it: any) =>
                          !tableSearch ||
                          it.tradeName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
                          it.scientificName?.toLowerCase().includes(tableSearch.toLowerCase()) ||
                          it.barcode?.includes(tableSearch),
                      )
                      .map((it: any, idx: number) => (
                        <tr key={it.inventoryItemId} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-slate-400 font-mono">{idx + 1}</td>
                          <td className="p-3">
                            <div className="font-bold text-slate-900">{it.tradeName}</div>
                            {it.scientificName && (
                              <div className="text-[10px] text-slate-400 font-mono truncate max-w-xs">
                                {it.scientificName}
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-mono font-bold">
                            <span className={it.currentStockPacks <= 0 ? 'text-rose-600 font-black' : 'text-slate-900'}>
                              {it.currentStockPacks} علبة
                            </span>
                            <div className="text-[10px] text-slate-400">({it.totalUnitsRemaining} شريط)</div>
                          </td>
                          <td className="p-3 font-mono font-bold text-slate-700">
                            {it.soldPacksLast30Days} علبة
                          </td>
                          <td className="p-3 font-mono font-bold text-blue-700">
                            {it.dailySalesVelocity} <span className="text-[10px] font-sans text-slate-400">علبة/يوم</span>
                          </td>
                          <td className="p-3 text-center font-mono">
                            {it.status === 'OUT_OF_STOCK' ? (
                              <span className="px-2.5 py-1 bg-slate-900 text-white font-black text-[10px] rounded-xl shadow-xs">
                                ❌ نافد (0)
                              </span>
                            ) : it.status === 'CRITICAL' ? (
                              <span className="px-2.5 py-1 bg-rose-100 text-rose-800 font-black text-[10px] rounded-xl border border-rose-200 animate-pulse">
                                ⚠️ ينفد بـ {it.daysLeft} يوم
                              </span>
                            ) : it.status === 'RUNNING_LOW' ? (
                              <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-black text-[10px] rounded-xl border border-amber-200">
                                ⏳ ينفد بـ {it.daysLeft} يوم
                              </span>
                            ) : it.status === 'STAGNANT' ? (
                              <span className="px-2.5 py-1 bg-slate-100 text-slate-500 font-bold text-[10px] rounded-xl">
                                ⚪ راكد
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-xl">
                                🟢 يكفي {it.daysLeft} يوم
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {it.suggestedReorderPacks > 0 ? (
                              <span className="px-2.5 py-1 bg-blue-50 text-blue-800 font-black text-xs rounded-xl border border-blue-200 font-mono">
                                📦 {it.suggestedReorderPacks} علبة
                              </span>
                            ) : (
                              <span className="text-slate-400 font-bold text-[11px]">—</span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {it.status === 'CRITICAL' || it.status === 'OUT_OF_STOCK' ? (
                              <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full text-[10px] font-black border border-rose-200">
                                عالي 🔴
                              </span>
                            ) : it.status === 'RUNNING_LOW' ? (
                              <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-[10px] font-black border border-amber-200">
                                متوسط 🟠
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black border border-emerald-200">
                                مستقر 🟢
                              </span>
                            )}
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

      {/* Modals for Traceability and Supplier Return */}
      {selectedTraceBatch && (
        <BatchTraceabilityModal
          batchNumber={selectedTraceBatch}
          onClose={() => setSelectedTraceBatch(null)}
        />
      )}

      {returnBatchItem && (
        <SupplierReturnModal
          batch={{
            batchId: returnBatchItem.inventoryItemId,
            tradeName: returnBatchItem.tradeName,
            scientificName: returnBatchItem.scientificName,
            batchNumber: returnBatchItem.oldestBatchNumber || 'BATCH-OLD',
            expiryDate: returnBatchItem.earliestExpiry || '',
            expiryFormatted: returnBatchItem.expiryFormatted,
            quantityUnitsRemaining: returnBatchItem.totalUnitsRemaining,
            unitsPerPack: returnBatchItem.unitsPerPack || 1,
            packsRemaining: returnBatchItem.packsRemaining || 1,
            purchasePricePack: Number(returnBatchItem.avgCostPack || returnBatchItem.sellingPricePack || 0),
            supplierName: returnBatchItem.supplierName,
          }}
          onClose={() => setReturnBatchItem(null)}
          onSuccess={() => {
            setReturnBatchItem(null);
            fetchReports();
          }}
        />
      )}
    </div>
  );
};
