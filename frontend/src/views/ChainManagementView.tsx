import React, { useState, useEffect } from 'react';
import {
  Building2,
  TrendingUp,
  Package,
  ArrowLeftRight,
  Plus,
  Check,
  X,
  RefreshCw,
  Search,
  ExternalLink,
  MapPin,
  Clock,
} from 'lucide-react';
import {
  apiRequest,
  setAuthToken,
  setStoredBranches,
} from '../api/client';

interface ChainManagementViewProps {
  onBranchSwitched: (newPharmacy: any, newBranches: any[]) => void;
}

export const ChainManagementView: React.FC<ChainManagementViewProps> = ({
  onBranchSwitched,
}) => {
  const [activeTab, setActiveTab] = useState<'BRANCHES' | 'TRANSFERS'>('BRANCHES');
  const [overview, setOverview] = useState<any | null>(null);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [transferFilter, setTransferFilter] = useState<'ALL' | 'INCOMING' | 'OUTGOING'>('ALL');
  const [loading, setLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create Transfer Modal
  const [showCreateTransferModal, setShowCreateTransferModal] = useState(false);
  const [transferForm, setTransferForm] = useState({
    targetTenantId: '',
    medicineId: '',
    quantityPacks: 1,
    quantityUnits: 0,
    notes: '',
  });

  // Search Medicine for Transfer
  const [searchMedicineTerm, setSearchMedicineTerm] = useState('');
  const [searchedMedicines, setSearchedMedicines] = useState<any[]>([]);
  const [selectedMedicine, setSelectedMedicine] = useState<any | null>(null);

  // Receive Transfer Modal
  const [receivingTransfer, setReceivingTransfer] = useState<any | null>(null);
  const [shelfLocationInput, setShelfLocationInput] = useState('');

  // Fetch Chain Overview
  const fetchChainData = async () => {
    setLoading(true);
    try {
      const [ovData, trData] = await Promise.all([
        apiRequest<any>('/chain/overview'),
        apiRequest<any[]>(`/chain/transfers?type=${transferFilter}`),
      ]);
      setOverview(ovData);
      setTransfers(trData || []);
      if (ovData?.branches) {
        setStoredBranches(ovData.branches);
      }
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'فشل تحميل بيانات السلسلة' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChainData();
  }, [transferFilter]);

  // Switch Branch
  const handleSwitchBranch = async (targetTenantId: string, branchName: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    setMessage(null);

    try {
      const res = await apiRequest<any>('/auth/switch-branch', {
        method: 'POST',
        body: JSON.stringify({ targetTenantId }),
      });

      setAuthToken(res.accessToken);
      localStorage.setItem('dawaee_user', JSON.stringify(res.user));
      localStorage.setItem('dawaee_pharmacy', JSON.stringify(res.pharmacy));
      if (res.branches) {
        setStoredBranches(res.branches);
      }

      onBranchSwitched(res.pharmacy, res.branches || []);
      setMessage({ type: 'success', text: `تم التبديل بنجاح إلى فرع (${branchName})!` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل التبديل إلى الفرع المحدد' });
    } finally {
      setActionLoading(false);
    }
  };

  // Search Medicine for Transfer
  useEffect(() => {
    if (searchMedicineTerm.trim().length >= 2) {
      const delay = setTimeout(async () => {
        try {
          const res = await apiRequest<any[]>(`/medicines/search?q=${encodeURIComponent(searchMedicineTerm)}`);
          setSearchedMedicines(res || []);
        } catch {
          setSearchedMedicines([]);
        }
      }, 250);
      return () => clearTimeout(delay);
    } else {
      setSearchedMedicines([]);
    }
  }, [searchMedicineTerm]);

  // Create Stock Transfer
  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedicine || !transferForm.targetTenantId || transferForm.quantityPacks <= 0) {
      setMessage({ type: 'error', text: 'يرجى اختيار الدواء والفرع المستلم وتحديد الكمية' });
      return;
    }

    setActionLoading(true);
    setMessage(null);

    try {
      const res = await apiRequest<any>('/chain/transfers', {
        method: 'POST',
        body: JSON.stringify({
          targetTenantId: transferForm.targetTenantId,
          medicineId: selectedMedicine.id,
          quantityPacks: Number(transferForm.quantityPacks),
          quantityUnits: Number(transferForm.quantityUnits || 0),
          notes: transferForm.notes,
        }),
      });

      setMessage({ type: 'success', text: res.message || 'تم إرسال سند المناقلة بنجاح' });
      setShowCreateTransferModal(false);
      setSelectedMedicine(null);
      setSearchMedicineTerm('');
      setTransferForm({
        targetTenantId: '',
        medicineId: '',
        quantityPacks: 1,
        quantityUnits: 0,
        notes: '',
      });
      fetchChainData();
      setActiveTab('TRANSFERS');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل إنشاء سند المناقلة' });
    } finally {
      setActionLoading(false);
    }
  };

  // Receive Transfer
  const handleConfirmReceive = async () => {
    if (!receivingTransfer) return;
    setActionLoading(true);
    setMessage(null);

    try {
      const res = await apiRequest<any>(`/chain/transfers/${receivingTransfer.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({ shelfLocation: shelfLocationInput }),
      });

      setMessage({ type: 'success', text: res.message || 'تم استلام الشحنة وإضافتها للمخزون بنجاح' });
      setReceivingTransfer(null);
      setShelfLocationInput('');
      fetchChainData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل استلام الشحنة' });
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel Transfer
  const handleCancelTransfer = async (transferId: string) => {
    if (!confirm('هل أنت متأكد من إلغاء سند المناقلة وإعادة الكميات لمخزون هذا الفرع؟')) return;
    setActionLoading(true);
    setMessage(null);

    try {
      const res = await apiRequest<any>(`/chain/transfers/${transferId}/cancel`, {
        method: 'POST',
      });

      setMessage({ type: 'success', text: res.message || 'تم إلغاء سند المناقلة بنجاح' });
      fetchChainData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل إلغاء سند المناقلة' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 pb-20 font-sans antialiased text-slate-900">
      {/* 1. Header & Quick Switch Bar */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black text-slate-900">
                {overview?.chain?.name || 'الفروع'}
              </h1>
              {overview?.chain && (
                <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs font-black">
                  {overview.summary?.totalBranches} فروع
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-bold mt-0.5">
              متابعة مبيعات الفروع ومناقلة الأدوية
            </p>
          </div>
        </div>

        {/* Action Tools */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={() => setShowCreateTransferModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md shadow-indigo-600/20 active:scale-95 transition-all cursor-pointer"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>مناقلة جديدة +</span>
          </button>

          <button
            onClick={fetchChainData}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all cursor-pointer"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Alert Messages */}
      {message && (
        <div
          className={`p-4 rounded-2xl text-xs font-black flex items-center justify-between gap-2 shadow-xs ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Executive Multi-Branch KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Today's Sales */}
        <div className="bg-emerald-50/90 p-4.5 rounded-3xl border border-emerald-200/80 shadow-xs">
          <div className="flex items-center justify-between text-emerald-900 text-xs font-black">
            <span>مبيعات اليوم</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-950 mt-1.5 font-mono">
            {Number(overview?.summary?.totalTodaySales || 0).toLocaleString()}{' '}
            <span className="text-xs font-sans">د.ع</span>
          </div>
          <div className="text-[10px] text-emerald-700 font-bold mt-0.5">
            كل الفروع
          </div>
        </div>

        {/* Total Monthly Sales */}
        <div className="bg-blue-50/90 p-4.5 rounded-3xl border border-blue-200/80 shadow-xs">
          <div className="flex items-center justify-between text-blue-900 text-xs font-black">
            <span>مبيعات الشهر</span>
            <Building2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-blue-950 mt-1.5 font-mono">
            {Number(overview?.summary?.totalMonthSales || 0).toLocaleString()}{' '}
            <span className="text-xs font-sans">د.ع</span>
          </div>
          <div className="text-[10px] text-blue-700 font-bold mt-0.5">
            الشهر الحالي
          </div>
        </div>

        {/* Total Inventory Valuation */}
        <div className="bg-purple-50/90 p-4.5 rounded-3xl border border-purple-200/80 shadow-xs">
          <div className="flex items-center justify-between text-purple-900 text-xs font-black">
            <span>قيمة المخزن</span>
            <Package className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-purple-950 mt-1.5 font-mono">
            {Number(overview?.summary?.totalInventoryValuation || 0).toLocaleString()}{' '}
            <span className="text-xs font-sans">د.ع</span>
          </div>
          <div className="text-[10px] text-purple-700 font-bold mt-0.5">
            بضاعة كل الفروع
          </div>
        </div>

        {/* Pending Transfers */}
        <div className="bg-amber-50/90 p-4.5 rounded-3xl border border-amber-200/80 shadow-xs">
          <div className="flex items-center justify-between text-amber-900 text-xs font-black">
            <span>مناقلات معلقة</span>
            <ArrowLeftRight className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-950 mt-1.5 font-mono">
            {overview?.summary?.pendingTransfersCount || 0}{' '}
            <span className="text-xs font-sans">شحنة</span>
          </div>
          <div className="text-[10px] text-amber-700 font-bold mt-0.5">
            بانتظار الاستلام
          </div>
        </div>
      </div>

      {/* 3. Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('BRANCHES')}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer ${
            activeTab === 'BRANCHES'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>الفروع ({overview?.branches?.length || 1})</span>
        </button>

        <button
          onClick={() => setActiveTab('TRANSFERS')}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer ${
            activeTab === 'TRANSFERS'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>المناقلات ({transfers.length})</span>
        </button>
      </div>

      {/* 4. TAB CONTENTS */}

      {/* TAB 1: BRANCHES CARDS & SWITCHER */}
      {activeTab === 'BRANCHES' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {(overview?.branches || []).map((branch: any) => {
              const isCurrent = branch.isCurrent;

              return (
                <div
                  key={branch.id}
                  className={`bg-white rounded-3xl border transition-all duration-200 overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md ${
                    isCurrent
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                      : 'border-slate-200'
                  }`}
                >
                  {/* Card Header */}
                  <div className="p-5 border-b border-slate-100 bg-slate-50/60">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-black text-slate-900 text-base">{branch.name}</h3>
                          {branch.chainRole === 'HQ' ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-md text-[10px] font-black">
                              الرئيسي
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md text-[10px] font-black">
                              فرع
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-bold">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          <span>{branch.governorate} • {branch.district}</span>
                          {branch.phone && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-slate-600">{branch.phone}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {isCurrent && (
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full text-xs font-black shrink-0 flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                          الفرع الحالي
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="p-5 grid grid-cols-2 gap-3 bg-white">
                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold block">مبيعات اليوم</span>
                      <span className="text-sm font-black text-emerald-700 font-mono mt-0.5 block">
                        {Number(branch.metrics?.todaySales || 0).toLocaleString()} د.ع
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold block">مبيعات الشهر</span>
                      <span className="text-sm font-black text-blue-700 font-mono mt-0.5 block">
                        {Number(branch.metrics?.monthSales || 0).toLocaleString()} د.ع
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold block">قيمة المخزن</span>
                      <span className="text-sm font-black text-slate-800 font-mono mt-0.5 block">
                        {Number(branch.metrics?.inventoryValue || 0).toLocaleString()} د.ع
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold block">النواقص</span>
                      <span className={`text-sm font-black font-mono mt-0.5 block ${Number(branch.metrics?.outOfStockCount || 0) > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                        {branch.metrics?.outOfStockCount || 0} دواء
                      </span>
                    </div>
                  </div>

                  {/* Card Footer / Switch Button */}
                  <div className="p-4 bg-slate-50/90 border-t border-slate-100">
                    {isCurrent ? (
                      <div className="w-full py-2 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-black text-center">
                        الفرع الحالي
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSwitchBranch(branch.id, branch.name)}
                        disabled={actionLoading}
                        className="w-full py-2.5 bg-slate-900 hover:bg-indigo-600 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-98 flex items-center justify-center gap-1.5"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>دخول الفرع</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: INTER-BRANCH TRANSFERS */}
      {activeTab === 'TRANSFERS' && (
        <div className="space-y-4">
          {/* Sub Filters */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              {[
                { id: 'ALL', label: 'الكل' },
                { id: 'INCOMING', label: 'الوارد' },
                { id: 'OUTGOING', label: 'الصادر' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setTransferFilter(f.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                    transferFilter === f.id
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowCreateTransferModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>مناقلة جديدة +</span>
            </button>
          </div>

          {/* Transfers Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">رقم السند</th>
                    <th className="p-3.5">التاريخ</th>
                    <th className="p-3.5">من فرع</th>
                    <th className="p-3.5">إلى فرع</th>
                    <th className="p-3.5">الدواء والكمية</th>
                    <th className="p-3.5">الوجبة والصلاحية</th>
                    <th className="p-3.5 text-center">الحالة</th>
                    <th className="p-3.5 text-center">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {transfers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد مناقلات
                      </td>
                    </tr>
                  ) : (
                    transfers.map((tr) => {
                      const isPending = tr.status === 'PENDING';
                      const isIncoming = tr.targetTenantId === overview?.currentBranchId;

                      return (
                        <tr key={tr.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3.5 font-mono font-black text-slate-900">{tr.transferNumber}</td>
                          <td className="p-3.5 text-slate-500 font-mono">
                            {new Date(tr.createdAt).toLocaleDateString('ar-IQ')}
                          </td>
                          <td className="p-3.5 font-bold text-slate-800">{tr.sourcePharmacyName}</td>
                          <td className="p-3.5 font-bold text-slate-800">{tr.targetPharmacyName}</td>
                          <td className="p-3.5">
                            <div className="font-bold text-indigo-950">{tr.tradeName}</div>
                            <div className="text-[11px] text-emerald-700 font-bold font-mono">
                              {tr.quantityPacks} علبة ({tr.quantityUnits} شريط)
                            </div>
                          </td>
                          <td className="p-3.5 text-slate-500 font-mono text-[11px]">
                            {tr.batchNumber && <div>وجبة: {tr.batchNumber}</div>}
                            {tr.expiryDate && <div>صلاحية: {tr.expiryDate.slice(0, 10)}</div>}
                          </td>
                          <td className="p-3.5 text-center">
                            {tr.status === 'PENDING' ? (
                              <span className="px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-200 rounded-full text-[10px] font-black inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-amber-600" />
                                قيد النقل
                              </span>
                            ) : tr.status === 'COMPLETED' ? (
                              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full text-[10px] font-black inline-flex items-center gap-1">
                                <Check className="w-3 h-3 text-emerald-600" />
                                مستلم
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 bg-rose-100 text-rose-800 border border-rose-200 rounded-full text-[10px] font-black inline-flex items-center gap-1">
                                <X className="w-3 h-3 text-rose-600" />
                                ملغي
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-center">
                            {isPending && isIncoming && (
                              <button
                                onClick={() => {
                                  setReceivingTransfer(tr);
                                  setShelfLocationInput('');
                                }}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-xs cursor-pointer active:scale-95 transition-all"
                              >
                                استلام
                              </button>
                            )}

                            {isPending && !isIncoming && (
                              <button
                                onClick={() => handleCancelTransfer(tr.id)}
                                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold shadow-2xs cursor-pointer active:scale-95 transition-all"
                              >
                                إلغاء
                              </button>
                            )}
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

      {/* MODAL: CREATE STOCK TRANSFER */}
      {showCreateTransferModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-indigo-600" />
                مناقلة جديدة
              </h3>
              <button
                onClick={() => setShowCreateTransferModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTransfer} className="space-y-3.5">
              {/* Target Branch */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الفرع المستلم *</label>
                <select
                  value={transferForm.targetTenantId}
                  onChange={(e) => setTransferForm({ ...transferForm, targetTenantId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white"
                  required
                >
                  <option value="">اختر الفرع...</option>
                  {(overview?.branches || [])
                    .filter((b: any) => !b.isCurrent)
                    .map((b: any) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.governorate} - {b.district})
                      </option>
                    ))}
                </select>
              </div>

              {/* Medicine Search */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الدواء *</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchMedicineTerm}
                    onChange={(e) => setSearchMedicineTerm(e.target.value)}
                    placeholder="بحث عن دواء..."
                    className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white"
                  />
                </div>

                {searchedMedicines.length > 0 && !selectedMedicine && (
                  <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-40 overflow-y-auto divide-y divide-slate-100 z-10">
                    {searchedMedicines.map((m) => (
                      <div
                        key={m.id}
                        onClick={() => {
                          setSelectedMedicine(m);
                          setSearchMedicineTerm(m.tradeName);
                          setSearchedMedicines([]);
                        }}
                        className="p-2.5 hover:bg-indigo-50 cursor-pointer text-xs flex items-center justify-between"
                      >
                        <span className="font-bold text-slate-900">{m.tradeName}</span>
                        <span className="text-slate-400 text-[10px]">{m.scientificName}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedMedicine && (
                <div className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-xs font-black text-indigo-950 block">{selectedMedicine.tradeName}</span>
                    <span className="text-[10px] text-indigo-700 font-mono">{selectedMedicine.scientificName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMedicine(null);
                      setSearchMedicineTerm('');
                    }}
                    className="text-xs text-rose-600 font-bold hover:underline cursor-pointer"
                  >
                    تغيير
                  </button>
                </div>
              )}

              {/* Quantity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">العلب *</label>
                  <input
                    type="number"
                    min="1"
                    value={transferForm.quantityPacks}
                    onChange={(e) => setTransferForm({ ...transferForm, quantityPacks: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:bg-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الأشرطة (اختياري)</label>
                  <input
                    type="number"
                    min="0"
                    value={transferForm.quantityUnits}
                    onChange={(e) => setTransferForm({ ...transferForm, quantityUnits: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:bg-white"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات</label>
                <input
                  type="text"
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                  placeholder="ملاحظات..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateTransferModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !selectedMedicine}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? 'جاري الإرسال...' : 'إرسال المناقلة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRM RECEIVE TRANSFER */}
      {receivingTransfer && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <Check className="w-5 h-5 text-emerald-600" />
                استلام مناقلة
              </h3>
              <button
                onClick={() => setReceivingTransfer(null)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-2xl space-y-1 text-xs">
              <div className="font-black text-emerald-950 text-sm">{receivingTransfer.tradeName}</div>
              <div className="text-emerald-800 font-bold">
                الكمية: <b className="font-mono">{receivingTransfer.quantityPacks} علبة</b> ({receivingTransfer.quantityUnits} شريط)
              </div>
              <div className="text-slate-500 text-[11px]">
                من: {receivingTransfer.sourcePharmacyName} (سند {receivingTransfer.transferNumber})
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                الرف (اختياري)
              </label>
              <input
                type="text"
                value={shelfLocationInput}
                onChange={(e) => setShelfLocationInput(e.target.value)}
                placeholder="مثال: A-01 أو ثلاجة"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:bg-white"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReceivingTransfer(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmReceive}
                disabled={actionLoading}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
              >
                {actionLoading ? 'جاري الاستلام...' : 'تأكيد الاستلام'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
