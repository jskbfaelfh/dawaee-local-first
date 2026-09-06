import React, { useRef } from 'react';

interface SmartExpiryInputProps {
  month: number | '' | undefined;
  year: number | '' | undefined; // Can be 2027 or 27
  onChange: (month: number, year: number) => void;
  onNext?: () => void;
  monthId?: string;
  yearId?: string;
  className?: string;
  disabled?: boolean;
}

export const SmartExpiryInput: React.FC<SmartExpiryInputProps> = ({
  month,
  year,
  onChange,
  onNext,
  monthId,
  yearId,
  className = '',
  disabled = false,
}) => {
  const monthInputRef = useRef<HTMLInputElement>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);

  // Normalize month display (no leading zero, 1-12)
  const displayMonth =
    month !== undefined && month !== '' && Number(month) > 0 ? String(Number(month)) : '';

  // Normalize year display (only the last 2 digits, e.g. 27 for 2027)
  const displayYear = (() => {
    if (year === undefined || year === '' || Number(year) <= 0) return '';
    const yNum = Number(year);
    if (yNum >= 2000) {
      return String(yNum).slice(-2);
    }
    return String(yNum);
  })();

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, ''); // only digits
    if (raw === '') {
      onChange(0, year && Number(year) > 0 ? (Number(year) < 2000 ? 2000 + Number(year) : Number(year)) : 2027);
      return;
    }

    let val = parseInt(raw, 10);
    // If user types numbers > 12, cap to 12
    if (val > 12) {
      val = 12;
    }

    const currentFullYear =
      year && Number(year) > 0 ? (Number(year) < 2000 ? 2000 + Number(year) : Number(year)) : 2027;
    onChange(val, currentFullYear);

    // If user typed 2-9, it's definitely a single digit month, auto-focus year input!
    if (raw.length === 1 && val >= 2 && val <= 9) {
      yearInputRef.current?.focus();
      yearInputRef.current?.select();
    } else if (raw.length >= 2) {
      // If user typed 2 digits (e.g. 10, 11, 12), auto-focus year input
      yearInputRef.current?.focus();
      yearInputRef.current?.select();
    }
  };

  const handleMonthKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      yearInputRef.current?.focus();
      yearInputRef.current?.select();
    }
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(-2); // only last 2 digits
    const currentMonth = month && Number(month) > 0 ? Number(month) : 12;

    if (raw === '') {
      onChange(currentMonth, 0);
      return;
    }

    const yy = parseInt(raw, 10);
    const fullYear = 2000 + yy;
    onChange(currentMonth, fullYear);
  };

  const handleYearKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (onNext) {
        onNext();
      }
    } else if (e.key === 'Backspace' && displayYear === '') {
      // Focus back to month
      monthInputRef.current?.focus();
    }
  };

  return (
    <div
      dir="ltr"
      className={`inline-flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs transition-all focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      } ${className}`}
    >
      {/* Month input (1-12 without leading zero) */}
      <input
        ref={monthInputRef}
        id={monthId}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        placeholder="1-12"
        value={displayMonth}
        onChange={handleMonthChange}
        onKeyDown={handleMonthKeyDown}
        className="w-7 text-center font-mono font-bold text-slate-900 bg-transparent outline-hidden placeholder:text-slate-300 select-all"
        title="شهر الصلاحية (من 1 إلى 12 بدون صفر)"
      />

      <span className="text-slate-400 font-bold select-none">/</span>

      {/* Year input with fixed '20' prefix */}
      <div className="inline-flex items-center font-mono font-bold text-slate-900">
        <span className="text-slate-400 select-none text-[11px]">20</span>
        <input
          ref={yearInputRef}
          id={yearId}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          placeholder="27"
          maxLength={2}
          value={displayYear}
          onChange={handleYearChange}
          onKeyDown={handleYearKeyDown}
          className="w-5 text-left font-mono font-bold text-slate-900 bg-transparent outline-hidden placeholder:text-slate-300 select-all"
          title="سنة الصلاحية (اكتب آخر رقمين فقط مثل 27 أو 28)"
        />
      </div>
    </div>
  );
};
