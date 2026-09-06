import React, { useState } from 'react';
import {
  X,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Printer,
} from 'lucide-react';
import { apiRequest } from '../api/client';

interface SupplierReturnModalProps {
  batch: {
    batchId: string;
    tradeName: string;
    scientificName?: string;
    batchNumber: string;
    expiryDate: string;
    expiryFormatted?: string;
    quantityUnitsRemaining: number;
    unitsPerPack: number;
    packsRemaining: number;
    purchasePricePack: number;
    supplierId?: string;
    supplierName?: string;
  };
  onClose: () => void;
  onSuccess: (result: any) => void;
}

export const SupplierReturnModal: React.FC<SupplierReturnModalProps> = ({
  batch,
  onClose,
  onSuccess,
}) => {
  const unitsPerPack = batch.unitsPerPack || 1;
  const maxPacks = Math.floor(batch.quantityUnitsRemaining / unitsPerPack);
  const [returnPacks, setReturnPacks] = useState<number>(maxPacks > 0 ? maxPacks : 1);
  const [refundPricePack, setRefundPricePack] = useState<number>(batch.purchasePricePack || 0);
  const [reason, setReason] = useState<string>('قرب انتهاء الصلاحية وإرجاع للمذخر');
  const [deductFromDebt, setDeductFromDebt] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<any | null>(null);

  const totalUnitsToReturn = returnPacks * unitsPerPack;
  const totalRefundAmount = returnPacks * refundPricePack;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (returnPacks <= 0) {
      setErrorMsg('يجب أن تكون الكمية المرتجعة أكبر من صفر');
      return;
    }
    if (totalUnitsToReturn > batch.quantityUnitsRemaining) {
      setErrorMsg('الكمية المراد إرجاعها أكبر من الرصيد المتوفر في الوجبة');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await apiRequest<any>(`/inventory/batches/${batch.batchId}/return-to-supplier`, {
        method: 'POST',
        body: JSON.stringify({
          quantityUnits: totalUnitsToReturn,
          unitRefundPrice: refundPricePack / unitsPerPack,
          reason: reason.trim(),
          deductFromSupplierDebt: deductFromDebt,
        }),
      });

      if (result && result.voucher) {
        setVoucher(result.voucher);
        onSuccess(result);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'فشل إرجاع الدواء للمذخر');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-purple-700 via-indigo-800 to-slate-900 text-white flex items-center justify-between shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center font-black">
              <RotateCcw className="w-5 h-5 text-amber-300 animate-pulse" />
            </div>
            <div>
              <h3 className="font-black text-base flex items-center gap-2">
                <span>إرجاع للمذخر</span>
              </h3>
              <p className="text-xs text-purple-200 font-medium">
                إرجاع بضاعة وخصمها من حساب المذخر
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

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {voucher ? (
            /* SUCCESS VOUCHER PRINT PREVIEW */
            <div className="space-y-6">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="font-black text-sm">تم تسجيل الإرجاع وتحديث المخزون والمديونية بنجاح!</h4>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    تم خصم الكمية من المخزن وتنزيل مبلغ ({voucher.refundTotal?.toLocaleString()} د.ع) من رصيد المذخر
                  </p>
                </div>
              </div>

              {/* Printable Voucher Paper */}
              <div id="printable-supplier-voucher" className="p-6 bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl space-y-4 text-xs font-mono">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div>
                    <h2 className="text-base font-black text-slate-900 font-sans">سند إرجاع بضاعة إلى المذخر</h2>
                    <p className="text-[11px] text-slate-500 font-sans">نظام دوائي لإدارة الصيدليات</p>
                  </div>
                  <div className="text-left font-sans">
                    <b className="text-sm text-purple-700 block">{voucher.voucherNumber}</b>
                    <span className="text-[10px] text-slate-400">{voucher.date}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-sans">المذخر / المورد</span>
                    <b className="text-slate-900 text-sm font-sans">{voucher.supplierName}</b>
                  </div>
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-sans">اسم الدواء</span>
                    <b className="text-slate-900 text-sm font-sans">{voucher.tradeName}</b>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-sans">رقم الوجبة</span>
                    <b className="text-slate-900 font-bold">{voucher.batchNumber}</b>
                  </div>
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-sans">الكمية المرتجعة</span>
                    <b className="text-purple-700 font-black text-sm">{voucher.returnedPacks} علبة</b>
                  </div>
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-sans">إجمالي المبلغ المخصوم</span>
                    <b className="text-emerald-700 font-black text-sm">
                      {Number(voucher.refundTotal).toLocaleString()} د.ع
                    </b>
                  </div>
                </div>

                <div className="p-2.5 bg-white rounded-xl border border-slate-200 font-sans">
                  <span className="text-[10px] text-slate-400 block">سبب الإرجاع:</span>
                  <p className="text-slate-700 text-xs font-bold mt-0.5">{voucher.reason}</p>
                </div>

                <div className="pt-4 flex items-center justify-between text-[10px] text-slate-400 font-sans border-t border-slate-200">
                  <span>توقيع واستلام مندوب المذخر: ....................</span>
                  <span>ختم الصيدلية: ....................</span>
                </div>
              </div>

              <div className="flex items-center gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-black flex items-center gap-2 cursor-pointer transition-all shadow-md"
                >
                  <Printer className="w-4 h-4" />
                  طباعة سند الإرجاع
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black cursor-pointer transition-all"
                >
                  تم والعودة
                </button>
              </div>
            </div>
          ) : (
            /* FORM TO SUBMIT RETURN */
            <form onSubmit={handleSubmit} className="space-y-5">
              {errorMsg && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Medicine & Batch Summary */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-slate-900">{batch.tradeName}</h4>
                  <span className="px-2.5 py-0.5 bg-slate-200 text-slate-700 rounded-full text-[10px] font-mono font-bold">
                    Batch: {batch.batchNumber}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-600 pt-1">
                  <div>
                    <span className="text-[10px] text-slate-400 block">المذخر الأصلي:</span>
                    <b className="text-slate-800">{batch.supplierName || 'غير مسجل (مباشر)'}</b>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">تاريخ الصلاحية:</span>
                    <b className="text-slate-800">{batch.expiryFormatted || batch.expiryDate?.slice(0, 10)}</b>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">الرصيد المتوفر للتشغيلة:</span>
                    <b className="text-indigo-600 font-mono font-bold">{maxPacks} علبة</b>
                  </div>
                </div>
              </div>

              {/* Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    عدد العلب *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={maxPacks}
                    value={returnPacks}
                    onChange={(e) => setReturnPacks(Math.max(1, Number(e.target.value)))}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono font-black text-slate-900 focus:border-purple-600 focus:outline-hidden"
                    required
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    الحد الأقصى: {maxPacks} علبة
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سعر الاسترداد (د.ع) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={250}
                    value={refundPricePack}
                    onChange={(e) => setRefundPricePack(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono font-black text-emerald-700 focus:border-purple-600 focus:outline-hidden"
                    required
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    سعر الشراء الأصلي
                  </span>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  سبب الإرجاع وملاحظات
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="ملاحظات..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:border-purple-600 focus:outline-hidden"
                />
              </div>

              {/* Deduction Checkbox */}
              <label className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl flex items-center justify-between cursor-pointer">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-purple-900 block">
                    خصم من ديون المذخر
                  </span>
                  <p className="text-[10px] text-purple-700">
                    تنزيل المبلغ من كشف الحساب
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={deductFromDebt}
                  onChange={(e) => setDeductFromDebt(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded-sm cursor-pointer"
                />
              </label>

              {/* Total Calculation Banner */}
              <div className="p-4 bg-gradient-to-r from-purple-900 to-indigo-950 text-white rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-purple-300 block font-bold">المبلغ المسترد:</span>
                  <span className="text-xs text-purple-200">
                    {returnPacks} علبة × {Number(refundPricePack).toLocaleString()} د.ع
                  </span>
                </div>
                <div className="text-left font-mono">
                  <b className="text-lg font-black text-amber-300">{Number(totalRefundAmount).toLocaleString()} د.ع</b>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-black shadow-md cursor-pointer transition-all active:scale-95 flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  {submitting ? 'جاري الإرجاع...' : 'تأكيد الإرجاع'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
