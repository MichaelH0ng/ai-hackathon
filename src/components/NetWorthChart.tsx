import { CountUp } from "./CountUp";
import { useId, useMemo, useRef, useState } from "react";
import { addDays, formatDate } from "../lib/dates";
import { formatMoney } from "../lib/finance";
import type { BankTransaction, NetWorthPoint } from "../lib/money";

const W = 800;
const H = 240;
const PAD = 10;
const PERIODS = [
  { key: "1W", days: 7, label: "Past week" },
  { key: "1M", days: 30, label: "Past month" },
  { key: "3M", days: 90, label: "Past 3 months" },
  { key: "YTD", label: "Year to date" },
  { key: "ALL", label: "All available history" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

const UP = "#54e2c2";
const DOWN = "#ffb47a";
const money = (n: number) => formatMoney(n, true);
type ChartTransaction = Pick<BankTransaction, "id" | "date" | "name" | "amount" | "category" | "pending">;

function RecapMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-stone-100 bg-white/45 px-3 py-2.5">
      <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-stone-500">{label}</dt>
      <dd className="mt-1 text-sm font-bold tabular-nums text-ink">{value}</dd>
      {detail && <span className="mt-0.5 block text-[11px] text-stone-500">{detail}</span>}
    </div>
  );
}

/**
 * Robinhood-style net worth chart: big number on top, one clean line, period tabs below.
 * Hover or drag across the line and the number swaps to that day's value.
 */
export function NetWorthChart({ series, transactions = [] }: { series: NetWorthPoint[]; transactions?: ChartTransaction[] }) {
  const [period, setPeriod] = useState<Period>("1M");
  const [hover, setHover] = useState<number | null>(null);
  const [activeMarker, setActiveMarker] = useState<{ index: number; name: string; amount: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gid = useId();

  const p = PERIODS.find((x) => x.key === period)!;
  const pts = useMemo(() => {
    const latest = series.at(-1)?.date;
    if (!latest) return [];
    if (p.key === "ALL") return series;
    if (p.key === "YTD") return series.filter((point) => point.date >= `${latest.slice(0, 4)}-01-01`);
    // Use date strings rather than an array slice so a partial data history is
    // still described accurately when a connection is new.
    return series.filter((point) => point.date >= addDays(latest, -(p.days ?? 0)));
  }, [series, p]);
  const first = pts[0]?.value ?? 0;
  const last = pts.at(-1)?.value ?? 0;
  const shown = hover != null ? pts[hover] : pts.at(-1);
  const change = (shown?.value ?? 0) - first;
  const periodChange = last - first;
  const pct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;
  const up = last >= first;
  const color = up ? UP : DOWN;

  const values = pts.map((x) => x.value);
  const min = Math.min(...values, first);
  const max = Math.max(...values, first);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / Math.max(1, pts.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (H - PAD * 2) * (1 - (v - min) / span);
  const line = pts.map((pt, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pt.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const transactionMarkers = useMemo(() => {
    // Mark only material posted activity, not every purchase, and never label
    // own-account transfers as an explanation for a net-worth move.
    if (pts.length < 2) return [];
    const threshold = Math.max(100, span * .05);
    return transactions
      .filter((transaction) => !transaction.pending && !transaction.category.startsWith("TRANSFER") && transaction.category !== "LOAN_PAYMENTS" && transaction.date >= pts[0].date && transaction.date <= pts.at(-1)!.date && Math.abs(transaction.amount) >= threshold)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 3)
      .map((transaction) => ({ ...transaction, index: pts.findIndex((point) => point.date >= transaction.date) }))
      .filter((transaction) => transaction.index >= 0)
      .sort((a, b) => a.index - b.index);
  }, [pts, span, transactions]);

  function track(clientX: number) {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || pts.length < 2) return;
    const i = Math.round((((clientX - r.left) / r.width) * W - PAD) / ((W - PAD * 2) / (pts.length - 1)));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  }

  if (pts.length < 2) return null;
  const high = pts.reduce((best, point) => point.value > best.value ? point : best, pts[0]);
  const low = pts.reduce((best, point) => point.value < best.value ? point : best, pts[0]);
  const hx = hover != null ? x(hover) : null;
  const hy = hover != null ? y(pts[hover].value) : null;

  return (
    <div>
      <p className="text-sm font-semibold text-stone-500">Net worth</p>
      <p className="font-display text-5xl font-bold tabular-nums text-ink sm:text-6xl" aria-live="polite">
        <CountUp value={shown?.value ?? 0} format={money} />
      </p>
      <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: change >= 0 ? UP : DOWN }}>
        {change >= 0 ? "▲" : "▼"} {money(Math.abs(change))} ({Math.abs(pct).toFixed(2)}%)
        <span className="ml-1.5 font-semibold text-stone-500">{hover != null ? formatDate(pts[hover].date) : p.label}</span>
      </p>

      <div className="relative mt-5 overflow-hidden rounded-2xl">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-56 w-full cursor-crosshair touch-pan-y sm:h-64"
          role="img"
          aria-label={`Net worth ${p.label.toLowerCase()}: from ${money(first)} to ${money(last)}`}
          onPointerMove={(e) => track(e.clientX)}
          onPointerDown={(e) => track(e.clientX)}
          onPointerLeave={() => { setHover(null); setActiveMarker(null); }}
        >
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.16} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`aurora-${gid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#54e2c2" stopOpacity=".24" />
              <stop offset="52%" stopColor="#74b9ff" stopOpacity=".12" />
              <stop offset="100%" stopColor="#c294ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="net-worth-aurora" aria-hidden="true">
            <path d="M-80,130 C70,8 205,142 365,58 C530,-26 654,99 880,6 L880,-20 L-80,-20 Z" fill={`url(#aurora-${gid})`} />
          </g>
          {/* where the period started, like Robinhood's dotted "previous close" line */}
          <line x1={PAD} x2={W - PAD} y1={y(first)} y2={y(first)} stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
          <path d={area} fill={`url(#fill-${gid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hx != null && hy != null && (
            <line x1={hx} x2={hx} y1={0} y2={H} stroke="#a8a29e" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
          {transactionMarkers.map((marker) => (
            <g
              key={marker.id}
              className="cursor-pointer"
              onPointerEnter={() => { setHover(marker.index); setActiveMarker(marker); }}
              onFocus={() => { setHover(marker.index); setActiveMarker(marker); }}
              onBlur={() => setActiveMarker(null)}
              tabIndex={0}
              role="img"
              aria-label={`Posted activity: ${marker.name}, ${marker.amount < 0 ? "incoming" : "outgoing"} ${money(Math.abs(marker.amount))} on ${formatDate(marker.date)}`}
            >
              <circle cx={x(marker.index)} cy={y(pts[marker.index].value)} r="6" fill="#0d1d35" opacity=".8" />
              <circle cx={x(marker.index)} cy={y(pts[marker.index].value)} r="3" fill={marker.amount < 0 ? UP : DOWN} />
            </g>
          ))}
        </svg>
        {/* the dot is HTML so it stays round while the SVG stretches */}
        {hx != null && hy != null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${(hx / W) * 100}%`, top: `${(hy / H) * 100}%`, background: color }}
          />
        )}
        {activeMarker && (
          <span className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-lg border border-white/30 bg-[#0d1d35]/90 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg">
            Posted activity · {activeMarker.name} · {activeMarker.amount < 0 ? "+" : "−"}{money(Math.abs(activeMarker.amount))}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1 border-b border-stone-200 pb-2" role="tablist" aria-label="Chart period">
        {PERIODS.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={period === x.key}
            onClick={() => { setPeriod(x.key); setHover(null); setActiveMarker(null); }}
            className="min-h-10 min-w-12 rounded-lg px-3 text-sm font-bold transition-colors duration-200"
            style={period === x.key ? { color, background: `${color}1a` } : { color: "#a8b9cf" }}
          >
            {x.key}
          </button>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`${p.label} recap`}>
        <RecapMetric label="Started" value={money(first)} detail={formatDate(pts[0].date)} />
        <RecapMetric label="High" value={money(high.value)} detail={formatDate(high.date)} />
        <RecapMetric label="Low" value={money(low.value)} detail={formatDate(low.date)} />
        <RecapMetric label="Net change" value={`${periodChange >= 0 ? "+" : "−"}${money(Math.abs(periodChange))}`} detail={periodChange >= 0 ? "Gained this period" : "Down this period"} />
      </dl>
    </div>
  );
}
