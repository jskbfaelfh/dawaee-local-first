import React, { useState, useEffect, useRef } from 'react';
import {
  PackagePlus,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
  Save,
  Gift,
  Percent,
  Building2,
  CreditCard,
  Banknote,
  Clock,
  ArrowDownLeft,
  Tag,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { roundTo250, calculateStripPrice } from '../utils/currency';
import { SmartExpiryInput } from '../components/SmartExpiryInput';
import { PriceChangesReviewModal, type ChangedPriceItem } from '../components/PriceChangesReviewModal';

interface TableRowItem {
  tempId: string;
  medicineId?: string;
  customName?: string;
  isNewMedicine?: boolean;
  tradeName: string;
  scientificName: string;
  dosageForm?: string;
  strength?: string;
  manufacturer?: string;
  barcode?: string;
  unitsPerPack: number;
  quantityPacks: number;
  bonusPacks: number;
  discountPercent: number;
  purchasePricePack: number;
  lastPurchasePricePack?: number;
  sellingPricePack: number;
  sellingPriceUnit: number;
  expiryMonth: number;
  expiryYear: number;
  batchNumber?: string;
  shelfLocation?: string;
  hasPreviousBatch?: boolean;
}

export const BulkStockEntryView: React.FC = () => {
  // Suppliers state
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');

  // Payment / Debt status
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'UNPAID' | 'PARTIAL'>('PAID');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Price changes review modal state
  const [showPriceChangesModal, setShowPriceChangesModal] = useState(false);
  const [changedItemsForReview, setChangedItemsForReview] = useState<ChangedPriceItem[]>([]);

  // Search & Table
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [items, setItems] = useState<TableRowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // New Medicine Modal State
  const [showNewMedModal, setShowNewMedModal] = useState(false);
  const [newMedForm, setNewMedForm] = useState({
    tradeName: '',
    scientificName: '',
    customName: '',
    dosageForm: 'أقراص / حبوب',
    strength: '',
    manufacturer: '',
    barcode: '',
    unitsPerPack: 2,
    quantityPacks: 10,
    bonusPacks: 0,
    discountPercent: 0,
    purchasePricePack: 0,
    sellingPricePack: 0,
    expiryMonth: 12,
    expiryYear: new Date().getFullYear() + 2,
    shelfLocation: '',
  });

  // Fetch saved suppliers list
  const fetchSuppliers = async () => {
    try {
      const data = await apiRequest<any[]>('/inventory/suppliers');
      setSuppliers(data || []);
    } catch (err) {
      console.error('Error loading suppliers:', err);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  // Search medicines from catalog
  const handleSearch = async (term: string) => {
    setSearchTerm(term);
    if (term.trim().length < 1) {
      setSearchResults([]);
      return;
    }

    try {
      const data = await apiRequest<any[]>(`/medicines/search?q=${encodeURIComponent(term)}`);
      setSearchResults(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  // Add selected medicine to grid with auto-prefill from last pharmacy batch
  const addMedicineToGrid = async (med: any) => {
    const currentYear = new Date().getFullYear();
    const tempId = Math.random().toString();

    // 1. Fetch previous batch history for this medicine in this pharmacy
    let history: any = null;
    try {
      const lookupKey = med.id || med.barcode;
      history = await apiRequest<any>(`/inventory/medicine-last-history/${encodeURIComponent(lookupKey)}`);
    } catch (e) {
      console.warn('Could not fetch medicine last history:', e);
    }

    const defaultUnits = Number(
      history?.unitsPerPack || med.defaultUnitsPerPack || med.unitsPerPack || 1,
    );
    const purchasePricePack = Number(
      history?.purchasePricePack || med.defaultPurchasePrice || 0,
    );
    const sellingPricePack = Number(history?.sellingPricePack || 0);
    let sellingPriceUnit = Number(history?.sellingPriceUnit || 0);
    if (sellingPriceUnit === 0 && sellingPricePack > 0 && defaultUnits > 0) {
      sellingPriceUnit = calculateStripPrice(sellingPricePack, defaultUnits);
    }

    const bonusPacks = Number(history?.bonusPacks || 0);
    const shelfLocation = history?.shelfLocation || '';
    const expiryMonth = Number(history?.expiryMonth || 12);
    const expiryYear = Number(history?.expiryYear || currentYear + 2);
    const hasPreviousBatch = !!history?.hasPreviousBatch;
    const lastPurchasePrice = Number(history?.lastPurchasePricePack || history?.purchasePricePack || med.defaultPurchasePrice || 0);

    const newRow: TableRowItem = {
      tempId,
      medicineId: med.id,
      customName:
        history?.tradeName && history.tradeName !== med.tradeName ? history.tradeName : '',
      tradeName: med.tradeName,
      scientificName: med.scientificName || '',
      dosageForm: med.dosageForm,
      strength: med.strength,
      barcode: med.barcode,
      unitsPerPack: defaultUnits,
      quantityPacks: 10,
      bonusPacks,
      discountPercent: 0,
      purchasePricePack,
      lastPurchasePricePack: lastPurchasePrice,
      sellingPricePack,
      sellingPriceUnit,
      expiryMonth,
      expiryYear,
      batchNumber: '',
      shelfLocation,
      hasPreviousBatch,
    };

    setItems((prev) => [newRow, ...prev]);
    setSearchTerm('');
    setSearchResults([]);

    // Auto-focus on the first field (Quantity) of the newly added row
    setTimeout(() => {
      const firstInput = document.getElementById(`input-qty-0`);
      if (firstInput) {
        firstInput.focus();
        (firstInput as HTMLInputElement).select?.();
      }
    }, 50);
  };

  // Update specific field in row
  const updateRowField = (tempId: string, field: keyof TableRowItem, value: any) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.tempId !== tempId) return item;

        const updated = { ...item, [field]: value };

        // Auto-calculate unit price when pack price or unitsPerPack changes
        if (field === 'sellingPricePack' || field === 'unitsPerPack') {
          const packPrice = field === 'sellingPricePack' ? Number(value) : Number(item.sellingPricePack);
          const units = field === 'unitsPerPack' ? Number(value) : Number(item.unitsPerPack);
          if (units > 0 && packPrice > 0) {
            updated.sellingPriceUnit = calculateStripPrice(packPrice, units);
          }
        }

        return updated;
      }),
    );
  };

  const removeRow = (tempId: string) => {
    setItems((prev) => prev.filter((i) => i.tempId !== tempId));
  };

  // Fast Enter Key navigation helper
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>, nextFieldId?: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nextFieldId) {
        const nextElem = document.getElementById(nextFieldId);
        if (nextElem) {
          nextElem.focus();
        }
      }
    }
  };

  // Calculations
  const grossTotal = items.reduce((sum, i) => sum + Number(i.purchasePricePack || 0) * Number(i.quantityPacks || 0), 0);
  const totalDiscount = items.reduce(
    (sum, i) =>
      sum +
      Number(i.purchasePricePack || 0) * Number(i.quantityPacks || 0) * (Number(i.discountPercent || 0) / 100),
    0,
  );
  const totalBonusValue = items.reduce(
    (sum, i) => sum + Number(i.bonusPacks || 0) * Number(i.purchasePricePack || 0),
    0,
  );
  const netInvoiceTotal = roundTo250(Math.max(0, grossTotal - totalDiscount));

  // Update paid amount automatically when payment status or total changes
  useEffect(() => {
    if (paymentStatus === 'PAID') {
      setPaidAmount(netInvoiceTotal);
    } else if (paymentStatus === 'UNPAID') {
      setPaidAmount(0);
    }
  }, [paymentStatus, netInvoiceTotal]);

  const remainingDebt = Math.max(0, netInvoiceTotal - paidAmount);

  // Submit new brand-new medicine from footer modal into table
  const handleAddNewMedicineToBatch = (e: React.FormEvent) => {
    e.preventDefault();
    const newRow: TableRowItem = {
      tempId: Math.random().toString(),
      isNewMedicine: true,
      customName: newMedForm.customName || undefined,
      tradeName: newMedForm.tradeName,
      scientificName: newMedForm.scientificName,
      dosageForm: newMedForm.dosageForm || undefined,
      strength: newMedForm.strength || undefined,
      manufacturer: newMedForm.manufacturer || undefined,
      barcode: newMedForm.barcode || undefined,
      unitsPerPack: Number(newMedForm.unitsPerPack || 1),
      quantityPacks: Number(newMedForm.quantityPacks || 1),
      bonusPacks: Number(newMedForm.bonusPacks || 0),
      discountPercent: Number(newMedForm.discountPercent || 0),
      purchasePricePack: Number(newMedForm.purchasePricePack || 0),
      sellingPricePack: Number(newMedForm.sellingPricePack || 0),
      sellingPriceUnit: calculateStripPrice(
        Number(newMedForm.sellingPricePack || 0),
        Number(newMedForm.unitsPerPack || 1),
      ),
      expiryMonth: Number(newMedForm.expiryMonth),
      expiryYear: Number(newMedForm.expiryYear),
      shelfLocation: newMedForm.shelfLocation || '',
    };

    setItems((prev) => [newRow, ...prev]);
    setShowNewMedModal(false);
    setNewMedForm({
      tradeName: '',
      scientificName: '',
      customName: '',
      dosageForm: 'أقراص / حبوب',
      strength: '',
      manufacturer: '',
      barcode: '',
      unitsPerPack: 2,
      quantityPacks: 10,
      bonusPacks: 0,
      discountPercent: 0,
      purchasePricePack: 0,
      sellingPricePack: 0,
      expiryMonth: 12,
      expiryYear: new Date().getFullYear() + 2,
      shelfLocation: '',
    });
  };

  // Save the entire batch to DB
  const handleSaveBulkBatch = async (forceConfirm = false) => {
    if (items.length === 0) {
      alert('يرجى إضافة مادة واحدة على الأقل في الوجبة');
      return;
    }

    if (!forceConfirm) {
      const changed = items
        .filter(
          (i) =>
            i.lastPurchasePricePack !== undefined &&
            i.lastPurchasePricePack > 0 &&
            i.purchasePricePack > 0 &&
            i.purchasePricePack !== i.lastPurchasePricePack,
        )
        .map((i) => ({
          id: i.tempId,
          tradeName: i.customName || i.tradeName,
          lastPurchasePrice: i.lastPurchasePricePack!,
          newPurchasePrice: i.purchasePricePack,
          unitsPerPack: i.unitsPerPack,
        }));

      if (changed.length > 0) {
        setChangedItemsForReview(changed);
        setShowPriceChangesModal(true);
        return;
      }
    }

    setLoading(true);
    setMessage(null);

    try {
      const payload = {
        supplierId: selectedSupplierId || undefined,
        supplierName: supplierName || undefined,
        supplierPhone: supplierPhone || undefined,
        supplierInvoiceNumber: supplierInvoiceNumber || undefined,
        paymentStatus,
        paidAmount: Number(paidAmount),
        dueDate: dueDate || undefined,
        notes: notes || undefined,
        items: items.map((i) => ({
          medicineId: i.medicineId,
          customName: i.customName || undefined,
          newMedicineData: i.isNewMedicine
            ? {
                tradeName: i.tradeName,
                scientificName: i.scientificName,
                dosageForm: i.dosageForm,
                strength: i.strength,
                manufacturer: i.manufacturer,
                barcode: i.barcode,
                defaultUnitsPerPack: i.unitsPerPack,
              }
            : undefined,
          unitsPerPack: Number(i.unitsPerPack),
          quantityPacks: Number(i.quantityPacks),
          bonusPacks: Number(i.bonusPacks || 0),
          discountPercent: Number(i.discountPercent || 0),
          purchasePricePack: Number(i.purchasePricePack),
          sellingPricePack: Number(i.sellingPricePack),
          sellingPriceUnit: Number(i.sellingPriceUnit),
          expiryMonth: Number(i.expiryMonth),
          expiryYear: Number(i.expiryYear),
          batchNumber: i.batchNumber || undefined,
          shelfLocation: i.shelfLocation || undefined,
        })),
      };

      const result = await apiRequest<any>('/inventory/bulk-entry', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessage({ type: 'success', text: result.message });
      setItems([]);
      setSupplierName('');
      setSupplierPhone('');
      setSelectedSupplierId('');
      setSupplierInvoiceNumber('');
      setPaymentStatus('PAID');
      setPaidAmount(0);
      setDueDate('');
      setNotes('');
      fetchSuppliers();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'فشل حفظ الوجبة' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-16">
      {/* 1. Header & Live Financial Breakdown Widget */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-3 mb-3 border-b border-slate-100">
          <div>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <PackagePlus className="w-6 h-6 text-indigo-600" />
              إدخال وجبة
            </h1>
          </div>

          {/* Live Financial Totals Badge */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-right">
              <span className="text-[11px] font-bold text-slate-500 block">الإجمالي</span>
              <span className="text-sm font-black text-slate-800">{grossTotal.toLocaleString()} د.ع</span>
            </div>

            {totalDiscount > 0 && (
              <div className="bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200 text-right">
                <span className="text-[11px] font-bold text-rose-700 block">الخصم</span>
                <span className="text-sm font-black text-rose-800">-{totalDiscount.toLocaleString()} د.ع</span>
              </div>
            )}

            {totalBonusValue > 0 && (
              <div className="bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200 text-right">
                <span className="text-[11px] font-bold text-amber-800 block">البونص</span>
                <span className="text-sm font-black text-amber-900">+{totalBonusValue.toLocaleString()} د.ع</span>
              </div>
            )}

            <div className="bg-indigo-600 px-3.5 py-1.5 rounded-xl text-right text-white shadow-xs">
              <span className="text-[11px] font-bold text-indigo-100 block">الصافي</span>
              <span className="text-base font-black">{netInvoiceTotal.toLocaleString()} د.ع</span>
            </div>

            <button
              onClick={() => handleSaveBulkBatch(false)}
              disabled={items.length === 0 || loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {loading ? 'جاري الحفظ...' : `حفظ الوجبة (${items.length})`}
            </button>
          </div>
        </div>

        {/* 2. Supplier & Payment Info Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Supplier Selector / Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              المذخر
            </label>
            <div className="flex gap-1.5">
              {suppliers.length > 0 ? (
                <select
                  value={selectedSupplierId}
                  onChange={(e) => {
                    const sId = e.target.value;
                    setSelectedSupplierId(sId);
                    const found = suppliers.find((s) => s.id === sId);
                    if (found) {
                      setSupplierName(found.name);
                      setSupplierPhone(found.phone || '');
                    } else {
                      setSupplierName('');
                    }
                  }}
                  className="w-1/2 px-2 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold"
                >
                  <option value="">-- اختر مذخر --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.totalRemainingDebt > 0 ? `(دين: ${Number(s.totalRemainingDebt).toLocaleString()} د.ع)` : ''}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                type="text"
                value={supplierName}
                onChange={(e) => {
                  setSupplierName(e.target.value);
                  setSelectedSupplierId('');
                }}
                placeholder="اسم المذخر..."
                className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-900"
              />
            </div>
          </div>

          {/* Supplier Invoice Number */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">رقم الفاتورة</label>
            <input
              type="text"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              placeholder="مثال: INV-98231"
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold"
            />
          </div>

          {/* Payment Status (Cash / Credit / Partial) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
              <CreditCard className="w-3.5 h-3.5 text-indigo-600" />
              حالة السداد
            </label>
            <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setPaymentStatus('PAID')}
                className={`py-1.5 text-[11px] font-bold rounded-md transition-all ${
                  paymentStatus === 'PAID'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                نقداً
              </button>
              <button
                type="button"
                onClick={() => setPaymentStatus('UNPAID')}
                className={`py-1.5 text-[11px] font-bold rounded-md transition-all ${
                  paymentStatus === 'UNPAID'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                آجل
              </button>
              <button
                type="button"
                onClick={() => setPaymentStatus('PARTIAL')}
                className={`py-1.5 text-[11px] font-bold rounded-md transition-all ${
                  paymentStatus === 'PARTIAL'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                جزئي
              </button>
            </div>
          </div>

          {/* Paid amount & Due Date if Credit/Partial */}
          <div>
            {paymentStatus === 'PARTIAL' ? (
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">المدفوع نقداً</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="250"
                    max={netInvoiceTotal}
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-amber-50 border border-amber-300 rounded-lg text-xs font-black text-amber-950"
                  />
                  <div className="text-[10px] text-slate-500 whitespace-nowrap self-center font-bold">
                    المتبقي: {remainingDebt.toLocaleString()} د.ع
                  </div>
                </div>
              </div>
            ) : paymentStatus === 'UNPAID' ? (
              <div>
                <label className="block text-xs font-bold text-rose-900 mb-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-rose-600" />
                  تاريخ الاستحقاق
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-rose-50 border border-rose-300 rounded-lg text-xs font-bold text-rose-900"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                  حالة الدفع
                </label>
                <div className="px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  مسدد بالكامل ({netInvoiceTotal.toLocaleString()} د.ع)
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl flex items-center gap-2 text-sm font-bold ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600" />
          )}
          {message.text}
        </div>
      )}

      {/* 3. Fast Barcode & Search Input */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute right-3.5 top-3.5 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (searchResults.length > 0) {
                    await addMedicineToGrid(searchResults[0]);
                  } else if (searchTerm.trim().length > 0) {
                    try {
                      const directMatches = await apiRequest<any[]>(
                        `/medicines/search?q=${encodeURIComponent(searchTerm.trim())}`,
                      );
                      if (directMatches && directMatches.length > 0) {
                        await addMedicineToGrid(directMatches[0]);
                      }
                    } catch (err) {
                      console.error(err);
                    }
                  }
                }
              }}
              placeholder="امسح الباركود أو اكتب اسم الدواء ثم اضغط Enter..."
              className="w-full pr-11 pl-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-bold text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setNewMedForm((prev) => ({
                ...prev,
                tradeName: searchTerm,
                barcode: /^\d+$/.test(searchTerm) ? searchTerm : '',
              }));
              setShowNewMedModal(true);
            }}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-xs transition-all active:scale-95 cursor-pointer"
            title="تسجيل دواء جديد غير موجود في الدليل الموحد"
          >
            <Plus className="w-4 h-4" />
            <span>➕ تسجيل دواء جديد</span>
          </button>
        </div>

        {/* Live Search Autocomplete Dropdown */}
        {searchTerm.trim().length > 0 && (
          <div className="absolute left-4 right-4 top-14 bg-white rounded-xl shadow-xl border border-slate-200 max-h-64 overflow-y-auto z-20 divide-y divide-slate-100">
            {searchResults.length > 0 ? (
              searchResults.map((med) => (
                <div
                  key={med.id}
                  onClick={() => addMedicineToGrid(med)}
                  className="p-3 hover:bg-indigo-50/70 cursor-pointer flex items-center justify-between transition-colors"
                >
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{med.tradeName}</div>
                    <div className="text-xs text-slate-500">
                      {med.scientificName} • ({med.defaultUnitsPerPack || 1} أشرطة) • {med.dosageForm || ''}
                    </div>
                  </div>
                  <button className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer">
                    <Plus className="w-3.5 h-3.5" />
                    إدراج
                  </button>
                </div>
              ))
            ) : (
              <div className="p-4 text-center space-y-2.5">
                <div className="text-xs font-bold text-slate-600">
                  لم يتم العثور على <span className="text-indigo-600 font-black">"{searchTerm}"</span> في الدليل الموحد
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewMedForm((prev) => ({
                      ...prev,
                      tradeName: searchTerm,
                      barcode: /^\d+$/.test(searchTerm) ? searchTerm : '',
                    }));
                    setShowNewMedModal(true);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  <span>دواء جديد +</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Main Interactive Grid Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-600" />
            أدوية الوجبة ({items.length})
          </h2>
          <span className="text-xs text-slate-400 font-bold">
            (Enter للتنقل)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-100/75 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="p-2.5 w-10 text-center">#</th>
                <th className="p-2.5 min-w-[180px]">الدواء</th>
                <th className="p-2.5 w-20 text-center">الكمية</th>
                <th className="p-2.5 w-20 text-center bg-amber-50/70 text-amber-900">
                  <span className="flex items-center justify-center gap-1">
                    <Gift className="w-3 h-3 text-amber-600" />
                    بونص
                  </span>
                </th>
                <th className="p-2.5 w-20 text-center">الشريط/علبة</th>
                <th className="p-2.5 w-28">شراء الباكيت</th>
                <th className="p-2.5 w-20 text-center bg-rose-50/70 text-rose-900">
                  <span className="flex items-center justify-center gap-1">
                    <Percent className="w-3 h-3 text-rose-600" />
                    خصم %
                  </span>
                </th>
                <th className="p-2.5 w-28 bg-indigo-50/50 text-indigo-900">الكلفة</th>
                <th className="p-2.5 w-28">بيع الباكيت</th>
                <th className="p-2.5 w-28">بيع الشريط</th>
                <th className="p-2.5 w-32">الصلاحية</th>
                <th className="p-2.5 w-24">الوجبة</th>
                <th className="p-2.5 w-24">الرف</th>
                <th className="p-2.5 w-10 text-center">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-10 text-center text-slate-400 font-bold">
                    <PackagePlus className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    لا توجد أدوية بعد.
                  </td>
                </tr>
              ) : (
                items.map((row, idx) => {
                  const qtyPacks = Number(row.quantityPacks || 0);
                  const bonusPacks = Number(row.bonusPacks || 0);
                  const totalPacks = qtyPacks + bonusPacks;
                  const discount = Number(row.discountPercent || 0);
                  const listPrice = Number(row.purchasePricePack || 0);

                  const grossLine = qtyPacks * listPrice;
                  const netLine = grossLine * (1 - discount / 100);
                  const effectiveCostPerPack = totalPacks > 0 ? Math.round(netLine / totalPacks) : listPrice;

                  return (
                    <tr key={row.tempId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-2.5 text-center text-slate-400 font-bold">{idx + 1}</td>

                      {/* Medicine Info & Custom Name Input */}
                      <td className="p-2.5">
                        <div className="font-bold text-slate-900 text-xs">{row.tradeName}</div>
                        <div className="text-[10px] text-slate-500 truncate max-w-[190px]">{row.scientificName}</div>
                        {row.hasPreviousBatch && (
                          <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-bold">
                            <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                            مسترد من الوجبة السابقة
                          </span>
                        )}
                        {row.isNewMedicine && (
                          <span className="inline-block mt-0.5 px-1 py-0.2 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px] font-bold">
                            دواء جديد كلياً
                          </span>
                        )}
                        <div className="mt-1">
                          <input
                            type="text"
                            value={row.customName || ''}
                            onChange={(e) => updateRowField(row.tempId, 'customName', e.target.value)}
                            placeholder="اسم دارج..."
                            className="w-full px-2 py-1 bg-amber-50/50 border border-amber-200 rounded-md text-[10px] text-amber-950 font-bold placeholder:text-amber-600/60"
                          />
                        </div>
                      </td>

                      {/* Quantity Packs */}
                      <td className="p-2">
                        <input
                          id={`input-qty-${idx}`}
                          type="number"
                          min="1"
                          value={row.quantityPacks}
                          onChange={(e) => updateRowField(row.tempId, 'quantityPacks', Number(e.target.value))}
                          onKeyDown={(e) => handleKeyDown(e, `input-bonus-${idx}`)}
                          className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md font-black text-slate-900 text-center"
                        />
                      </td>

                      {/* Bonus Packs */}
                      <td className="p-2 bg-amber-50/30">
                        <input
                          id={`input-bonus-${idx}`}
                          type="number"
                          min="0"
                          value={row.bonusPacks}
                          onChange={(e) => updateRowField(row.tempId, 'bonusPacks', Number(e.target.value))}
                          onKeyDown={(e) => handleKeyDown(e, `input-units-${idx}`)}
                          className="w-full px-2 py-1.5 bg-amber-50 border border-amber-300 rounded-md font-black text-amber-900 text-center"
                        />
                      </td>

                      {/* Units Per Pack */}
                      <td className="p-2">
                        <input
                          id={`input-units-${idx}`}
                          type="number"
                          min="1"
                          value={row.unitsPerPack}
                          onChange={(e) => updateRowField(row.tempId, 'unitsPerPack', Number(e.target.value))}
                          onKeyDown={(e) => handleKeyDown(e, `input-price-${idx}`)}
                          className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-center text-slate-700 font-bold"
                        />
                      </td>

                      {/* List Purchase Price */}
                      <td className="p-2">
                        <input
                          id={`input-price-${idx}`}
                          type="number"
                          min="0"
                          step="250"
                          value={row.purchasePricePack}
                          onChange={(e) => updateRowField(row.tempId, 'purchasePricePack', Number(e.target.value))}
                          onKeyDown={(e) => handleKeyDown(e, `input-discount-${idx}`)}
                          className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md font-bold text-slate-900 text-left"
                        />
                        {row.lastPurchasePricePack !== undefined &&
                          row.lastPurchasePricePack > 0 &&
                          row.purchasePricePack > 0 &&
                          row.purchasePricePack !== row.lastPurchasePricePack && (
                            <div
                              className={`text-[10px] mt-1 font-bold leading-tight ${
                                row.purchasePricePack > row.lastPurchasePricePack
                                  ? 'text-rose-600'
                                  : 'text-emerald-600'
                              }`}
                            >
                              {row.purchasePricePack > row.lastPurchasePricePack
                                ? `🔺 ارتفع سعر الشراء (آخر سعر: ${row.lastPurchasePricePack.toLocaleString()} د.ع)`
                                : `🔻 انخفض سعر الشراء (آخر سعر: ${row.lastPurchasePricePack.toLocaleString()} د.ع)`}
                            </div>
                          )}
                      </td>

                      {/* Discount % */}
                      <td className="p-2 bg-rose-50/30">
                        <input
                          id={`input-discount-${idx}`}
                          type="number"
                          min="0"
                          max="100"
                          value={row.discountPercent}
                          onChange={(e) => updateRowField(row.tempId, 'discountPercent', Number(e.target.value))}
                          onKeyDown={(e) => handleKeyDown(e, `input-selling-pack-${idx}`)}
                          className="w-full px-2 py-1.5 bg-rose-50 border border-rose-300 rounded-md font-black text-rose-900 text-center"
                        />
                      </td>

                      {/* Calculated Effective Net Cost per Pack */}
                      <td className="p-2.5 bg-indigo-50/40 font-black text-indigo-950 text-xs">
                        {effectiveCostPerPack.toLocaleString()} د.ع
                        {bonusPacks > 0 || discount > 0 ? (
                          <div className="text-[9px] text-emerald-700 font-bold flex items-center gap-0.5">
                            <ArrowDownLeft className="w-2.5 h-2.5" />
                            توفير بونص/خصم
                          </div>
                        ) : null}
                      </td>

                      {/* Selling Price Pack */}
                      <td className="p-2">
                        <input
                          id={`input-selling-pack-${idx}`}
                          type="number"
                          min="250"
                          step="250"
                          value={row.sellingPricePack}
                          onChange={(e) => updateRowField(row.tempId, 'sellingPricePack', Number(e.target.value))}
                          onKeyDown={(e) => handleKeyDown(e, `input-selling-unit-${idx}`)}
                          className="w-full px-2 py-1.5 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-md font-black text-left"
                        />
                      </td>

                      {/* Selling Price Unit (Strip) */}
                      <td className="p-2">
                        <input
                          id={`input-selling-unit-${idx}`}
                          type="number"
                          min="250"
                          step="250"
                          value={row.sellingPriceUnit}
                          onChange={(e) => updateRowField(row.tempId, 'sellingPriceUnit', Number(e.target.value))}
                          onKeyDown={(e) => handleKeyDown(e, `input-exp-month-${idx}`)}
                          className="w-full px-2 py-1.5 bg-blue-50 border border-blue-300 text-blue-950 rounded-md font-black text-left"
                        />
                      </td>

                      {/* Expiry Date (Month 1-12 without zero, Year 20XX with Enter navigation) */}
                      <td className="p-2">
                        <SmartExpiryInput
                          month={row.expiryMonth}
                          year={row.expiryYear}
                          monthId={`input-exp-month-${idx}`}
                          yearId={`input-exp-year-${idx}`}
                          onChange={(m, y) => {
                            updateRowField(row.tempId, 'expiryMonth', m);
                            updateRowField(row.tempId, 'expiryYear', y);
                          }}
                          onNext={() => {
                            const batchInput = document.getElementById(`input-batch-${idx}`);
                            if (batchInput) {
                              batchInput.focus();
                              (batchInput as HTMLInputElement).select?.();
                            } else {
                              document.getElementById(`input-shelf-${idx}`)?.focus();
                            }
                          }}
                        />
                      </td>

                      {/* Batch Number */}
                      <td className="p-2">
                        <input
                          id={`input-batch-${idx}`}
                          type="text"
                          value={row.batchNumber || ''}
                          onChange={(e) => updateRowField(row.tempId, 'batchNumber', e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, `input-shelf-${idx}`)}
                          placeholder="اختياري"
                          className="w-full px-1.5 py-1.5 bg-white border border-slate-300 rounded-md text-center text-xs font-mono"
                        />
                      </td>

                      {/* Shelf Location */}
                      <td className="p-2">
                        <input
                          id={`input-shelf-${idx}`}
                          type="text"
                          value={row.shelfLocation || ''}
                          onChange={(e) => updateRowField(row.tempId, 'shelfLocation', e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              searchInputRef.current?.focus();
                              searchInputRef.current?.select();
                            }
                          }}
                          placeholder="A-01"
                          className="w-full px-1.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md text-center text-xs font-bold font-mono text-slate-900 focus:bg-white focus:border-indigo-500"
                        />
                      </td>

                      {/* Delete */}
                      <td className="p-2 text-center">
                        <button
                          onClick={() => removeRow(row.tempId)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                          title="حذف من الفاتورة"
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

        {/* 5. Footer Adder for Brand-New Medicines */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={() => setShowNewMedModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-indigo-600" />
            + إضافة دواء جديد
          </button>

          <div className="text-xs font-bold text-slate-600">
            العدد: <span className="text-slate-900 font-black text-sm">{items.length}</span>
          </div>
        </div>
      </div>

      {/* Modal for Brand-New Medicine */}
      {showNewMedModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 max-w-lg w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              إضافة دواء جديد
            </h3>

            <form onSubmit={handleAddNewMedicineToBatch} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الاسم التجاري *</label>
                  <input
                    type="text"
                    required
                    value={newMedForm.tradeName}
                    onChange={(e) => setNewMedForm({ ...newMedForm, tradeName: e.target.value })}
                    placeholder="مثال: Catafast"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الاسم العلمي *</label>
                  <input
                    type="text"
                    required
                    value={newMedForm.scientificName}
                    onChange={(e) => setNewMedForm({ ...newMedForm, scientificName: e.target.value })}
                    placeholder="مثال: Diclofenac"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Custom Name */}
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1 flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5 text-amber-600" />
                  الاسم الدارج (اختياري)
                </label>
                <input
                  type="text"
                  value={newMedForm.customName}
                  onChange={(e) => setNewMedForm({ ...newMedForm, customName: e.target.value })}
                  placeholder="مثال: كاتفست أصفر"
                  className="w-full px-3 py-2 border border-amber-300 bg-amber-50/50 rounded-lg text-sm font-bold text-amber-950"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الشكل</label>
                  <input
                    type="text"
                    value={newMedForm.dosageForm}
                    onChange={(e) => setNewMedForm({ ...newMedForm, dosageForm: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">التركيز</label>
                  <input
                    type="text"
                    value={newMedForm.strength}
                    onChange={(e) => setNewMedForm({ ...newMedForm, strength: e.target.value })}
                    placeholder="50mg"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">أشرطة/علبة</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newMedForm.unitsPerPack}
                    onChange={(e) => setNewMedForm({ ...newMedForm, unitsPerPack: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-center font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">كمية العلب</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newMedForm.quantityPacks}
                    onChange={(e) => setNewMedForm({ ...newMedForm, quantityPacks: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-amber-800 mb-1">بونص مجاني</label>
                  <input
                    type="number"
                    min="0"
                    value={newMedForm.bonusPacks}
                    onChange={(e) => setNewMedForm({ ...newMedForm, bonusPacks: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-amber-300 bg-amber-50 text-amber-950 rounded-lg text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-rose-800 mb-1">خصم %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={newMedForm.discountPercent}
                    onChange={(e) => setNewMedForm({ ...newMedForm, discountPercent: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-rose-300 bg-rose-50 text-rose-950 rounded-lg text-sm font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر الشراء للعلبة (د.ع)</label>
                  <input
                    type="number"
                    min="250"
                    step="250"
                    required
                    value={newMedForm.purchasePricePack}
                    onChange={(e) => setNewMedForm({ ...newMedForm, purchasePricePack: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر البيع للعلبة (د.ع) *</label>
                  <input
                    type="number"
                    min="250"
                    step="250"
                    required
                    value={newMedForm.sellingPricePack}
                    onChange={(e) => setNewMedForm({ ...newMedForm, sellingPricePack: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-emerald-300 bg-emerald-50 text-emerald-950 rounded-lg text-sm font-bold"
                  />
                </div>
              </div>

              {/* Expiry & Shelf Location */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    شهر / سنة الصلاحية (1-12 و 20XX)
                  </label>
                  <SmartExpiryInput
                    month={newMedForm.expiryMonth}
                    year={newMedForm.expiryYear}
                    onChange={(m, y) =>
                      setNewMedForm((prev) => ({ ...prev, expiryMonth: m, expiryYear: y }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">موقع الرف</label>
                  <input
                    type="text"
                    value={newMedForm.shelfLocation}
                    onChange={(e) =>
                      setNewMedForm((prev) => ({ ...prev, shelfLocation: e.target.value }))
                    }
                    placeholder="مثال: A-01"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-bold font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  إدراج الدواء في الفاتورة
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewMedModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Group Alert for Purchase Price Changes before Confirmation */}
      <PriceChangesReviewModal
        isOpen={showPriceChangesModal}
        items={changedItemsForReview}
        onConfirm={() => {
          setShowPriceChangesModal(false);
          handleSaveBulkBatch(true);
        }}
        onCancel={() => setShowPriceChangesModal(false)}
        isSubmitting={loading}
      />
    </div>
  );
};
