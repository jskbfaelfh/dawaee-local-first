import React, { useState, useEffect } from 'react';
import {
  FileText,
  Search,
  Package,
  Eye,
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Printer,
  Sparkles,
  Camera,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { SmartInvoiceScannerModal } from '../components/SmartInvoiceScannerModal';

interface PurchaseInvoiceItem {
  id?: string;
  medicineId: string;
  tradeName: string;
  scientificName?: string;
  batchNumber?: string;
  expiryDate: string;
  quantityPacks: number;
  unitsPerPack: number;
  purchasePricePack: number;
  sellingPricePack: number;
  totalCost?: number;
}

interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  supplierId?: string;
  supplierName?: string;
  invoiceDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  notes?: string;
  itemsCount: number;
  createdAt: string;
  items?: PurchaseInvoiceItem[];
}

export const PurchasesView: React.FC = () => {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  const [showAiScanModal, setShowAiScanModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [earlyDiscountAlerts, setEarlyDiscountAlerts] = useState<any[]>([]);
  const [applyingDiscountId, setApplyingDiscountId] = useState<string | null>(null);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<PurchaseInvoice[]>(
        `/purchases${searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : ''}`,
      );
      setInvoices(data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchInitialData = async () => {
    try {
      const alerts = await apiRequest<any[]>('/purchases/early-discount-alerts').catch(() => []);
      setEarlyDiscountAlerts(alerts || []);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleApplyEarlyDiscount = async (invId: string) => {
    if (!confirm('هل تريد تطبيق خصم التسديد المبكر لهذه الفاتورة الآن وتخفيض الدين المستحق؟')) return;
    setApplyingDiscountId(invId);
    try {
      const res = await apiRequest<any>(`/purchases/${invId}/apply-early-discount`, {
        method: 'POST',
      });
      setMessage({ type: 'success', text: res.message || 'تم تطبيق خصم التسديد المبكر بنجاح!' });
      fetchInvoices();
      fetchInitialData();
    } catch (err: any) {
      alert(err.message || 'فشل تطبيق الخصم');
    } finally {
      setApplyingDiscountId(null);
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchInitialData();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchInvoices();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const openInvoiceDetails = async (invoice: PurchaseInvoice) => {
    try {
      const full = await apiRequest<PurchaseInvoice>(`/purchases/${invoice.id}`);
      setSelectedInvoice(full);
    } catch {
      setSelectedInvoice(invoice);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-800">المشتريات</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAiScanModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-900/20 active:scale-95 transition-all cursor-pointer"
            title="مسح فاتورة الشراء بالكاميرا"
          >
            <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
            <Camera className="w-4 h-4" />
            <span>مسح فاتورة (كاميرا) 📷</span>
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-xs font-bold ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Early Settlement Discount Urgent Alerts */}
      {earlyDiscountAlerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl space-y-2">
          <div className="flex items-center gap-2 font-black text-amber-950 text-xs">
            <Sparkles className="w-4 h-4 text-amber-600 animate-bounce" />
            <span>تنبيهات السداد المبكر والتوفير (Early Payment Discounts):</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {earlyDiscountAlerts.map((alt) => (
              <div
                key={alt.id}
                className="bg-white p-3 rounded-xl border border-amber-200 shadow-2xs flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-slate-900">
                    فاتورة <span className="font-mono text-blue-700">{alt.invoiceNumber}</span> — {alt.supplierName}
                  </div>
                  <div className="text-[11px] text-amber-800 font-bold mt-0.5">
                    خصم {alt.earlyDiscountPercent}% (توفير {Number(alt.earlyDiscountAmount || 0).toLocaleString()} د.ع) • متبقي {alt.daysRemaining} أيام
                  </div>
                </div>
                <button
                  disabled={applyingDiscountId === alt.id}
                  onClick={() => handleApplyEarlyDiscount(alt.id)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-black cursor-pointer shadow-xs active:scale-95 transition-all"
                >
                  {applyingDiscountId === alt.id ? 'جاري التطبيق...' : '⚡ تطبيق الخصم وتخفيض الدين'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search and Summary Filters */}
      <div className="flex items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث برقم الفاتورة أو المذخر..."
            className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
          />
        </div>
        <div className="text-xs font-bold text-slate-500 shrink-0">
          الفواتير: <span className="text-slate-900 font-black">{invoices.length}</span>
        </div>
      </div>

      {/* Invoices List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="p-3.5">رقم الفاتورة</th>
                <th className="p-3.5">المذخر</th>
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">المواد</th>
                <th className="p-3.5">المجموع</th>
                <th className="p-3.5">الواصل</th>
                <th className="p-3.5">الباقي</th>
                <th className="p-3.5">خصم الدفع</th>
                <th className="p-3.5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                    جاري التحميل...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
                    لا توجد فواتير
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 font-bold font-mono text-blue-700">{inv.invoiceNumber}</td>
                    <td className="p-3.5 font-bold text-slate-900">{inv.supplierName || '—'}</td>
                    <td className="p-3.5 text-slate-500 font-mono">
                      {new Date(inv.invoiceDate).toLocaleDateString('ar-IQ')}
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-bold text-[11px]">
                        {inv.itemsCount} مواد
                      </span>
                    </td>
                    <td className="p-3.5 font-black text-slate-900 font-mono">
                      {Number(inv.totalAmount).toLocaleString()} د.ع
                    </td>
                    <td className="p-3.5 text-emerald-700 font-bold font-mono">
                      {Number(inv.paidAmount).toLocaleString()} د.ع
                    </td>
                    <td className="p-3.5 font-bold font-mono">
                      {Number(inv.remainingAmount) > 0 ? (
                        <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md">
                          {Number(inv.remainingAmount).toLocaleString()} د.ع
                        </span>
                      ) : (
                        <span className="text-emerald-600">مسدد بالكامل</span>
                      )}
                    </td>
                    <td className="p-3.5 text-xs">
                      {(inv as any).earlyDiscountApplied ? (
                        <span className="px-2 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md font-bold text-[10px] inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          خصم {(inv as any).earlyDiscountPercent}% مُطبّق (وفر {Number((inv as any).earlyDiscountAppliedAmount || 0).toLocaleString()} د.ع)
                        </span>
                      ) : (inv as any).earlyDiscountDeadline && Number(inv.remainingAmount) > 0 ? (
                        <div className="space-y-1">
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-md font-bold text-[10px] block w-fit">
                            ⚡ خصم {(inv as any).earlyDiscountPercent}% متاح (توفير {Number((inv as any).earlyDiscountAmount || 0).toLocaleString()} د.ع)
                          </span>
                          <button
                            disabled={applyingDiscountId === inv.id}
                            onClick={() => handleApplyEarlyDiscount(inv.id)}
                            className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-[10px] font-black cursor-pointer shadow-2xs active:scale-95 transition-all"
                          >
                            {applyingDiscountId === inv.id ? 'جاري التطبيق...' : '⚡ تطبيق الخصم الآن'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="p-3.5 text-center">
                      <button
                        onClick={() => openInvoiceDetails(inv)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>تفاصيل</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Details Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-3xl w-full shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-black">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">
                    فاتورة شراء رقم: <span className="font-mono text-blue-600">{selectedInvoice.invoiceNumber}</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    المورد: {selectedInvoice.supplierName || 'غير محدد'} • التاريخ:{' '}
                    {new Date(selectedInvoice.invoiceDate).toLocaleDateString('ar-IQ')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Invoice Items Table */}
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold sticky top-0">
                  <tr>
                    <th className="p-3">اسم الدواء</th>
                    <th className="p-3">الوجبة</th>
                    <th className="p-3">الصلاحية</th>
                    <th className="p-3">الكمية (علب)</th>
                    <th className="p-3">سعر الشراء</th>
                    <th className="p-3">سعر البيع</th>
                    <th className="p-3">إجمالي التكلفة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {selectedInvoice.items && selectedInvoice.items.length > 0 ? (
                    selectedInvoice.items.map((it, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-slate-900">
                          {it.tradeName}
                          {it.scientificName && (
                            <div className="text-[10px] text-slate-400">{it.scientificName}</div>
                          )}
                        </td>
                        <td className="p-3 font-mono text-slate-600">{it.batchNumber || '—'}</td>
                        <td className="p-3 font-mono text-slate-600">
                          {new Date(it.expiryDate).toLocaleDateString('ar-IQ')}
                        </td>
                        <td className="p-3 font-bold">{it.quantityPacks} علبة</td>
                        <td className="p-3 font-mono text-slate-700">
                          {Number(it.purchasePricePack).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 font-mono text-emerald-700 font-bold">
                          {Number(it.sellingPricePack).toLocaleString()} د.ع
                        </td>
                        <td className="p-3 font-mono font-black text-slate-900">
                          {Number(it.totalCost || it.quantityPacks * it.purchasePricePack).toLocaleString()} د.ع
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-400">
                        لا توجد بنود مفصلة متاحة لهذه الفاتورة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Summary Footer */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-4 shrink-0 text-xs">
              <div>
                <span className="text-slate-500">إجمالي الفاتورة: </span>
                <span className="font-black text-slate-900 text-sm font-mono mr-1">
                  {Number(selectedInvoice.totalAmount).toLocaleString()} د.ع
                </span>
              </div>
              <div>
                <span className="text-slate-500">المدفوع: </span>
                <span className="font-bold text-emerald-700 font-mono mr-1">
                  {Number(selectedInvoice.paidAmount).toLocaleString()} د.ع
                </span>
              </div>
              <div>
                <span className="text-slate-500">المتبقي: </span>
                <span className="font-bold text-rose-600 font-mono mr-1">
                  {Number(selectedInvoice.remainingAmount).toLocaleString()} د.ع
                </span>
              </div>
              <button
                onClick={() => window.print()}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smart AI OCR Invoice Scanner Modal */}
      {showAiScanModal && (
        <SmartInvoiceScannerModal
          onClose={() => setShowAiScanModal(false)}
          onSuccess={(savedInvoice) => {
            setShowAiScanModal(false);
            setMessage({
              type: 'success',
              text: `تم بنجاح قراءة واعتماد فاتورة المذخر (${savedInvoice.invoiceNumber || 'رقم جديد'}) وترحيل الأدوية للمخزن`,
            });
            fetchInvoices();
          }}
        />
      )}
    </div>
  );
};
