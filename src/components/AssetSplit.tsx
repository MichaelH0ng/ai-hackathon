import { useId, useState } from "react";
import { formatExact } from "../lib/finance";
import type { InstitutionSlice } from "../lib/money";

const COLORS = ["#c294ff", "#54e2c2", "#74b9ff", "#ffb47a", "#ff8fc7", "#9fb0c8"];
const PIE_CENTER = 60;
const PIE_RADIUS = 48;
const PIE_POPOUT = 6;

function piePath(startPercent: number, endPercent: number) {
  const point = (percent: number) => {
    const angle = (percent / 100) * Math.PI * 2 - Math.PI / 2;
    return [PIE_CENTER + PIE_RADIUS * Math.cos(angle), PIE_CENTER + PIE_RADIUS * Math.sin(angle)];
  };
  const [startX, startY] = point(startPercent);
  const [endX, endY] = point(endPercent);
  const largeArc = endPercent - startPercent > 50 ? 1 : 0;
  return `M ${PIE_CENTER} ${PIE_CENTER} L ${startX} ${startY} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${largeArc} 1 ${endX} ${endY} Z`;
}

function piePopout(startPercent: number, endPercent: number) {
  const angle = ((startPercent + endPercent) / 200) * Math.PI * 2 - Math.PI / 2;
  return `translate(${Math.cos(angle) * PIE_POPOUT} ${Math.sin(angle) * PIE_POPOUT})`;
}

function shade(hex: string, target: number, amount: number) {
  const channels = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16)) ?? [0, 0, 0];
  return `rgb(${channels.map((channel) => Math.round(channel + (target - channel) * amount)).join(" ")})`;
}

/** A compact, keyboard-friendly institution pie with a readable value legend. */
export function AssetSplit({ slices }: { slices: InstitutionSlice[] }) {
  const [hot, setHot] = useState<number | null>(null);
  const pieId = useId().replaceAll(":", "");
  if (!slices.length) return null;
  let offset = 0;
  const segments = slices.map((slice, index) => {
    const segment = { ...slice, index, offset };
    offset += slice.pct;
    return segment;
  });

  return (
    <section aria-label={`Assets across ${slices.length} institutions`} className="asset-split-pie">
      <div className="flex justify-center py-1">
        <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0 overflow-visible" role="img" aria-label="Asset allocation. Hover over a slice or institution label to inspect it." onMouseLeave={() => setHot(null)}>
          <defs>
            <filter id={`${pieId}-shadow`} x="-20%" y="-20%" width="140%" height="145%">
              <feDropShadow dx="0" dy="3" stdDeviation="1.5" floodColor="#061221" floodOpacity=".32" />
            </filter>
            {segments.map((slice) => (
              <linearGradient key={slice.name} id={`${pieId}-slice-${slice.index}`} x1="0" y1="0" x2=".7" y2="1">
                <stop offset="0%" stopColor={shade(COLORS[slice.index % COLORS.length], 255, .28)} />
                <stop offset="56%" stopColor={COLORS[slice.index % COLORS.length]} />
                <stop offset="100%" stopColor={shade(COLORS[slice.index % COLORS.length], 0, .26)} />
              </linearGradient>
            ))}
          </defs>
          <ellipse cx={PIE_CENTER} cy="110" rx="43" ry="4" fill="#061221" opacity=".18" />
          {segments.map((slice) => {
            const active = hot === slice.index;
            const muted = hot != null && !active;
            const common = {
              fill: `url(#${pieId}-slice-${slice.index})`,
              filter: `url(#${pieId}-shadow)`,
              className: "cursor-default transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
              opacity: muted ? .3 : 1,
              transform: active && slice.pct < 99.999 ? piePopout(slice.offset, slice.offset + slice.pct) : undefined,
              onMouseEnter: () => setHot(slice.index),
            };
            return slice.pct >= 99.999 ? <circle key={slice.name} cx={PIE_CENTER} cy={PIE_CENTER} r={PIE_RADIUS} {...common} /> : <path key={slice.name} d={piePath(slice.offset, slice.offset + slice.pct)} {...common} />;
          })}
        </svg>
      </div>
      <p className="mt-2 text-sm font-bold uppercase tracking-[0.09em] text-stone-500">Institutions</p>
      <ul className="mt-2 space-y-1.5" aria-label="Institution legend">
        {slices.map((slice, index) => (
          <li key={slice.name}>
            <button type="button" onMouseEnter={() => setHot(index)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(index)} onBlur={() => setHot(null)} className={`flex min-h-12 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-[background-color,border-color,box-shadow] duration-200 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500${hot === index ? " bg-stone-50 shadow-sm" : " border-transparent"}`} style={hot === index ? { borderColor: COLORS[index % COLORS.length] } : undefined}>
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COLORS[index % COLORS.length] }} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">{slice.name}</span>
                <span className="mt-0.5 block text-xs font-medium tabular-nums text-stone-500">{formatExact(slice.value)} · {slice.pct.toFixed(1)}%</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
