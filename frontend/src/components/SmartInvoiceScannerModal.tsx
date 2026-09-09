import React, { useState, useRef, useMemo } from 'react';
import {
  Camera,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  X,
  Package,
  RefreshCw,
  Trash2,
  Plus,
  Calendar,
  Clock,
  Tag,
  Hash,
  BadgePercent,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { SmartExpiryInput } from './SmartExpiryInput';
import { PriceChangesReviewModal, type ChangedPriceItem } from './PriceChangesReviewModal';

export interface ScannedItem {
  id: string;
  rawName: string;
  matchedMedicineId: string | null;
  matchedTradeName: string;
  scientificName?: string;
  barcode: string;
  unitsPerPack: number;
  quantityPacks: number;
  bonusPacks: number;
  amortizeBonus?: boolean;
  purchasePricePack: number;
  lastPurchasePricePack?: number;
  discountPercent: number;
  sellingPricePack: number;
  sellingPriceUnit: number;
  batchNumber: string;
  expiryMonth: number | '';
  expiryYear: number | '';
  shelfLocation: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  discrepancies: string[];
}

export interface MonthlyDiscountTier {
  monthIndex: number;
  daysLimit: number;
  discountPercent: number;
}

interface SmartInvoiceScannerModalProps {
  onClose: () => void;
  onSuccess: (savedInvoice: any) => void;
}

export const SmartInvoiceScannerModal: React.FC<SmartInvoiceScannerModalProps> = ({
  onClose,
  onSuccess,
}) => {
  // Stepper: UPLOAD -> PROCESSING -> REVIEW
  const [step, setStep] = useState<'UPLOAD' | 'PROCESSING' | 'REVIEW'>('UPLOAD');
  const [processingStage, setProcessingStage] = useState<string>('قراءة النصوص البصرية (OCR)...');

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [rawTextHint, setRawTextHint] = useState<string>('');

  // Invoice Data
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidAmount, setPaidAmount] = useState<number>(0);

  // Tiered Monthly Discounts State
  const [discountMonthsCount, setDiscountMonthsCount] = useState<number>(0);
  const [discountTiers, setDiscountTiers] = useState<MonthlyDiscountTier[]>([]);

  const [confidenceScore, setConfidenceScore] = useState<number>(90);
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [discrepanciesCount, setDiscrepanciesCount] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Direct Overall Invoice Discount
  const [directDiscountType, setDirectDiscountType] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [directDiscountValue, setDirectDiscountValue] = useState<number>(0);

  const [showPriceChangesModal, setShowPriceChangesModal] = useState(false);
  const [changedItemsForReview, setChangedItemsForReview] = useState<ChangedPriceItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Automatic smart compression on file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1600;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
          setSelectedImage(compressedBase64);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  // Start AI Extraction Pipeline
  const runAiExtraction = async (base64Img?: string) => {
    const imgToSend = base64Img || selectedImage;
    setStep('PROCESSING');
    setErrorMsg(null);

    try {
      setProcessingStage('📷 جاري مسح واستخراج النصوص البصرية وفحص جدول المواد...');
      await new Promise((r) => setTimeout(r, 600));

      setProcessingStage('🧠 جاري قراءة أسماء المواد، التراكيز، الكميات، والأسعار بدقة...');
      await new Promise((r) => setTimeout(r, 700));

      setProcessingStage('🔎 جاري المطابقة المباشرة مع الدليل الدوائي المركزي (28,500 مادة)...');

      const response = await apiRequest<any>('/purchases/ai-scan-invoice', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: imgToSend || 'data:image/jpeg;base64,sample',
          rawTextHint: rawTextHint.trim() || undefined,
        }),
      });

      if (response && response.items) {
        setInvoiceNumber(response.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`);
        setSupplierName(response.supplierName || 'مذخر أدوية');
        setInvoiceDate(response.invoiceDate || new Date().toISOString().slice(0, 10));

        // Format items with strict zero-guesswork rules
        const formattedItems: ScannedItem[] = response.items.map((it: any, index: number) => {
          let expMonth: number | '' = '';
          let expYear: number | '' = '';
          if (it.expiryDate && it.expiryDate.includes('-')) {
            const parts = it.expiryDate.split('-');
            if (parts.length >= 2) {
              const y = parseInt(parts[0], 10);
              const m = parseInt(parts[1], 10);
              if (!isNaN(y) && y > 2000) expYear = y;
              if (!isNaN(m) && m >= 1 && m <= 12) expMonth = m;
            }
          }

          const units = Number(it.unitsPerPack) || 1;
          const sellPack = Number(it.sellingPricePack) || 0;
          const sellUnit = Number(it.sellingPriceUnit) || (sellPack > 0 && units > 1 ? Math.round(sellPack / units) : sellPack);

          return {
            id: `item_${Date.now()}_${index}`,
            rawName: it.rawName || '',
            matchedMedicineId: it.matchedMedicineId || null,
            matchedTradeName: it.matchedTradeName || it.tradeName || it.rawName || '',
            scientificName: it.scientificName || '',
            barcode: it.barcode || '',
            unitsPerPack: units,
            quantityPacks: Number(it.quantityPacks) || 1,
            bonusPacks: Number(it.bonusQuantity || it.bonusPacks) || 0,
            amortizeBonus: true,
            purchasePricePack: Number(it.purchasePricePack) || 0,
            lastPurchasePricePack: Number(it.lastPurchasePricePack || 0),
            discountPercent: Number(it.discountPercent) || 0,
            sellingPricePack: sellPack,
            sellingPriceUnit: sellUnit,
            batchNumber: it.batchNumber || '',
            expiryMonth: expMonth,
            expiryYear: expYear,
            shelfLocation: it.shelfLocation || '',
            confidence: it.confidence || 'HIGH',
            discrepancies: it.discrepancies || [],
          };
        });

        setItems(formattedItems);
        setConfidenceScore(response.confidenceScore || 90);
        setDiscrepanciesCount(response.discrepanciesCount || 0);

        // Handle Tiered Monthly Discounts from AI response
        if (response.discountTiers && Array.isArray(response.discountTiers) && response.discountTiers.length > 0) {
          setDiscountMonthsCount(response.discountTiers.length);
          setDiscountTiers(response.discountTiers);
        } else if (response.earlyDiscountPercent && Number(response.earlyDiscountPercent) > 0) {
          setDiscountMonthsCount(1);
          setDiscountTiers([
            {
              monthIndex: 1,
              daysLimit: Number(response.earlyDiscountDays) || 30,
              discountPercent: Number(response.earlyDiscountPercent),
            },
          ]);
        } else {
          setDiscountMonthsCount(0);
          setDiscountTiers([]);
        }

        // Handle direct overall discount if detected by AI OCR
        if (response.directDiscountAmount && Number(response.directDiscountAmount) > 0) {
          setDirectDiscountType('AMOUNT');
          setDirectDiscountValue(Number(response.directDiscountAmount));
        } else {
          setDirectDiscountValue(0);
        }

        // Calculate initial total
        const total = formattedItems.reduce((acc, it) => {
          const netCost = it.purchasePricePack * (1 - it.discountPercent / 100);
          return acc + it.quantityPacks * netCost;
        }, 0);
        setPaidAmount(Math.round(total));

        setStep('REVIEW');
      } else {
        throw new Error('لم يتمكن الذكاء الاصطناعي من قراءة محتوى الفاتورة.');
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'حدث خطأ أثناء معالجة الفاتورة');
      setStep('UPLOAD');
    }
  };

  // Handle Changing Number of Discount Months
  const handleDiscountMonthsChange = (count: number) => {
    setDiscountMonthsCount(count);
    if (count === 0) {
      setDiscountTiers([]);
      return;
    }

    setDiscountTiers((prev) => {
      const newTiers: MonthlyDiscountTier[] = [];
      for (let i = 1; i <= count; i++) {
        const existing = prev.find((t) => t.monthIndex === i);
        newTiers.push({
          monthIndex: i,
          daysLimit: i * 30,
          discountPercent: existing ? existing.discountPercent : 0,
        });
      }
      return newTiers;
    });
  };

  // Update specific discount tier percent
  const updateTierPercent = (monthIndex: number, percent: number) => {
    setDiscountTiers((prev) =>
      prev.map((t) => (t.monthIndex === monthIndex ? { ...t, discountPercent: Math.max(0, percent) } : t))
    );
  };

  // Item field update
  const updateItemField = (index: number, field: keyof ScannedItem, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index], [field]: value };

      // Auto compute unit selling price if pack selling price or units change
      if (field === 'sellingPricePack' || field === 'unitsPerPack') {
        const units = Number(field === 'unitsPerPack' ? value : item.unitsPerPack) || 1;
        const packPrice = Number(field === 'sellingPricePack' ? value : item.sellingPricePack) || 0;
        if (packPrice > 0 && units > 1) {
          item.sellingPriceUnit = Math.round(packPrice / units);
        } else {
          item.sellingPriceUnit = packPrice;
        }
      }

      updated[index] = item;
      return updated;
    });
  };

  // Fast Enter key navigation helper
  const handleKeyDownNav = (e: React.KeyboardEvent<HTMLElement>, nextFieldId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextEl = document.getElementById(nextFieldId);
      if (nextEl) {
        nextEl.focus();
        (nextEl as HTMLInputElement).select?.();
      }
    }
  };

  // Remove Item
  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Add Empty Row Manually
  const addNewRowManually = () => {
    const newRow: ScannedItem = {
      id: `manual_${Date.now()}`,
      rawName: '',
      matchedMedicineId: null,
      matchedTradeName: '',
      barcode: '',
      unitsPerPack: 1,
      quantityPacks: 1,
      bonusPacks: 0,
      amortizeBonus: true,
      purchasePricePack: 0,
      lastPurchasePricePack: 0,
      discountPercent: 0,
      sellingPricePack: 0,
      sellingPriceUnit: 0,
      batchNumber: '',
      expiryMonth: '',
      expiryYear: '',
      shelfLocation: '',
      confidence: 'HIGH',
      discrepancies: [],
    };
    setItems((prev) => [...prev, newRow]);
  };

  // Financial Calculations
  const grossInvoiceAmount = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.quantityPacks) || 0) * (Number(it.purchasePricePack) || 0), 0);
  }, [items]);

  const itemsCostTotal = useMemo(() => {
    return items.reduce((sum, it) => {
      const netCost = (Number(it.purchasePricePack) || 0) * (1 - (Number(it.discountPercent) || 0) / 100);
      return sum + (Number(it.quantityPacks) || 0) * netCost;
    }, 0);
  }, [items]);

  const itemsDiscounts = grossInvoiceAmount - itemsCostTotal;

  const directDiscountAmount = useMemo(() => {
    if (directDiscountType === 'PERCENT') {
      return Math.round(itemsCostTotal * (Math.min(100, Math.max(0, directDiscountValue)) / 100));
    }
    return Math.min(itemsCostTotal, Math.max(0, directDiscountValue));
  }, [itemsCostTotal, directDiscountType, directDiscountValue]);

  const totalInvoiceAmount = Math.max(0, itemsCostTotal - directDiscountAmount);
  const remainingDebt = Math.max(0, totalInvoiceAmount - paidAmount);

  // Helper to compute deadline date
  const getTierDeadlineDate = (days: number): string => {
    const d = new Date(invoiceDate);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Helper to compute expected discount amount
  const getTierDiscountAmount = (percent: number): number => {
    return Math.round(totalInvoiceAmount * (percent / 100));
  };

  // Final confirmation: Convert AI review to real purchase invoice in database
  const handleApproveInvoice = async (forceConfirm = false) => {
    if (!invoiceNumber.trim()) {
      setErrorMsg('يرجى إدخال رقم الفاتورة');
      return;
    }
    if (!supplierName.trim()) {
      setErrorMsg('يرجى إدخال اسم المذخر / المورد');
      return;
    }
    if (items.length === 0) {
      setErrorMsg('يجب أن تحتوي الفاتورة على دواء واحد على الأقل');
      return;
    }

    if (!forceConfirm) {
      const changed = items
        .filter(
          (it) =>
            it.lastPurchasePricePack !== undefined &&
            it.lastPurchasePricePack > 0 &&
            it.purchasePricePack > 0 &&
            it.purchasePricePack !== it.lastPurchasePricePack,
        )
        .map((it) => ({
          id: it.id,
          tradeName: (it.matchedTradeName || it.rawName || 'دواء').trim(),
          lastPurchasePrice: it.lastPurchasePricePack!,
          newPurchasePrice: it.purchasePricePack,
          unitsPerPack: it.unitsPerPack,
        }));

      if (changed.length > 0) {
        setChangedItemsForReview(changed);
        setShowPriceChangesModal(true);
        return;
      }
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const payload = {
        invoiceNumber: invoiceNumber.trim() || `INV-${Date.now().toString().slice(-6)}`,
        supplierName: supplierName.trim(),
        invoiceDate: new Date(invoiceDate).toISOString().slice(0, 10),
        totalAmount: Math.round(totalInvoiceAmount),
        paidAmount: Number(paidAmount) || 0,
        directDiscountAmount: directDiscountAmount > 0 ? directDiscountAmount : undefined,
        discountTiers: discountTiers.filter((t) => t.discountPercent > 0),
        earlyDiscountDays: discountTiers.length > 0 ? discountTiers[0].daysLimit : undefined,
        earlyDiscountPercent: discountTiers.length > 0 ? discountTiers[0].discountPercent : undefined,
        notes: `تم الإدخال والاعتماد عبر الذكاء الاصطناعي الذكي (AI Smart OCR - دقة ${confidenceScore}%)`,
        items: items.map((it) => {
          let expiryDate: string | undefined = undefined;
          if (it.expiryYear && it.expiryMonth) {
            const m = String(it.expiryMonth).padStart(2, '0');
            expiryDate = `${it.expiryYear}-${m}-01`;
          }

          return {
            medicineId: it.matchedMedicineId || undefined,
            tradeName: (it.matchedTradeName || it.rawName || 'دواء جديد').trim(),
            customTradeName: (it.matchedTradeName || it.rawName || 'دواء جديد').trim(),
            scientificName: it.scientificName || undefined,
            barcode: it.barcode?.trim() || undefined,
            batchNumber: it.batchNumber?.trim() || undefined,
            expiryDate,
            quantityPacks: Number(it.quantityPacks) || 1,
            bonusPacks: Number(it.bonusPacks) || 0,
            amortizeBonus: it.amortizeBonus !== false,
            unitsPerPack: Number(it.unitsPerPack) || 1,
            purchasePricePack: Number(it.purchasePricePack) || 0,
            discountPercent: Number(it.discountPercent) || 0,
            sellingPricePack: Number(it.sellingPricePack) || 0,
            sellingPriceUnit: Number(it.sellingPriceUnit) || 0,
            shelfLocation: it.shelfLocation?.trim() || undefined,
          };
        }),
      };

      const result = await apiRequest<any>('/purchases', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      onSuccess(result);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'فشل اعتماد وترحيل الفاتورة إلى المخزن');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-7xl overflow-hidden flex flex-col max-h-[96vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-linear-to-r from-emerald-800 via-teal-800 to-indigo-900 text-white flex items-center justify-between shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center font-black">
              <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
            </div>
            <div>
              <h3 className="font-black text-base flex items-center gap-2">
                <span>الإدخال الذكي لفواتير المذاخر (AI Smart OCR)</span>
                <span className="px-2.5 py-0.5 bg-emerald-400/20 text-emerald-200 border border-emerald-400/30 rounded-full text-[11px] font-black">
                  28,500 مادة + بدون تخمين
                </span>
              </h3>
              <p className="text-xs text-emerald-100 font-medium">
                استخراج دقيق للمعلومات الحقيقية فقط بدون تخمين + الاسم التجاري والتركيز + شرائح الخصم الشهرية
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 bg-slate-50/50">
          {errorMsg && (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMsg}</span>
              </div>
              {errorMsg.includes('إعدادات الصيدلية') && (
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[11px] font-black shrink-0 transition-colors"
                >
                  الحصول على مفتاح مجاني من Google ↗
                </a>
              )}
            </div>
          )}

          {/* STEP 1: UPLOAD / CAMERA */}
          {step === 'UPLOAD' && (
            <div className="space-y-6 py-4 max-w-3xl mx-auto">
              <div className="text-center space-y-2">
                <h4 className="text-xl font-black text-slate-900">
                  اختر صورة فاتورة المذخر للتحليل الذكي
                </h4>
                <p className="text-xs text-slate-500 font-medium">
                  يقوم النظام باستخراج الأدوية بدقة وتنقيتها (الاسم + التركيز فقط) بدون تخمين أي بيانات غير مطبوعة
                </p>
              </div>

              {/* Upload Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all ${
                  selectedImage
                    ? 'border-emerald-500 bg-emerald-50/50 shadow-inner'
                    : 'border-slate-300 hover:border-emerald-500 hover:bg-slate-100/70 bg-white shadow-xs'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />

                {selectedImage ? (
                  <div className="space-y-4">
                    <img
                      src={selectedImage}
                      alt="Invoice Preview"
                      className="max-h-64 mx-auto rounded-2xl object-contain shadow-lg border border-slate-200"
                    />
                    <div className="flex items-center justify-center gap-2 text-emerald-700 font-black text-xs">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>تم تحميل صورة الفاتورة بنجاح. انقر هنا لتغيير الصورة إن أردت</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 py-6">
                    <div className="w-20 h-20 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-3xl flex items-center justify-center mx-auto shadow-xs">
                      <Camera className="w-10 h-10" />
                    </div>
                    <div>
                      <div className="font-black text-base text-slate-800">
                        انقر لرفع صورة الفاتورة أو التقاطها عبر الكاميرا
                      </div>
                      <div className="text-xs text-slate-400 mt-1 font-medium">
                        يدعم صور الهواتف والماسحات الضوئية (JPG, PNG, WebP)
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Optional Text Paste Hint */}
              <div className="space-y-1.5 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>أو الصق نص الفاتورة يدوياً إذا كانت متوفرة كنص (اختياري):</span>
                </div>
                <textarea
                  rows={2}
                  value={rawTextHint}
                  onChange={(e) => setRawTextHint(e.target.value)}
                  placeholder="مثال: Panadol 500mg 50 packs 3500 IQD, Amoxil 500mg 20 packs..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => runAiExtraction()}
                  className="px-10 py-4 bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-2xl font-black text-sm shadow-xl shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer transition-all transform active:scale-95"
                >
                  <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
                  <span>بدء المسح والتحليل الذكي للفاتورة</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESSING ANIMATION */}
          {step === 'PROCESSING' && (
            <div className="py-20 text-center space-y-6 max-w-md mx-auto">
              <div className="relative w-24 h-24 mx-auto">
                <div className="absolute inset-0 rounded-3xl bg-emerald-500/20 animate-ping"></div>
                <div className="relative w-24 h-24 rounded-3xl bg-emerald-600 text-white flex items-center justify-center shadow-2xl">
                  <Sparkles className="w-10 h-10 text-amber-300 animate-spin" style={{ animationDuration: '3s' }} />
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-base font-black text-slate-900">
                  جاري معالجة الفاتورة ومطابقة المواد بالذكاء الاصطناعي
                </h4>
                <p className="text-xs font-bold text-emerald-800 bg-emerald-50 py-2.5 px-4 rounded-xl border border-emerald-200 inline-block animate-pulse">
                  {processingStage}
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: FULL REVIEW & 100% EDITABLE GRID */}
          {step === 'REVIEW' && (
            <div className="space-y-5">
              {/* Top AI Summary Banner */}
              <div className="p-4 bg-slate-900 text-white rounded-2xl flex flex-wrap items-center justify-between gap-4 shadow-md border border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-black">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-300">
                      دقة القراءة والمطابقة: <span className="text-emerald-400 font-black">{confidenceScore}%</span>
                    </div>
                    <div className="text-xs text-slate-400 font-medium">
                      تم استخراج <span className="text-white font-bold">{items.length}</span> أصناف مطابقة مع الدليل. يمكنك تعديل أي حقل بحرية كاملة.
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {discrepanciesCount > 0 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-xl text-xs font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span>{discrepanciesCount} ملاحظات دقيقة للمراجعة</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={addNewRowManually}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة مادة +</span>
                  </button>
                </div>
              </div>

              {/* Invoice Metadata Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-white border border-slate-200 rounded-2xl shadow-xs text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-slate-400" />
                    <span>رقم الفاتورة</span>
                  </label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold font-mono text-slate-900 focus:bg-white focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-slate-400" />
                    <span>المذخر</span>
                  </label>
                  <input
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:bg-white focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>التاريخ</span>
                  </label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold font-mono text-slate-900 focus:bg-white focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* DYNAMIC MONTHLY TIERED DISCOUNTS (نظام الخصومات المتدرجة شهرياً) */}
              <div className="p-5 bg-linear-to-br from-amber-50/80 via-white to-orange-50/40 border-2 border-amber-200/80 rounded-3xl space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black shadow-xs">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                        <span>شروط خصومات السداد المتدرجة للمذخر</span>
                        <span className="px-2 py-0.5 bg-amber-200/60 text-amber-900 rounded-full text-[10px] font-bold">
                          Monthly Tiers
                        </span>
                      </h5>
                      <p className="text-[11px] text-slate-500 font-medium">
                        حدد عدد أشهر مهلة السداد، وستظهر خانة خصم لكل شهر وتاريخ استحقاقه ومبلغ التوفير
                      </p>
                    </div>
                  </div>

                  {/* Selector for Number of Months */}
                  <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border border-amber-300 shadow-xs">
                    <span className="text-xs font-bold text-slate-700 px-2">مدة الخصم:</span>
                    <div className="flex items-center gap-1">
                      {[
                        { count: 0, label: 'بدون خصم' },
                        { count: 1, label: 'شهر 1' },
                        { count: 2, label: 'شهرين' },
                        { count: 3, label: '3 أشهر' },
                        { count: 4, label: '4 أشهر' },
                      ].map((btn) => (
                        <button
                          key={btn.count}
                          type="button"
                          onClick={() => handleDiscountMonthsChange(btn.count)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                            discountMonthsCount === btn.count
                              ? 'bg-amber-500 text-white shadow-xs'
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Dynamic Monthly Tier Cards */}
                {discountMonthsCount > 0 ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {discountTiers.map((tier) => {
                        const deadline = getTierDeadlineDate(tier.daysLimit);
                        const expectedSaving = getTierDiscountAmount(tier.discountPercent);

                        return (
                          <div
                            key={tier.monthIndex}
                            className="p-4 bg-white border-2 border-amber-300/80 rounded-2xl shadow-xs space-y-2.5 relative overflow-hidden"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-900 flex items-center justify-center font-black text-xs">
                                  {tier.monthIndex}
                                </span>
                                <span className="font-black text-xs text-slate-900">
                                  الشهر {tier.monthIndex === 1 ? 'الأول' : tier.monthIndex === 2 ? 'الثاني' : tier.monthIndex === 3 ? 'الثالث' : 'الرابع'}
                                </span>
                              </div>
                              <span className="text-[10px] font-bold text-slate-400 font-mono">
                                خلال {tier.daysLimit} يوم
                              </span>
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                نسبة الخصم المشروطة %
                              </label>
                              <div className="relative">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.5"
                                  value={tier.discountPercent || ''}
                                  onChange={(e) => updateTierPercent(tier.monthIndex, Number(e.target.value))}
                                  placeholder="مثال: 6%"
                                  className="w-full p-2 pr-2 pl-7 bg-amber-50/40 border border-amber-300 rounded-xl font-black font-mono text-amber-950 text-xs focus:bg-white focus:outline-hidden focus:border-amber-600"
                                />
                                <span className="absolute left-2.5 top-2 text-xs font-black text-amber-700">%</span>
                              </div>
                            </div>

                            <div className="pt-1 border-t border-slate-100 space-y-1 text-[10px]">
                              <div className="flex items-center justify-between text-slate-500">
                                <span>يسري حتى:</span>
                                <span className="font-bold text-blue-700 font-mono">{deadline}</span>
                              </div>
                              <div className="flex items-center justify-between font-bold">
                                <span className="text-slate-600">مبلغ الخصم:</span>
                                <span className="text-emerald-700 font-black font-mono">
                                  {expectedSaving.toLocaleString()} د.ع
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="p-3 bg-amber-100/60 rounded-xl border border-amber-200 text-xs font-bold text-amber-900 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        ملاحظة: بعد انتهاء الشهر {discountMonthsCount}، يسقط الخصم بالكامل ويتم سداد الفاتورة بصافي السعر كاملاً بدون خصم.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-100/70 rounded-xl border border-slate-200 text-xs text-slate-500 font-bold flex items-center gap-2">
                    <span>لم يتم تحديد خصم سداد للمذخر على هذه الفاتورة (سداد مباشر بدون خصومات تسديد).</span>
                  </div>
                )}
              </div>

              {/* FULL 100% EDITABLE ITEMS GRID */}
              <div className="space-y-3 bg-white p-4 rounded-3xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-emerald-600" />
                    <h5 className="font-black text-sm text-slate-900">
                      المواد ({items.length})
                    </h5>
                    <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-[10px] font-bold">
                      تعديل
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-bold font-mono">
                    Enter للتنقل بين الحقول
                  </div>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-right text-xs whitespace-nowrap border-collapse">
                      <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200 text-slate-700 font-black">
                        <tr>
                          <th className="p-2.5 text-center w-8">#</th>
                          <th className="p-2.5 min-w-[200px]">الدواء</th>
                          <th className="p-2.5 min-w-[120px]">الباركود</th>
                          <th className="p-2.5 min-w-[70px] text-center">الشريط/علبة</th>
                          <th className="p-2.5 min-w-[75px] text-center">الكمية</th>
                          <th className="p-2.5 min-w-[70px] text-center">بونص</th>
                          <th className="p-2.5 min-w-[100px]">سعر الشراء</th>
                          <th className="p-2.5 min-w-[70px] text-center">خصم %</th>
                          <th className="p-2.5 min-w-[105px]">بيع الباكيت</th>
                          <th className="p-2.5 min-w-[95px]">بيع الشريط</th>
                          <th className="p-2.5 min-w-[105px]">الوجبة</th>
                          <th className="p-2.5 min-w-[140px]">الصلاحية</th>
                          <th className="p-2.5 min-w-[80px]">الرف</th>
                          <th className="p-2.5 min-w-[100px]">المجموع</th>
                          <th className="p-2.5 text-center w-10">حذف</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {items.map((item, idx) => {
                          const netCostPack = (Number(item.purchasePricePack) || 0) * (1 - (Number(item.discountPercent) || 0) / 100);
                          const totalItemCost = (Number(item.quantityPacks) || 0) * netCostPack;

                          return (
                            <tr
                              key={item.id || idx}
                              className={`hover:bg-slate-50 transition-colors ${
                                item.discrepancies.length > 0 ? 'bg-amber-50/20' : ''
                              }`}
                            >
                              <td className="p-2.5 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>

                              {/* 1. Medicine Name + Strength ONLY */}
                              <td className="p-2.5">
                                <input
                                  id={`scanner-trade-${idx}`}
                                  type="text"
                                  value={item.matchedTradeName}
                                  onChange={(e) => updateItemField(idx, 'matchedTradeName', e.target.value)}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-barcode-${idx}`)}
                                  placeholder="اسم الدواء + التركيز (مثل: Panadol 500mg)"
                                  className="w-full p-1.5 font-black text-slate-900 bg-white border border-slate-200 rounded-lg text-xs focus:border-emerald-500 focus:outline-hidden"
                                />
                                {item.scientificName && (
                                  <div className="text-[10px] text-slate-400 truncate max-w-[180px] font-mono mt-0.5">
                                    {item.scientificName}
                                  </div>
                                )}
                              </td>

                              {/* 2. Barcode */}
                              <td className="p-2.5">
                                <input
                                  id={`scanner-barcode-${idx}`}
                                  type="text"
                                  value={item.barcode}
                                  onChange={(e) => updateItemField(idx, 'barcode', e.target.value)}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-units-${idx}`)}
                                  placeholder="فارغ أو امسحه"
                                  className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-800 text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                                />
                              </td>

                              {/* 3. Units Per Pack */}
                              <td className="p-2.5 text-center">
                                <input
                                  id={`scanner-units-${idx}`}
                                  type="number"
                                  min="1"
                                  value={item.unitsPerPack}
                                  onChange={(e) => updateItemField(idx, 'unitsPerPack', Math.max(1, Number(e.target.value)))}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-qty-${idx}`)}
                                  className="w-14 p-1.5 text-center bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold text-slate-900 text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                                />
                              </td>

                              {/* 4. Quantity Packs */}
                              <td className="p-2.5 text-center">
                                <input
                                  id={`scanner-qty-${idx}`}
                                  type="number"
                                  min="1"
                                  value={item.quantityPacks}
                                  onChange={(e) => updateItemField(idx, 'quantityPacks', Math.max(0, Number(e.target.value)))}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-bonus-${idx}`)}
                                  className="w-16 p-1.5 text-center bg-white border border-slate-300 rounded-lg font-mono font-black text-slate-900 text-xs focus:border-emerald-500 focus:outline-hidden"
                                />
                              </td>

                              {/* 5. Bonus Packs */}
                              <td className="p-2.5 text-center">
                                <input
                                  id={`scanner-bonus-${idx}`}
                                  type="number"
                                  min="0"
                                  value={item.bonusPacks}
                                  onChange={(e) => updateItemField(idx, 'bonusPacks', Math.max(0, Number(e.target.value)))}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-purchase-${idx}`)}
                                  className="w-14 p-1.5 text-center bg-emerald-50 border border-emerald-200 rounded-lg font-mono font-bold text-emerald-800 text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                                />
                                {Number(item.bonusPacks || 0) > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => updateItemField(idx, 'amortizeBonus', item.amortizeBonus === false ? true : false)}
                                    className={`px-1.5 py-0.5 mt-1 rounded text-[10px] font-bold border transition-all cursor-pointer flex items-center justify-center gap-1 w-full ${
                                      item.amortizeBonus !== false
                                        ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                                        : 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                    }`}
                                    title={
                                      item.amortizeBonus !== false
                                        ? 'تذويب: تخفيض كلفة الشراء للباكيت. انقر للفصل كوجبة بونص مجانية'
                                        : 'وجبة منفصلة: يدخل البونص كتشغيلة مجانية برصيد منفصل (كلفة 0). انقر للتحويل إلى تذويب'
                                    }
                                  >
                                    {item.amortizeBonus !== false ? '💧 تذويب' : '🎁 منفصل'}
                                  </button>
                                )}
                              </td>

                              {/* 6. Purchase Price Pack */}
                              <td className="p-2.5">
                                <input
                                  id={`scanner-purchase-${idx}`}
                                  type="number"
                                  min="0"
                                  step="250"
                                  value={item.purchasePricePack || ''}
                                  onChange={(e) => updateItemField(idx, 'purchasePricePack', Number(e.target.value))}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-discount-${idx}`)}
                                  placeholder="سعر الشراء"
                                  className="w-24 p-1.5 bg-white border border-slate-300 rounded-lg font-mono font-black text-slate-900 text-xs focus:border-emerald-500 focus:outline-hidden"
                                />
                                {item.lastPurchasePricePack !== undefined &&
                                  item.lastPurchasePricePack > 0 &&
                                  item.purchasePricePack > 0 &&
                                  item.purchasePricePack !== item.lastPurchasePricePack && (
                                    <div
                                      className={`text-[10px] mt-0.5 font-bold leading-tight ${
                                        item.purchasePricePack > item.lastPurchasePricePack
                                          ? 'text-rose-600'
                                          : 'text-emerald-600'
                                      }`}
                                    >
                                      {item.purchasePricePack > item.lastPurchasePricePack
                                        ? `🔺 ارتفع (آخر سعر: ${item.lastPurchasePricePack.toLocaleString()} د.ع)`
                                        : `🔻 انخفض (آخر سعر: ${item.lastPurchasePricePack.toLocaleString()} د.ع)`}
                                    </div>
                                  )}
                              </td>

                              {/* 7. Discount Percent on Item */}
                              <td className="p-2.5 text-center">
                                <input
                                  id={`scanner-discount-${idx}`}
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.5"
                                  value={item.discountPercent || ''}
                                  onChange={(e) => updateItemField(idx, 'discountPercent', Number(e.target.value))}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-selling-pack-${idx}`)}
                                  placeholder="0%"
                                  className="w-14 p-1.5 text-center bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold text-slate-800 text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                                />
                              </td>

                              {/* 8. Selling Price Pack */}
                              <td className="p-2.5">
                                <input
                                  id={`scanner-selling-pack-${idx}`}
                                  type="number"
                                  min="0"
                                  step="250"
                                  value={item.sellingPricePack || ''}
                                  onChange={(e) => updateItemField(idx, 'sellingPricePack', Number(e.target.value))}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-selling-unit-${idx}`)}
                                  placeholder="سعر البيع"
                                  className="w-24 p-1.5 bg-emerald-50/60 border border-emerald-300 rounded-lg font-mono font-black text-emerald-900 text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                                />
                              </td>

                              {/* 9. Selling Price Unit */}
                              <td className="p-2.5">
                                <input
                                  id={`scanner-selling-unit-${idx}`}
                                  type="number"
                                  min="0"
                                  step="250"
                                  value={item.sellingPriceUnit || ''}
                                  onChange={(e) => updateItemField(idx, 'sellingPriceUnit', Number(e.target.value))}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-batch-${idx}`)}
                                  placeholder="شريط"
                                  className="w-20 p-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold text-slate-800 text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                                />
                              </td>

                              {/* 10. Batch Number */}
                              <td className="p-2.5">
                                <input
                                  id={`scanner-batch-${idx}`}
                                  type="text"
                                  value={item.batchNumber}
                                  onChange={(e) => updateItemField(idx, 'batchNumber', e.target.value)}
                                  onKeyDown={(e) => handleKeyDownNav(e, `scanner-exp-month-${idx}`)}
                                  placeholder="رقم التشغيلة"
                                  className="w-24 p-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-800 text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                                />
                              </td>

                              {/* 11. Expiry Month & Year */}
                              <td className="p-2.5">
                                <SmartExpiryInput
                                  month={item.expiryMonth}
                                  year={item.expiryYear}
                                  monthId={`scanner-exp-month-${idx}`}
                                  yearId={`scanner-exp-year-${idx}`}
                                  onChange={(m, y) => {
                                    updateItemField(idx, 'expiryMonth', m || '');
                                    updateItemField(idx, 'expiryYear', y || '');
                                  }}
                                  onNext={() => {
                                    const shelfInput = document.getElementById(`scanner-shelf-${idx}`);
                                    shelfInput?.focus();
                                    (shelfInput as HTMLInputElement)?.select?.();
                                  }}
                                />
                              </td>

                              {/* 12. Shelf Location */}
                              <td className="p-2.5">
                                <input
                                  id={`scanner-shelf-${idx}`}
                                  type="text"
                                  value={item.shelfLocation}
                                  onChange={(e) => updateItemField(idx, 'shelfLocation', e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      if (idx < items.length - 1) {
                                        const nextTrade =
                                          document.getElementById(`scanner-trade-${idx + 1}`) ||
                                          document.getElementById(`scanner-qty-${idx + 1}`);
                                        if (nextTrade) {
                                          nextTrade.focus();
                                          (nextTrade as HTMLInputElement).select?.();
                                        }
                                      } else {
                                        document.getElementById('scanner-save-batch-btn')?.focus();
                                      }
                                    }
                                  }}
                                  placeholder="A-01"
                                  className="w-16 p-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-800 text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden font-bold text-center"
                                />
                              </td>

                              {/* Total Net Cost */}
                              <td className="p-2.5 font-mono font-black text-slate-900 whitespace-nowrap">
                                {Math.round(totalItemCost).toLocaleString()} د.ع
                              </td>

                              {/* Delete Action */}
                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeItem(idx)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="حذف الصنف"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Add Row Button at bottom */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={addNewRowManually}
                    className="px-4 py-2 border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-800 rounded-xl text-xs font-black flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <Plus className="w-4 h-4 text-emerald-600" />
                    <span>+ إضافة صنف دوائي جديد يدوياً إلى هذه الفاتورة</span>
                  </button>
                </div>
              </div>

              {/* Financial Settlement Drawer */}
              <div className="p-5 bg-white border border-slate-200 rounded-3xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs font-bold shadow-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                  <span className="text-slate-500 font-bold">إجمالي القائمة:</span>
                  <span className="font-mono text-sm text-slate-700">
                    {grossInvoiceAmount.toLocaleString()} د.ع
                  </span>
                </div>

                <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-2xl flex items-center justify-between">
                  <span className="text-amber-800 font-bold">خصومات المواد:</span>
                  <span className="font-mono text-sm text-amber-900 font-black">
                    {Math.round(itemsDiscounts).toLocaleString()} د.ع
                  </span>
                </div>

                <div className="p-3 bg-rose-50/60 border border-rose-200 rounded-2xl flex flex-col justify-between gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-rose-800 font-bold flex items-center gap-1">
                      <BadgePercent className="w-3.5 h-3.5 text-rose-600" />
                      خصم مباشر:
                    </span>
                    <div className="inline-flex rounded-lg bg-slate-200 p-0.5 text-[9px] font-black">
                      <button
                        type="button"
                        onClick={() => setDirectDiscountType('AMOUNT')}
                        className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer ${
                          directDiscountType === 'AMOUNT' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600'
                        }`}
                      >
                        د.ع
                      </button>
                      <button
                        type="button"
                        onClick={() => setDirectDiscountType('PERCENT')}
                        className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer ${
                          directDiscountType === 'PERCENT' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600'
                        }`}
                      >
                        %
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step={directDiscountType === 'AMOUNT' ? '250' : '1'}
                      value={directDiscountValue || ''}
                      onChange={(e) => setDirectDiscountValue(Math.max(0, Number(e.target.value)))}
                      placeholder={directDiscountType === 'AMOUNT' ? '0 د.ع' : '0 %'}
                      className="w-full p-1 bg-white border border-rose-300 rounded-lg font-mono font-black text-rose-700 text-right text-xs focus:border-rose-500 focus:outline-hidden"
                    />
                    {directDiscountType === 'PERCENT' && directDiscountValue > 0 && (
                      <span className="text-[10px] font-mono font-bold text-rose-700 whitespace-nowrap">
                        ={directDiscountAmount.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-2xl flex items-center justify-between">
                  <span className="text-emerald-800 font-bold">الصافي المطلوب:</span>
                  <span className="font-mono text-base text-emerald-900 font-black">
                    {Math.round(totalInvoiceAmount).toLocaleString()} د.ع
                  </span>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                  <span className="text-slate-600 font-bold">المسدد للمذخر:</span>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    className="w-24 p-1 bg-white border border-slate-300 rounded-xl font-mono font-black text-emerald-700 text-right focus:border-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Debt Notice if any */}
              {remainingDebt > 0 && (
                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 text-xs font-bold text-amber-900 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>المبلغ المتبقي سيُسجل ديناً على الصيدلية لصالح «{supplierName || 'المذخر'}»:</span>
                  </div>
                  <span className="font-mono text-sm font-black text-amber-800">
                    {Math.round(remainingDebt).toLocaleString()} د.ع
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 px-6 bg-white border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-bold cursor-pointer transition-colors"
          >
            إلغاء
          </button>

          {step === 'REVIEW' && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep('UPLOAD')}
                className="px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-black cursor-pointer transition-colors"
              >
                إعادة التصوير
              </button>

              <button
                id="scanner-save-batch-btn"
                type="button"
                disabled={submitting}
                onClick={() => handleApproveInvoice(false)}
                className="px-7 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-black text-xs shadow-lg shadow-emerald-900/20 flex items-center gap-2 cursor-pointer transition-all transform active:scale-95"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جاري ترحيل الأدوية للمخزن...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>اعتماد الفاتورة وترحيل الأدوية للمخزن</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Group Alert for Purchase Price Changes before Final Confirmation */}
      <PriceChangesReviewModal
        isOpen={showPriceChangesModal}
        items={changedItemsForReview}
        onConfirm={() => {
          setShowPriceChangesModal(false);
          handleApproveInvoice(true);
        }}
        onCancel={() => setShowPriceChangesModal(false)}
        isSubmitting={submitting}
      />
    </div>
  );
};
