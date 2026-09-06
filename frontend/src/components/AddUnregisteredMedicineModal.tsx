import React, { useState } from 'react';
import {
  Pill,
  X,
  CheckCircle2,
  AlertCircle,
  Barcode,
  Building2,
  Layers,
  FlaskConical,
} from 'lucide-react';
import { apiRequest } from '../api/client';

interface AddUnregisteredMedicineModalProps {
  initialSearch?: string;
  initialBarcode?: string;
  onClose: () => void;
  onSuccess: (newMedicine: any) => void;
}

export const AddUnregisteredMedicineModal: React.FC<AddUnregisteredMedicineModalProps> = ({
  initialSearch = '',
  initialBarcode = '',
  onClose,
  onSuccess,
}) => {
  const [tradeName, setTradeName] = useState(initialSearch);
  const [scientificName, setScientificName] = useState('');
  const [dosageForm, setDosageForm] = useState('أقراص');
  const [strength, setStrength] = useState('');
  const [defaultUnitsPerPack, setDefaultUnitsPerPack] = useState(1);
  const [barcode, setBarcode] = useState(initialBarcode);
  const [manufacturer, setManufacturer] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commonDosageForms = [
    'أقراص',
    'كبسول',
    'شراب',
    'معلق',
    'قطرات',
    'أمبول / حقن',
    'مرهم',
    'كريم',
    'تحاميل',
    'بخاخ استنشاق',
  ];

  const commonStrengths = [
    '500mg',
    '1g',
    '250mg',
    '100mg',
    '50mg',
    '20mg',
    '10mg',
    '5mg',
    '100mcg',
  ];

  const commonManufacturers = [
    'SDI (سامراء)',
    'Pioneer',
    'Awamedica',
    'GSK',
    'Julphar',
    'Sanofi',
    'Novartis',
    'Pfizer',
    'Hikma',
    'AstraZeneca',
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tradeName.trim()) {
      setError('يرجى إدخال الاسم التجاري للدواء');
      return;
    }
    if (!scientificName.trim()) {
      setError('يرجى إدخال الاسم العلمي أو المادة الفعالة');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const createdMed = await apiRequest<any>('/medicines', {
        method: 'POST',
        body: JSON.stringify({
          tradeName: tradeName.trim(),
          scientificName: scientificName.trim(),
          dosageForm: dosageForm.trim() || undefined,
          strength: strength.trim() || undefined,
          defaultUnitsPerPack: Number(defaultUnitsPerPack) || 1,
          barcode: barcode.trim() || undefined,
          manufacturer: manufacturer.trim() || undefined,
          isVerified: false,
        }),
      });

      onSuccess(createdMed);
      onClose();
    } catch (err: any) {
      setError(err.message || 'فشل تسجيل الدواء الجديد');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white text-slate-900 rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Pill className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base text-slate-900">إضافة دواء جديد</h3>
              <p className="text-[11px] text-slate-500 font-medium">إضافة بطاقة دواء للنظام</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2 text-xs font-bold">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Trade Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              الاسم التجاري *
            </label>
            <div className="relative">
              <Pill className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
              <input
                type="text"
                required
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="مثال: Panadol Actifast"
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Scientific Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
              <span>الاسم العلمي *</span>
              <span className="text-[10px] text-indigo-600 font-normal">مهم للبدائل</span>
            </label>
            <div className="relative">
              <FlaskConical className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
              <input
                type="text"
                required
                value={scientificName}
                onChange={(e) => setScientificName(e.target.value)}
                placeholder="مثال: Paracetamol"
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Dosage Form with Quick Pills */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              الشكل الدوائي
            </label>
            <input
              type="text"
              value={dosageForm}
              onChange={(e) => setDosageForm(e.target.value)}
              placeholder="مثال: أقراص، شراب، كبسول..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden mb-1.5"
            />
            <div className="flex gap-1 flex-wrap">
              {commonDosageForms.map((df) => (
                <button
                  key={df}
                  type="button"
                  onClick={() => setDosageForm(df)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                    dosageForm === df
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {df}
                </button>
              ))}
            </div>
          </div>

          {/* Strength and Units Per Pack */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                التركيز
              </label>
              <input
                type="text"
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="مثال: 500mg أو 1g"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden mb-1"
              />
              <div className="flex gap-1 flex-wrap">
                {commonStrengths.slice(0, 4).map((str) => (
                  <button
                    key={str}
                    type="button"
                    onClick={() => setStrength(str)}
                    className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[9px] font-bold cursor-pointer"
                  >
                    {str}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-indigo-600" />
                <span>الشريط بالعلبة</span>
              </label>
              <input
                type="number"
                min="1"
                max="100"
                required
                value={defaultUnitsPerPack}
                onChange={(e) => setDefaultUnitsPerPack(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-black text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Barcode & Manufacturer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <Barcode className="w-3.5 h-3.5 text-indigo-600" />
                الباركود (اختياري)
              </label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="امسح الباركود..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                الشركة المصنعة
              </label>
              <input
                type="text"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="مثال: SDI, GSK..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden mb-1"
              />
              <div className="flex gap-1 flex-wrap">
                {commonManufacturers.slice(0, 3).map((mfg) => (
                  <button
                    key={mfg}
                    type="button"
                    onClick={() => setManufacturer(mfg)}
                    className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[9px] font-bold cursor-pointer"
                  >
                    {mfg}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{loading ? 'جاري الحفظ...' : 'حفظ الدواء'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
