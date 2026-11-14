import {
  ArrowRight,
  Camera,
  ChartNoAxesGantt,
  ChefHat,
  Clapperboard,
  Clock,
  Lightbulb,
  Gauge,
  ListChecks,
  MessageCircleHeart,
  PiggyBank,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Sprout,
  Target,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { formatWeeks, whatIfSpend } from "../lib/finance";
import { type PathKind, PathCards } from "./PathCards";

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export const LANDING_SECTIONS = [
  { id: "paths", label: "Get started" },
  { id: "how", label: "How it works" },
  { id: "features", label: "Features" },
];

export function Landing({
  goalCount,
  onPick,
  onDemo,
  onGoals,
  onCheck,
}: {
  goalCount: number;
  onPick: (k: PathKind) => void;
  onDemo: () => void;
  onGoals: () => void;
  onCheck: () => void;
}) {
  return (
    <main id="main">
      <Hero goalCount={goalCount} onDemo={onDemo} onGoals={onGoals} />
      <TangibleStrip />
      <Section id="paths" eyebrow="Three ways to start" title="What are you working toward?" lead="Money and time are both limited. Pick the goal you care about most. You can add the others any time and see them side by side.">
        <PathCards onPick={onPick} />
      </Section>
      <AtTheStore onCheck={onCheck} />
      <HowItWorks />
      <DecisionAssistant />
      <Features />
      <FinalCta onStart={() => scrollTo("paths")} onDemo={onDemo} />
      <Footer />
    </main>
  );
}

function Section({ id, eyebrow, title, lead, children, tone = "plain" }: { id: string; eyebrow: string; title: string; lead?: string; children: React.ReactNode; tone?: "plain" | "tint" }) {
  return (
    <section id={id} className={`scroll-mt-20 px-4 py-20 ${tone === "tint" ? "bg-brand-50" : ""}`}>
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-bold uppercase tracking-wider text-brand-600">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-bold text-ink sm:text-4xl">{title}</h2>
        {lead && <p className="mt-3 max-w-2xl text-lg leading-relaxed text-stone-600">{lead}</p>}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

// ---------- Hero with a live, playable example ----------

function Hero({ goalCount, onDemo, onGoals }: { goalCount: number; onDemo: () => void; onGoals: () => void }) {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-12 sm:pt-16">
      {/* soft background blobs */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-200/60 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 top-40 h-72 w-72 rounded-full bg-emerald-200/50 blur-3xl" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        <div className="rise">
          {goalCount > 0 ? (
            <button onClick={onGoals} className="inline-flex min-h-9 items-center gap-2 rounded-full bg-white px-3 text-sm font-bold text-brand-700 shadow-sm ring-1 ring-brand-200 hover:bg-brand-50">
              Welcome back. You have {goalCount} goal{goalCount === 1 ? "" : "s"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-bold text-brand-700 shadow-sm ring-1 ring-brand-200">
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Made for college students
            </p>
          )}
          <h1 className="mt-5 text-5xl font-bold leading-[1.05] text-ink sm:text-6xl">
            See what today's choices <span className="relative whitespace-nowrap text-brand-600">cost tomorrow.<svg aria-hidden="true" viewBox="0 0 300 12" className="absolute -bottom-2 left-0 w-full" preserveAspectRatio="none"><path d="M2 9c60-6 140-8 296-4" stroke="#34d399" strokeWidth="5" fill="none" strokeLinecap="round" /></svg></span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600">
            A $20 dinner isn't just $20. It's your hoodie arriving <strong className="text-ink">9 days later</strong>. TradeOff turns everyday decisions into tradeoffs you can actually see, for your savings, your study time and your food budget.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={() => scrollTo("paths")} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand-600 px-6 font-bold text-white shadow-[0_6px_0_0_rgb(59_7_100/0.25)] transition-all duration-200 hover:bg-brand-700 active:translate-y-0.5">
              Start a goal <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </button>
            <button onClick={onDemo} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white px-6 font-bold text-ink ring-2 ring-brand-200 transition-colors duration-200 hover:bg-brand-50">
              Try the demo example
            </button>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-stone-500">
            <li className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> No sign-up</li>
            <li className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Saved on your device</li>
            <li className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Free</li>
          </ul>
        </div>

        <HeroCalculator />
      </div>
    </section>
  );
}

type Pick = "out" | "cook" | "skip";

/** The hoodie example from the pitch, live: change the choice and watch the timeline move. */
function HeroCalculator() {
  const [pick, setPick] = useState<Pick>("out");
  const [dinner, setDinner] = useState(20);
  const spend = pick === "out" ? dinner : pick === "cook" ? 5 : 0;
  const w = whatIfSpend(150, 60, 15, spend);
  const maxWeeks = whatIfSpend(150, 60, 15, 60).newWeeks;
  const options: { id: Pick; label: string; icon: LucideIcon }[] = [
    { id: "out", label: `Go out · $${dinner}`, icon: Utensils },
    { id: "cook", label: "Cook · $5", icon: ChefHat },
    { id: "skip", label: "Skip · $0", icon: Sparkles },
  ];

  return (
    <div className="floaty">
      <div className="clay relative p-6" role="group" aria-label="Live example: saving for a hoodie">
        <span className="absolute -top-3 right-6 rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white shadow">Live example: try it</span>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><PiggyBank className="h-6 w-6" aria-hidden="true" /></span>
          <div className="flex-1">
            <p className="font-display text-lg font-bold text-ink">New hoodie</p>
            <p className="text-sm text-stone-500">$60 of $150 saved · $15/week</p>
          </div>
          <p className="font-display text-2xl font-bold text-ink">40%</p>
        </div>
        <div className="mt-3 h-3 rounded-full bg-stone-100"><div className="h-full w-2/5 rounded-full bg-emerald-500" /></div>

        <p className="mt-6 text-sm font-bold text-stone-700">Friday night. Your friends want to eat out. What if you…</p>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Choose an option">
          {options.map((o) => {
            const Icon = o.icon;
            const on = pick === o.id;
            return (
              <button
                key={o.id}
                role="radio"
                aria-checked={on}
                onClick={() => setPick(o.id)}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-xs font-bold transition-all duration-200 ${on ? "bg-ink text-white shadow-lg" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {o.label}
              </button>
            );
          })}
        </div>

        {pick === "out" && (
          <label className="mt-4 block">
            <span className="flex justify-between text-xs font-semibold text-stone-500"><span>Dinner cost</span><span className="text-ink">${dinner}</span></span>
            <input type="range" min={5} max={60} step={1} value={dinner} onChange={(e) => setDinner(Number(e.target.value))} className="mt-1 w-full accent-brand-600" />
          </label>
        )}

        <div className="mt-5 space-y-3" aria-hidden="true">
          {[
            { label: "Original plan", weeks: w.originalWeeks, color: "bg-stone-300" },
            { label: "With this choice", weeks: w.newWeeks, color: w.delayDays > 0 ? "bg-amber-400" : "bg-emerald-500" },
          ].map((r) => (
            <div key={r.label}>
              <div className="flex justify-between text-xs font-semibold text-stone-500"><span>{r.label}</span><span className="text-ink">{formatWeeks(r.weeks)}</span></div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-stone-100">
                <div className={`h-full w-full origin-left rounded-full transition-transform duration-500 ease-out ${r.color}`} style={{ transform: `scaleX(${r.weeks / maxWeeks})` }} />
              </div>
            </div>
          ))}
        </div>

        <div className={`mt-5 rounded-2xl p-4 transition-colors duration-300 ${w.delayDays > 0 ? "bg-amber-50" : "bg-emerald-50"}`} aria-live="polite">
          <p className={`font-display text-3xl font-bold ${w.delayDays > 0 ? "text-amber-700" : "text-emerald-700"}`}>
            {w.delayDays > 0 ? `+${w.delayDays.toFixed(1)} days` : "No delay"}
          </p>
          <p className="mt-1 text-sm text-stone-700">
            {pick === "out"
              ? `A $${dinner} dinner pushes your hoodie back. If time with friends matters, go, and adjust your plan.`
              : pick === "cook"
                ? `Cooking saves you ${(whatIfSpend(150, 60, 15, dinner).delayDays - w.delayDays).toFixed(1)} days compared with eating out.`
                : "Your hoodie stays right on track for Christmas."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- Opportunity cost, made tangible ----------

function TangibleStrip() {
  const items: { icon: LucideIcon; big: string; small: string; tint: string }[] = [
    { icon: Utensils, big: "$20 dinner = 9 days", small: "later for a $150 hoodie at $15/week", tint: "text-amber-600" },
    { icon: Clapperboard, big: "2-hour movie = 25%", small: "of an 8-hour study week before your exam", tint: "text-brand-600" },
    { icon: ChefHat, big: "$0.82 vs $15", small: "a home-cooked meal vs eating out", tint: "text-emerald-600" },
  ];
  return (
    <section aria-label="Examples of opportunity cost" className="px-4">
      <div className="clay mx-auto grid max-w-6xl gap-6 p-6 sm:grid-cols-3 sm:p-8">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.big} className="flex items-start gap-3">
              <Icon className={`mt-1 h-6 w-6 shrink-0 ${it.tint}`} aria-hidden="true" />
              <div>
                <p className="font-display text-xl font-bold text-ink">{it.big}</p>
                <p className="text-sm text-stone-600">{it.small}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- At the store: snap a price tag ----------

function AtTheStore({ onCheck }: { onCheck: () => void }) {
  return (
    <section className="px-4 pb-20">
      <div className="clay mx-auto grid max-w-6xl items-center gap-10 overflow-hidden p-6 sm:p-10 lg:grid-cols-2">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600">At the store?</p>
          <h2 className="mt-2 text-3xl font-bold text-ink sm:text-4xl">Snap the price tag. See the real cost.</h2>
          <p className="mt-3 text-lg leading-relaxed text-stone-600">
            Holding something you want? Take a photo of the tag, or just type the price. TradeOff reads it, shows how many hours of work it is, and tells you how many days it pushes back each of your goals. It even suggests a cheaper swap.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={onCheck} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand-600 px-6 font-bold text-white shadow-[0_6px_0_0_rgb(59_7_100/0.25)] transition-all duration-200 hover:bg-brand-700 active:translate-y-0.5">
              <Camera className="h-5 w-5" aria-hidden="true" /> Check a price
            </button>
            <button onClick={onCheck} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white px-6 font-bold text-ink ring-2 ring-brand-200 transition-colors duration-200 hover:bg-brand-50">
              Type a price instead
            </button>
          </div>
        </div>

        {/* phone mockup */}
        <div className="mx-auto w-full max-w-xs" aria-hidden="true">
          <div className="rounded-[2.5rem] bg-ink p-3 shadow-2xl">
            <div className="overflow-hidden rounded-[2rem] bg-white">
              <div className="relative flex h-44 items-center justify-center bg-gradient-to-br from-stone-200 to-stone-300">
                <div className="rotate-[-4deg] rounded-xl bg-yellow-300 px-5 py-3 text-center shadow-lg ring-2 ring-yellow-500">
                  <p className="text-[10px] font-bold uppercase text-yellow-900">Wireless earbuds</p>
                  <p className="font-display text-3xl font-bold text-ink">$129.99</p>
                </div>
                <div className="absolute inset-6 rounded-2xl border-2 border-dashed border-white/90" />
              </div>
              <div className="space-y-2 p-4">
                <p className="font-display text-lg font-bold text-ink">Wireless earbuds · $129.99</p>
                <p className="flex items-center gap-1.5 text-xs text-stone-600"><Clock className="h-3.5 w-3.5 text-brand-600" /> 7h 13m of work at $18/hr</p>
                <div className="flex justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm"><span className="font-semibold">Hoodie</span><span className="font-display font-bold text-amber-700">+60.7 days</span></div>
                <div className="flex justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm"><span className="font-semibold">Spring break</span><span className="font-display font-bold text-amber-700">+36.4 days</span></div>
                <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-stone-700"><Lightbulb className="h-3.5 w-3.5 text-emerald-600" /> Cheaper idea: budget earbuds, ~$30</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- How it works ----------

function HowItWorks() {
  const steps = [
    { title: "Set a goal", body: "A hoodie, an exam or a weekly food budget, with your deadline and what you have to work with." },
    { title: "Get a plan", body: "A savings timeline, a study schedule or a grocery list built around you." },
    { title: "Test a decision", body: "\"What if I go out tonight?\" Try it before you do it. Type it, tap a preset or snap a price." },
    { title: "See the tradeoff", body: "Days added or saved, study hours used, and cheaper options side by side." },
    { title: "Update your timeline", body: "Pick what fits your priorities. Your plan adapts and your choices add up." },
  ];
  return (
    <Section id="how" eyebrow="How it works" title="From a goal to a smarter choice in five steps" tone="tint">
      <ol className="grid gap-5 md:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.title} className="relative">
            {i < steps.length - 1 && <div aria-hidden="true" className="absolute left-12 top-6 hidden h-0.5 w-[calc(100%-1.5rem)] bg-brand-200 md:block" />}
            <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 font-display text-xl font-bold text-white shadow-[0_5px_0_0_rgb(59_7_100/0.25)]">{i + 1}</span>
            <h3 className="mt-4 text-lg font-bold text-ink">{s.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-stone-600">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---------- Decision assistant, not a budget coach ----------

function DecisionAssistant() {
  return (
    <section className="px-4 py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Our philosophy</p>
          <h2 className="mt-2 text-3xl font-bold text-ink sm:text-4xl">A decision assistant, not a scolding budget coach.</h2>
          <p className="mt-4 text-lg leading-relaxed text-stone-600">
            Dinner with friends can be worth a 9-day delay. TradeOff never tells you "no." It shows what you give up and what you gain, scores how much the choice matters to <em>you</em>, and helps you adjust your plan whatever you decide.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              { icon: Sprout, text: "Celebrates good choices too: cook at home 2×/week and your hoodie arrives about 4 weeks sooner." },
              { icon: RefreshCcw, text: "Spent more than planned? It suggests a new weekly amount that keeps your date." },
              { icon: Target, text: "Not sure you even want it? It suggests waiting before you commit money." },
            ].map((r) => {
              const Icon = r.icon;
              return (
                <li key={r.text} className="flex gap-3 text-stone-700">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                  {r.text}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-4" aria-hidden="true">
          <div className="clay flex gap-3 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700"><MessageCircleHeart className="h-5 w-5" /></span>
            <p className="leading-relaxed text-stone-700">
              "Going out to eat will delay your hoodie goal by about 9 days. Cooking at home for $5 instead would reduce that delay to about 2 days. However, if spending time with friends is important to you, you can still choose dinner out and adjust your savings plan."
            </p>
          </div>
          <div className="clay ml-auto max-w-sm p-5">
            <div className="flex items-center justify-between">
              <p className="font-display text-lg font-bold text-ink">Is it worth it to you?</p>
              <span className="rounded-full bg-emerald-100 px-3 py-1 font-display font-bold text-emerald-800">73/100</span>
            </div>
            {[["Enjoyment", 4], ["Importance", 4], ["Urgency", 3]].map(([label, n]) => (
              <div key={label} className="mt-3 flex items-center justify-between text-sm">
                <span className="text-stone-600">{label}</span>
                <span className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((d) => <span key={d} className={`h-3 w-3 rounded-full ${d <= (n as number) ? "bg-brand-600" : "bg-stone-200"}`} />)}
                </span>
              </div>
            ))}
            <p className="mt-3 text-sm font-bold text-emerald-700">Worth it for you</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Feature grid ----------

function Features() {
  const items: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: ChartNoAxesGantt, title: "Compare timelines", body: "Go out, cook or skip: see each option's finish date against your deadline." },
    { icon: Gauge, title: "Worth-it score", body: "Weighs cost against enjoyment, importance, urgency and how sure you are about the goal." },
    { icon: Sprout, title: "Make it a habit", body: "See how small swaps add up: dollars per month and days sooner." },
    { icon: RefreshCcw, title: "Adaptive plans", body: "Fall behind and get a one-tap weekly amount that puts you back on track." },
    { icon: Target, title: "Confidence-based", body: "Exam confidence and quiz scores tune your study hours. Unsure about a purchase? Wait first." },
    { icon: Camera, title: "Snap a price", body: "Point your camera at a price tag or upload a cart screenshot. AI reads it and suggests a cheaper swap." },
    { icon: ChefHat, title: "Smart grocery list", body: "The cheapest balanced meals for your budget and diet, plus AI recipe ideas." },
    { icon: ListChecks, title: "Your choices", body: "Track days gained, money kept and study time traded across all your goals." },
  ];
  return (
    <Section id="features" eyebrow="Features" title="Everything you need to weigh a tradeoff" tone="tint">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="clay p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-100 text-brand-700"><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <h3 className="mt-3 text-lg font-bold text-ink">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">{f.body}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---------- Final CTA + footer ----------

function FinalCta({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  return (
    <section className="px-4 py-20">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 to-brand-900 px-6 py-14 text-center text-white shadow-[0_24px_60px_-20px_rgb(59_7_100/0.6)] sm:px-12">
        <h2 className="text-3xl font-bold sm:text-4xl">Your next choice is coming. Know what it costs.</h2>
        <p className="mx-auto mt-3 max-w-xl text-lg text-brand-100">Set a goal in under a minute. Everything stays in your browser.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button onClick={onStart} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white px-6 font-bold text-brand-700 transition-colors duration-200 hover:bg-brand-50">
            Start a goal <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
          <button onClick={onDemo} className="min-h-12 rounded-2xl px-6 font-bold text-white ring-2 ring-white/40 transition-colors duration-200 hover:bg-white/10">
            Try the demo example
          </button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-brand-100 px-4 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 text-sm text-stone-500 sm:flex-row sm:justify-between">
        <p><strong className="font-display text-ink">TradeOff</strong> · See what today's choices cost tomorrow. Built for the Cal Poly AI Hackathon.</p>
        <p>An educational planning tool, not financial advice. Grades aren't guaranteed.</p>
      </div>
    </footer>
  );
}
