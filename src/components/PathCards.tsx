import { ArrowRight, GraduationCap, PiggyBank, type LucideIcon } from "lucide-react";

export type PathKind = "money" | "study";

const PATHS: { kind: PathKind; icon: LucideIcon; title: string; line: string; bubble: string }[] = [
  { kind: "money", icon: PiggyBank, title: "Save for something", line: "A hoodie by Christmas, a trip by spring break.", bubble: "bg-emerald-100 text-emerald-700" },
  { kind: "study", icon: GraduationCap, title: "Plan for an exam", line: "A day-by-day schedule, hard topics first.", bubble: "bg-brand-100 text-brand-700" },
];

/** Pick a goal type: savings or study. */
export function PathCards({ onPick }: { onPick: (k: PathKind) => void }) {
  return (
    <div className="grid gap-3">
      {PATHS.map((p) => {
        const Icon = p.icon;
        return (
          <button key={p.kind} onClick={() => onPick(p.kind)} className="clay clay-press flex items-center gap-4 p-5 text-left">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${p.bubble}`}>
              <Icon className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="flex-1">
              <span className="block font-display text-lg font-bold text-ink">{p.title}</span>
              <span className="block text-sm text-stone-600">{p.line}</span>
            </span>
            <ArrowRight className="h-5 w-5 text-stone-400" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
