import React, { useState, useEffect } from 'react';
import {
  Shield,
  Search,
  RefreshCw,
  User,
  Eye,
  X,
  FileText,
  DollarSign,
  Undo2,
  AlertTriangle,
  ClipboardCheck,
  UserCog,
  KeyRound,
  Building,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
import { apiRequest } from '../api/client';

export interface AuditLog {
  id: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string;
  details: Record<string, any> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditStats {
  totalLogs: number;
  todayLogs: number;
  priceChanges: number;
  returnsCount: number;
  stocktakesCount: number;
  userActions: number;
}

const ACTION_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string; icon: any }
> = {
  UPDATE_PRICE: {
    label: 'تعديل سعر دواء',
    bg: 'bg-amber-500/10',
    text: 'text-amber-700',
    border: 'border-amber-500/30',
    icon: DollarSign,
  },
  RETURN_TO_SUPPLIER: {
    label: 'إرجاع وجبة لمذخر',
    bg: 'bg-blue-500/10',
    text: 'text-blue-700',
    border: 'border-blue-500/30',
    icon: Undo2,
  },
  PROCESS_RETURN: {
    label: 'مرتجع مبيعات من زبون',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-700',
    border: 'border-cyan-500/30',
    icon: Undo2,
  },
  BATCH_RECALL: {
    label: 'سحب وجبة (Recall)',
    bg: 'bg-rose-500/10',
    text: 'text-rose-700',
    border: 'border-rose-500/30',
    icon: AlertTriangle,
  },
  RECONCILE_STOCKTAKE: {
    label: 'تسوية واعتماد جرد',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-700',
    border: 'border-emerald-500/30',
    icon: ClipboardCheck,
  },
  USER_CREATE: {
    label: 'إنشاء حساب كاشير',
    bg: 'bg-purple-500/10',
    text: 'text-purple-700',
    border: 'border-purple-500/30',
    icon: UserCog,
  },
  USER_DELETE: {
    label: 'حذف حساب كاشير',
    bg: 'bg-rose-500/10',
    text: 'text-rose-700',
    border: 'border-rose-500/30',
    icon: AlertTriangle,
  },
  USER_PASSWORD_RESET: {
    label: 'إعادة تعيين كلمة مرور كاشير',
    bg: 'bg-indigo-500/10',
    text: 'text-indigo-700',
    border: 'border-indigo-500/30',
    icon: KeyRound,
  },
  CHANGE_OWNER_PASSWORD: {
    label: 'تغيير كلمة مرور المالك',
    bg: 'bg-violet-500/10',
    text: 'text-violet-700',
    border: 'border-violet-500/30',
    icon: KeyRound,
  },
  UPDATE_PHARMACY_PROFILE: {
    label: 'تحديث بيانات الصيدلية',
    bg: 'bg-teal-500/10',
    text: 'text-teal-700',
    border: 'border-teal-500/30',
    icon: Building,
  },
  BACKUP_RESTORE: {
    label: 'استعادة نسخة احتياطية',
    bg: 'bg-red-500/10',
    text: 'text-red-700',
    border: 'border-red-500/30',
    icon: AlertTriangle,
  },
};

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats>({
    totalLogs: 0,
    todayLogs: 0,
    priceChanges: 0,
    returnsCount: 0,
    stocktakesCount: 0,
    userActions: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchStats = async () => {
    try {
      const res = await apiRequest<AuditStats>('/audit-logs/stats');
      if (res) setStats(res);
    } catch (err) {
      console.error('Failed to fetch audit stats', err);
    }
  };

  const fetchLogs = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', '40');

      if (actionFilter && actionFilter !== 'ALL') {
        params.append('action', actionFilter);
      }
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      if (fromDate) {
        params.append('from', fromDate);
      }
      if (toDate) {
        params.append('to', toDate);
      }

      const res = await apiRequest<{
        logs: AuditLog[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      }>('/audit-logs?' + params.toString());

      if (res) {
        setLogs(res.logs || []);
        setTotalCount(res.total || 0);
        setTotalPages(res.totalPages || 1);
        setCurrentPage(res.page || 1);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    fetchLogs(1);
  }, [actionFilter, fromDate, toDate]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs(1);
  };

  const resetFilters = () => {
    setActionFilter('ALL');
    setSearchQuery('');
    setFromDate('');
    setToDate('');
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('ar-IQ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(date);
    } catch {
      return dateString;
    }
  };

  const exportLogsAsCSV = () => {
    if (!logs.length) return;
    const headers = ['التاريخ', 'المستخدم', 'الدور', 'العملية', 'الهدف', 'التفاصيل'];
    const rows = logs.map((l) => [
      l.createdAt,
      l.userName || 'غير محدد',
      l.userRole || '',
      ACTION_CONFIG[l.action]?.label || l.action,
      l.entityId || l.entityType,
      '"' + (l.description || '').replace(/"/g, '""') + '"',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,﻿' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'audit_logs_' + new Date().toISOString().slice(0, 10) + '.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center font-bold">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900">
                سجل الرقابة والأمان (Audit Log)
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                توثيق كامل لكافة التعديلات الإدارية، تغيير الأسعار، المرتجعات، الجرد، وإدارة الحسابات
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => {
              fetchStats();
              fetchLogs(currentPage);
            }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            title="تحديث البيانات"
          >
            <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} />
            <span>تحديث</span>
          </button>

          <button
            onClick={exportLogsAsCSV}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            title="تصدير السجل إلى ملف CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تصدير CSV</span>
          </button>
        </div>
      </div>

      {/* Summary Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-indigo-500" />
            <span>إجمالي السجلات</span>
          </div>
          <div className="text-xl font-black text-slate-900">{stats.totalLogs.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-emerald-500" />
            <span>عمليات اليوم</span>
          </div>
          <div className="text-xl font-black text-emerald-600">{stats.todayLogs.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-amber-500" />
            <span>تعديل الأسعار</span>
          </div>
          <div className="text-xl font-black text-amber-600">{stats.priceChanges.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1.5">
            <Undo2 className="w-3.5 h-3.5 text-blue-500" />
            <span>المرتجعات</span>
          </div>
          <div className="text-xl font-black text-blue-600">{stats.returnsCount.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1.5">
            <ClipboardCheck className="w-3.5 h-3.5 text-teal-500" />
            <span>تسويات الجرد</span>
          </div>
          <div className="text-xl font-black text-teal-600">{stats.stocktakesCount.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1.5">
            <UserCog className="w-3.5 h-3.5 text-purple-500" />
            <span>إدارة الحسابات</span>
          </div>
          <div className="text-xl font-black text-purple-600">{stats.userActions.toLocaleString()}</div>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-xs border border-slate-200/80 space-y-4">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-600">نوع العملية</label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="ALL">جميع العمليات</option>
              <option value="UPDATE_PRICE">تعديل أسعار الأدوية</option>
              <option value="RETURN_TO_SUPPLIER">إرجاع وجبة لمذخر</option>
              <option value="PROCESS_RETURN">مرتجع مبيعات من زبون</option>
              <option value="BATCH_RECALL">سحب وجبة دوائية (Recall)</option>
              <option value="RECONCILE_STOCKTAKE">تسوية واعتماد جرد</option>
              <option value="USER_CREATE">إنشاء حساب كاشير</option>
              <option value="USER_DELETE">حذف حساب كاشير</option>
              <option value="USER_PASSWORD_RESET">إعادة تعيين كلمة مرور</option>
              <option value="CHANGE_OWNER_PASSWORD">تغيير كلمة مرور المالك</option>
              <option value="UPDATE_PHARMACY_PROFILE">تحديث بيانات الصيدلية</option>
              <option value="BACKUP_RESTORE">استعادة نسخة احتياطية</option>
            </select>
          </div>

          <div className="space-y-1 lg:col-span-2">
            <label className="text-[11px] font-bold text-slate-600">بحث بالوصف أو اسم المستخدم</label>
            <div className="relative">
              <input
                type="text"
                placeholder="ابحث عن دواء، مستخدم، أو تفاصيل..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-600">من تاريخ</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-600">إلى تاريخ</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </form>

        {(actionFilter !== 'ALL' || searchQuery || fromDate || toDate) && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <div className="text-slate-500 font-medium">
              النتائج المطابقة للتصفية: <span className="font-bold text-slate-800">{totalCount} سجل</span>
            </div>
            <button
              onClick={resetFilters}
              className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>إعادة ضبط الفلاتر</span>
            </button>
          </div>
        )}
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-3xl shadow-xs border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-slate-500 font-black text-[11px] uppercase">
                <th className="py-3.5 px-4">الوقت والتاريخ</th>
                <th className="py-3.5 px-4">المستخدم</th>
                <th className="py-3.5 px-4">نوع العملية</th>
                <th className="py-3.5 px-4">البيان والتفاصيل</th>
                <th className="py-3.5 px-4 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
                    <span>جاري تحميل سجلات الرقابة...</span>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <Shield className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-bold text-slate-600">لا توجد سجلات رقابة مطابقة للبحث</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      ستظهر هنا أي عمليات أسعار، مرتجعات، تسويات جرد، أو حسابات مستخدمين.
                    </p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const cfg = ACTION_CONFIG[log.action] || {
                    label: log.action,
                    bg: 'bg-slate-100',
                    text: 'text-slate-700',
                    border: 'border-slate-200',
                    icon: FileText,
                  };
                  const ActionIcon = cfg.icon;

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                      onClick={() => setSelectedLog(log)}
                    >
                      {/* Date & Time */}
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 font-medium">
                        <div className="font-bold text-slate-900">{formatDate(log.createdAt)}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {log.ipAddress ? 'IP: ' + log.ipAddress : 'داخلي / آمن'}
                        </div>
                      </td>

                      {/* User */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs shrink-0">
                            <User className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="font-black text-slate-900">
                              {log.userName || 'النظام'}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {log.userRole === 'OWNER'
                                ? 'صاحب الصيدلية'
                                : log.userRole === 'CASHIER'
                                ? 'كاشير'
                                : log.userRole === 'SUPER_ADMIN'
                                ? 'المدير العام'
                                : log.userRole || 'تلقائي'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Action Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black border ' + cfg.bg + ' ' + cfg.text + ' ' + cfg.border}
                        >
                          <ActionIcon className="w-3 h-3 shrink-0" />
                          <span>{cfg.label}</span>
                        </span>
                      </td>

                      {/* Description */}
                      <td className="py-3 px-4 text-slate-700">
                        <p className="font-bold line-clamp-2 max-w-md">{log.description}</p>
                        {log.entityId && (
                          <span className="text-[10px] font-mono text-slate-400">
                            المعرف: {log.entityId.slice(0, 12)}...
                          </span>
                        )}
                      </td>

                      {/* View Details Action */}
                      <td className="py-3 px-4 whitespace-nowrap text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>التفاصيل</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="text-xs text-slate-500 font-bold">
              صفحة {currentPage} من {totalPages} (إجمالي {totalCount} سجل)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchLogs(currentPage - 1)}
                disabled={currentPage <= 1 || loading}
                className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => fetchLogs(currentPage + 1)}
                disabled={currentPage >= totalPages || loading}
                className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details Modal Drawer */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="fixed inset-0"
            onClick={() => setSelectedLog(null)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col z-10 overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center font-bold shrink-0">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900">تفاصيل العملية الرقابية</h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    ID: {selectedLog.id}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedLog(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Core Information Grid */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/70">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">نوع العملية</span>
                  <div className="font-black text-slate-800 text-xs mt-0.5">
                    {ACTION_CONFIG[selectedLog.action]?.label || selectedLog.action}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">وقت التنفيذ</span>
                  <div className="font-black text-slate-800 text-xs mt-0.5">
                    {formatDate(selectedLog.createdAt)}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">المستخدم المنفذ</span>
                  <div className="font-black text-slate-800 text-xs mt-0.5">
                    {selectedLog.userName || 'النظام'} ({selectedLog.userRole || 'SYSTEM'})
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">الكيان المتأثر</span>
                  <div className="font-black text-slate-800 text-xs mt-0.5">
                    {selectedLog.entityType} {selectedLog.entityId ? '#' + selectedLog.entityId.slice(0, 8) : ''}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500">البيان:</span>
                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl text-slate-800 font-bold leading-relaxed">
                  {selectedLog.description}
                </div>
              </div>

              {/* Structured Details Diff View */}
              {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-500">
                    البيانات والمقارنة التفصيلية (State Snapshot):
                  </span>
                  
                  {/* Specialized Price Change Diff */}
                  {selectedLog.action === 'UPDATE_PRICE' && (
                    <div className="grid grid-cols-2 gap-3 bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl">
                      <div>
                        <div className="text-[10px] font-bold text-amber-700">السعر السابق</div>
                        <div className="font-mono font-black text-slate-800 text-xs mt-1">
                          قطعة: {Number(selectedLog.details.previousPriceUnit || 0).toLocaleString()} د.ع
                        </div>
                        <div className="font-mono font-black text-slate-800 text-xs">
                          باكيت: {Number(selectedLog.details.previousPricePack || 0).toLocaleString()} د.ع
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-emerald-700">السعر الجديد المعتمد</div>
                        <div className="font-mono font-black text-emerald-600 text-xs mt-1">
                          قطعة: {Number(selectedLog.details.newPriceUnit || 0).toLocaleString()} د.ع
                        </div>
                        <div className="font-mono font-black text-emerald-600 text-xs">
                          باكيت: {Number(selectedLog.details.newPricePack || 0).toLocaleString()} د.ع
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Raw Structured JSON viewer */}
                  <div className="bg-slate-900 text-emerald-400 p-3.5 rounded-2xl font-mono text-[11px] overflow-x-auto max-h-48 border border-slate-800">
                    <pre>{JSON.stringify(selectedLog.details, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
