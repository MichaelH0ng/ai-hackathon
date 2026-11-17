import { ArrowRight, Check, Hand } from "lucide-react";
import { useState } from "react";
import { daysBetween, formatDate } from "../lib/dates";
import { formatMoney, projectedDate, weeklyNeededForDeadline, weeksToGoal } from "../lib/finance";
import { savingsCapacity, type SavingsCapacity } from "../lib/savingsCapacity";
import type { BankData } from "../lib/money";
import type { MoneyGoal } from "../lib/types";
import CometDial from "./CometDial";

const DIAL_STEP = 5;
const DEFAULT_DIAL_MAX = 100;

function roundToStep(value: number, direction: "up" | "nearest" = "nearest") {
  const rounded = direction === "up" ? Math.ceil(value / DIAL_STEP) : Math.round(value / DIAL_STEP);
  return Math.max(0, rounded * DIAL_STEP);
}

function suggestedWeekly(g: MoneyGoal, capacity: SavingsCapacity): number {
  if (capacity.status !== "available") return 0;
  const oneYearPace = Math.max(5, (g.target - g.saved) / 52);
  return roundToStep(Math.min(oneYearPace, capacity.weeklyLimit));
}

/** The dial reflects measured room; a blocked dial stays at zero. */
function dialMax(capacity: SavingsCapacity): number {
  return capacity.status === "available" ? Math.max(DIAL_STEP, roundToStep(capacity.weeklyLimit, "up")) : DEFAULT_DIAL_MAX;
}

function initialWeekly(g: MoneyGoal, capacity: SavingsCapacity): number {
  if (capacity.status !== "available") return 0;
  const max = dialMax(capacity);
  return g.weekly > max ? suggestedWeekly(g, capacity) : g.weekly;
}

/**
 * "How much can you save each week?" Turn the dial and watch your finish date move.
 * Tap Save to make it your plan.
 */
export function SavingsPlanner({ goals, financials = {}, onUpdate, onOpen, onOpenPlan }: { goals: MoneyGoal[]; financials?: { bankData?: BankData | null; manualMonthlyIncome?: number; manualMonthlyExpenses?: number }; onUpdate: (g: MoneyGoal) => void; onOpen: (id: string) => void; onOpenPlan?: () => void }) {
  const open = goals.filter((g) => g.saved < g.target);
  const list = open.length ? open : goals;
  const [focus, setFocus] = useState(list[0].id);
  const goal = list.find((g) => g.id === focus) ?? list[0];
  const capacityFor = (candidate: MoneyGoal) => savingsCapacity({ ...financials, goals, selectedGoalId: candidate.id });
  const capacity = capacityFor(goal);
  const [weekly, setWeekly] = useState(() => initialWeekly(goal, capacityFor(goal)));
  const [saved, setSaved] = useState(false);

  const max = dialMax(capacity);
  const blocked = capacity.status !== "available";
  const pick = (g: MoneyGoal) => {
    setFocus(g.id);
    setWeekly(initialWeekly(g, capacityFor(g)));
    setSaved(false);
  };

  const remaining = Math.max(0, goal.target - goal.saved);
  const nowFinish = projectedDate(weeksToGoal(goal.target, goal.saved, goal.weekly));
  const newFinish = projectedDate(weeksToGoal(goal.target, goal.saved, weekly));
  const shift = nowFinish && newFinish ? daysBetween(newFinish, nowFinish) : null; // + = sooner
  const need = goal.deadline ? Math.ceil(weeklyNeededForDeadline(goal.target, goal.saved, goal.deadline)) : null;
  const onTime = goal.deadline && newFinish ? newFinish <= goal.deadline : null;
  const changed = weekly !== goal.weekly;
  const pct = Math.round(Math.min(1, goal.saved / goal.target) * 100);
  const savedPlanIsTooHigh = !blocked && goal.weekly > max;
  const quickAmounts = [...new Set([5, 10, 25, 50, suggestedWeekly(goal, capacity), goal.weekly])]
    .filter(() => !blocked)
    .filter((amount) => amount > 0 && amount <= max)
    .sort((a, b) => a - b);

  return (
    <section aria-labelledby="planner-title" className="px-4 pb-12">
      <div className="savings-planner-panel relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-6 py-10 text-white shadow-[0_24px_60px_-24px_rgb(30_27_46/0.8)] sm:px-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-600/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

        <div className="relative grid items-center gap-10 lg:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center">
            <CometDial
              key={goal.id}
              value={weekly}
              min={0}
              max={max}
              step={DIAL_STEP}
              disabled={blocked}
              unit="none"
              label={goal.name}
              accent="#f5f5f5"
              ink="#fdfdfd"
              size={250}
              sweep={320}
              thickness={5}
              speed={25}
              tapBounce={0.2}
              flickBounce={0.1}
              momentum={1}
              cometReach={180}
              cometWidth={12}
              format={(v) => formatMoney(Math.round(v))}
              caption={() => "each week"}
              valueText={(v) => `${formatMoney(v)} per week`}
              onChange={(v) => {
                setWeekly(Math.round(v));
                setSaved(false);
              }}
              onChangeEnd={(v) => setWeekly(Math.round(v))}
            />
            <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-200">
              <Hand className="h-3.5 w-3.5" aria-hidden="true" /> {blocked ? "Savings is paused until NorthStar can verify room in your budget" : "Turn in $5 steps — only up to money you can set aside"}
            </p>
          </div>

          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-teal-200">A sustainable pace</p>
            <h2 id="planner-title" className="mt-1 text-3xl font-bold sm:text-4xl">What can you set aside each week?</h2>

            <p className="mt-3 text-lg text-white/80" aria-live="polite">
              {blocked ? (
                <>NorthStar is not recommending a weekly savings amount yet.</>
              ) : weekly <= 0 ? (
                <>At $0/week your {goal.name.toLowerCase()} stays where it is. Choose an amount only when it fits your budget.</>
              ) : (
                <>
                  At <strong className="text-white">{formatMoney(weekly)}/week</strong>, your {goal.name.toLowerCase()} is done around{" "}
                  <strong className="text-white">{newFinish ? formatDate(newFinish) : "—"}</strong>
                  {changed && shift != null && shift !== 0 && (
                    <span className={shift > 0 ? "text-emerald-300" : "text-amber-300"}>
                      {" "}({Math.abs(shift)} day{Math.abs(shift) === 1 ? "" : "s"} {shift > 0 ? "sooner" : "later"})
                    </span>
                  )}
                  .
                </>
              )}
            </p>
            {capacity.status === "missing-income" ? (
              <p className="mt-2 max-w-2xl text-sm text-amber-200">NorthStar found no recurring income and your monthly plan has no income entered. Connect the account where pay lands or add your monthly after-tax income before setting a savings target.</p>
            ) : capacity.status === "no-room" ? (
              <p className="mt-2 max-w-2xl text-sm text-amber-200">{capacity.incomeSource === "detected" ? "Your recurring deposits" : "Your monthly plan"} estimate {formatMoney(capacity.monthlyIncome)}/month. After {formatMoney(capacity.monthlySpending)} for spending, {formatMoney(capacity.monthlyOtherGoals)} for other goals, and a {formatMoney(capacity.monthlyBuffer)} buffer, there is no weekly room to assign yet.</p>
            ) : (
              <p className="mt-2 max-w-2xl text-sm text-teal-100">Based on {capacity.incomeSource === "detected" ? "recurring deposits" : "your monthly plan"}, NorthStar sees {formatMoney(capacity.monthlyIncome)}/month coming in. After spending, other goals, and a {formatMoney(capacity.monthlyBuffer)} buffer, this goal can use up to <strong>{formatMoney(max)}/week</strong>.</p>
            )}
            {blocked && onOpenPlan && <button type="button" onClick={onOpenPlan} className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-full bg-white/10 px-4 text-sm font-bold text-white transition-colors duration-200 hover:bg-white/15">Review monthly plan <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
            {savedPlanIsTooHigh && <p className="mt-2 max-w-2xl rounded-xl border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-sm text-amber-100">Your saved plan is {formatMoney(goal.weekly)}/week. That is above this practical range, so we started you at {formatMoney(weekly)}/week instead. Nothing changes until you save.</p>}
            {goal.deadline && (blocked || onTime != null) && (
              <p className={`mt-1 text-sm font-semibold ${onTime && !blocked ? "text-emerald-300" : "text-amber-300"}`}>
                {onTime && !blocked ? `On time for ${formatDate(goal.deadline)}.` : `This date would require ${formatMoney(need ?? 0)}/week — a requirement, not a recommendation.`}
              </p>
            )}

            {!blocked && <div className="mt-5" aria-label="Weekly savings shortcuts">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Try a weekly amount</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {quickAmounts.map((amount) => <button key={amount} onClick={() => { setWeekly(amount); setSaved(false); }} aria-pressed={weekly === amount} className={`min-h-10 rounded-full px-4 text-sm font-semibold transition-colors duration-200 ${weekly === amount ? "bg-white text-ink" : "bg-white/10 text-white hover:bg-white/15"}`}>{formatMoney(amount)}</button>)}
              </div>
            </div>}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                disabled={blocked || (!changed && !saved) || weekly <= 0}
                onClick={() => {
                  onUpdate({ ...goal, weekly });
                  setSaved(true);
                }}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white px-5 font-bold text-ink transition-colors duration-200 hover:bg-brand-50 disabled:opacity-40"
              >
                {saved ? <><Check className="h-4 w-4" aria-hidden="true" /> Saved to your plan</> : `Use ${formatMoney(weekly)}/week`}
              </button>
              <button onClick={() => onOpen(goal.id)} className="inline-flex min-h-12 items-center gap-1 px-2 text-sm font-bold text-white/80 hover:text-white">
                Open goal <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {list.length > 1 && (
              <div className="mt-6 flex flex-wrap gap-2" role="radiogroup" aria-label="Choose a goal">
                {list.map((g) => (
                  <button
                    key={g.id}
                    role="radio"
                    aria-checked={g.id === goal.id}
                    onClick={() => pick(g)}
                    className={`min-h-10 rounded-full px-4 text-sm font-bold transition-colors duration-200 ${g.id === goal.id ? "bg-white text-ink" : "bg-white/10 text-white hover:bg-white/15"}`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-4 text-sm text-slate-200">
              {formatMoney(goal.saved)} of {formatMoney(goal.target)} saved ({pct}%) · {formatMoney(remaining)} to go
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
