import { Camera } from "lucide-react";
import { daysBetween, formatDate, todayISO } from "../lib/dates";
import { formatMoney, formatWeeks, projectedDate, weeksToGoal } from "../lib/finance";
import { planGroceries, weeklySavings } from "../lib/grocery";
import { freeHours, recommendedFor } from "../lib/study";
import type { Decision, FoodGoal, Goal, MoneyGoal, StudyGoal } from "../lib/types";
import { Button, Card, Progress } from "./ui";

/** Home dashboard: every goal side by side, plus insights from the choices you've made. */
export function Home({
  goals,
  history,
  onOpen,
  onNew,
  onCheck,
}: {
  goals: Goal[];
  history: Decision[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onCheck: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-ink">My goals</h1>
        <p className="text-stone-600">Every goal side by side. Open one to test a choice.</p>
      </div>

      <button
        onClick={onCheck}
        className="flex w-full items-center gap-4 rounded-3xl bg-brand-600 p-4 text-left text-white shadow-[0_5px_0_0_rgb(59_7_100/0.25)] transition-all duration-200 hover:bg-brand-700 active:translate-y-0.5"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Camera className="h-6 w-6" aria-hidden="true" /></span>
        <span>
          <span className="block font-display text-lg font-bold">Thinking about buying something?</span>
          <span className="block text-sm text-brand-100">Snap the price tag or type the price to see what it costs your goals.</span>
        </span>
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        {goals.map((g) => (
          <button key={g.id} onClick={() => onOpen(g.id)} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-stone-200 hover:ring-brand-500">
            {g.kind === "money" ? <MoneySummary goal={g} /> : g.kind === "study" ? <StudySummary goal={g} /> : <FoodSummary goal={g} />}
            <p className="mt-3 text-sm font-semibold text-brand-700">Open · test a choice →</p>
          </button>
        ))}
      </div>

      <Button className="w-full" onClick={onNew}>+ Add a goal</Button>

      <Insights history={history} />
    </div>
  );
}

function MoneySummary({ goal }: { goal: MoneyGoal }) {
  const weeks = weeksToGoal(goal.target, goal.saved, goal.weekly);
  const finish = projectedDate(weeks);
  const late = goal.deadline && finish && finish > goal.deadline;
  return (
    <>
      <p className="text-xs font-medium uppercase text-stone-500">💰 Saving</p>
      <p className="text-lg font-bold text-stone-900">{goal.name}</p>
      <div className="mt-2"><Progress value={goal.saved / goal.target} /></div>
      <p className="mt-1 text-sm text-stone-700">{formatMoney(goal.saved)} of {formatMoney(goal.target)}</p>
      <p className={`text-sm ${late ? "text-amber-800" : "text-stone-600"}`}>
        {weeks === 0 ? "Funded 🎉" : `${formatWeeks(weeks)} to go${finish ? ` · ~${formatDate(finish)}` : ""}`}
        {late && " (behind your date)"}
      </p>
    </>
  );
}

function StudySummary({ goal }: { goal: StudyGoal }) {
  const planned = goal.plan.reduce((s, d) => s + d.hours, 0);
  const done = goal.plan.filter((d) => d.done).reduce((s, d) => s + d.hours, 0);
  const days = daysBetween(todayISO(), goal.examDate);
  const todayPlan = goal.plan.find((d) => d.date === todayISO());
  const tight = freeHours(goal) < recommendedFor(goal);
  return (
    <>
      <p className="text-xs font-medium uppercase text-stone-500">📚 Studying</p>
      <p className="text-lg font-bold text-stone-900">{goal.name}</p>
      <div className="mt-2"><Progress value={planned ? done / planned : 0} /></div>
      <p className="mt-1 text-sm text-stone-700">{done}h of {planned}h studied</p>
      <p className={`text-sm ${tight ? "text-amber-800" : "text-stone-600"}`}>
        {days < 0 ? "Exam passed" : days === 0 ? "Exam today" : `Exam in ${days} day${days === 1 ? "" : "s"}`}
        {todayPlan && todayPlan.hours > 0 && !todayPlan.done && ` · ${todayPlan.hours}h today${todayPlan.topic ? `: ${todayPlan.topic}` : ""}`}
      </p>
    </>
  );
}

function FoodSummary({ goal }: { goal: FoodGoal }) {
  const plan = planGroceries(goal.weeklyBudget, goal.diets, goal.mealsPerWeek);
  const savings = weeklySavings(goal.swapPerWeek, goal.costPerMealOut, plan.costPerMeal);
  return (
    <>
      <p className="text-xs font-medium uppercase text-stone-500">🛒 Food budget</p>
      <p className="text-lg font-bold text-stone-900">{formatMoney(goal.weeklyBudget)}/week</p>
      <p className="mt-1 text-sm text-stone-700">{plan.meals} home meals at {formatMoney(plan.costPerMeal, true)} each</p>
      <p className="text-sm text-stone-600">{savings > 0 ? `Cooking saves ${formatMoney(savings, true)}/week` : "Compare cooking vs eating out"}</p>
    </>
  );
}

/** Personalized habit insights from logged decisions. */
function Insights({ history }: { history: Decision[] }) {
  if (!history.length) {
    return (
      <Card className="text-sm text-stone-600">
        <p className="font-semibold text-stone-900">Your choices</p>
        Test a choice in any goal's "What if I…" and pick an option. Your tradeoffs will show up here.
      </Card>
    );
  }
  const money = history.filter((d) => d.kind === "money");
  const sooner = money.filter((d) => (d.effectDays ?? 0) > 0).reduce((s, d) => s + (d.effectDays ?? 0), 0);
  const later = money.filter((d) => (d.effectDays ?? 0) < 0).reduce((s, d) => s - (d.effectDays ?? 0), 0);
  const kept = money.filter((d) => (d.amount ?? 0) > 0).reduce((s, d) => s + (d.amount ?? 0), 0);
  const studyUsed = history.filter((d) => d.kind === "study" && (d.hours ?? 0) < 0).reduce((s, d) => s - (d.hours ?? 0), 0);
  const studyAdded = history.filter((d) => d.kind === "study" && (d.hours ?? 0) > 0).reduce((s, d) => s + (d.hours ?? 0), 0);

  return (
    <Card>
      <p className="font-semibold text-stone-900">Your choices</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-center text-sm">
        <div className="rounded-xl bg-emerald-50 p-2">
          <p className="text-xl font-bold text-emerald-800">{Math.round(sooner)} days</p>
          <p className="text-xs text-emerald-900">gained toward goals</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-2">
          <p className="text-xl font-bold text-amber-800">{Math.round(later)} days</p>
          <p className="text-xs text-amber-900">spent on things you chose</p>
        </div>
      </div>
      {(kept > 0 || studyUsed > 0 || studyAdded > 0) && (
        <p className="mt-2 text-sm text-stone-700">
          {kept > 0 && <>You kept {formatMoney(kept)} by choosing alternatives. </>}
          {studyAdded > 0 && <>You added {studyAdded}h of study. </>}
          {studyUsed > 0 && <>You chose {studyUsed}h of fun over study, and your schedule adjusted. </>}
        </p>
      )}
      <ul className="mt-3 space-y-1 text-sm">
        {history.slice(-6).reverse().map((d) => (
          <li key={d.id} className="flex justify-between gap-2">
            <span className="text-stone-700">{d.label}</span>
            <span className={`shrink-0 font-medium ${(d.effectDays ?? d.hours ?? 0) >= 0 ? "text-emerald-800" : "text-amber-800"}`}>
              {d.effectDays != null && d.effectDays !== 0
                ? `${d.effectDays > 0 ? "−" : "+"}${Math.abs(Math.round(d.effectDays))}d`
                : d.hours != null
                  ? `${d.hours > 0 ? "+" : "−"}${Math.abs(d.hours)}h`
                  : "on track"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-stone-500">−Nd means your goal got N days closer. +Nd means N days later.</p>
    </Card>
  );
}
