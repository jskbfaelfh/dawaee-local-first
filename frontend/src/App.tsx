import React, { useState, useEffect } from 'react';
import {
  ShoppingCart,
  PackagePlus,
  Package,
  TrendingUp,
  ShieldCheck,
  Search,
  LogOut,
  Pill,
  UserCheck,
  Settings,
  Banknote,
  FileText,
  TrendingDown,
  LayoutDashboard,
  Menu,
  X,
  Building2,
  ChevronDown,
  RefreshCw,
  Pin,
  PinOff,
  Clock,
  ClipboardCheck,
} from 'lucide-react';
import { PosView } from './views/PosView';
import { BulkStockEntryView } from './views/BulkStockEntryView';
import { InventoryView } from './views/InventoryView';
import { ExpiryView } from './views/ExpiryView';
import { StocktakeView } from './views/StocktakeView';
import { PurchasesView } from './views/PurchasesView';
import { ExpensesView } from './views/ExpensesView';
import { OwnerMobileDashboardView } from './views/OwnerMobileDashboardView';
import { ReportsView } from './views/ReportsView';
import { SuperAdminView } from './views/SuperAdminView';
import { PublicSearchView } from './views/PublicSearchView';
import { PharmacyProfileView } from './views/PharmacyProfileView';
import { SuppliersDebtView } from './views/SuppliersDebtView';
import { ChainManagementView } from './views/ChainManagementView';
import { LoginView } from './views/LoginView';
import { ProactiveAlertsModal } from './components/ProactiveAlertsModal';
import {
  getAuthToken,
  setAuthToken,
  getStoredUser,
  getStoredPharmacy,
  getStoredBranches,
  setStoredBranches,
  clearAuthToken,
  apiRequest,
} from './api/client';

type ActiveTab =
  | 'POS'
  | 'BULK_STOCK'
  | 'INVENTORY'
  | 'EXPIRY'
  | 'STOCKTAKE'
  | 'PURCHASES'
  | 'EXPENSES'
  | 'CHAIN'
  | 'OWNER_DASHBOARD'
  | 'SUPPLIERS'
  | 'REPORTS'
  | 'PROFILE'
  | 'ADMIN'
  | 'PUBLIC_SEARCH'
  | 'LOGIN';

const getInitialTab = (): ActiveTab => {
  try {
    const path = (window.location.pathname || '').toLowerCase();
    const hash = (window.location.hash || '').toLowerCase();
    const search = (window.location.search || '').toLowerCase();

    const isLoginUrl =
      path === '/login' ||
      path.startsWith('/login') ||
      hash === '#login' ||
      hash.startsWith('#login') ||
      search.includes('login') ||
      search.includes('tab=login');

    const isSearchUrl =
      path === '/search' ||
      hash === '#search' ||
      search.includes('search');

    const token = getAuthToken();
    const user = getStoredUser();

    if (isLoginUrl) {
      return 'LOGIN';
    }

    if (token && user) {
      if (isSearchUrl) return 'PUBLIC_SEARCH';
      return user.role === 'SUPER_ADMIN' ? 'ADMIN' : 'POS';
    }

    return 'PUBLIC_SEARCH';
  } catch {
    return 'PUBLIC_SEARCH';
  }
};

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any | null>(getStoredUser());
  const [currentPharmacy, setCurrentPharmacy] = useState<any | null>(getStoredPharmacy());
  const [branches, setBranches] = useState<any[]>(getStoredBranches());
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState<boolean>(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(getInitialTab);

  // Sync browser URL & listen to Back/Forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(getInitialTab());
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  const navigateToTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    try {
      if (tab === 'LOGIN') {
        if (window.location.pathname !== '/login' && window.location.hash !== '#login') {
          window.history.pushState(null, '', '/login');
        }
      } else if (tab === 'PUBLIC_SEARCH') {
        if (window.location.pathname === '/login') {
          window.history.pushState(null, '', '/');
        }
      } else {
        if (window.location.pathname === '/login') {
          window.history.pushState(null, '', '/');
        }
      }
    } catch {
      // Fallback
    }
  };

  // Sidebar state:
  // isSidebarPinned: false by default (hidden completely off-canvas as requested)
  // isSidebarOpen: controls the sliding drawer
  const [isSidebarPinned, setIsSidebarPinned] = useState<boolean>(() => {
    return localStorage.getItem('dawaee_sidebar_pinned') === 'true';
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Proactive Alerts State
  const [expiringAlerts, setExpiringAlerts] = useState<any[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<any[]>([]);
  const [showAlertModal, setShowAlertModal] = useState<boolean>(false);

  // Close drawer on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSidebarOpen && !isSidebarPinned) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen, isSidebarPinned]);

  // Proactive alert check on startup
  useEffect(() => {
    if (currentUser && currentUser.role !== 'SUPER_ADMIN') {
      const alreadyChecked = sessionStorage.getItem('dawaee_alerts_dismissed');
      if (!alreadyChecked) {
        Promise.all([
          apiRequest<any[]>('/inventory/expiring-soon').catch(() => []),
          apiRequest<any[]>('/inventory/low-stock').catch(() => []),
        ]).then(([expiring, lowStock]) => {
          if ((expiring && expiring.length > 0) || (lowStock && lowStock.length > 0)) {
            setExpiringAlerts(expiring || []);
            setLowStockAlerts(lowStock || []);
            setShowAlertModal(true);
            sessionStorage.setItem('dawaee_alerts_dismissed', 'true');
          }
        });
      }
    }
  }, [currentUser]);

  const handleLoginSuccess = (user: any, pharmacy?: any, branchList?: any[]) => {
    setCurrentUser(user);
    setCurrentPharmacy(pharmacy || null);
    if (branchList) {
      setBranches(branchList);
    }

    if (user.role === 'SUPER_ADMIN') {
      navigateToTab('ADMIN');
    } else {
      navigateToTab('POS');
    }
  };

  const handleSwitchBranch = async (targetTenantId: string) => {
    if (isSwitchingBranch) return;
    setIsSwitchingBranch(true);
    setIsBranchDropdownOpen(false);

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
        setBranches(res.branches);
      }

      setCurrentUser(res.user);
      setCurrentPharmacy(res.pharmacy);
    } catch (err: any) {
      alert(err.message || 'فشل التبديل إلى الفرع المحدد');
    } finally {
      setIsSwitchingBranch(false);
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    localStorage.removeItem('dawaee_branches');
    setCurrentUser(null);
    setCurrentPharmacy(null);
    setBranches([]);
    navigateToTab('LOGIN');
  };

  // If viewing public search screen (Pure Public Portal)
  if (activeTab === 'PUBLIC_SEARCH') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col">
        {currentUser && (
          <div className="bg-slate-900 border-b border-slate-800 px-6 py-2.5 flex items-center justify-between text-xs z-50">
            <span className="text-slate-400 font-bold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              معاينة شبكة البحث العامة للمواطنين (حساب الصيدلية نشط)
            </span>
            <button
              onClick={() => navigateToTab(currentUser.role === 'SUPER_ADMIN' ? 'ADMIN' : 'POS')}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs transition-all shadow-xs cursor-pointer"
            >
              العودة لإدارة الصيدلية
            </button>
          </div>
        )}

        <PublicSearchView onNavigateToLogin={() => navigateToTab('LOGIN')} />
      </div>
    );
  }

  // If viewing Login screen
  if (activeTab === 'LOGIN') {
    return (
      <LoginView
        onLoginSuccess={handleLoginSuccess}
        onNavigateToSearch={() => navigateToTab('PUBLIC_SEARCH')}
      />
    );
  }

  // Helper navigation item component
  const NavItem = ({
    tab,
    label,
    icon: Icon,
    badge,
    activeColor = 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30',
  }: {
    tab: ActiveTab;
    label: string;
    icon: any;
    badge?: string;
    activeColor?: string;
  }) => {
    const isActive = activeTab === tab;
    return (
      <button
        onClick={() => {
          navigateToTab(tab);
          if (!isSidebarPinned) {
            setIsSidebarOpen(false);
          }
        }}
        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all duration-150 cursor-pointer group relative ${
          isActive
            ? activeColor
            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
        }`}
      >
        <div className="flex items-center gap-3 truncate min-w-0">
          <Icon
            className={`w-5 h-5 shrink-0 transition-transform group-hover:scale-110 ${
              isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
            }`}
          />
          <span className="truncate">{label}</span>
        </div>
        {badge && (
          <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
            {badge}
          </span>
        )}
      </button>
    );
  };

  const SectionHeading = ({ title }: { title: string }) => {
    return (
      <div className="text-[10px] font-black text-slate-400 px-3 pt-3 pb-1 tracking-wider uppercase">
        {title}
      </div>
    );
  };

  return (
    <div className="h-screen w-full max-w-full bg-slate-100 flex flex-row text-slate-900 font-sans antialiased overflow-x-hidden">
      {/* Backdrop Overlay (when sidebar drawer is open and unpinned) */}
      {!isSidebarPinned && isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-40 animate-in fade-in duration-200"
        />
      )}

      {/* Sidebar: Either Docked (Pinned) or Off-Canvas Drawer (Unpinned / Hidden) */}
      <aside
        className={`h-screen bg-slate-900 text-white flex flex-col justify-between border-l border-slate-800 shrink-0 select-none shadow-2xl transition-all duration-300 ease-in-out ${
          isSidebarPinned
            ? 'w-64 static z-30'
            : `fixed top-0 bottom-0 right-0 z-50 w-72 ${
                isSidebarOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
              }`
        }`}
      >
        {/* Top Logo & Drawer Actions */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 overflow-hidden">
            {currentPharmacy?.logoUrl ? (
              <img
                src={currentPharmacy.logoUrl}
                alt="Logo"
                className="w-8 h-8 rounded-xl object-contain bg-white p-0.5 shadow-md shrink-0"
              />
            ) : (
              <div className="w-8 h-8 bg-emerald-600 text-white rounded-xl flex items-center justify-center font-black shadow-md shrink-0">
                <Pill className="w-4 h-4" />
              </div>
            )}

            <div className="truncate">
              <div className="font-black text-xs text-white flex items-center gap-1.5">
                <span>{currentPharmacy?.name || 'نظام دوائي'}</span>
              </div>
              <div className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>متصل بالسحابة</span>
              </div>
            </div>
          </div>

          {/* Pin & Close Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setIsSidebarPinned((prev) => {
                  const next = !prev;
                  localStorage.setItem('dawaee_sidebar_pinned', String(next));
                  return next;
                });
              }}
              className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                isSidebarPinned
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title={isSidebarPinned ? 'إلغاء التثبيت (إخفاء تلقائي كامل)' : 'تثبيت القائمة دائماً'}
            >
              {isSidebarPinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              title="إغلاق القائمة"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1 no-scrollbar">
          {currentUser?.role === 'SUPER_ADMIN' ? (
            <>
              <SectionHeading title="الإدارة العامة" />
              <NavItem
                tab="ADMIN"
                label="لوحة تحكم المنصة"
                icon={ShieldCheck}
                activeColor="bg-indigo-600 text-white shadow-md shadow-indigo-900/30"
              />
            </>
          ) : (
            <>
              {/* Sales & POS */}
              <SectionHeading title="المبيعات" />
              <NavItem
                tab="POS"
                label="الكاشير"
                icon={ShoppingCart}
                badge="رئيسي"
                activeColor="bg-emerald-600 text-white shadow-md shadow-emerald-900/30"
              />

              {/* Warehouse & Inventory */}
              <SectionHeading title="المخزن والمشتريات" />
              <NavItem
                tab="INVENTORY"
                label="المخزن"
                icon={Package}
                activeColor="bg-indigo-600 text-white shadow-md shadow-indigo-900/30"
              />
              <NavItem
                tab="EXPIRY"
                label="الإكسباير"
                icon={Clock}
                activeColor="bg-purple-600 text-white shadow-md shadow-purple-900/30"
              />
              <NavItem
                tab="STOCKTAKE"
                label="الجرد والتسوية"
                icon={ClipboardCheck}
                badge="جديد"
                activeColor="bg-teal-600 text-white shadow-md shadow-teal-900/30"
              />
              <NavItem
                tab="PURCHASES"
                label="المشتريات"
                icon={FileText}
                activeColor="bg-blue-600 text-white shadow-md shadow-blue-900/30"
              />
              <NavItem
                tab="BULK_STOCK"
                label="إدخال وجبة"
                icon={PackagePlus}
                activeColor="bg-indigo-600 text-white shadow-md shadow-indigo-900/30"
              />

              {/* Financial & Accounts */}
              {currentUser?.role === 'OWNER' && (
                <>
                  <SectionHeading title="المالية" />
                  <NavItem
                    tab="EXPENSES"
                    label="المصاريف"
                    icon={TrendingDown}
                    activeColor="bg-rose-600 text-white shadow-md shadow-rose-900/30"
                  />
                  <NavItem
                    tab="SUPPLIERS"
                    label="المذاخر والديون"
                    icon={Banknote}
                    activeColor="bg-amber-600 text-white shadow-md shadow-amber-900/30"
                  />
                  <NavItem
                    tab="REPORTS"
                    label="التقارير"
                    icon={TrendingUp}
                    activeColor="bg-indigo-600 text-white shadow-md shadow-indigo-900/30"
                  />
                </>
              )}

              {/* Management & Live Monitoring */}
              {currentUser?.role === 'OWNER' && (
                <>
                  <SectionHeading title="المتابعة والإعدادات" />
                  <NavItem
                    tab="CHAIN"
                    label="الفروع"
                    icon={Building2}
                    badge={branches.length > 1 ? `${branches.length} فروع` : undefined}
                    activeColor="bg-indigo-600 text-white shadow-md shadow-indigo-900/30"
                  />
                  <NavItem
                    tab="OWNER_DASHBOARD"
                    label="المتابعة"
                    icon={LayoutDashboard}
                    activeColor="bg-slate-800 border border-slate-700 text-emerald-400 shadow-md"
                  />
                  <NavItem
                    tab="PROFILE"
                    label="الإعدادات"
                    icon={Settings}
                    activeColor="bg-slate-700 text-white shadow-md"
                  />
                </>
              )}
            </>
          )}

          {/* Public Search Portal preview */}
          <SectionHeading title="بحث الأدوية" />
          <NavItem
            tab="PUBLIC_SEARCH"
            label="بحث الأدوية"
            icon={Search}
            activeColor="bg-teal-600 text-white shadow-md"
          />
        </div>

        {/* User Card & Logout Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/50 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">
                <UserCheck className="w-4 h-4" />
              </div>
              <div className="truncate min-w-0">
                <div className="text-xs font-bold text-slate-200 truncate">
                  {currentUser?.name || 'المستخدم'}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {currentUser?.role === 'OWNER'
                    ? 'صاحب الصيدلية'
                    : currentUser?.role === 'SUPER_ADMIN'
                    ? 'المدير العام'
                    : 'كاشير الصيدلية'}
                </div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-xl transition-colors cursor-pointer shrink-0"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area (Fixed Top Header + Scrollable Content) */}
      <div className="flex-1 flex flex-col h-screen min-w-0 max-w-full overflow-hidden bg-slate-100">
        {/* Slim Fixed Top Bar */}
        <header className="bg-white border-b border-slate-200/90 h-14 px-3 sm:px-5 flex items-center justify-between shrink-0 shadow-2xs w-full max-w-full">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Hamburger Toggle Button (opens off-canvas drawer) */}
            {(!isSidebarPinned || !isSidebarOpen) && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 text-slate-700 hover:text-indigo-600 hover:bg-slate-100 rounded-xl cursor-pointer shrink-0 transition-all flex items-center gap-1.5 active:scale-95 border border-slate-200/80 shadow-2xs"
                title="فتح القائمة الرئيسية"
              >
                <Menu className="w-5 h-5" />
                <span className="text-xs font-bold hidden sm:inline text-slate-700">القائمة</span>
              </button>
            )}

            {/* Current Active Page Title & Breadcrumb */}
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 min-w-0">
              <span className="text-slate-400 hidden lg:inline truncate">{currentPharmacy?.name || 'دوائي'}</span>
              <span className="text-slate-300 hidden lg:inline">/</span>
              <span className="text-slate-900 font-black truncate text-xs sm:text-sm">
                {activeTab === 'POS' && 'الكاشير'}
                {activeTab === 'INVENTORY' && 'المخزن'}
                {activeTab === 'PURCHASES' && 'المشتريات'}
                {activeTab === 'BULK_STOCK' && 'إدخال وجبة'}
                {activeTab === 'EXPENSES' && 'المصاريف'}
                {activeTab === 'CHAIN' && 'الفروع'}
                {activeTab === 'SUPPLIERS' && 'المذاخر والديون'}
                {activeTab === 'REPORTS' && 'التقارير'}
                {activeTab === 'OWNER_DASHBOARD' && 'المتابعة'}
                {activeTab === 'PROFILE' && 'الإعدادات'}
                {activeTab === 'ADMIN' && 'لوحة التحكم'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Branch Switcher Dropdown (For Owner with multiple branches or chain) */}
            {currentUser?.role === 'OWNER' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsBranchDropdownOpen(!isBranchDropdownOpen)}
                  className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200/80 rounded-xl text-xs font-black transition-all cursor-pointer shadow-2xs active:scale-95"
                >
                  <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span className="max-w-[80px] sm:max-w-[140px] truncate">
                    {currentPharmacy?.name || 'الفرع الحالي'}
                  </span>
                  {branches.length > 1 && (
                    <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px] flex items-center justify-center font-bold shrink-0">
                      {branches.length}
                    </span>
                  )}
                  <ChevronDown className="w-3 h-3 text-indigo-500 shrink-0" />
                </button>

                {/* Dropdown Menu */}
                {isBranchDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsBranchDropdownOpen(false)}
                    />
                    <div className="absolute left-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                      <div className="px-3 py-2 text-[10px] font-black text-slate-400 border-b border-slate-100 uppercase tracking-wider flex items-center justify-between">
                        <span>التبديل الفوري بين الفروع</span>
                        {isSwitchingBranch && <RefreshCw className="w-3 h-3 animate-spin text-indigo-600" />}
                      </div>

                      <div className="py-1 max-h-48 overflow-y-auto divide-y divide-slate-50">
                        {branches.map((b) => {
                          const isCurrent = b.id === currentPharmacy?.id;
                          return (
                            <button
                              key={b.id}
                              onClick={() => {
                                if (!isCurrent) {
                                  handleSwitchBranch(b.id);
                                } else {
                                  setIsBranchDropdownOpen(false);
                                }
                              }}
                              disabled={isSwitchingBranch}
                              className={`w-full text-right px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                isCurrent
                                  ? 'bg-indigo-50 text-indigo-950 font-black'
                                  : 'hover:bg-slate-50 text-slate-700 font-bold'
                              }`}
                            >
                              <div className="truncate">
                                <div>{b.name}</div>
                                <div className="text-[10px] text-slate-400 font-normal">
                                  {b.governorate} • {b.district}
                                </div>
                              </div>
                              {isCurrent ? (
                                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shrink-0" />
                              ) : (
                                <span className="text-[10px] text-indigo-600 font-bold shrink-0">
                                  تبديل ⚡
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div className="pt-1.5 border-t border-slate-100 mt-1">
                        <button
                          onClick={() => {
                            setIsBranchDropdownOpen(false);
                            navigateToTab('CHAIN');
                          }}
                          className="w-full text-center py-2 bg-slate-900 hover:bg-indigo-600 text-white rounded-xl text-xs font-black transition-colors cursor-pointer flex items-center justify-center gap-1"
                        >
                          <Building2 className="w-3.5 h-3.5" />
                          <span>إدارة وربط الفروع (لوحة السلسلة)</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Quick Open Public Search button */}
            <button
              onClick={() => navigateToTab('PUBLIC_SEARCH')}
              className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              title="معاينة شبكة البحث العامة للمواطنين"
            >
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">بحث الشبكة</span>
            </button>

            {/* Quick Role Badge */}
            <span className="hidden md:inline-block px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[11px] font-bold border border-slate-200">
              {currentUser?.name}
            </span>
          </div>
        </header>

        {/* Dynamic View Component with Independent Smooth Scroll */}
        <main className="flex-1 overflow-y-auto p-2 sm:p-5 w-full max-w-full overflow-x-hidden">
          {activeTab === 'POS' && <PosView />}
          {activeTab === 'BULK_STOCK' && <BulkStockEntryView />}
          {activeTab === 'INVENTORY' && <InventoryView onNavigateToExpiry={() => navigateToTab('EXPIRY')} />}
          {activeTab === 'EXPIRY' && <ExpiryView onNavigateToInventory={() => navigateToTab('INVENTORY')} />}
          {activeTab === 'STOCKTAKE' && <StocktakeView onNavigateToInventory={() => navigateToTab('INVENTORY')} />}
          {activeTab === 'PURCHASES' && <PurchasesView />}
          {activeTab === 'EXPENSES' && <ExpensesView />}
          {activeTab === 'CHAIN' && (
            <ChainManagementView
              onBranchSwitched={(newPh, newBr) => {
                setCurrentPharmacy(newPh);
                setBranches(newBr);
              }}
            />
          )}
          {activeTab === 'OWNER_DASHBOARD' && <OwnerMobileDashboardView />}
          {activeTab === 'SUPPLIERS' && <SuppliersDebtView />}
          {activeTab === 'REPORTS' && <ReportsView />}
          {activeTab === 'PROFILE' && <PharmacyProfileView />}
          {activeTab === 'ADMIN' && <SuperAdminView />}
        </main>
      </div>

      {/* Proactive Expiry & Low Stock Alerts Modal */}
      {showAlertModal && (
        <ProactiveAlertsModal
          expiringItems={expiringAlerts}
          lowStockItems={lowStockAlerts}
          onClose={() => setShowAlertModal(false)}
          onNavigateToInventory={() => {
            setShowAlertModal(false);
            navigateToTab('EXPIRY');
          }}
        />
      )}
    </div>
  );
};

export default App;
