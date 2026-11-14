import { useState } from "react";
import { formatMoney } from "../lib/finance";
import type { InstitutionSlice } from "../lib/money";

const COLORS = ["#c294ff", "#54e2c2", "#74b9ff", "#ffb47a", "#ff8fc7", "#9fb0c8"];

/** "Across 3 institutions": one bar split by bank or brokerage, with a legend you can hover. */
export function AssetSplit({ slices }: { slices: InstitutionSlice[] }) {
  const [hot, setHot] = useState<number | null>(null);
  if (!slices.length) return null;
  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">
          Across {slices.length} institution{slices.length === 1 ? "" : "s"}
        </h2>
        <p className="text-sm text-stone-500">
          Assets <strong className="text-ink">{formatMoney(total)}</strong>
        </p>
      </div>

      <div className="relative mt-3 flex h-7 gap-1" role="img" aria-label={slices.map((s) => `${s.name} ${s.pct.toFixed(1)}%`).join(", ")}>
        {slices.map((s, i) => (
          <div
            key={s.name}
            tabIndex={0}
            aria-label={`${s.name}: ${s.pct.toFixed(1)}%`}
            onMouseEnter={() => setHot(i)}
            onMouseLeave={() => setHot(null)}
            onFocus={() => setHot(i)}
            onBlur={() => setHot(null)}
            onClick={() => setHot(i)}
            className="relative min-w-1.5 cursor-default rounded-md outline-offset-2 transition-[transform,opacity] duration-200 motion-reduce:transition-none"
            style={{ flexGrow: s.value, background: COLORS[i % COLORS.length], transform: hot === i ? "scaleY(1.2)" : undefined, opacity: hot != null && hot !== i ? 0.45 : 1 }}
          >
            {hot === i && (
              <span role="tooltip" className={`asset-split-tip${i === 0 ? " at-start" : i === slices.length - 1 ? " at-end" : ""}`}>
                <span className="truncate">{s.name}</span> <strong>{s.pct.toFixed(1)}%</strong>
              </span>
            )}
          </div>
        ))}
      </div>

      <ul className="mt-4 grid gap-2">
        {slices.map((s, i) => (
          <li
            key={s.name}
            onMouseEnter={() => setHot(i)}
            onMouseLeave={() => setHot(null)}
            className={`flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors duration-200 ${hot === i ? "bg-stone-100" : "bg-stone-50"}`}
          >
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{s.name}</span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{formatMoney(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
