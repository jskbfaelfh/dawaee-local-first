import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  TrendingDown,
  Building2,
  Users,
  Zap,
  Wrench,
  ShoppingBag,
  Receipt,
} from 'lucide-react';
import { apiRequest } from '../api/client';

const CATEGORY_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  RENT: { label: 'إيجار', icon: Building2, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  SALARIES: { label: 'رواتب', icon: Users, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  ELECTRICITY: { label: 'كهرباء ومولد', icon: Zap, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  MAINTENANCE: { label: 'صيانة', icon: Wrench, color: 'text-orange-600 bg-orange-50 border-orange-200' },
  SUPPLIES: { label: 'مستلزمات', icon: ShoppingBag, color: 'text-teal-600 bg-teal-50 border-teal-200' },
  TAXES: { label: 'رسوم', icon: Receipt, color: 'text-purple-600 bg-purple-50 border-purple-200' },
  OTHER: { label: 'نثريات', icon: DollarSign, color: 'text-slate-600 bg-slate-100 border-slate-200' },
};

export const ExpensesView: React.FC = () => {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState('OTHER');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== 'ALL') params.append('category', selectedCategory);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const data = await apiRequest<any>(`/expenses?${params.toString()}`);
      setExpenses(data.expenses || []);
      setTotalExpenses(data.totalExpenses || 0);
      setByCategory(data.byCategory || {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, [selectedCategory, startDate, endDate]);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !amount || Number(amount) <= 0) {
      alert('يرجى ملء الحقول المطلوبة بمبلغ صحيح');
      return;
    }

    setSaving(true);
    try {
      const res = await apiRequest<any>('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          amount: Number(amount),
          category,
          expenseDate,
          recipient: recipient.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      setMessage({ type: 'success', text: res.message || 'تم تسجيل المصروف بنجاح' });
      setShowModal(false);
      // Reset Form
      setTitle('');
      setAmount('');
      setCategory('OTHER');
      setRecipient('');
      setNotes('');
      fetchExpenses();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل تسجيل المصروف' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا المصروف؟')) return;

    try {
      await apiRequest(`/expenses/${id}`, { method: 'DELETE' });
      setMessage({ type: 'success', text: 'تم حذف المصروف بنجاح' });
      fetchExpenses();
    } catch (err: any) {
      alert(err.message || 'فشل حذف المصروف');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center font-bold">
            <TrendingDown className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-black text-slate-800">المصاريف</h1>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black shadow-xs active:scale-95 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>مصروف جديد +</span>
        </button>
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Expenses Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
            <span>المصاريف</span>
            <TrendingDown className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-xl font-black text-rose-600 font-mono">
            {totalExpenses.toLocaleString()} <span className="text-xs font-sans">د.ع</span>
          </div>
        </div>

        {/* Salaries & Rent */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
            <span>رواتب وإيجار</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xl font-black text-slate-900 font-mono">
            {((byCategory['SALARIES'] || 0) + (byCategory['RENT'] || 0)).toLocaleString()}{' '}
            <span className="text-xs font-sans">د.ع</span>
          </div>
        </div>

        {/* Electricity & Maintenance */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
            <span>كهرباء وصيانة</span>
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-black text-slate-900 font-mono">
            {((byCategory['ELECTRICITY'] || 0) + (byCategory['MAINTENANCE'] || 0)).toLocaleString()}{' '}
            <span className="text-xs font-sans">د.ع</span>
          </div>
        </div>

        {/* Supplies & Others */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
            <span>نثريات</span>
            <ShoppingBag className="w-4 h-4 text-teal-500" />
          </div>
          <div className="text-xl font-black text-slate-900 font-mono">
            {((byCategory['SUPPLIES'] || 0) + (byCategory['OTHER'] || 0) + (byCategory['TAXES'] || 0)).toLocaleString()}{' '}
            <span className="text-xs font-sans">د.ع</span>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            الكل
          </button>
          {Object.keys(CATEGORY_LABELS).map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {CATEGORY_LABELS[cat].label}
            </button>
          ))}
        </div>

        {/* Date Filter */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-slate-500 font-bold">من:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-slate-800"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500 font-bold">إلى:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-slate-800"
            />
          </div>
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
              className="text-slate-400 hover:text-slate-600 p-1"
              title="إلغاء فلتر التاريخ"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="p-3.5">البيان</th>
                <th className="p-3.5">الفئة</th>
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">المستلم</th>
                <th className="p-3.5">المبلغ</th>
                <th className="p-3.5">ملاحظات</th>
                <th className="p-3.5 text-center">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-rose-500" />
                    جاري التحميل...
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    <DollarSign className="w-8 h-8 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
                    لا توجد مصاريف
                  </td>
                </tr>
              ) : (
                expenses.map((exp) => {
                  const catInfo = CATEGORY_LABELS[exp.category] || CATEGORY_LABELS['OTHER'];
                  return (
                    <tr key={exp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-bold text-slate-900">{exp.title}</td>
                      <td className="p-3.5">
                        <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${catInfo.color}`}>
                          {catInfo.label}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-500 font-mono">
                        {new Date(exp.expenseDate).toLocaleDateString('ar-IQ')}
                      </td>
                      <td className="p-3.5 text-slate-700">{exp.recipient || '—'}</td>
                      <td className="p-3.5 font-black text-rose-600 font-mono text-sm">
                        {Number(exp.amount).toLocaleString()} د.ع
                      </td>
                      <td className="p-3.5 text-slate-500 text-[11px]">{exp.notes || '—'}</td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => handleDeleteExpense(exp.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center font-black">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="font-black text-base text-slate-900">إضافة مصروف</h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">البيان *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مولد، إيجار، راتب..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:outline-hidden focus:border-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">المبلغ *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value !== '' ? Number(e.target.value) : '')}
                    placeholder="50000"
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold text-rose-600 focus:outline-hidden focus:border-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">الفئة</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 focus:outline-hidden focus:border-rose-500"
                  >
                    {Object.keys(CATEGORY_LABELS).map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">التاريخ</label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-slate-800 focus:outline-hidden focus:border-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">المستلم</label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="الاسم"
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 focus:outline-hidden focus:border-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 focus:outline-hidden focus:border-rose-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl font-black shadow-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>حفظ</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
