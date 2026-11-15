import type { ReactNode } from "react";

// Plain, functional building blocks. Visual design comes later.

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`clay p-5 ${className}`}>{children}</div>;
}

const inputClass =
  "w-full min-w-0 rounded-xl bg-stone-50 px-3 py-2.5 text-stone-900 outline-none";

function Label({ text, hint, children }: { text?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="ui-field block min-w-0">
      {text && <span className="mb-1 block text-sm font-medium text-stone-700">{text}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  prefix = "$",
  suffix,
  hint,
  step = "any",
}: {
  label?: string;
  value: number | "";
  onChange: (v: number | "") => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  step?: string;
}) {
  return (
    <Label text={label} hint={hint}>
      <div className="ui-number-field flex items-center rounded-xl bg-stone-50">
        {prefix && <span className="pl-3 text-stone-500">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full min-w-0 bg-transparent px-2 py-2.5 text-stone-900 outline-none"
        />
        {suffix && <span className="pr-3 text-sm text-stone-500">{suffix}</span>}
      </div>
    </Label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  autoComplete,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  /** "email" / "tel" bring up the right phone keyboard. */
  type?: "text" | "email" | "tel";
  autoComplete?: string;
}) {
  return (
    <Label text={label} hint={hint}>
      <input type={type} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
    </Label>
  );
}

export function DateField({
  label,
  value,
  onChange,
  min,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  hint?: string;
}) {
  return (
    <Label text={label} hint={hint}>
      <input type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </Label>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-brand-600 text-white shadow-[0_4px_0_0_rgb(59_7_100/0.25)] hover:bg-brand-700 active:translate-y-px disabled:bg-stone-300 disabled:shadow-none",
    secondary: "bg-stone-100 text-stone-800 ring-1 ring-stone-300 hover:bg-stone-200 disabled:opacity-50",
    ghost: "text-stone-600 hover:bg-stone-100",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`ui-button ui-button-${variant} min-h-11 rounded-2xl px-4 py-2.5 text-sm font-bold transition-all duration-200 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm ring-1 ${
        active ? "bg-brand-600 text-white ring-brand-600" : "bg-stone-100 text-stone-800 ring-stone-300 hover:bg-stone-200"
      }`}
    >
      {children}
    </button>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-stone-200">
      <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone = "default" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "good" | "warn" }) {
  // Theme tokens (not fixed shades) so these stay readable in the dark theme too.
  const color = { default: "text-stone-900", good: "text-gain", warn: "text-cost" }[tone];
  return (
    <div className="rounded-xl bg-stone-50 p-3 text-center">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-stone-500">{sub}</p>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "good" | "warn"; children: ReactNode }) {
  const styles = {
    info: "bg-sky-50 text-sky-950 ring-sky-200",
    good: "bg-emerald-50 text-emerald-950 ring-emerald-200",
    warn: "bg-amber-50 text-amber-950 ring-amber-200",
  }[tone];
  return <div className={`rounded-xl p-3 text-sm ring-1 ${styles}`}>{children}</div>;
}

export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 inline-flex min-h-11 items-center text-sm font-bold text-brand-700">
      ← {label}
    </button>
  );
}

/** A labelled checkbox with an optional one-line hint underneath. */
export function CheckboxField({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="checkbox-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-semibold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-sm text-stone-600">{hint}</span>}
      </span>
    </label>
  );
}
