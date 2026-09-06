import React, { useState } from 'react';
import {
  Building2,
  ShieldCheck,
  Lock,
  User,
  AlertCircle,
  Pill,
  Search,
} from 'lucide-react';
import { apiRequest, setAuthToken, setStoredBranches } from '../api/client';

interface LoginViewProps {
  onLoginSuccess: (user: any, pharmacy?: any, branches?: any[]) => void;
  onNavigateToSearch?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, onNavigateToSearch }) => {
  const [activeTab, setActiveTab] = useState<'PHARMACY' | 'ADMIN'>('PHARMACY');
  const [pharmacySlug, setPharmacySlug] = useState('pharmacy_baghdad_1');
  const [username, setUsername] = useState('owner_ali');
  const [password, setPassword] = useState('123456');

  // Admin login credentials
  const [adminUsername, setAdminUsername] = useState('superadmin');
  const [adminPassword, setAdminPassword] = useState('Admin@Dawaee2026');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePharmacyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<any>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          pharmacySlug: pharmacySlug.trim(),
          username: username.trim(),
          password,
        }),
      });

      setAuthToken(data.accessToken);
      localStorage.setItem('dawaee_user', JSON.stringify(data.user));
      localStorage.setItem('dawaee_pharmacy', JSON.stringify(data.pharmacy));
      if (data.branches) {
        setStoredBranches(data.branches);
      }

      onLoginSuccess(data.user, data.pharmacy, data.branches);
    } catch (err: any) {
      setError(err.message || 'فشل تسجيل الدخول، يرجى التأكد من البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<any>('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: adminUsername, password: adminPassword }),
      });

      setAuthToken(data.accessToken);
      localStorage.setItem('dawaee_user', JSON.stringify(data.user));

      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message || 'بيانات المدير العام غير صحيحة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-3 sm:p-4 w-full max-w-full overflow-x-hidden">
      <div className="bg-white rounded-3xl p-5 sm:p-8 max-w-md w-full shadow-2xl border border-slate-800 relative">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-xs">
            <Pill className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">نظام دوائي</h1>
          <p className="text-xs text-slate-500 mt-1">إدارة الصيدليات</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl mb-6">
          <button
            onClick={() => {
              setActiveTab('PHARMACY');
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'PHARMACY'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            الصيدلية
          </button>
          <button
            onClick={() => {
              setActiveTab('ADMIN');
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'ADMIN'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            الإدارة
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2 text-xs font-bold">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Pharmacy Login Form */}
        {activeTab === 'PHARMACY' ? (
          <form onSubmit={handlePharmacyLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">معرف الصيدلية</label>
              <div className="relative">
                <Building2 className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                <input
                  type="text"
                  required
                  value={pharmacySlug}
                  onChange={(e) => setPharmacySlug(e.target.value)}
                  placeholder="pharmacy_baghdad_1"
                  className="w-full pr-9 pl-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستخدم</label>
              <div className="relative">
                <User className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="اسم المستخدم"
                  className="w-full pr-9 pl-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pr-9 pl-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl font-bold text-sm shadow-md transition-all active:scale-95 cursor-pointer"
            >
              {loading ? 'جاري الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        ) : (
          /* Super Admin Login Form */
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستخدم</label>
              <div className="relative">
                <ShieldCheck className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                <input
                  type="text"
                  required
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  className="w-full pr-9 pl-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                <input
                  type="password"
                  required
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full pr-9 pl-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl font-bold text-sm shadow-md transition-all active:scale-95 cursor-pointer"
            >
              {loading ? 'جاري الدخول...' : 'دخول الإدارة'}
            </button>
          </form>
        )}

        {onNavigateToSearch && (
          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={onNavigateToSearch}
              className="text-xs font-bold text-slate-500 hover:text-emerald-600 flex items-center justify-center gap-1.5 mx-auto transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>بحث الأدوية للجمهور</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
