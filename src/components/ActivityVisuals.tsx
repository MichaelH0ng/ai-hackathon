import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { formatDate, formatLongDate } from "../lib/dates";
import { formatExact } from "../lib/finance";
import { budgetPace, dailySpending, heatLevel, monthGrid, monthSpending } from "../lib/activityInsights";
import { type BankTransaction, categoryLabel } from "../lib/money";
import { Card } from "./ui";
import { Segmented } from "./Segmented";
import { CategoryIcon } from "./CategoryIcon";

const money = (n: number) => formatExact(n);

/** The month's spending against the monthly plan, with a tick for how far through the month you are. */
export function BudgetPace({ transactions, transferIds, budget }: { transactions: BankTransaction[]; transferIds: Set<string>; budget: number }) {
  const now = new Date();
  const spent = monthSpending(transactions, transferIds, now);
  const pace = budgetPace(spent, budget, now);
  const tone = pace.status === "over" ? "bg-amber-600" : pace.status === "ahead" ? "bg-amber-400" : "bg-brand-500";
  const message =
    pace.status === "over" ? `${money(-pace.left)} over your monthly plan.`
    : pace.status === "ahead" ? `${money(pace.left)} left, and you're spending a little faster than the month is passing.`
    : `${money(pace.left)} left. You're on track for the month.`;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">This month vs. your plan</h2>
        <p className="text-sm text-stone-500"><strong className="tabular-nums text-ink">{money(spent)}</strong> of {money(budget)}</p>
      </div>
      <div className="relative mt-3 h-3 rounded-full bg-stone-100" role="img" aria-label={`${Math.round(pace.spentPct * 100)}% of your monthly plan spent, ${Math.round(pace.monthPct * 100)}% of the month gone`}>
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pace.spentPct * 100)}%` }} />
        <span className="absolute -top-1 h-5 w-0.5 rounded bg-stone-500" style={{ left: `${pace.monthPct * 100}%` }} aria-hidden="true" />
      </div>
      <p className="mt-2 text-sm text-stone-600">{message}</p>
      <p className="mt-1 text-xs text-stone-500">The tick shows how far through the month you are. Your plan is essentials plus lifestyle from the Plan tab.</p>
    </Card>
  );
}

/** Spending over time: a 30-day bar chart or a month calendar. Tapping a day filters the transactions to it. */
export function SpendingOverview({ transactions, transferIds, selectedDay, onSelectDay }: {
  transactions: BankTransaction[];
  transferIds: Set<string>;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  const [view, setView] = useState<"trend" | "calendar">("trend");
  const [monthOffset, setMonthOffset] = useState(0);
  const now = new Date();
  const days = useMemo(() => dailySpending(transactions, transferIds, 30), [transactions, transferIds]);
  const total = days.reduce((s, d) => s + d.spent, 0);
  const top = days.reduce((a, b) => (b.spent > a.spent ? b : a), days[0] ?? { date: "", spent: 0 });
  const shown = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const shownYear = shown.getFullYear();
  const shownMonth = shown.getMonth();
  const weeks = useMemo(() => monthGrid(transactions, transferIds, shownYear, shownMonth), [transactions, transferIds, shownYear, shownMonth]);
  const monthMax = Math.max(0, ...weeks.flat().map((c) => c?.spent ?? 0));
  const toggle = (date: string) => onSelectDay(selectedDay === date ? null : date);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Spending over time</h2>
        <Segmented label="Spending view" options={[{ value: "trend", label: "Trend" }, { value: "calendar", label: "Calendar" }]} value={view} onChange={setView} />
      </div>

      {view === "trend" ? (
        <>
          <p className="mt-2 text-sm text-stone-600">
            <strong className="tabular-nums text-ink">{money(total)}</strong> over the last 30 days
            {top.spent > 0 && <>, most on <strong className="text-ink">{formatDate(top.date)}</strong> ({money(top.spent)})</>}.
          </p>
          <div className="mt-3 flex h-28 items-end gap-[3px]" role="group" aria-label="Daily spending, last 30 days. Tap a bar to see that day's transactions.">
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => toggle(d.date)}
                aria-pressed={selectedDay === d.date}
                aria-label={`${formatDate(d.date)}: ${money(d.spent)} spent`}
                title={`${formatDate(d.date)}: ${money(d.spent)}`}
                className="group flex h-full min-w-0 flex-1 items-end rounded-sm"
              >
                <span
                  className={`block w-full rounded-t-sm transition-colors ${selectedDay === d.date ? "bg-amber-500" : "bg-brand-500 group-hover:bg-brand-600"} ${d.spent === 0 ? "opacity-30" : ""}`}
                  style={{ height: `${d.spent === 0 ? 2 : Math.max(6, (d.spent / (top.spent || 1)) * 100)}%` }}
                />
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-stone-500" aria-hidden="true">
            <span>{formatDate(days[0]?.date ?? "")}</span>
            <span>Today</span>
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setMonthOffset((n) => n - 1)} aria-label="Previous month" className="grid min-h-11 min-w-11 place-items-center rounded-xl text-stone-600 hover:bg-stone-100"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
            <strong className="text-ink">{shown.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong>
            <button type="button" onClick={() => setMonthOffset((n) => Math.min(0, n + 1))} disabled={monthOffset >= 0} aria-label="Next month" className="grid min-h-11 min-w-11 place-items-center rounded-xl text-stone-600 hover:bg-stone-100 disabled:opacity-30"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1 text-center text-xs font-bold text-stone-500" aria-hidden="true">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {weeks.flat().map((cell, i) => {
              if (!cell) return <span key={i} aria-hidden="true" />;
              const level = heatLevel(cell.spent, monthMax);
              const percent = [0, 18, 35, 55, 75][level];
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => toggle(cell.date)}
                  aria-pressed={selectedDay === cell.date}
                  aria-label={`${formatLongDate(cell.date)}: ${money(cell.spent)} spent`}
                  title={`${formatDate(cell.date)}: ${money(cell.spent)}`}
                  className={`grid aspect-square min-h-9 place-items-center rounded-lg text-xs font-semibold text-stone-800 ring-1 ${selectedDay === cell.date ? "ring-2 ring-amber-500" : "ring-stone-200 hover:ring-stone-400"}`}
                  style={{ background: percent ? `color-mix(in srgb, var(--aurora-teal, #14b8a6) ${percent}%, transparent)` : undefined }}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-stone-500">Darker days are heavier spending. Tap a day to see its transactions.</p>
        </>
      )}
    </Card>
  );
}

/** One transaction in full, with what it means for your goal and a shortcut to ask Polaris about it. */
export function TransactionDetail({ transaction: t, transfer, accountLabel, goalLine, unusualLine, onClose, onSeeMerchant, onAsk }: {
  transaction: BankTransaction;
  transfer: boolean;
  accountLabel: string;
  /** "About 3 days of what you save toward Japan trip." */
  goalLine: string | null;
  unusualLine: string | null;
  onClose: () => void;
  onSeeMerchant: () => void;
  onAsk: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const out = t.amount > 0;
  // The parent hands over a new onClose each render, so keep the latest in a ref and set focus up only once.
  const closeLatest = useRef(onClose);
  useEffect(() => { closeLatest.current = onClose; });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeLatest.current(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, []);
  const host = (() => {
    if (!t.website) return null;
    try { return new URL(t.website.startsWith("http") ? t.website : `https://${t.website}`).hostname.replace(/^www\./, ""); } catch { return null; }
  })();
  const rows: [string, string][] = [
    ["Date", formatLongDate(t.date)],
    ["Account", accountLabel],
    ["Category", transfer ? "Transfer between accounts" : categoryLabel(t.category)],
    ["Status", t.pending ? "Pending. The amount can still change." : "Posted"],
  ];
  if (t.raw && t.raw !== t.name) rows.push(["Bank description", t.raw]);
  if (host) rows.push(["Website", host]);
  return (
    <div className="wealth-modal-backdrop" onClick={onClose}>
      <section className="wealth-modal" role="dialog" aria-modal="true" aria-labelledby="txn-title" onClick={(e) => e.stopPropagation()}>
        <div className="wealth-section-head">
          <div className="flex min-w-0 items-center gap-3">
            <CategoryIcon category={transfer ? (t.amount < 0 ? "TRANSFER_IN" : "TRANSFER_OUT") : t.category} logo={transfer ? undefined : t.logo} />
            <div className="min-w-0">
              <h2 id="txn-title" className="truncate">{t.name}</h2>
              <p className={`font-display text-2xl font-bold tabular-nums ${out ? "text-ink" : "text-[var(--color-gain)]"}`}>{out ? "−" : "+"}{money(Math.abs(t.amount))}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" className="wealth-icon-button" aria-label="Close details" onClick={onClose}><X size={20} /></button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-stone-500">{label}</dt>
              <dd className="text-right font-semibold text-stone-800">{value}</dd>
            </div>
          ))}
        </dl>
        {unusualLine && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{unusualLine}</p>}
        {goalLine && <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700">{goalLine}</p>}
        <div className="wealth-modal-actions mt-5">
          <button type="button" className="wealth-secondary" onClick={onSeeMerchant}>More from {t.name.length > 18 ? "this merchant" : t.name}</button>
          <button type="button" className="wealth-primary" onClick={onAsk}><Sparkles size={16} aria-hidden="true" /> Ask Polaris</button>
        </div>
      </section>
    </div>
  );
}
