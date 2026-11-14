import { ArrowRight, Check, GraduationCap, PiggyBank, ShoppingBasket, type LucideIcon } from "lucide-react";

export type PathKind = "money" | "study" | "food";

interface Path {
  kind: PathKind;
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  gets: string[];
  cta: string;
  tint: { bubble: string; text: string; soft: string };
  preview: React.ReactNode;
}

const PATHS: Path[] = [
  {
    kind: "money",
    icon: PiggyBank,
    title: "Saving for something",
    tagline: "A hoodie by Christmas. A trip by spring break.",
    description:
      "Tell us what it costs, what you've saved and what you can put away each week. TradeOff builds your savings timeline, then shows how every purchase moves your finish date.",
    gets: ["Weekly plan + projected finish date", "What-if for any purchase, or snap a price", "Timeline comparing your options", "\"Is it worth it?\" score"],
    cta: "Start a savings goal",
    tint: { bubble: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", soft: "bg-emerald-50" },
    preview: (
      <div className="space-y-1.5" aria-hidden="true">
        <div className="flex justify-between text-[11px] font-semibold text-stone-500"><span>New hoodie</span><span>6.0 weeks</span></div>
        <div className="h-2.5 rounded-full bg-stone-200"><div className="h-full w-2/5 rounded-full bg-emerald-500" /></div>
        <div className="flex justify-between text-[11px] font-semibold"><span className="text-amber-700">$20 dinner → +9.3 days</span><span className="text-emerald-700">Cook → +2.3</span></div>
      </div>
    ),
  },
  {
    kind: "study",
    icon: GraduationCap,
    title: "Preparing for an exam",
    tagline: "Stats midterm in 5 days? Let's plan it.",
    description:
      "Share your exam date, confidence, target grade and free hours. You get a day-by-day schedule that puts hard topics first, adjusts after practice quizzes and shows what a movie night really costs.",
    gets: ["Day-by-day study schedule", "Hard topics first, review last", "Practice quizzes re-tune your hours", "What-if: movie, party, extra shift"],
    cta: "Plan my studying",
    tint: { bubble: "bg-brand-100 text-brand-700", text: "text-brand-700", soft: "bg-brand-50" },
    preview: (
      <div className="flex items-end justify-between gap-1" aria-hidden="true">
        {[1.5, 1.5, 0, 2, 1].map((h, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div className={`w-full rounded-md ${h ? "bg-brand-500" : "bg-amber-300"}`} style={{ height: `${h ? h * 16 : 10}px` }} />
            <span className="text-[10px] font-semibold text-stone-500">{["Fri", "Sat", "Sun", "Mon", "Tue"][i]}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    kind: "food",
    icon: ShoppingBasket,
    title: "Planning my food budget",
    tagline: "Make $40 a week feed you well.",
    description:
      "Compare cooking with eating out, get the cheapest grocery list that makes the most balanced meals for your diet, and see how much sooner your other goals arrive when you cook.",
    gets: ["Cheapest balanced grocery list", "Cost per meal vs eating out", "Savings sent to your goals", "AI meal ideas from your list"],
    cta: "Plan my food budget",
    tint: { bubble: "bg-orange-100 text-orange-700", text: "text-orange-700", soft: "bg-orange-50" },
    preview: (
      <div className="grid grid-cols-2 gap-2 text-center" aria-hidden="true">
        <div className="rounded-xl bg-white/80 p-2"><p className="text-[10px] font-semibold text-stone-500">Meal out</p><p className="font-display text-lg font-bold text-amber-700">$15</p></div>
        <div className="rounded-xl bg-white/80 p-2"><p className="text-[10px] font-semibold text-stone-500">At home</p><p className="font-display text-lg font-bold text-emerald-700">$0.82</p></div>
      </div>
    ),
  },
];

/** The three things TradeOff helps with. Used on the landing page and when adding a goal. */
export function PathCards({ onPick, compact = false }: { onPick: (k: PathKind) => void; compact?: boolean }) {
  return (
    <div className={`grid gap-5 ${compact ? "" : "md:grid-cols-3"}`}>
      {PATHS.map((p, i) => {
        const Icon = p.icon;
        return (
          <article key={p.kind} className="clay clay-press rise flex flex-col p-6" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center gap-3">
              <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${p.tint.bubble}`}>
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-xl font-bold text-ink">{p.title}</h3>
                <p className={`text-sm font-semibold ${p.tint.text}`}>{p.tagline}</p>
              </div>
            </div>
            {!compact && <p className="mt-4 leading-relaxed text-stone-600">{p.description}</p>}
            <div className={`mt-4 rounded-2xl p-3 ${p.tint.soft}`}>{p.preview}</div>
            {!compact && (
              <ul className="mt-4 space-y-2 text-sm text-stone-700">
                {p.gets.map((g) => (
                  <li key={g} className="flex items-start gap-2">
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${p.tint.text}`} aria-hidden="true" />
                    {g}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => onPick(p.kind)}
              className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-sm font-bold text-white transition-colors duration-200 hover:bg-brand-700 md:mt-auto md:translate-y-0"
            >
              {p.cta}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </article>
        );
      })}
    </div>
  );
}
