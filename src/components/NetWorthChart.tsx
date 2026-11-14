import { useId, useMemo, useRef, useState } from "react";
import { formatDate } from "../lib/dates";
import { formatMoney } from "../lib/finance";
import type { NetWorthPoint } from "../lib/money";

const W = 800;
const H = 240;
const PAD = 10;
const PERIODS = [
  { key: "1W", days: 7, label: "Past week" },
  { key: "1M", days: 30, label: "Past month" },
  { key: "3M", days: 90, label: "Past 3 months" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

const UP = "#54e2c2";
const DOWN = "#ffb47a";
const money = (n: number) => formatMoney(n, true);

/**
 * Robinhood-style net worth chart: big number on top, one clean line, period tabs below.
 * Hover or drag across the line and the number swaps to that day's value.
 */
export function NetWorthChart({ series, note }: { series: NetWorthPoint[]; note?: string }) {
  const [period, setPeriod] = useState<Period>("1M");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gid = useId();

  const p = PERIODS.find((x) => x.key === period)!;
  const pts = useMemo(() => series.slice(-(p.days + 1)), [series, p.days]);
  const first = pts[0]?.value ?? 0;
  const last = pts.at(-1)?.value ?? 0;
  const shown = hover != null ? pts[hover] : pts.at(-1);
  const change = (shown?.value ?? 0) - first;
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

  function track(clientX: number) {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || pts.length < 2) return;
    const i = Math.round((((clientX - r.left) / r.width) * W - PAD) / ((W - PAD * 2) / (pts.length - 1)));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  }

  if (pts.length < 2) return null;
  const hx = hover != null ? x(hover) : null;
  const hy = hover != null ? y(pts[hover].value) : null;

  return (
    <div>
      <p className="text-sm font-semibold text-stone-500">Net worth</p>
      <p className="font-display text-5xl font-bold tabular-nums text-ink sm:text-6xl" aria-live="polite">
        {money(shown?.value ?? 0)}
      </p>
      <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: change >= 0 ? UP : DOWN }}>
        {change >= 0 ? "▲" : "▼"} {money(Math.abs(change))} ({Math.abs(pct).toFixed(2)}%)
        <span className="ml-1.5 font-semibold text-stone-500">{hover != null ? formatDate(pts[hover].date) : p.label}</span>
      </p>

      <div className="relative mt-5">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-56 w-full cursor-crosshair touch-pan-y sm:h-64"
          role="img"
          aria-label={`Net worth ${p.label.toLowerCase()}: from ${money(first)} to ${money(last)}`}
          onPointerMove={(e) => track(e.clientX)}
          onPointerDown={(e) => track(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.16} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* where the period started, like Robinhood's dotted "previous close" line */}
          <line x1={PAD} x2={W - PAD} y1={y(first)} y2={y(first)} stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
          <path d={area} fill={`url(#fill-${gid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hx != null && hy != null && (
            <line x1={hx} x2={hx} y1={0} y2={H} stroke="#a8a29e" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {/* the dot is HTML so it stays round while the SVG stretches */}
        {hx != null && hy != null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${(hx / W) * 100}%`, top: `${(hy / H) * 100}%`, background: color }}
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-1 border-b border-stone-200 pb-2" role="tablist" aria-label="Chart period">
        {PERIODS.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={period === x.key}
            onClick={() => setPeriod(x.key)}
            className="min-h-10 min-w-12 rounded-lg px-3 text-sm font-bold transition-colors duration-200"
            style={period === x.key ? { color, background: `${color}1a` } : { color: "#a8b9cf" }}
          >
            {x.key}
          </button>
        ))}
        {note && <span className="ml-auto text-xs text-stone-400">{note}</span>}
      </div>
    </div>
  );
}
