import React from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, CheckCircle2, ArrowRight, X } from 'lucide-react';

export interface ChangedPriceItem {
  id?: string;
  tradeName: string;
  lastPurchasePrice: number;
  newPurchasePrice: number;
  unitsPerPack?: number;
}

interface PriceChangesReviewModalProps {
  isOpen: boolean;
  items: ChangedPriceItem[];
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export const PriceChangesReviewModal: React.FC<PriceChangesReviewModalProps> = ({
  isOpen,
  items,
  onConfirm,
  onCancel,
  isSubmitting = false,
}) => {
  if (!isOpen || items.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center font-black">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-base">تنبيه تغير أسعار الشراء</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                يوجد <b className="text-slate-800 font-mono font-black">{items.length}</b> دواء تغير سعر شرائه عن آخر وجبة مسجلة:
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Changed Items List */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1 divide-y divide-slate-100">
          {items.map((item, idx) => {
            const isIncrease = item.newPurchasePrice > item.lastPurchasePrice;
            const diff = Math.abs(item.newPurchasePrice - item.lastPurchasePrice);
            const percent = item.lastPurchasePrice > 0
              ? Math.round((diff / item.lastPurchasePrice) * 100)
              : 0;

            return (
              <div key={idx} className={`pt-3 first:pt-0 flex items-center justify-between gap-3 ${idx > 0 ? 'mt-3' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-black text-slate-900 text-sm truncate">
                    {item.tradeName}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 font-mono flex-wrap">
                    <span>السابق: <b className="text-slate-700">{item.lastPurchasePrice.toLocaleString()} د.ع</b></span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-180" />
                    <span>الجديد: <b className={isIncrease ? 'text-rose-700' : 'text-emerald-700'}>{item.newPurchasePrice.toLocaleString()} د.ع</b></span>
                  </div>
                </div>

                <div className="shrink-0 text-left">
                  <span
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black border ${
                      isIncrease
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}
                  >
                    {isIncrease ? (
                      <>
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>ارتفع (+{percent}%)</span>
                      </>
                    ) : (
                      <>
                        <TrendingDown className="w-3.5 h-3.5" />
                        <span>انخفض (-{percent}%)</span>
                      </>
                    )}
                  </span>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5 text-left">
                    {isIncrease ? `+${diff.toLocaleString()}` : `-${diff.toLocaleString()}`} د.ع
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-2xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-700/20 transition-all disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
            <span>{isSubmitting ? 'جاري الاعتماد والحفظ...' : 'تأكيد واعتماد الفاتورة'}</span>
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-5 py-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-2xl text-xs sm:text-sm font-bold cursor-pointer transition-colors"
          >
            مراجعة وتعديل
          </button>
        </div>
      </div>
    </div>
  );
};
