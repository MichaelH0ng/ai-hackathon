import { useRef, useState, type ReactNode } from "react";
import { formatExact, formatMoney } from "../lib/finance";
import { monthlyFlow, monthPace, niceMax, topMerchants, weekdaySpending } from "../lib/activityInsights";
import type { BankTransaction } from "../lib/money";
import { Card } from "./ui";

// Charts for the Activity page. Plain HTML and SVG, no chart library. Colors come from the .ns-chart variables
// in index.css (checked for color-blind separation). Every chart has a hover/focus readout and a "View as table".

const money = (n: number) => formatExact(n);
/** Axis ticks: whole dollars, masked when "hide amounts" is on. */
const tick = (n: number) => formatMoney(n);
const FULL_DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

interface TipRow { label: string; value: string; color?: string }
interface TipState { x: number; y: number; title: string; rows: TipRow[] }

/** One floating readout per chart. Values are always also in the table view, so the tooltip never gates them. */
function useChartTip() {
  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const clampX = (x: number, width: number) => Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return {
    frame,
    tip,
    /** Show the readout above an element (a bar or column), centered on it. */
    showOn(target: Element, title: string, rows: TipRow[]) {
      const f = frame.current?.getBoundingClientRect();
      if (!f) return;
      const r = target.getBoundingClientRect();
      setTip({ x: clampX(r.left - f.left + r.width / 2, f.width), y: r.top - f.top - 6, title, rows });
    },
    /** Show the readout at a spot inside the chart frame (the crosshair on a line chart). */
    showAt(x: number, y: number, title: string, rows: TipRow[]) {
      const width = frame.current?.getBoundingClientRect().width ?? 0;
      setTip({ x: clampX(x, width), y, title, rows });
    },
    hide: () => setTip(null),
  };
}

function ChartTip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className="ns-chart-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      <span className="tip-title">{tip.title}</span>
      {tip.rows.map((row) => (
        <span key={row.label} className="tip-row">
          <span>{row.color && <span className="tip-key" style={{ background: row.color }} />}{row.label}</span>
          <strong className="tabular-nums">{row.value}</strong>
        </span>
      ))}
    </div>
  );
}

function ChartCard({ title, subtitle, legend, children }: { title: string; subtitle?: ReactNode; legend?: ReactNode; children: ReactNode }) {
  return (
    <Card className="ns-chart">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {legend && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600">{legend}</div>}
      </div>
      {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
      {children}
    </Card>
  );
}

const Swatch = ({ color, line = false, label }: { color: string; line?: boolean; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span aria-hidden="true" style={{ background: color, width: line ? 14 : 10, height: line ? 2 : 10, borderRadius: line ? 1 : 2 }} />
    {label}
  </span>
);

/** The same numbers as the chart, as a table, for screen readers and anyone who wants exact values. */
function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="inline-flex min-h-9 cursor-pointer items-center font-bold text-brand-700">View as table</summary>
      <table className="ns-chart-table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j} className="tabular-nums">{cell}</td>))}</tr>)}</tbody>
      </table>
    </details>
  );
}

/** Horizontal hairlines at the bottom, middle, and top, with the dollar values beside them. */
function YAxis({ max, height }: { max: number; height: string }) {
  return (
    <div className={`relative w-11 shrink-0 text-right text-[11px] text-stone-500 ${height}`} aria-hidden="true">
      {[0, 0.5, 1].map((f) => <span key={f} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${(1 - f) * 100}%` }}>{tick(max * f)}</span>)}
    </div>
  );
}
const Gridlines = () => (
  <>
    {[0, 50, 100].map((p) => <span key={p} className="pointer-events-none absolute inset-x-0 h-px" style={{ top: `${p}%`, background: "var(--chart-grid)" }} aria-hidden="true" />)}
  </>
);

// ---------- money in vs. spending, by month ----------

export function MonthlyFlowChart({ transactions, transferIds }: { transactions: BankTransaction[]; transferIds: Set<string> }) {
  const rows = monthlyFlow(transactions, transferIds);
  const { frame, tip, showOn, hide } = useChartTip();
  if (rows.length < 2) return null;
  const max = niceMax(Math.max(...rows.flatMap((r) => [r.in, r.out])));
  const pct = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / max) * 100));
  const rowsText = (r: (typeof rows)[number]): TipRow[] => [
    { label: "Money in", value: money(r.in), color: "var(--chart-income)" },
    { label: "Spending", value: money(r.out), color: "var(--chart-spend)" },
    { label: r.in >= r.out ? "Left over" : "Over by", value: money(Math.abs(r.in - r.out)) },
  ];
  const latest = rows.at(-1)!;
  return (
    <ChartCard
      title="Money in vs. spending"
      subtitle={`${latest.label} so far: ${money(latest.in)} in, ${money(latest.out)} out.`}
      legend={<><Swatch color="var(--chart-income)" label="Money in" /><Swatch color="var(--chart-spend)" label="Spending" /></>}
    >
      <div ref={frame} className="relative mt-3" onPointerLeave={hide}>
        <div className="flex gap-1">
          <YAxis max={max} height="h-36" />
          <div className="relative h-36 min-w-0 flex-1">
            <Gridlines />
            <div className="absolute inset-0 flex" role="group" aria-label="Money in and spending for each month. Each month is a button with its exact figures.">
              {rows.map((r) => (
                <button
                  key={r.month}
                  type="button"
                  aria-label={`${r.label}${r.partial ? " so far" : ""}: ${money(r.in)} in, ${money(r.out)} spent`}
                  onPointerEnter={(e) => showOn(e.currentTarget, `${r.label}${r.partial ? " (so far)" : ""}`, rowsText(r))}
                  onFocus={(e) => showOn(e.currentTarget, `${r.label}${r.partial ? " (so far)" : ""}`, rowsText(r))}
                  onBlur={hide}
                  className="ns-chart-bar flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-md px-1 hover:bg-[var(--chart-grid)] focus-visible:bg-[var(--chart-grid)]"
                >
                  <span className="block w-full max-w-6 rounded-t-[4px]" style={{ height: `${pct(r.in)}%`, background: "var(--chart-income)" }} />
                  <span className="block w-full max-w-6 rounded-t-[4px]" style={{ height: `${pct(r.out)}%`, background: "var(--chart-spend)" }} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-1 flex gap-1" aria-hidden="true">
          <span className="w-11 shrink-0" />
          <div className="flex min-w-0 flex-1">{rows.map((r) => <span key={r.month} className="min-w-0 flex-1 text-center text-xs text-stone-500">{r.label}</span>)}</div>
        </div>
        <ChartTip tip={tip} />
      </div>
      <TableView caption="Money in and spending by month" head={["Month", "Money in", "Spending"]} rows={rows.map((r) => [`${r.label}${r.partial ? " (so far)" : ""}`, money(r.in), money(r.out)])} />
    </ChartCard>
  );
}

// ---------- this month's running total vs. last month's ----------

export function MonthPaceChart({ transactions, transferIds }: { transactions: BankTransaction[]; transferIds: Set<string> }) {
  const now = new Date();
  const pace = monthPace(transactions, transferIds, now);
  const { frame, tip, showAt, hide } = useChartTip();
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  if (pace.thisTotal === 0 && pace.lastTotal === 0) return null;
  const days = pace.points.length;
  const max = niceMax(Math.max(...pace.points.flatMap((p) => [p.current ?? 0, p.previous ?? 0])));
  const x = (day: number) => (days > 1 ? ((day - 1) / (days - 1)) * 100 : 0);
  const y = (v: number) => 100 - (v / max) * 100;
  const line = (key: "current" | "previous") => pace.points.filter((p) => p[key] !== null).map((p) => `${x(p.day)},${y(p[key]!)}`).join(" ");
  const currentPoints = pace.points.filter((p) => p.current !== null);
  const area = currentPoints.length > 1 ? `${x(1)},100 ${line("current")} ${x(currentPoints.at(-1)!.day)},100` : "";
  const end = currentPoints.at(-1);
  const gap = pace.thisTotal - pace.lastSameDay;
  const summary = Math.abs(gap) < 1
    ? `You've spent ${money(pace.thisTotal)} so far, about the same as this point last month.`
    : `You've spent ${money(pace.thisTotal)} so far, ${money(Math.abs(gap))} ${gap > 0 ? "more" : "less"} than this point last month.`;
  const dayLabel = (month: Date, day: number) => new Date(month.getFullYear(), month.getMonth(), day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const read = (day: number) => {
    const p = pace.points[day - 1];
    if (!p) return;
    setHoverDay(day);
    const box = frame.current?.getBoundingClientRect();
    const plot = frame.current?.querySelector("[data-plot]")?.getBoundingClientRect();
    if (!box || !plot) return;
    const px = plot.left - box.left + (x(day) / 100) * plot.width;
    showAt(px, 44, `Day ${day}`, [
      { label: `This month (${dayLabel(now, day)})`, value: p.current === null ? "Not yet" : money(p.current), color: "var(--chart-spend)" },
      { label: `Last month (${dayLabel(lastMonth, day)})`, value: p.previous === null ? "No day" : money(p.previous), color: "var(--chart-muted)" },
    ]);
  };
  const dayFromPointer = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.min(days, Math.max(1, Math.round(((clientX - r.left) / r.width) * (days - 1)) + 1));
  };
  const clear = () => { setHoverDay(null); hide(); };
  const hover = hoverDay === null ? null : pace.points[hoverDay - 1];

  return (
    <ChartCard
      title="This month vs. last month"
      subtitle={summary}
      legend={<><Swatch line color="var(--chart-spend)" label="This month" /><Swatch line color="var(--chart-muted)" label="Last month" /></>}
    >
      <div ref={frame} className="relative mt-3">
        <div className="flex gap-1">
          <YAxis max={max} height="h-36" />
          <div className="relative h-36 min-w-0 flex-1" data-plot>
            <Gridlines />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              {area && <polygon points={area} fill="var(--chart-spend)" opacity="0.1" />}
              <polyline points={line("previous")} fill="none" stroke="var(--chart-muted)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <polyline points={line("current")} fill="none" stroke="var(--chart-spend)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {end && end.current !== null && (
              <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${x(end.day)}%`, top: `${y(end.current)}%`, background: "var(--chart-spend)", boxShadow: "0 0 0 2px var(--chart-surface)" }} aria-hidden="true" />
            )}
            {hover && <span className="pointer-events-none absolute inset-y-0 w-px" style={{ left: `${x(hover.day)}%`, background: "var(--chart-muted)" }} aria-hidden="true" />}
            <div
              tabIndex={0}
              role="group"
              aria-label="Running spending by day of the month. Use the left and right arrow keys to read each day."
              className="absolute inset-0 touch-pan-y rounded-md"
              onPointerMove={(e) => read(dayFromPointer(e.clientX, e.currentTarget))}
              onPointerLeave={clear}
              onFocus={() => read(hoverDay ?? pace.today)}
              onBlur={clear}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                read(Math.min(days, Math.max(1, (hoverDay ?? pace.today) + (e.key === "ArrowRight" ? 1 : -1))));
              }}
            />
          </div>
        </div>
        <div className="mt-1 flex gap-1 text-xs text-stone-500" aria-hidden="true">
          <span className="w-11 shrink-0" />
          <div className="flex min-w-0 flex-1 justify-between"><span>1</span><span>{Math.ceil(days / 2)}</span><span>{days}</span></div>
        </div>
        <ChartTip tip={tip} />
      </div>
      <TableView
        caption="Running spending by day of the month, this month and last month"
        head={["Day", "This month", "Last month"]}
        rows={pace.points.filter((p) => p.day === 1 || p.day % 5 === 0 || p.day === pace.today || p.day === days).map((p) => [String(p.day), p.current === null ? "" : money(p.current), p.previous === null ? "" : money(p.previous)])}
      />
    </ChartCard>
  );
}

// ---------- spending by day of the week ----------

export function WeekdayChart({ transactions, transferIds }: { transactions: BankTransaction[]; transferIds: Set<string> }) {
  const rows = weekdaySpending(transactions, transferIds);
  const { frame, tip, showOn, hide } = useChartTip();
  const top = rows.reduce((a, b) => (b.average > a.average ? b : a), rows[0]!);
  if (top.average <= 0) return null;
  const plural = FULL_DAYS[top.weekday]!;
  const tipRows = (r: (typeof rows)[number]): TipRow[] => [
    { label: "Average", value: money(r.average), color: "var(--chart-spend)" },
    { label: `Total over ${r.days} ${r.days === 1 ? "day" : "days"}`, value: money(r.total) },
  ];
  return (
    <ChartCard title="Your week" subtitle={<>You spend the most on <strong className="text-ink">{plural}</strong>, about {money(top.average)} on an average one. Based on the last 90 days.</>}>
      <div ref={frame} className="relative mt-3" onPointerLeave={hide}>
        <div className="relative h-32">
          <Gridlines />
          <div className="absolute inset-0 flex" role="group" aria-label="Average spending for each day of the week. Each day is a button with its exact figures.">
            {rows.map((r) => (
              <button
                key={r.weekday}
                type="button"
                aria-label={`${r.label}: ${money(r.average)} on average`}
                onPointerEnter={(e) => showOn(e.currentTarget, r.label, tipRows(r))}
                onFocus={(e) => showOn(e.currentTarget, r.label, tipRows(r))}
                onBlur={hide}
                className="ns-chart-bar flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-md px-1 hover:bg-[var(--chart-grid)] focus-visible:bg-[var(--chart-grid)]"
              >
                {r.weekday === top.weekday && <span className="mb-1 text-[11px] font-bold tabular-nums text-ink">{money(r.average)}</span>}
                <span className="block w-full max-w-6 rounded-t-[4px]" style={{ height: `${r.average <= 0 ? 0 : Math.max(2, (r.average / top.average) * 82)}%`, background: "var(--chart-spend)", opacity: r.weekday === top.weekday ? 1 : 0.55 }} />
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1 flex" aria-hidden="true">{rows.map((r) => <span key={r.weekday} className="min-w-0 flex-1 text-center text-xs text-stone-500">{r.label}</span>)}</div>
        <ChartTip tip={tip} />
      </div>
      <TableView caption="Average spending by day of the week" head={["Day", "Average", "Total", "Days counted"]} rows={rows.map((r) => [r.label, money(r.average), money(r.total), String(r.days)])} />
    </ChartCard>
  );
}

// ---------- biggest merchants ----------

export function TopMerchantsChart({ transactions, transferIds, onPick }: { transactions: BankTransaction[]; transferIds: Set<string>; onPick: (name: string) => void }) {
  const rows = topMerchants(transactions, transferIds);
  if (rows.length === 0) return null;
  const max = rows[0]!.total;
  return (
    <ChartCard title="Top places you spent" subtitle="The last 30 days. Tap one to see its transactions.">
      <ul className="mt-2">
        {rows.map((m) => (
          <li key={m.name}>
            <button type="button" onClick={() => onPick(m.name)} className="block min-h-11 w-full rounded-xl px-2 py-2 text-left hover:bg-stone-50">
              <span className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-semibold text-stone-800">{m.name}</span>
                <span className="shrink-0 tabular-nums"><strong className="text-ink">{money(m.total)}</strong> <span className="text-xs text-stone-500">· {m.count} {m.count === 1 ? "charge" : "charges"}</span></span>
              </span>
              <span className="mt-1 block h-2 rounded-full" style={{ background: "var(--chart-grid)" }}>
                <span className="block h-full rounded-full" style={{ width: `${(m.total / max) * 100}%`, background: "var(--chart-spend)" }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <TableView caption="Top merchants, last 30 days" head={["Merchant", "Total", "Charges"]} rows={rows.map((m) => [m.name, money(m.total), String(m.count)])} />
    </ChartCard>
  );
}
