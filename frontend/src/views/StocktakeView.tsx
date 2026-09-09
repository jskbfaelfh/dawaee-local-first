import React, { useState, useEffect, useRef } from 'react';
import {
  ClipboardCheck,
  Search,
  Barcode,
  Layers,
  AlertTriangle,
  CheckCircle2,
  Printer,
  FileSpreadsheet,
  Plus,
  X,
  Eye,
  EyeOff,
  History,
  Scale,
  MapPin,
  ArrowDownLeft,
  ArrowUpRight,
  Package,
  Calendar,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { exportToExcel } from '../utils/excel';

interface StocktakeViewProps {
  onNavigateToInventory?: () => void;
}

export const StocktakeView: React.FC<StocktakeViewProps> = ({ onNavigateToInventory }) => {
  // Mode: ACTIVE_SESSION or ARCHIVE
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'ARCHIVE'>('ACTIVE');

  // Sessions list
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedShelf, setSelectedShelf] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [blindCount, setBlindCount] = useState<boolean>(false);
  const [rapidScanMode, setRapidScanMode] = useState<boolean>(false); // Beep +1 mode

  // Barcode Scanner Input Ref
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [scannedBarcode, setScannedBarcode] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: `الجرد ${new Date().getMonth() > 6 ? 'السنوي' : 'النصف سنوي'} ${new Date().getFullYear()}`,
    type: new Date().getMonth() > 6 ? 'ANNUAL' : 'SEMI_ANNUAL',
    shelfFilter: '',
    notes: '',
  });

  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconcileNotes, setReconcileNotes] = useState('');

  // 1. Fetch all sessions
  const fetchSessions = async () => {
    try {
      const data = await apiRequest<any[]>('/stocktake/sessions');
      setSessions(data || []);
      if (!activeSessionId && data && data.length > 0) {
        // Default to latest active/in-progress or latest session
        const inProgress = data.find((s) => s.status === 'IN_PROGRESS');
        setActiveSessionId(inProgress ? inProgress.id : data[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load stocktake sessions:', err);
    }
  };

  // 2. Fetch details for active session
  const fetchSessionDetails = async (sessionId: string) => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      if (selectedShelf && selectedShelf !== 'ALL') params.append('shelf', selectedShelf);
      if (selectedStatus && selectedStatus !== 'ALL') params.append('status', selectedStatus);

      const res = await apiRequest<any>(`/stocktake/sessions/${sessionId}?${params.toString()}`);
      setSessionData(res);
    } catch (err: any) {
      console.error('Failed to load session details:', err);
      setMessage({ type: 'error', text: err.message || 'فشل تحميل بيانات جلسة الجرد' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      fetchSessionDetails(activeSessionId);
    }
  }, [activeSessionId, selectedShelf, selectedStatus]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeSessionId) {
        fetchSessionDetails(activeSessionId);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // 3. Create a new Session
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.title.trim()) return;

    setActionLoading(true);
    try {
      const res = await apiRequest<any>('/stocktake/sessions', {
        method: 'POST',
        body: JSON.stringify({
          title: createForm.title.trim(),
          type: createForm.type,
          shelfFilter: createForm.shelfFilter || undefined,
          notes: createForm.notes || undefined,
        }),
      });

      setShowCreateModal(false);
      setMessage({ type: 'success', text: res.message || 'تم بدء جلسة الجرد بنجاح!' });
      await fetchSessions();
      if (res.sessionId) {
        setActiveSessionId(res.sessionId);
        setViewMode('ACTIVE');
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل إنشاء جلسة الجرد' });
    } finally {
      setActionLoading(false);
    }
  };

  // 4. Record count for an item
  const handleSaveCount = async (
    stocktakeItemId: string,
    packs: number,
    loose: number,
    notes?: string,
  ) => {
    if (!activeSessionId) return;

    try {
      await apiRequest<any>(`/stocktake/sessions/${activeSessionId}/count`, {
        method: 'POST',
        body: JSON.stringify({
          stocktakeItemId,
          countedPacks: Number(packs),
          countedLoose: Number(loose),
          notes,
        }),
      });

      // Optimistically update local sessionData items & stats
      setSessionData((prev: any) => {
        if (!prev) return prev;
        const updatedItems = prev.items.map((it: any) => {
          if (it.id === stocktakeItemId) {
            const unitsPerPack = Number(it.unitsPerPack) || 1;
            const countedTotalUnits = Number(packs) * unitsPerPack + Number(loose);
            const varianceUnits = countedTotalUnits - Number(it.systemUnits || 0);
            const variancePacks = Number((varianceUnits / unitsPerPack).toFixed(2));
            const varianceCost = Math.round(variancePacks * Number(it.purchasePricePack || 0));
            const varianceRetail = Math.round(variancePacks * Number(it.sellingPricePack || 0));
            let varianceStatus = 'MATCHED';
            if (varianceUnits < 0) varianceStatus = 'SHORTAGE';
            else if (varianceUnits > 0) varianceStatus = 'SURPLUS';

            return {
              ...it,
              countedPacks: Number(packs),
              countedLoose: Number(loose),
              countedTotalUnits,
              varianceUnits,
              variancePacks,
              varianceCost,
              varianceRetail,
              varianceStatus,
            };
          }
          return it;
        });

        // Recalculate stats
        const countedItems = updatedItems.filter((i: any) => i.varianceStatus !== 'UNCOUNTED').length;
        const matchedItems = updatedItems.filter((i: any) => i.varianceStatus === 'MATCHED').length;
        const shortageItems = updatedItems.filter((i: any) => i.varianceStatus === 'SHORTAGE').length;
        const surplusItems = updatedItems.filter((i: any) => i.varianceStatus === 'SURPLUS').length;

        const totalDeficitCost = updatedItems.reduce(
          (sum: number, i: any) => (i.varianceUnits < 0 ? sum + Math.abs(i.varianceCost) : sum),
          0,
        );
        const totalSurplusCost = updatedItems.reduce(
          (sum: number, i: any) => (i.varianceUnits > 0 ? sum + i.varianceCost : sum),
          0,
        );
        const netVarianceCost = totalSurplusCost - totalDeficitCost;

        return {
          ...prev,
          stats: {
            ...prev.stats,
            countedItems,
            matchedItems,
            shortageItems,
            surplusItems,
            totalDeficitCost,
            totalSurplusCost,
            netVarianceCost,
            progressPercent: prev.stats.totalItems > 0 ? Math.round((countedItems / prev.stats.totalItems) * 100) : 0,
          },
          items: updatedItems,
        };
      });
    } catch (err: any) {
      console.error('Failed to save count:', err);
    }
  };

  // 5. Handle Barcode Enter / Beep
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const barcode = scannedBarcode.trim();
    if (!barcode || !activeSessionId || !sessionData) return;

    // Look for item in current session
    const match = sessionData.items.find((i: any) => i.barcode === barcode);
    if (match) {
      if (rapidScanMode) {
        // Increment +1 pack automatically
        const currentPacks = Number(match.countedPacks || 0);
        const newPacks = currentPacks + 1;
        await handleSaveCount(match.id, newPacks, Number(match.countedLoose || 0));
        setMessage({ type: 'success', text: `+1 (${match.tradeName}) تم تسجيل: ${newPacks} علبة` });
      } else {
        // Focus on the pack input for that row
        const input = document.getElementById(`count-pack-${match.id}`);
        if (input) {
          input.focus();
          (input as HTMLInputElement).select?.();
        }
      }
      setScannedBarcode('');
    } else {
      setMessage({
        type: 'error',
        text: `لم يتم العثور على دواء بالباركود (${barcode}) في جلسة الجرد هذه`,
      });
      setScannedBarcode('');
    }
  };

  // 6. Reconcile Session
  const handleReconcile = async () => {
    if (!activeSessionId) return;

    setActionLoading(true);
    try {
      const res = await apiRequest<any>(`/stocktake/sessions/${activeSessionId}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ notes: reconcileNotes }),
      });

      setShowReconcileModal(false);
      setMessage({ type: 'success', text: res.message || 'تم اعتماد محضر الجرد وتسوية المخزن بنجاح!' });
      await fetchSessions();
      await fetchSessionDetails(activeSessionId);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل اعتماد التسوية' });
    } finally {
      setActionLoading(false);
    }
  };

  // 7. Delete draft session
  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('هل أنت متأكد من حذف جلسة الجرد هذه؟ لا يمكن التراجع عن هذا الإجراء.')) return;

    setActionLoading(true);
    try {
      await apiRequest<any>(`/stocktake/sessions/${sessionId}`, { method: 'DELETE' });
      setMessage({ type: 'success', text: 'تم حذف جلسة الجرد بنجاح' });
      await fetchSessions();
      if (activeSessionId === sessionId) {
        setActiveSessionId(sessions.find((s) => s.id !== sessionId)?.id || null);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل حذف الجلسة' });
    } finally {
      setActionLoading(false);
    }
  };

  // 8. Export to Excel
  const handleExportExcel = () => {
    if (!sessionData || !sessionData.items) return;

    const exportRows = sessionData.items.map((it: any, idx: number) => ({
      '#': idx + 1,
      'اسم الدواء': it.tradeName,
      'الاسم العلمي': it.scientificName || '',
      الباركود: it.barcode || '',
      الرف: it.shelfLocation || '',
      'أشرطة/علبة': it.unitsPerPack,
      'سعر الشراء': Number(it.purchasePricePack).toLocaleString(),
      'سعر البيع': Number(it.sellingPricePack).toLocaleString(),
      'رصيد النظام (علب)': it.systemPacks,
      'رصيد النظام (أشرطة)': it.systemLoose,
      'إجمالي وحدات النظام': it.systemUnits,
      'العد الفعلي (علب)': it.countedPacks,
      'العد الفعلي (أشرطة)': it.countedLoose,
      'إجمالي المعدود': it.countedTotalUnits,
      'فارق العلب': it.variancePacks,
      'أثر الكلفة (د.ع)': Number(it.varianceCost).toLocaleString(),
      'أثر البيع (د.ع)': Number(it.varianceRetail).toLocaleString(),
      الحالة:
        it.varianceStatus === 'MATCHED'
          ? 'مطابق'
          : it.varianceStatus === 'SHORTAGE'
          ? 'عجز / نقص'
          : it.varianceStatus === 'SURPLUS'
          ? 'زيادة'
          : 'غير مجرود',
    }));

    exportToExcel(
      exportRows,
      `تقرير_الجرد_${sessionData.session.title}_${new Date().toISOString().slice(0, 10)}`,
    );
  };

  // 9. Print Report
  const handlePrint = () => {
    window.print();
  };

  const session = sessionData?.session;
  const stats = sessionData?.stats || {};
  const isCompleted = session?.status === 'COMPLETED';

  return (
    <div className="flex flex-col gap-5 pb-16 print:p-0">
      {/* 1. Page Header & Control Banner */}
      <div className="bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
              <ClipboardCheck className="w-5 h-5 text-amber-300" />
            </div>
            <h1 className="text-xl font-black tracking-tight">الجرد الدوري والسنوي والتسوية المخزنية</h1>
            <span className="px-2.5 py-0.5 bg-amber-400/20 text-amber-300 border border-amber-400/30 rounded-full text-[11px] font-mono font-bold">
              Smart Stocktake & Audit
            </span>
          </div>
          <p className="text-xs text-indigo-200/90 pr-12">
            حصر الأرصدة الفعلية على الرفوف ومطابقتها بالنظام، كشف العجز والزيادة، واعتماد التسوية المخزنية بضغطة زر
          </p>
        </div>

        {/* Action Buttons Top */}
        <div className="flex flex-wrap items-center gap-2 self-end md:self-center shrink-0">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-md shadow-emerald-900/30 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>جلسة جرد جديدة</span>
          </button>

          <button
            onClick={() => setViewMode(viewMode === 'ACTIVE' ? 'ARCHIVE' : 'ACTIVE')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-black backdrop-blur-sm border border-white/10 transition-all cursor-pointer shadow-xs"
          >
            <History className="w-4 h-4 text-amber-300" />
            <span>{viewMode === 'ACTIVE' ? 'أرشيف الجرودات' : 'العودة للجلسة الحالية'}</span>
          </button>

          {viewMode === 'ACTIVE' && sessionData && (
            <>
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-black backdrop-blur-sm border border-white/10 transition-all cursor-pointer shadow-xs"
                title="تصدير كشف الجرد Excel"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
                <span>Excel</span>
              </button>

              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-black backdrop-blur-sm border border-white/10 transition-all cursor-pointer shadow-xs"
                title="طباعة محضر الجرد"
              >
                <Printer className="w-4 h-4 text-indigo-200" />
                <span>طباعة</span>
              </button>
            </>
          )}

          {onNavigateToInventory && (
            <button
              onClick={onNavigateToInventory}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-xs"
            >
              <Package className="w-4 h-4" />
              <span>المخزن</span>
            </button>
          )}
        </div>
      </div>

      {/* Notification Message */}
      {message && (
        <div
          className={`p-4 rounded-2xl flex items-center justify-between gap-2 text-xs font-black animate-in fade-in ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ARCHIVE MODE VIEW */}
      {viewMode === 'ARCHIVE' ? (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-indigo-600" />
              أرشيف جلسات الجرد السابقة والسنوية
            </h2>
            <span className="text-xs text-slate-500 font-bold">
              إجمالي الجلسات: {sessions.length}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <ClipboardCheck className="w-12 h-12 stroke-1 text-slate-300 mx-auto" />
              <p className="font-bold text-sm">لا توجد جلسات جرد سابقة حتى الآن</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                + إنشاء أول جلسة جرد
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sessions.map((s) => {
                const isSessCompleted = s.status === 'COMPLETED';
                return (
                  <div
                    key={s.id}
                    className={`p-5 rounded-2xl border transition-all cursor-pointer hover:shadow-md flex flex-col justify-between gap-4 ${
                      activeSessionId === s.id
                        ? 'bg-indigo-50/40 border-indigo-400 ring-2 ring-indigo-200'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                    onClick={() => {
                      setActiveSessionId(s.id);
                      setViewMode('ACTIVE');
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-black text-slate-900 text-sm">{s.title}</h3>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
                            isSessCompleted
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {isSessCompleted ? '✅ معتمد ومسوّى' : '⏳ قيد العد'}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-500 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>التاريخ: {new Date(s.createdAt).toLocaleDateString('ar-IQ')}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-slate-400" />
                          <span>
                            المواد المجرودة: <b>{s.totalCountedItems || 0}</b> من <b>{s.totalSystemItems || 0}</b>
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[10px]">
                        <div className="p-1.5 bg-rose-50 rounded-lg text-rose-800 font-bold">
                          <span>العجز: </span>
                          <span className="font-mono font-black">{Number(s.totalDeficitCost || 0).toLocaleString()} د.ع</span>
                        </div>
                        <div className="p-1.5 bg-blue-50 rounded-lg text-blue-800 font-bold">
                          <span>الزيادة: </span>
                          <span className="font-mono font-black">{Number(s.totalSurplusCost || 0).toLocaleString()} د.ع</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                      <span className="text-indigo-600 font-black flex items-center gap-1">
                        عرض التفاصيل ➔
                      </span>
                      {!isSessCompleted && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(s.id);
                          }}
                          className="text-rose-500 hover:text-rose-700 font-bold text-[11px] cursor-pointer"
                        >
                          إلغاء الجلسة
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ACTIVE SESSION VIEW */
        <div className="space-y-4">
          {session ? (
            <>
              {/* Session Meta Header & Live Progress Status */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h2 className="text-lg font-black text-slate-900">{session.title}</h2>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                          isCompleted
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                        }`}
                      >
                        {isCompleted ? '✅ معتمد ومسوّى في المخزن' : '⏳ جاري العد الفعلي (قيد التنفيذ)'}
                      </span>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-bold">
                        {session.type === 'ANNUAL'
                          ? 'جرد سنوي كامل'
                          : session.type === 'SEMI_ANNUAL'
                          ? 'جرد نصف سنوي'
                          : `جرد جزئي (${session.shelfFilter || 'رف محدد'})`}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium">
                      <span>أنشئت بواسطة: <b>{session.createdByName}</b></span>
                      <span>•</span>
                      <span>التاريخ: <b>{new Date(session.createdAt).toLocaleDateString('ar-IQ')}</b></span>
                      {session.reconciledAt && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-700 font-bold">
                            اعتمدت التسوية بواسطة {session.reconciledByName} في {new Date(session.reconciledAt).toLocaleDateString('ar-IQ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Reconcile Action Button for OWNER */}
                  <div className="flex items-center gap-2">
                    {!isCompleted ? (
                      <button
                        onClick={() => setShowReconcileModal(true)}
                        disabled={actionLoading}
                        className="px-5 py-2.5 bg-linear-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white rounded-2xl text-xs font-black shadow-md shadow-emerald-600/20 transition-all cursor-pointer flex items-center gap-2 active:scale-95"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>اعتماد محضر الجرد وتسوية المخزن 🚀</span>
                      </button>
                    ) : (
                      <div className="px-4 py-2 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-2xl text-xs font-black flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>تم ضبط أرصدة المخزن بنجاح</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Live KPI Variance Dashboard */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {/* Card 1: Progress */}
                  <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-right space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-500 block">نسبة الإنجاز</span>
                    <div className="text-lg font-black text-slate-900 font-mono">
                      {stats.progressPercent || 0}%
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full transition-all duration-300"
                        style={{ width: `${stats.progressPercent || 0}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 block font-mono">
                      {stats.countedItems} من {stats.totalItems} مادة
                    </span>
                  </div>

                  {/* Card 2: Shortage Count & Cost */}
                  <div
                    onClick={() => setSelectedStatus(selectedStatus === 'SHORTAGE' ? 'ALL' : 'SHORTAGE')}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer text-right space-y-1 ${
                      selectedStatus === 'SHORTAGE'
                        ? 'bg-rose-100 border-rose-300 ring-2 ring-rose-200'
                        : 'bg-rose-50/60 border-rose-200 hover:bg-rose-100/60'
                    }`}
                  >
                    <span className="text-[11px] font-black text-rose-800 flex items-center justify-between">
                      <span>عجز ونقص 🔴</span>
                      <span className="font-mono bg-rose-200/60 px-1.5 py-0.2 rounded-md">
                        {stats.shortageItems || 0}
                      </span>
                    </span>
                    <div className="text-base font-black text-rose-950 font-mono">
                      -{(stats.totalDeficitCost || 0).toLocaleString()} د.ع
                    </div>
                    <span className="text-[10px] text-rose-600 font-bold block">
                      بسعر الشراء (الكلفة)
                    </span>
                  </div>

                  {/* Card 3: Surplus Count & Cost */}
                  <div
                    onClick={() => setSelectedStatus(selectedStatus === 'SURPLUS' ? 'ALL' : 'SURPLUS')}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer text-right space-y-1 ${
                      selectedStatus === 'SURPLUS'
                        ? 'bg-blue-100 border-blue-300 ring-2 ring-blue-200'
                        : 'bg-blue-50/60 border-blue-200 hover:bg-blue-100/60'
                    }`}
                  >
                    <span className="text-[11px] font-black text-blue-800 flex items-center justify-between">
                      <span>فائض وزيادة 🔵</span>
                      <span className="font-mono bg-blue-200/60 px-1.5 py-0.2 rounded-md">
                        {stats.surplusItems || 0}
                      </span>
                    </span>
                    <div className="text-base font-black text-blue-950 font-mono">
                      +{(stats.totalSurplusCost || 0).toLocaleString()} د.ع
                    </div>
                    <span className="text-[10px] text-blue-600 font-bold block">
                      بضائع غير مسجلة
                    </span>
                  </div>

                  {/* Card 4: Matched */}
                  <div
                    onClick={() => setSelectedStatus(selectedStatus === 'MATCHED' ? 'ALL' : 'MATCHED')}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer text-right space-y-1 ${
                      selectedStatus === 'MATCHED'
                        ? 'bg-emerald-100 border-emerald-300 ring-2 ring-emerald-200'
                        : 'bg-emerald-50/60 border-emerald-200 hover:bg-emerald-100/60'
                    }`}
                  >
                    <span className="text-[11px] font-black text-emerald-800 flex items-center justify-between">
                      <span>مطابق تماماً 🟢</span>
                      <span className="font-mono bg-emerald-200/60 px-1.5 py-0.2 rounded-md">
                        {stats.matchedItems || 0}
                      </span>
                    </span>
                    <div className="text-base font-black text-emerald-950 font-mono">
                      {stats.matchedItems || 0} مادة
                    </div>
                    <span className="text-[10px] text-emerald-600 font-bold block">
                      دقة 100%
                    </span>
                  </div>

                  {/* Card 5: Uncounted */}
                  <div
                    onClick={() => setSelectedStatus(selectedStatus === 'UNCOUNTED' ? 'ALL' : 'UNCOUNTED')}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer text-right space-y-1 ${
                      selectedStatus === 'UNCOUNTED'
                        ? 'bg-slate-200 border-slate-400 ring-2 ring-slate-300'
                        : 'bg-slate-100 border-slate-200 hover:bg-slate-200/60'
                    }`}
                  >
                    <span className="text-[11px] font-bold text-slate-600 flex items-center justify-between">
                      <span>بانتظار العد ⚪</span>
                      <span className="font-mono bg-slate-300/60 px-1.5 py-0.2 rounded-md">
                        {stats.uncountedItems || 0}
                      </span>
                    </span>
                    <div className="text-base font-black text-slate-800 font-mono">
                      {stats.uncountedItems || 0} مادة
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold block">
                      متبقية للجرد
                    </span>
                  </div>

                  {/* Card 6: Net Variance */}
                  <div
                    className={`p-3.5 rounded-2xl border text-right space-y-1 ${
                      (stats.netVarianceCost || 0) < 0
                        ? 'bg-amber-50/60 border-amber-300'
                        : 'bg-indigo-50/60 border-indigo-200'
                    }`}
                  >
                    <span className="text-[11px] font-black text-slate-700 flex items-center gap-1">
                      <Scale className="w-3.5 h-3.5 text-indigo-600" />
                      صافي الفرق المالي
                    </span>
                    <div
                      className={`text-base font-black font-mono ${
                        (stats.netVarianceCost || 0) < 0 ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {Number(stats.netVarianceCost || 0).toLocaleString()} د.ع
                    </div>
                    <span className="text-[10px] text-slate-500 font-bold block">
                      {(stats.netVarianceCost || 0) < 0 ? 'عجز مالي صافي' : 'فائض مالي صافي'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Fast Barcode Scanner & Filters Bar */}
              <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  {/* Fast Barcode Scanner Input */}
                  <div className="md:col-span-5">
                    <form onSubmit={handleBarcodeSubmit} className="relative">
                      <Barcode className="w-5 h-5 absolute right-3.5 top-3 text-indigo-600" />
                      <input
                        ref={barcodeInputRef}
                        type="text"
                        value={scannedBarcode}
                        onChange={(e) => setScannedBarcode(e.target.value)}
                        placeholder="امسح الباركود للقراءة السريعة أو اكتبه واضغط Enter..."
                        className="w-full pr-11 pl-4 py-2.5 bg-indigo-50/30 border border-indigo-200 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                      />
                    </form>
                  </div>

                  {/* Rapid Scan Beep (+1) Mode Toggle */}
                  <div className="md:col-span-3">
                    <button
                      type="button"
                      onClick={() => setRapidScanMode(!rapidScanMode)}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-black border transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        rapidScanMode
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm ring-2 ring-emerald-300'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                      title="عند التفعيل: كل ضربة باركود تزيد العلبة تلقائياً +1 دون فتح حقول الإدخال"
                    >
                      <Barcode className="w-4 h-4" />
                      <span>{rapidScanMode ? '⚡ مسح سريع متتابع (+1)' : 'مسح عادي (تحديد المادة)'}</span>
                    </button>
                  </div>

                  {/* Search Text */}
                  <div className="md:col-span-4 relative">
                    <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="ابحث بالاسم التجاري أو العلمي..."
                      className="w-full pr-9 pl-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Second Line: Shelves & Blind Count Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs font-bold">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Shelf Filter */}
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-600">الرف:</span>
                      <select
                        value={selectedShelf}
                        onChange={(e) => setSelectedShelf(e.target.value)}
                        className="bg-transparent text-slate-900 font-bold focus:outline-hidden cursor-pointer"
                      >
                        <option value="ALL">كافة الرفوف</option>
                        {sessionData.availableShelves?.map((sh: string) => (
                          <option key={sh} value={sh}>
                            الرف ({sh})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Status Filter */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                      {[
                        { key: 'ALL', label: 'الكل' },
                        { key: 'SHORTAGE', label: '🔴 عجز' },
                        { key: 'SURPLUS', label: '🔵 زيادة' },
                        { key: 'MATCHED', label: '🟢 مطابق' },
                        { key: 'UNCOUNTED', label: '⚪ لم يُجرد' },
                      ].map((st) => (
                        <button
                          key={st.key}
                          type="button"
                          onClick={() => setSelectedStatus(st.key)}
                          className={`px-2.5 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                            selectedStatus === st.key
                              ? 'bg-white text-slate-900 shadow-2xs font-black'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Blind Count Toggle (إخفاء رصيد النظام لضمان النزاهة) */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setBlindCount(!blindCount)}
                      className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold ${
                        blindCount
                          ? 'bg-purple-50 text-purple-800 border-purple-300 ring-2 ring-purple-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                      title="إخفاء رصيد النظام عن الموظف لضمان العد الفعلي دون تحيز أو تخمين"
                    >
                      {blindCount ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5 text-purple-600" />
                          <span>الجرد الأعمى (رصيد النظام مخفي 👁️)</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5 text-slate-400" />
                          <span>إظهار رصيد النظام للعد</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* 4. Interactive Items Counting Table */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden print:border-none print:shadow-none">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 text-[11px] text-slate-500 font-black uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="p-3 w-10 text-center">#</th>
                        <th className="p-3 min-w-[180px]">الدواء</th>
                        <th className="p-3 w-28">الباركود</th>
                        <th className="p-3 w-20 text-center">الرف</th>
                        <th className="p-3 w-20 text-center">الشريط/علبة</th>
                        {!blindCount && (
                          <th className="p-3 w-28 text-center bg-slate-100/70 text-slate-800 font-black">
                            رصيد النظام
                          </th>
                        )}
                        <th className="p-3 min-w-[180px] bg-indigo-50/70 text-indigo-950 font-black text-center">
                          العد الفعلي على الرف (علب + أشرطة)
                        </th>
                        <th className="p-3 w-24 text-center">الفارق</th>
                        <th className="p-3 w-28">أثر الكلفة</th>
                        <th className="p-3 w-24 text-center">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {loading ? (
                        <tr>
                          <td colSpan={10} className="p-16 text-center text-slate-400">
                            <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                            <span className="font-bold">جاري تحميل مواد جلسة الجرد...</span>
                          </td>
                        </tr>
                      ) : sessionData.items?.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="p-16 text-center text-slate-400">
                            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                            <p className="font-bold text-slate-700">لا توجد مواد مطابقة للبحث أو الفلتر</p>
                          </td>
                        </tr>
                      ) : (
                        sessionData.items.map((it: any, idx: number) => {
                          const isShortage = it.varianceStatus === 'SHORTAGE';
                          const isSurplus = it.varianceStatus === 'SURPLUS';
                          const isMatched = it.varianceStatus === 'MATCHED';
                          const isUncounted = it.varianceStatus === 'UNCOUNTED';

                          return (
                            <tr
                              key={it.id}
                              className={`transition-colors ${
                                isShortage
                                  ? 'bg-rose-50/40 hover:bg-rose-50/70'
                                  : isSurplus
                                  ? 'bg-blue-50/40 hover:bg-blue-50/70'
                                  : isMatched
                                  ? 'bg-emerald-50/20 hover:bg-emerald-50/50'
                                  : 'hover:bg-slate-50/70'
                              }`}
                            >
                              <td className="p-3 text-center text-slate-400 font-mono">{idx + 1}</td>

                              {/* Medicine Name */}
                              <td className="p-3">
                                <div className="font-black text-slate-900 text-xs">{it.tradeName}</div>
                                {it.scientificName && (
                                  <div className="text-[10px] text-slate-500 font-mono truncate max-w-[190px]">
                                    {it.scientificName}
                                  </div>
                                )}
                              </td>

                              {/* Barcode */}
                              <td className="p-3 font-mono text-[11px] text-slate-600">
                                {it.barcode || '—'}
                              </td>

                              {/* Shelf Location */}
                              <td className="p-3 text-center">
                                {it.shelfLocation ? (
                                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded text-[10px] font-mono font-bold">
                                    {it.shelfLocation}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 text-[10px]">غير محدد</span>
                                )}
                              </td>

                              {/* Units per pack */}
                              <td className="p-3 text-center font-bold text-slate-600">
                                {it.unitsPerPack}
                              </td>

                              {/* Theoretical System Stock (Hidden if Blind Count) */}
                              {!blindCount && (
                                <td className="p-3 text-center bg-slate-100/40 font-mono">
                                  <b className="text-slate-900 text-xs font-black">{it.systemPacks} علبة</b>
                                  {it.systemLoose > 0 && (
                                    <span className="text-[10px] text-slate-500 block font-bold">
                                      + {it.systemLoose} شريط
                                    </span>
                                  )}
                                </td>
                              )}

                              {/* Actual Physical Count Inputs */}
                              <td className="p-2 bg-indigo-50/30">
                                <div className="flex items-center justify-center gap-1.5">
                                  <div className="flex items-center gap-1">
                                    <input
                                      id={`count-pack-${it.id}`}
                                      type="number"
                                      min="0"
                                      disabled={isCompleted}
                                      value={it.countedPacks !== undefined ? it.countedPacks : ''}
                                      onChange={(e) => {
                                        const p = Math.max(0, parseInt(e.target.value, 10) || 0);
                                        handleSaveCount(it.id, p, it.countedLoose || 0);
                                      }}
                                      placeholder="علب"
                                      className="w-16 px-2 py-1.5 bg-white border border-indigo-200 rounded-lg text-xs font-black text-center text-indigo-950 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden disabled:bg-slate-100"
                                    />
                                    <span className="text-[10px] text-slate-500 font-bold">علبة</span>
                                  </div>

                                  {it.unitsPerPack > 1 && (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min="0"
                                        max={it.unitsPerPack - 1}
                                        disabled={isCompleted}
                                        value={it.countedLoose !== undefined ? it.countedLoose : ''}
                                        onChange={(e) => {
                                          const l = Math.max(0, parseInt(e.target.value, 10) || 0);
                                          handleSaveCount(it.id, it.countedPacks || 0, l);
                                        }}
                                        placeholder="أشرطة"
                                        className="w-12 px-1.5 py-1.5 bg-white border border-indigo-200 rounded-lg text-xs font-black text-center text-blue-950 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden disabled:bg-slate-100"
                                      />
                                      <span className="text-[10px] text-slate-500 font-bold">شريط</span>
                                    </div>
                                  )}

                                  {/* Quick Mark Matched button */}
                                  {!isCompleted && isUncounted && (
                                    <button
                                      type="button"
                                      onClick={() => handleSaveCount(it.id, it.systemPacks, it.systemLoose)}
                                      className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-black transition-all cursor-pointer"
                                      title="تأكيد مطابقة رصيد النظام"
                                    >
                                      مطابق ✓
                                    </button>
                                  )}
                                </div>
                              </td>

                              {/* Variance */}
                              <td className="p-3 text-center font-mono font-black text-xs">
                                {isUncounted ? (
                                  <span className="text-slate-300">—</span>
                                ) : isMatched ? (
                                  <span className="text-emerald-600 font-bold">0</span>
                                ) : (
                                  <span
                                    className={`inline-flex items-center gap-0.5 ${
                                      isShortage ? 'text-rose-600' : 'text-blue-600'
                                    }`}
                                  >
                                    {isShortage ? (
                                      <ArrowDownLeft className="w-3 h-3" />
                                    ) : (
                                      <ArrowUpRight className="w-3 h-3" />
                                    )}
                                    {it.variancePacks > 0 ? `+${it.variancePacks}` : it.variancePacks}
                                  </span>
                                )}
                              </td>

                              {/* Variance Cost Impact */}
                              <td className="p-3 font-mono font-bold text-xs">
                                {isUncounted ? (
                                  <span className="text-slate-300">—</span>
                                ) : isMatched ? (
                                  <span className="text-slate-400">0 د.ع</span>
                                ) : (
                                  <span
                                    className={`font-black ${
                                      isShortage ? 'text-rose-700' : 'text-blue-700'
                                    }`}
                                  >
                                    {it.varianceCost > 0
                                      ? `+${Number(it.varianceCost).toLocaleString()}`
                                      : Number(it.varianceCost).toLocaleString()}{' '}
                                    د.ع
                                  </span>
                                )}
                              </td>

                              {/* Status Badge */}
                              <td className="p-3 text-center">
                                {isMatched && (
                                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-md text-[10px] font-black">
                                    مطابق 🟢
                                  </span>
                                )}
                                {isShortage && (
                                  <span className="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded-md text-[10px] font-black">
                                    عجز 🔴
                                  </span>
                                )}
                                {isSurplus && (
                                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 border border-blue-300 rounded-md text-[10px] font-black">
                                    زيادة 🔵
                                  </span>
                                )}
                                {isUncounted && (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-bold">
                                    غير مجرود ⚪
                                  </span>
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
            </>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 space-y-3">
              <ClipboardCheck className="w-12 h-12 stroke-1 text-slate-300 mx-auto" />
              <h3 className="font-black text-slate-700 text-base">لا توجد جلسة جرد نشطة حالياً</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                ابدأ جلسة جرد سنوي أو نصف سنوي لحصر الكميات الفعلية والتسوية.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black shadow-md cursor-pointer transition-all"
              >
                + إنشاء جلسة جرد جديدة
              </button>
            </div>
          )}
        </div>
      )}

      {/* CREATE STOCKTAKE SESSION MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-amber-300" />
                <h3 className="font-black text-sm">بدء جلسة جرد جديدة</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-white/20 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="p-6 space-y-4 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">عنوان الجلسة *</label>
                <input
                  type="text"
                  required
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  placeholder="مثال: الجرد السنوي لعام 2026"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1">نوع الجرد</label>
                  <select
                    value={createForm.type}
                    onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden cursor-pointer"
                  >
                    <option value="ANNUAL">جرد سنوي شامل</option>
                    <option value="SEMI_ANNUAL">جرد نصف سنوي</option>
                    <option value="PARTIAL">جرد جزئي (قسم/رف)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 mb-1">تحديد رف معين (اختياري)</label>
                  <input
                    type="text"
                    value={createForm.shelfFilter}
                    onChange={(e) => setCreateForm({ ...createForm, shelfFilter: e.target.value })}
                    placeholder="فارغ للكل أو مثل: A-01"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1">ملاحظات / فريق الجرد (اختياري)</label>
                <textarea
                  rows={2}
                  value={createForm.notes}
                  onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                  placeholder="فريق العمل، توجيهات الجرد..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-hidden"
                />
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                ℹ️ <b>ملاحظة هامة:</b> عند إنشاء الجلسة، سيلتقط النظام نسخة فورية من الأرصدة الدفترية الحالية للأدوية لتكون مرجع المقارنة، ويمكنك العد براحة تامة دون إيقاف المبيعات في الكاشير.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? 'جاري الإنشاء...' : 'بدء جلسة الجرد 🚀'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECONCILE & APPLY CONFIRMATION MODAL */}
      {showReconcileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-5 bg-linear-to-r from-emerald-800 to-teal-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                <h3 className="font-black text-sm">اعتماد محضر الجرد وتسوية المخزن</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReconcileModal(false)}
                className="p-1 hover:bg-white/20 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs font-bold">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">المواد المجرودة:</span>
                  <span className="font-mono font-black text-slate-900">
                    {stats.countedItems} من {stats.totalItems} مادة
                  </span>
                </div>
                <div className="flex items-center justify-between text-rose-700">
                  <span>إجمالي العجز المالي (كلفة):</span>
                  <span className="font-mono font-black">
                    -{(stats.totalDeficitCost || 0).toLocaleString()} د.ع
                  </span>
                </div>
                <div className="flex items-center justify-between text-blue-700">
                  <span>إجمالي الفائض المالي (كلفة):</span>
                  <span className="font-mono font-black">
                    +{(stats.totalSurplusCost || 0).toLocaleString()} د.ع
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between font-black text-sm">
                  <span>صافي أثر التسوية:</span>
                  <span className={(stats.netVarianceCost || 0) < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                    {Number(stats.netVarianceCost || 0).toLocaleString()} د.ع
                  </span>
                </div>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 text-[11px] leading-relaxed space-y-1">
                <p>
                  ✅ <b>ماذا سيحدث بعد الاعتماد؟</b>
                </p>
                <p>
                  سيقوم النظام تلقائياً بتحديث كميات المخزن لتصبح مساوية للأرقام المعدودة فعلياً 100%، وقفل الجلسة وإصدار المحضر الرسمي المؤرشف.
                </p>
              </div>

              <div>
                <label className="block text-slate-700 mb-1">ملاحظات الاعتماد الختامية (اختياري)</label>
                <textarea
                  rows={2}
                  value={reconcileNotes}
                  onChange={(e) => setReconcileNotes(e.target.value)}
                  placeholder="ملاحظات الصيدلي المسؤول..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowReconcileModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  تراجع
                </button>
                <button
                  type="button"
                  onClick={handleReconcile}
                  disabled={actionLoading}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-200 cursor-pointer disabled:opacity-50 transition-all"
                >
                  {actionLoading ? 'جاري التسوية...' : 'تأكيد الاعتماد وضبط المخزن 🚀'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
