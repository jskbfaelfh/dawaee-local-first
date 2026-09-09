import React, { useState, useEffect } from 'react';
import {
  Building2,
  Search,
  Plus,
  Edit,
  FileText,
  Phone,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  X,
  Banknote,
  Clock,
  Percent,
  Camera,
  Eye,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  Trash2,
} from 'lucide-react';
import { apiRequest } from '../api/client';

export const SuppliersDebtView: React.FC = () => {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    suppliersCount: 0,
    indebtedSuppliersCount: 0,
    totalPurchasedAmount: 0,
    totalPaidAmount: 0,
    totalRemainingDebt: 0,
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'DEBT_ONLY' | 'SETTLED_ONLY'>('ALL');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals state
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    phone: '',
    address: '',
    notes: '',
  });

  // Payment Modal
  const [payingSupplier, setPayingSupplier] = useState<any | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    discountPercent: 0,
    discountAmount: 0,
    netPaidAmount: 0,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'CASH',
    receiptNumber: '',
    receiptImage: '',
    notes: '',
  });
  const [payingLoading, setPayingLoading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  // Receipt Lightbox Modal
  const [selectedReceiptModal, setSelectedReceiptModal] = useState<{
    image: string;
    supplierName?: string;
    amount?: number;
    date?: string;
    receiptNumber?: string;
  } | null>(null);
  const [receiptZoom, setReceiptZoom] = useState(1);
  const [receiptRotation, setReceiptRotation] = useState(0);

  // Ledger / Statement Modal
  const [ledgerSupplier, setLedgerSupplier] = useState<any | null>(null);
  const [ledgerData, setLedgerData] = useState<any | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<'INVOICES' | 'PAYMENTS'>('INVOICES');

  // Client-side Image Compression Helper
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDimension = 1280;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve(compressedDataUrl);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Fetch Data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [sumData, supList] = await Promise.all([
        apiRequest<any>('/inventory/suppliers/summary'),
        apiRequest<any[]>('/inventory/suppliers'),
      ]);
      setSummary(sumData || {});
      setSuppliers(supList || []);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'فشل تحميل بيانات المذاخر' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filtered Suppliers
  const filteredSuppliers = suppliers.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.phone && s.phone.includes(searchTerm));

    const debt = Number(s.totalRemainingDebt || 0);

    if (filterMode === 'DEBT_ONLY') {
      return matchSearch && debt > 0;
    }
    if (filterMode === 'SETTLED_ONLY') {
      return matchSearch && debt === 0;
    }
    return matchSearch;
  });

  // Create / Update Supplier
  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingSupplier) {
        await apiRequest(`/inventory/suppliers/${editingSupplier.id}`, {
          method: 'PATCH',
          body: JSON.stringify(supplierForm),
        });
        setMessage({ type: 'success', text: `تم تحديث بيانات مذخر (${supplierForm.name}) بنجاح` });
      } else {
        await apiRequest('/inventory/suppliers', {
          method: 'POST',
          body: JSON.stringify(supplierForm),
        });
        setMessage({ type: 'success', text: `تمت إضافة مذخر (${supplierForm.name}) بنجاح` });
      }

      setShowAddSupplierModal(false);
      setEditingSupplier(null);
      setSupplierForm({ name: '', phone: '', address: '', notes: '' });
      fetchData();
    } catch (err: any) {
      alert(err.message || 'فشل حفظ بيانات المذخر');
    }
  };

  // Open Edit Supplier
  const openEditSupplier = (s: any) => {
    setEditingSupplier(s);
    setSupplierForm({
      name: s.name || '',
      phone: s.phone || '',
      address: s.address || '',
      notes: s.notes || '',
    });
    setShowAddSupplierModal(true);
  };

  // Open Payment Modal
  const openPaymentModal = (s: any) => {
    const totalDebt = Number(s.totalRemainingDebt || 0);
    setPayingSupplier(s);
    setPaymentForm({
      amount: totalDebt,
      discountPercent: 0,
      discountAmount: 0,
      netPaidAmount: totalDebt,
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'CASH',
      receiptNumber: '',
      receiptImage: '',
      notes: '',
    });
  };

  // Submit Payment
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingSupplier) return;

    setPayingLoading(true);
    try {
      const res = await apiRequest<any>(`/inventory/suppliers/${payingSupplier.id}/pay`, {
        method: 'POST',
        body: JSON.stringify(paymentForm),
      });

      setMessage({ type: 'success', text: res.message || 'تم توثيق الدفعة وتخفيض الدين بنجاح' });
      setPayingSupplier(null);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'فشل تسجيل الدفعة');
    } finally {
      setPayingLoading(false);
    }
  };

  // Open Ledger / Statement
  const openLedgerModal = async (s: any) => {
    setLedgerSupplier(s);
    setLedgerLoading(true);
    setLedgerTab('INVOICES');
    try {
      const data = await apiRequest<any>(`/inventory/suppliers/${s.id}/ledger`);
      setLedgerData(data);
    } catch (err: any) {
      alert(err.message || 'فشل تحميل كشف الحساب');
    } finally {
      setLedgerLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-20">
      {/* 1. Header & Top Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Total Outstanding Debt */}
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-right shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-800">الديون</span>
            <div className="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center text-rose-700">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-rose-950 mt-1.5 font-mono">
            {Number(summary.totalRemainingDebt || 0).toLocaleString()} <span className="text-xs font-bold text-rose-800">د.ع</span>
          </div>
          <div className="text-[11px] text-rose-700 font-bold mt-0.5">
            {summary.indebtedSuppliersCount || 0} مذخر
          </div>
        </div>

        {/* Card 2: Total Purchases */}
        <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-2xl text-right shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-800">المشتريات</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-indigo-950 mt-1.5 font-mono">
            {Number(summary.totalPurchasedAmount || 0).toLocaleString()} <span className="text-xs font-bold text-indigo-800">د.ع</span>
          </div>
          <div className="text-[11px] text-indigo-700 font-bold mt-0.5">
            الفواتير
          </div>
        </div>

        {/* Card 3: Total Paid Amount */}
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl text-right shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800">الواصل</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-emerald-950 mt-1.5 font-mono">
            {Number(summary.totalPaidAmount || 0).toLocaleString()} <span className="text-xs font-bold text-emerald-800">د.ع</span>
          </div>
          <div className="text-[11px] text-emerald-700 font-bold mt-0.5">
            مسدد
          </div>
        </div>

        {/* Card 4: Total Suppliers Count */}
        <div className="bg-white border border-slate-200 p-4 rounded-2xl text-right shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">المذاخر</span>
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-slate-900 mt-1.5">
            {summary.suppliersCount || 0}
          </div>
          <div className="text-[11px] text-slate-500 font-bold mt-0.5">
            مذخر
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl flex items-center gap-2 text-xs font-bold shadow-xs ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600" />
          )}
          {message.text}
        </div>
      )}

      {/* 2. Main Table & Actions Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Filter & Actions Bar */}
        <div className="p-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute right-3.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث..."
              className="w-full pr-9 pl-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => setFilterMode('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                filterMode === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
              }`}
            >
              الكل ({suppliers.length})
            </button>
            <button
              onClick={() => setFilterMode('DEBT_ONLY')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                filterMode === 'DEBT_ONLY'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
              }`}
            >
              الديون ({summary.indebtedSuppliersCount || 0})
            </button>
            <button
              onClick={() => setFilterMode('SETTLED_ONLY')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                filterMode === 'SETTLED_ONLY'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
              }`}
            >
              واصل
            </button>
          </div>

          {/* Add Supplier Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditingSupplier(null);
                setSupplierForm({ name: '', phone: '', address: '', notes: '' });
                setShowAddSupplierModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              مذخر جديد +
            </button>

            <button
              onClick={fetchData}
              className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              title="تحديث"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Suppliers Ledger Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-100/75 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="p-2.5 w-10 text-center">#</th>
                <th className="p-2.5 min-w-[150px]">المذخر</th>
                <th className="p-2.5 min-w-[110px]">الهاتف</th>
                <th className="p-2.5 w-16 text-center">الفواتير</th>
                <th className="p-2.5 min-w-[100px]">المشتريات</th>
                <th className="p-2.5 min-w-[100px]">الواصل</th>
                <th className="p-2.5 min-w-[110px] bg-rose-50/50 text-rose-900">الباقي</th>
                <th className="p-2.5 min-w-[90px]">الحالة</th>
                <th className="p-2.5 text-center min-w-[170px]">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-slate-400 font-bold">
                    جاري التحميل...
                  </td>
                </tr>
              ) : filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-slate-400 font-bold">
                    {filterMode === 'DEBT_ONLY'
                      ? 'لا توجد ديون حالياً'
                      : 'لا توجد نتائج'}
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((s, idx) => {
                  const debt = Number(s.totalRemainingDebt || 0);
                  const isSettled = debt === 0;

                  return (
                    <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>

                      {/* Supplier Name */}
                      <td className="p-3">
                        <div className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                          <Building2 className="w-4 h-4 text-indigo-600" />
                          {s.name}
                        </div>
                        {s.notes && <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[160px]">{s.notes}</div>}
                      </td>

                      {/* Phone & Address */}
                      <td className="p-3 text-slate-600">
                        {s.phone ? (
                          <div className="font-mono font-bold text-slate-800 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {s.phone}
                          </div>
                        ) : (
                          <span className="text-slate-400">غير محدد</span>
                        )}
                        {s.address && <div className="text-[10px] text-slate-500 truncate max-w-[130px]">{s.address}</div>}
                      </td>

                      {/* Invoices Count */}
                      <td className="p-3 text-center">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md font-bold text-xs">
                          {s.invoicesCount || 0}
                        </span>
                      </td>

                      {/* Total Purchased */}
                      <td className="p-3 font-bold text-slate-900 font-mono">
                        {Number(s.totalPurchasedAmount || 0).toLocaleString()} د.ع
                      </td>

                      {/* Total Paid */}
                      <td className="p-3 font-bold text-emerald-700 font-mono">
                        {Number(s.totalPaidAmount || 0).toLocaleString()} د.ع
                      </td>

                      {/* Remaining Debt */}
                      <td className="p-3 bg-rose-50/30">
                        <div className={`font-black text-sm font-mono ${debt > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                          {debt.toLocaleString()} د.ع
                        </div>
                        {debt > 0 && s.nextDueDate && (
                          <div className="text-[10px] text-rose-600 flex items-center gap-1 mt-0.5">
                            <Clock className="w-2.5 h-2.5" />
                            موعد: {new Date(s.nextDueDate).toLocaleDateString('ar-IQ')}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3">
                        {isSettled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-black">
                            <CheckCircle2 className="w-3 h-3" />
                            واصل
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-[10px] font-black">
                            <AlertCircle className="w-3 h-3" />
                            مطلوب
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {/* Pay Installment Button */}
                          <button
                            onClick={() => openPaymentModal(s)}
                            disabled={isSettled}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg font-bold text-xs flex items-center gap-1 cursor-pointer transition-all active:scale-95"
                            title="تسديد"
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            تسديد
                          </button>

                          {/* Account Ledger / Invoices */}
                          <button
                            onClick={() => openLedgerModal(s)}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                            title="كشف حساب"
                          >
                            <FileText className="w-3.5 h-3.5 text-indigo-600" />
                            كشف
                          </button>

                          {/* Edit Supplier */}
                          <button
                            onClick={() => openEditSupplier(s)}
                            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
                            title="تعديل"
                          >
                            <Edit className="w-3.5 h-3.5" />
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

      {/* Modal 1: Add / Edit Supplier Modal */}
      {showAddSupplierModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                {editingSupplier ? 'تعديل مذخر' : 'إضافة مذخر'}
              </h3>
              <button onClick={() => setShowAddSupplierModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSupplier} className="space-y-3 mt-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم المذخر *</label>
                <input
                  type="text"
                  required
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  placeholder="مثال: مذخر الرشيد"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الهاتف</label>
                <input
                  type="text"
                  value={supplierForm.phone}
                  onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                  placeholder="07701234567"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">العنوان</label>
                <input
                  type="text"
                  value={supplierForm.address}
                  onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  placeholder="مثال: بغداد"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  rows={2}
                  value={supplierForm.notes}
                  onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })}
                  placeholder="مواعيد التوزيع..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  حفظ
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddSupplierModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Pay Installment Modal */}
      {payingSupplier && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-emerald-600" />
                  تسديد دفعة
                </h3>
                <p className="text-xs text-slate-500 font-bold mt-0.5">{payingSupplier.name}</p>
              </div>
              <button onClick={() => setPayingSupplier(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="my-3 bg-rose-50 border border-rose-200 p-3 rounded-xl flex items-center justify-between text-xs">
              <span className="font-bold text-rose-800">الباقي:</span>
              <span className="text-base font-black text-rose-950 font-mono">
                {Number(payingSupplier.totalRemainingDebt).toLocaleString()} د.ع
              </span>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المطلوب تسديده من الدين *</label>
                <input
                  type="number"
                  required
                  min="250"
                  step="250"
                  max={Number(payingSupplier.totalRemainingDebt)}
                  value={paymentForm.amount}
                  onChange={(e) => {
                    const newAmount = Number(e.target.value);
                    const discAmt =
                      paymentForm.discountPercent > 0
                        ? Math.round((newAmount * paymentForm.discountPercent) / 100)
                        : 0;
                    setPaymentForm({
                      ...paymentForm,
                      amount: newAmount,
                      discountAmount: discAmt,
                      netPaidAmount: Math.max(0, newAmount - discAmt),
                    });
                  }}
                  className="w-full px-3 py-2 bg-emerald-50/50 border border-emerald-300 rounded-xl text-base font-black text-emerald-950 font-mono"
                />
              </div>

              {/* Optional Discount on Payment as a Percentage */}
              <div className="bg-amber-50/70 border border-amber-200/80 p-3 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                    <Percent className="w-3.5 h-3.5 text-amber-700" />
                    <span>خصم التسديد (اختياري)</span>
                  </label>
                  {paymentForm.discountPercent > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentForm((prev) => ({
                          ...prev,
                          discountPercent: 0,
                          discountAmount: 0,
                          netPaidAmount: prev.amount,
                        }));
                      }}
                      className="text-[11px] font-bold text-amber-700 hover:text-amber-900 underline cursor-pointer"
                    >
                      إلغاء الخصم
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-amber-900 mb-0.5">نسبة الخصم %</label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={paymentForm.discountPercent || ''}
                        onChange={(e) => {
                          const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          const discAmt = Math.round((paymentForm.amount * pct) / 100);
                          setPaymentForm((prev) => ({
                            ...prev,
                            discountPercent: pct,
                            discountAmount: discAmt,
                            netPaidAmount: Math.max(0, prev.amount - discAmt),
                          }));
                        }}
                        placeholder="0"
                        className="w-full pl-7 pr-3 py-1.5 bg-white border border-amber-300 rounded-xl text-xs font-black font-mono text-amber-950 focus:border-amber-500 focus:outline-hidden"
                      />
                      <span className="absolute left-2.5 top-1.5 text-xs font-black text-amber-700">%</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-amber-900 mb-0.5">مبلغ الخصم (د.ع)</label>
                    <input
                      type="number"
                      min="0"
                      step="250"
                      max={paymentForm.amount}
                      value={paymentForm.discountAmount || ''}
                      onChange={(e) => {
                        const discAmt = Math.max(0, Math.min(paymentForm.amount, Number(e.target.value) || 0));
                        const pct =
                          paymentForm.amount > 0 ? Number(((discAmt / paymentForm.amount) * 100).toFixed(2)) : 0;
                        setPaymentForm((prev) => ({
                          ...prev,
                          discountAmount: discAmt,
                          discountPercent: pct,
                          netPaidAmount: Math.max(0, prev.amount - discAmt),
                        }));
                      }}
                      placeholder="0"
                      className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-xl text-xs font-bold font-mono text-amber-950 focus:border-amber-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Quick Preset Percentage Buttons */}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <span className="text-[10px] text-amber-800 font-bold ml-1">نسب سريعة:</span>
                  {[0, 2, 3, 4, 5, 6, 8, 10].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        const discAmt = Math.round((paymentForm.amount * pct) / 100);
                        setPaymentForm((prev) => ({
                          ...prev,
                          discountPercent: pct,
                          discountAmount: discAmt,
                          netPaidAmount: Math.max(0, prev.amount - discAmt),
                        }));
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                        paymentForm.discountPercent === pct
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-white border border-amber-200 text-amber-900 hover:bg-amber-100'
                      }`}
                    >
                      {pct === 0 ? 'بدون' : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Financial Breakdown */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600 font-bold">
                  <span>المخصوم من الدين:</span>
                  <span className="font-mono text-slate-900 font-black">
                    {paymentForm.amount.toLocaleString()} د.ع
                  </span>
                </div>

                {paymentForm.discountAmount > 0 && (
                  <div className="flex items-center justify-between text-amber-800 font-bold">
                    <span>خصم التسديد المكتسب ({paymentForm.discountPercent}%):</span>
                    <span className="font-mono font-black">-{paymentForm.discountAmount.toLocaleString()} د.ع</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200">
                  <span className="font-black text-emerald-950">الصافي المدفوع نقداً للمذخر:</span>
                  <span className="font-mono font-black text-base text-emerald-700">
                    {(paymentForm.amount - paymentForm.discountAmount).toLocaleString()} د.ع
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 font-bold pt-0.5">
                  <span>المتبقي من الدين بعد السداد:</span>
                  <span className="font-mono text-slate-600 font-bold">
                    {Math.max(
                      0,
                      Number(payingSupplier.totalRemainingDebt) - paymentForm.amount,
                    ).toLocaleString()}{' '}
                    د.ع
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">التاريخ</label>
                  <input
                    type="date"
                    required
                    value={paymentForm.paymentDate}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">طريقة الدفع</label>
                  <select
                    value={paymentForm.paymentMethod}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold"
                  >
                    <option value="CASH">نقداً</option>
                    <option value="ZAIN_CASH">زين كاش</option>
                    <option value="QI_CARD">كي كارد</option>
                    <option value="BANK_TRANSFER">حوالة</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رقم الوصل</label>
                <input
                  type="text"
                  value={paymentForm.receiptNumber}
                  onChange={(e) => setPaymentForm({ ...paymentForm, receiptNumber: e.target.value })}
                  placeholder="REC-..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات</label>
                <input
                  type="text"
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  placeholder="دفعة..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              {/* Optional Receipt Photo Attachment */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-indigo-600" />
                    <span>صورة وصل التسديد (وصل المذخر أو المندوب)</span>
                  </label>
                  <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-md">
                    اختياري
                  </span>
                </div>

                {!paymentForm.receiptImage ? (
                  <div>
                    <input
                      type="file"
                      id="receipt-photo-upload"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setIsCompressing(true);
                        try {
                          const compressed = await compressImage(file);
                          setPaymentForm((prev) => ({ ...prev, receiptImage: compressed }));
                        } catch (err) {
                          console.error('Failed to process image:', err);
                          alert('فشل معالجة الصورة، يرجى اختيار صورة أخرى');
                        } finally {
                          setIsCompressing(false);
                          e.target.value = '';
                        }
                      }}
                    />
                    <label
                      htmlFor="receipt-photo-upload"
                      className={`w-full py-3 px-4 border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/40 hover:bg-indigo-50/80 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${
                        isCompressing ? 'opacity-50 pointer-events-none' : ''
                      }`}
                    >
                      <Camera className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-bold text-indigo-900">
                        {isCompressing ? 'جاري ضغط ومعالجة الصورة...' : 'التقاط بالكاميرا أو اختيار صورة الوصل 📷'}
                      </span>
                    </label>
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-50/80 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="relative group cursor-pointer shrink-0"
                        onClick={() =>
                          setSelectedReceiptModal({
                            image: paymentForm.receiptImage,
                            supplierName: payingSupplier?.name,
                            amount: paymentForm.amount,
                            date: paymentForm.paymentDate,
                            receiptNumber: paymentForm.receiptNumber,
                          })
                        }
                      >
                        <img
                          src={paymentForm.receiptImage}
                          alt="وصل التسديد"
                          className="w-12 h-12 object-cover rounded-xl border border-emerald-300 shadow-2xs"
                        />
                        <div className="absolute inset-0 bg-black/30 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-4 h-4 text-white" />
                        </div>
                      </div>
                      <div className="truncate">
                        <span className="text-xs font-black text-emerald-900 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>تم إرفاق صورة الوصل بنجاح</span>
                        </span>
                        <span className="text-[10px] text-emerald-700 block truncate">
                          اضغط على الصورة للمعاينة المكبرة
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedReceiptModal({
                            image: paymentForm.receiptImage,
                            supplierName: payingSupplier?.name,
                            amount: paymentForm.amount,
                            date: paymentForm.paymentDate,
                            receiptNumber: paymentForm.receiptNumber,
                          })
                        }
                        className="p-1.5 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                        title="معاينة"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentForm((prev) => ({ ...prev, receiptImage: '' }))}
                        className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer"
                        title="حذف الصورة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={payingLoading}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-xs cursor-pointer transition-all active:scale-95"
                >
                  {payingLoading ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button
                  type="button"
                  onClick={() => setPayingSupplier(null)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Account Statement & Invoices Ledger Modal */}
      {ledgerSupplier && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 max-w-3xl w-full shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  كشف حساب: {ledgerSupplier.name}
                </h3>
              </div>
              <button onClick={() => setLedgerSupplier(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Financial Summary Strip */}
            {ledgerData && (
              <div className="grid grid-cols-3 gap-2.5 my-3">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-right">
                  <span className="text-[11px] font-bold text-slate-500 block">المشتريات</span>
                  <span className="text-sm font-black text-slate-900 font-mono">
                    {Number(ledgerData.summary.totalPurchased).toLocaleString()} د.ع
                  </span>
                </div>
                <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 text-right">
                  <span className="text-[11px] font-bold text-emerald-800 block">الواصل</span>
                  <span className="text-sm font-black text-emerald-950 font-mono">
                    {Number(ledgerData.summary.totalPaid).toLocaleString()} د.ع
                  </span>
                </div>
                <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200 text-right">
                  <span className="text-[11px] font-bold text-rose-800 block">الباقي</span>
                  <span className="text-sm font-black text-rose-950 font-mono">
                    {Number(ledgerData.summary.totalDebt).toLocaleString()} د.ع
                  </span>
                </div>
              </div>
            )}

            {/* Tabs: Invoices vs Payments */}
            <div className="flex border-b border-slate-200 mb-3">
              <button
                onClick={() => setLedgerTab('INVOICES')}
                className={`pb-2 px-3 text-xs font-black border-b-2 transition-all cursor-pointer ${
                  ledgerTab === 'INVOICES'
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                الفواتير ({ledgerData?.invoices?.length || 0})
              </button>
              <button
                onClick={() => setLedgerTab('PAYMENTS')}
                className={`pb-2 px-3 text-xs font-black border-b-2 transition-all cursor-pointer ${
                  ledgerTab === 'PAYMENTS'
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                الدفعات ({ledgerData?.payments?.length || 0})
              </button>
            </div>

            {/* Modal Body / Tables */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {ledgerLoading ? (
                <div className="py-12 text-center text-slate-400 font-bold text-xs">
                  جاري التحميل...
                </div>
              ) : ledgerTab === 'INVOICES' ? (
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">رقم الفاتورة</th>
                      <th className="p-2.5">التاريخ</th>
                      <th className="p-2.5">المجموع</th>
                      <th className="p-2.5">الواصل</th>
                      <th className="p-2.5">الباقي</th>
                      <th className="p-2.5">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledgerData?.invoices?.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-slate-400 font-bold">
                          لا توجد فواتير
                        </td>
                      </tr>
                    ) : (
                      ledgerData?.invoices?.map((inv: any) => (
                        <tr key={inv.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-mono font-bold text-indigo-700">
                            {inv.invoiceNumber || 'فاتورة بدون رقم'}
                          </td>
                          <td className="p-2.5 text-slate-600">
                            {new Date(inv.createdAt).toLocaleDateString('ar-IQ')}
                          </td>
                          <td className="p-2.5 font-bold font-mono text-slate-900">
                            {Number(inv.netTotalAmount).toLocaleString()} د.ع
                          </td>
                          <td className="p-2.5 font-bold font-mono text-emerald-700">
                            {Number(inv.paidAmount).toLocaleString()} د.ع
                          </td>
                          <td className="p-2.5 font-black font-mono text-rose-700">
                            {Number(inv.remainingAmount).toLocaleString()} د.ع
                          </td>
                          <td className="p-2.5">
                            {Number(inv.remainingAmount) === 0 ? (
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-bold">
                                واصل
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded text-[10px] font-bold">
                                آجل
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">التاريخ</th>
                      <th className="p-2.5">المبلغ المطفي</th>
                      <th className="p-2.5">الخصم المكتسب</th>
                      <th className="p-2.5">المدفوع نقداً</th>
                      <th className="p-2.5">طريقة الدفع</th>
                      <th className="p-2.5">رقم الوصل</th>
                      <th className="p-2.5 text-center">وصل التسديد</th>
                      <th className="p-2.5">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledgerData?.payments?.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-slate-400 font-bold">
                          لا توجد دفعات
                        </td>
                      </tr>
                    ) : (
                      ledgerData?.payments?.map((pay: any) => (
                        <tr key={pay.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-mono font-bold text-slate-800">
                            {new Date(pay.paymentDate).toLocaleDateString('ar-IQ')}
                          </td>
                          <td className="p-2.5 font-black font-mono text-slate-900 text-sm">
                            {Number(pay.amount).toLocaleString()} د.ع
                          </td>
                          <td className="p-2.5">
                            {Number(pay.discountAmount || 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 text-amber-800 font-bold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-mono">
                                <span>{Number(pay.discountAmount).toLocaleString()} د.ع</span>
                                {pay.discountPercent > 0 && <span className="text-[10px] text-amber-700">({pay.discountPercent}%)</span>}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-mono">—</span>
                            )}
                          </td>
                          <td className="p-2.5 font-black font-mono text-emerald-700 text-sm">
                            {Number(pay.netPaidAmount || pay.amount).toLocaleString()} د.ع
                          </td>
                          <td className="p-2.5 text-slate-600">
                            {pay.paymentMethod === 'CASH' ? 'نقداً' : pay.paymentMethod}
                          </td>
                          <td className="p-2.5 font-mono text-indigo-700 font-bold">
                            {pay.receiptNumber || '—'}
                          </td>
                          <td className="p-2.5 text-center">
                            {pay.receiptImage ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setReceiptZoom(1);
                                  setReceiptRotation(0);
                                  setSelectedReceiptModal({
                                    image: pay.receiptImage,
                                    supplierName: ledgerSupplier?.name,
                                    amount: pay.amount,
                                    date: pay.paymentDate,
                                    receiptNumber: pay.receiptNumber,
                                  });
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold border border-indigo-200 transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95"
                                title="اضغط لمعاينة وصل التسديد"
                              >
                                <Camera className="w-3.5 h-3.5 text-indigo-600" />
                                <span>معاينة الوصل 📷</span>
                              </button>
                            ) : (
                              <span className="text-slate-300 font-mono text-[11px]">—</span>
                            )}
                          </td>
                          <td className="p-2.5 text-slate-500">
                            {pay.notes || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setLedgerSupplier(null)}
                className="px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: Receipt Image Lightbox Viewer Modal */}
      {selectedReceiptModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 z-60 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-4xl w-full max-h-[95vh] flex flex-col shadow-2xl overflow-hidden text-white">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-white flex items-center gap-2">
                    <span>وصل تسديد: {selectedReceiptModal.supplierName || 'المذخر'}</span>
                    {selectedReceiptModal.receiptNumber && (
                      <span className="px-2 py-0.5 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 font-mono rounded-md text-xs font-bold">
                        #{selectedReceiptModal.receiptNumber}
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-bold mt-0.5">
                    {selectedReceiptModal.amount && (
                      <span>
                        المبلغ المسدد:{' '}
                        <b className="font-mono text-emerald-400 font-black">
                          {Number(selectedReceiptModal.amount).toLocaleString()} د.ع
                        </b>
                      </span>
                    )}
                    {selectedReceiptModal.date && (
                      <span>
                        التاريخ:{' '}
                        <b className="font-mono text-slate-300">
                          {new Date(selectedReceiptModal.date).toLocaleDateString('ar-IQ')}
                        </b>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setReceiptZoom((prev) => Math.min(3, prev + 0.25))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer"
                  title="تكبير"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptZoom((prev) => Math.max(0.5, prev - 0.25))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer"
                  title="تصغير"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptRotation((prev) => (prev + 90) % 360)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer"
                  title="تدوير 90 درجة"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <a
                  href={selectedReceiptModal.image}
                  download={`وصل_تسديد_${selectedReceiptModal.supplierName || 'مذخر'}_${
                    selectedReceiptModal.receiptNumber || 'receipt'
                  }.jpg`}
                  className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors cursor-pointer"
                  title="تنزيل الصورة"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedReceiptModal(null);
                    setReceiptZoom(1);
                    setReceiptRotation(0);
                  }}
                  className="p-2 bg-slate-800 hover:bg-rose-900/60 hover:text-rose-300 text-slate-400 rounded-xl transition-colors cursor-pointer ml-1"
                  title="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Image Canvas Container */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center min-h-[350px] max-h-[75vh] bg-slate-950/60">
              <img
                src={selectedReceiptModal.image}
                alt="وصل التسديد"
                style={{
                  transform: `scale(${receiptZoom}) rotate(${receiptRotation}deg)`,
                  transition: 'transform 0.2s ease-out',
                  maxHeight: '70vh',
                  maxWidth: '100%',
                  objectFit: 'contain',
                }}
                className="rounded-xl shadow-2xl select-none"
              />
            </div>

            {/* Footer with Reset & Info */}
            <div className="px-5 py-2.5 bg-slate-900 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span>
                تكبير: {Math.round(receiptZoom * 100)}% | تدوير: {receiptRotation}°
              </span>
              {(receiptZoom !== 1 || receiptRotation !== 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setReceiptZoom(1);
                    setReceiptRotation(0);
                  }}
                  className="text-indigo-400 hover:text-indigo-300 font-bold underline cursor-pointer"
                >
                  إعادة ضبط العرض
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
