import { daysBetween, formatDate, todayISO } from "../lib/dates";

export interface TimelineRow {
  label: string;
  end: string | null; // finish date (null = never)
  tone?: "neutral" | "good" | "warn" | "bad";
  note?: string;
}

const TONE = {
  neutral: "bg-stone-400",
  good: "bg-emerald-600",
  warn: "bg-amber-500",
  bad: "bg-red-500",
};

/** Visual timeline: one bar per scenario from today to its finish date, with an optional deadline line. */
export function Timeline({ rows, deadline, title }: { rows: TimelineRow[]; deadline?: string; title?: string }) {
  const start = todayISO();
  const ends = rows.map((r) => r.end).filter((e): e is string => !!e);
  if (deadline) ends.push(deadline);
  const span = Math.max(7, ...ends.map((e) => daysBetween(start, e))) * 1.08;
  const pct = (d: string) => Math.max(0, Math.min(100, (daysBetween(start, d) / span) * 100));

  return (
    <div>
      {title && <p className="mb-2 text-sm font-medium text-stone-700">{title}</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-xs text-stone-600">
              <span className="font-medium text-stone-800">{r.label}</span>
              <span>{r.end ? formatDate(r.end) : "never"}{r.note ? ` · ${r.note}` : ""}</span>
            </div>
            <div className="relative mt-0.5 h-3 rounded-full bg-stone-100">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${TONE[r.tone ?? "neutral"]}`}
                style={{ width: `${r.end ? Math.max(2, pct(r.end)) : 100}%`, opacity: r.end ? 1 : 0.3 }}
              />
              {deadline && (
                <div className="absolute -inset-y-1 w-0.5 rounded bg-stone-800" style={{ left: `${pct(deadline)}%` }} title="Your date" />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-stone-500">
        <span>Today</span>
        {deadline && <span>▮ your date: {formatDate(deadline)}</span>}
      </div>
    </div>
  );
}
