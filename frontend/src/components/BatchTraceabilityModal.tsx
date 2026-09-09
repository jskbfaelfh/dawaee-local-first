import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  Truck,
  Building,
  ShoppingCart,
  RotateCcw,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Search,
} from 'lucide-react';
import { apiRequest } from '../api/client';

interface BatchTraceabilityModalProps {
  batchNumber: string;
  onClose: () => void;
  onRecallChanged?: () => void;
}

export const BatchTraceabilityModal: React.FC<BatchTraceabilityModalProps> = ({
  batchNumber,
  onClose,
  onRecallChanged,
}) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [recalling, setRecalling] = useState(false);
  const [searchTerm, setSearchTerm] = useState(batchNumber);

  const fetchTrace = async (batchNum: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<any>(`/inventory/batches/trace/${encodeURIComponent(batchNum.trim())}`);
      if (res && res.found) {
        setData(res);
      } else {
        setError(res?.message || 'لم يتم العثور على أي تشغيلة بهذا الرقم');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'فشل جلب مسار وسجل الوجبة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (batchNumber) {
      fetchTrace(batchNumber);
    }
  }, [batchNumber]);

  const handleToggleRecall = async (currentRecalled: boolean) => {
    if (!data || !data.batches || data.batches.length === 0) return;
    const targetBatchNum = data.batches[0].batchNumber;

    setRecalling(true);
    try {
      await apiRequest<any>('/inventory/batches/recall', {
        method: 'POST',
        body: JSON.stringify({
          batchNumber: targetBatchNum,
          isRecalled: !currentRecalled,
        }),
      });

      // Refresh data
      await fetchTrace(targetBatchNum);
      if (onRecallChanged) onRecallChanged();
    } catch (err: any) {
      alert(err.message || 'فشل تغيير حالة سحب التشغيلة');
    } finally {
      setRecalling(false);
    }
  };

  const batch = data?.batches?.[0];
  const isRecalled = batch?.isRecalled || false;

  // Expiry styling
  const expiryDate = batch ? new Date(batch.expiryDate) : null;
  const isExpired = expiryDate ? expiryDate < new Date() : false;
  const daysUntilExpiry = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center font-black">
              <Clock className="w-5 h-5 text-amber-300 animate-pulse" />
            </div>
            <div>
              <h3 className="font-black text-base flex items-center gap-2">
                <span>تتبع مسار ودورة حياة التشغيلة (Batch Traceability)</span>
                <span className="px-2 py-0.5 bg-amber-400/20 text-amber-200 border border-amber-400/30 rounded-full text-[10px] font-mono font-bold">
                  #{searchTerm}
                </span>
              </h3>
              <p className="text-xs text-slate-300">
                متابعة حركة الوجبة من المذخر إلى المخزن وحتى فواتير الصرف والمرتجعات
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar in Modal */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchTrace(searchTerm)}
              placeholder="ابحث برقم تشغيلة / Batch Number آخر..."
              className="w-full pl-3 pr-9 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:outline-hidden"
            />
          </div>
          <button
            onClick={() => fetchTrace(searchTerm)}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black cursor-pointer transition-all"
          >
            بحث
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-500">جاري تتبع مسار الوجبة واستخراج كافة الحركات...</p>
            </div>
          ) : error ? (
            <div className="p-6 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-center space-y-2">
              <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
              <p className="text-sm font-black">{error}</p>
              <p className="text-xs text-rose-600">تأكد من رقم التشغيلة وحاول مرة أخرى</p>
            </div>
          ) : batch ? (
            <div className="space-y-6">
              {/* Top Medicine & Batch Summary Banner */}
              <div className="p-4 bg-slate-900 rounded-2xl text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-black text-amber-300">{batch.tradeName}</h4>
                    {batch.isBonus && (
                      <span className="px-2 py-0.5 bg-amber-400/20 text-amber-300 border border-amber-400/30 rounded-md text-[10px] font-black">
                        🎁 وجبة بونص (مجانية)
                      </span>
                    )}
                    {batch.scientificName && (
                      <span className="text-xs text-slate-300 font-mono">({batch.scientificName})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <span>رقم الوجبة: <b className="text-white font-mono">{batch.batchNumber}</b></span>
                    <span>•</span>
                    <span>سعر الشراء: <b className="text-emerald-300 font-bold">{batch.isBonus ? '0 د.ع (بونص مجاني)' : `${Number(batch.purchasePricePack).toLocaleString()} د.ع`}</b></span>
                    <span>•</span>
                    <span>سعر البيع: <b className="text-white font-bold">{Number(batch.sellingPricePack).toLocaleString()} د.ع</b></span>
                  </div>
                </div>

                {/* Recall / Lock Action */}
                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-800">
                  {isRecalled ? (
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-black flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-rose-400" />
                        تشغيلة مقفولة / مسحوبة طبياً ⛔
                      </span>
                      <button
                        onClick={() => handleToggleRecall(true)}
                        disabled={recalling}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                      >
                        {recalling ? '...' : 'إلغاء القفل'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-black flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        تشغيلة مصرحة للبيع 🟢
                      </span>
                      <button
                        onClick={() => handleToggleRecall(false)}
                        disabled={recalling}
                        title="سحب التشغيلة وقفل بيعها في نقطة البيع في حال وجود تحذير دوائي"
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                      >
                        {recalling ? '...' : 'قفل وسحب التشغيلة 🔒'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* TIMELINE 4 STAGES */}
              <div className="relative pl-4 space-y-6 before:absolute before:right-5 before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-200">
                
                {/* STAGE 1: SUPPLIER & INVOICE */}
                <div className="relative flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black shrink-0 z-10 shadow-md ring-4 ring-white">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div className="flex-1 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-indigo-700 uppercase tracking-wider">
                        المحطة 1: التوريد وفاتورة الشراء
                      </span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {batch.receivedAt ? new Date(batch.receivedAt).toLocaleDateString('ar-IQ') : '—'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">المذخر / المورد</span>
                        <b className="text-slate-900 font-black">{batch.supplierName || 'مذخر مباشر'}</b>
                        {batch.supplierPhone && (
                          <span className="text-[10px] text-slate-500 block font-mono mt-0.5">{batch.supplierPhone}</span>
                        )}
                      </div>

                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">رقم فاتورة الشراء</span>
                        <b className="text-slate-900 font-mono font-black">{batch.purchaseInvoiceNumber || 'شراء مباشر'}</b>
                      </div>

                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">سعر الشراء للباكيت</span>
                        <b className="text-emerald-700 font-black font-mono">
                          {Number(batch.purchasePricePack).toLocaleString()} د.ع
                        </b>
                      </div>
                    </div>
                  </div>
                </div>

                {/* STAGE 2: INVENTORY & STORAGE */}
                <div className="relative flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black shrink-0 z-10 shadow-md ring-4 ring-white">
                    <Building className="w-5 h-5" />
                  </div>
                  <div className="flex-1 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-amber-700 uppercase tracking-wider">
                        المحطة 2: المخزن والرصيد الحالي
                      </span>
                      {isExpired ? (
                        <span className="px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded-full text-[10px] font-black">
                          ❌ منتهي الصلاحية
                        </span>
                      ) : daysUntilExpiry <= 90 ? (
                        <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-black">
                          ⚠️ ينتهي خلال {daysUntilExpiry} يوم
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-black">
                          ✅ صالح ({daysUntilExpiry} يوم متبقي)
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">الكمية المتبقية في المخزن</span>
                        <div className="flex items-baseline gap-1 font-mono">
                          <b className="text-slate-900 font-black text-sm">
                            {Math.floor(batch.quantityUnitsRemaining / (batch.unitsPerPack || 1))}
                          </b>
                          <span className="text-[10px] text-slate-500">علبة</span>
                          {batch.quantityUnitsRemaining % (batch.unitsPerPack || 1) > 0 && (
                            <span className="text-[10px] text-indigo-600 font-bold">
                              + {batch.quantityUnitsRemaining % (batch.unitsPerPack || 1)} شريط
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">تاريخ انتهاء الصلاحية</span>
                        <b className="text-slate-900 font-mono font-black">
                          {expiryDate ? expiryDate.toLocaleDateString('ar-IQ') : '—'}
                        </b>
                      </div>

                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">القيمة المالية المتبقية (شراء)</span>
                        <b className="text-indigo-700 font-black font-mono">
                          {Math.round(
                            (batch.quantityUnitsRemaining / (batch.unitsPerPack || 1)) * batch.purchasePricePack,
                          ).toLocaleString()}{' '}
                          د.ع
                        </b>
                      </div>
                    </div>
                  </div>
                </div>

                {/* STAGE 3: SALES DISPENSING */}
                <div className="relative flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black shrink-0 z-10 shadow-md ring-4 ring-white">
                    <ShoppingCart className="w-5 h-5" />
                  </div>
                  <div className="flex-1 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-emerald-700 uppercase tracking-wider">
                        المحطة 3: فواتير المبيعات الصادرة ({data?.salesHistory?.length || 0} عمليات صرف)
                      </span>
                    </div>

                    {data?.salesHistory && data.salesHistory.length > 0 ? (
                      <div className="overflow-x-auto max-h-48 border border-slate-100 rounded-xl">
                        <table className="w-full text-right text-xs">
                          <thead className="bg-slate-50 text-[10px] text-slate-500 font-black uppercase">
                            <tr>
                              <th className="p-2">رقم الفاتورة</th>
                              <th className="p-2">التاريخ والوقت</th>
                              <th className="p-2">الكاشير</th>
                              <th className="p-2">الكمية</th>
                              <th className="p-2">السعر الإجمالي</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {data.salesHistory.map((s: any, idx: number) => (
                              <tr key={idx} className="hover:bg-slate-50/70 font-medium">
                                <td className="p-2 font-mono font-bold text-indigo-600">{s.invoiceNumber}</td>
                                <td className="p-2 text-slate-500 text-[11px]">
                                  {new Date(s.soldAt).toLocaleString('ar-IQ')}
                                </td>
                                <td className="p-2 text-slate-800">{s.cashierName || 'كاشير'}</td>
                                <td className="p-2 font-mono">
                                  {s.quantitySold} {s.unitType === 'PACK' ? 'علبة' : 'شريط'}
                                </td>
                                <td className="p-2 font-mono font-bold text-slate-900">
                                  {Number(s.totalPrice).toLocaleString()} د.ع
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 py-2 text-center bg-slate-50 rounded-xl">
                        لم يتم صرف أي مبيعات من هذه التشغيلة بعد
                      </p>
                    )}
                  </div>
                </div>

                {/* STAGE 4: RETURNS (Customer & Supplier) */}
                <div className="relative flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center font-black shrink-0 z-10 shadow-md ring-4 ring-white">
                    <RotateCcw className="w-5 h-5" />
                  </div>
                  <div className="flex-1 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-purple-700 uppercase tracking-wider">
                        المحطة 4: سجل المرتجعات (الزبائن والمذاخر)
                      </span>
                    </div>

                    {/* Customer Returns */}
                    {data?.returnsHistory && data.returnsHistory.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-slate-500">مرتجعات الزبائن:</span>
                        <div className="overflow-x-auto max-h-32 border border-slate-100 rounded-xl">
                          <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 text-[10px] text-slate-500 font-black">
                              <tr>
                                <th className="p-2">التاريخ</th>
                                <th className="p-2">الكمية</th>
                                <th className="p-2">المبلغ المسترد</th>
                                <th className="p-2">السبب</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {data.returnsHistory.map((r: any, idx: number) => (
                                <tr key={idx} className="hover:bg-slate-50/70">
                                  <td className="p-2 text-slate-500 text-[11px]">
                                    {new Date(r.returnedAt).toLocaleDateString('ar-IQ')}
                                  </td>
                                  <td className="p-2 font-mono">
                                    {r.quantityReturned} {r.unitType === 'PACK' ? 'علبة' : 'شريط'}
                                  </td>
                                  <td className="p-2 font-mono text-rose-600 font-bold">
                                    {Number(r.refundAmount).toLocaleString()} د.ع
                                  </td>
                                  <td className="p-2 text-slate-600">{r.reason || 'إرجاع زبون'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Supplier Returns */}
                    {data?.supplierReturnsHistory && data.supplierReturnsHistory.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-purple-700">سندات إرجاع للمذخر:</span>
                        <div className="space-y-1">
                          {data.supplierReturnsHistory.map((sr: any, idx: number) => (
                            <div key={idx} className="p-2.5 bg-purple-50 rounded-xl border border-purple-100 text-xs flex items-center justify-between">
                              <div>
                                <b className="text-purple-950 font-black">{sr.receiptNumber}</b>
                                <p className="text-[10px] text-purple-700">{sr.notes}</p>
                              </div>
                              <b className="text-purple-900 font-mono font-black">
                                -{Number(sr.refundAmount).toLocaleString()} د.ع
                              </b>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(!data?.returnsHistory || data.returnsHistory.length === 0) &&
                      (!data?.supplierReturnsHistory || data.supplierReturnsHistory.length === 0) && (
                        <p className="text-xs text-slate-400 py-2 text-center bg-slate-50 rounded-xl">
                          لا توجد أي حركات إرجاع مسجلة على هذه التشغيلة
                        </p>
                      )}
                  </div>
                </div>

              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-black cursor-pointer transition-all"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
