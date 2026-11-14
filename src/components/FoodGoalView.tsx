import { useState } from "react";
import { formatMoney, formatWeeks, goalPhrase, habitImpact } from "../lib/finance";
import { planGroceries, weeklySavings } from "../lib/grocery";
import type { FoodGoal, MoneyGoal } from "../lib/types";
import { DIETS } from "./FoodGoalForm";
import type { LogDecision } from "./MoneyWhatIf";
import { BackButton, Button, Card, Chip, NumberField, Notice, Stat } from "./ui";

interface MealIdea {
  name: string;
  uses: string[];
  how: string;
}

const CAT_BADGE = { carb: "bg-amber-100 text-amber-900", protein: "bg-rose-100 text-rose-900", produce: "bg-emerald-100 text-emerald-900" };

export function FoodGoalView({
  goal,
  moneyGoals,
  onChange,
  onChangeMoney,
  onLog,
  onDelete,
  onBack,
}: {
  goal: FoodGoal;
  moneyGoals: MoneyGoal[];
  onChange: (g: FoodGoal) => void;
  onChangeMoney: (g: MoneyGoal) => void;
  onLog: (d: LogDecision & { goalId?: string; goalName?: string }) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<{ loading: boolean; meals?: MealIdea[]; error?: string }>({ loading: false });

  const plan = planGroceries(goal.weeklyBudget, goal.diets, goal.mealsPerWeek);
  const leftover = Math.max(0, goal.weeklyBudget - plan.total);
  const outWeekly = goal.mealsOutPerWeek * goal.costPerMealOut;
  const savings = weeklySavings(goal.swapPerWeek, goal.costPerMealOut, plan.costPerMeal);
  const linked = moneyGoals.find((g) => g.id === goal.linkedGoalId);
  const applied = goal.appliedPerWeek ?? 0;
  const toAdd = Math.round((savings - applied) * 100) / 100; // only what isn't in the plan yet
  // Measure against the plan *without* food savings, so "days sooner" stays honest after applying.
  const impact = linked ? habitImpact(linked.target, linked.saved, Math.max(0, linked.weekly - applied), savings) : null;

  async function getIdeas() {
    setIdeas({ loading: true });
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: plan.items.map((i) => i.item.name), diets: goal.diets }),
      });
      const body = await res.json().catch(() => ({ error: "The server isn't responding. Is it running?" }));
      if (!res.ok) throw new Error(body.error ?? "Couldn't get ideas.");
      setIdeas({ loading: false, meals: body.meals });
    } catch (e) {
      setIdeas({ loading: false, error: e instanceof Error ? e.message : "Couldn't get ideas." });
    }
  }

  return (
    <div className="space-y-3">
      <BackButton onClick={onBack} label="All goals" />
      {message && (
        <Notice tone="good">
          <div className="flex items-start justify-between gap-2">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
          </div>
        </Notice>
      )}

      <Card>
        <p className="text-sm text-stone-500">🛒 Food budget</p>
        <h2 className="text-2xl font-bold text-stone-900">{formatMoney(goal.weeklyBudget)} a week</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Home meals" value={plan.meals} sub={`goal: ${goal.mealsPerWeek}`} tone={plan.meals >= goal.mealsPerWeek ? "good" : "warn"} />
          <Stat label="Per meal" value={formatMoney(plan.costPerMeal, true)} />
          <Stat label="Left over" value={formatMoney(leftover, true)} tone="good" />
        </div>
        {plan.meals < goal.mealsPerWeek && (
          <p className="mt-2 text-sm text-amber-800">This budget covers {plan.meals} of your {goal.mealsPerWeek} meals. Raise the budget or cook fewer meals.</p>
        )}
      </Card>

      {/* Grocery vs eating out */}
      <Card>
        <h3 className="text-lg font-bold text-stone-900">Cooking vs eating out</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Meal out" value={formatMoney(goal.costPerMealOut)} sub={`${goal.mealsOutPerWeek}×/week = ${formatMoney(outWeekly)}`} tone="warn" />
          <Stat label="Meal at home" value={formatMoney(plan.costPerMeal, true)} sub="from your grocery plan" tone="good" />
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span>Swap</span>
          <select
            value={goal.swapPerWeek}
            onChange={(e) => onChange({ ...goal, swapPerWeek: Number(e.target.value) })}
            className="rounded-lg bg-stone-50 px-2 py-1 ring-1 ring-stone-300"
          >
            {Array.from({ length: Math.max(1, goal.mealsOutPerWeek) + 1 }, (_, i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
          <span>meals out for home cooking each week</span>
        </div>
        {savings > 0 && (
          <Notice tone="good">
            <p className="mt-0">
              🌱 You'd save <strong>{formatMoney(savings, true)}/week</strong>, about {formatMoney(savings * 4.345)}/month or {formatMoney(savings * 52)}/year.
            </p>
            {linked && impact && isFinite(impact.before) && (
              <>
                <p className="mt-1">
                  Put toward your <strong>{goalPhrase(linked.name)}</strong>, you'd get it <strong>{Math.round(impact.daysSooner)} days sooner</strong> ({formatWeeks(impact.before)} → {formatWeeks(impact.after)}).
                </p>
                {Math.abs(toAdd) < 0.01 ? (
                  <p className="mt-2 font-medium">✓ Already in your {goalPhrase(linked.name)} plan.</p>
                ) : (
                  <Button
                    className="mt-2 w-full"
                    onClick={() => {
                      onChangeMoney({ ...linked, weekly: Math.max(0, Math.round((linked.weekly + toAdd) * 100) / 100) });
                      onChange({ ...goal, appliedPerWeek: savings });
                      onLog({ label: `Cook at home ${goal.swapPerWeek}×/week instead of eating out`, amount: savings, effectDays: impact.daysSooner, goalId: linked.id, goalName: linked.name });
                      setMessage(`Your ${goalPhrase(linked.name)} plan now includes ${formatMoney(savings, true)}/week from cooking. That's ${Math.round(impact.daysSooner)} days sooner!`);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    {applied > 0 ? `Update ${linked.name} plan (${toAdd > 0 ? "+" : "−"}${formatMoney(Math.abs(toAdd), true)}/week)` : `Add ${formatMoney(savings, true)}/week to ${linked.name}`}
                  </Button>
                )}
              </>
            )}
          </Notice>
        )}
        {moneyGoals.length > 0 && (
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium text-stone-700">Savings go toward</span>
            <select
              value={goal.linkedGoalId ?? ""}
              onChange={(e) => onChange({ ...goal, linkedGoalId: e.target.value || undefined, appliedPerWeek: 0 })}
              className="w-full rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-300"
            >
              <option value="">No goal</option>
              {moneyGoals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
      </Card>

      {/* Cheapest groceries that maximize balanced meals */}
      <Card>
        <h3 className="text-lg font-bold text-stone-900">Your grocery list</h3>
        <p className="text-sm text-stone-600">
          Cheapest items that make the most balanced meals (a carb, a protein and a fruit or veg each){goal.diets.length ? `, ${goal.diets.join(", ")}` : ""}.
        </p>
        <ul className="mt-3 divide-y divide-stone-100">
          {plan.items.map(({ item, qty }) => (
            <li key={item.name} className="flex items-center gap-2 py-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CAT_BADGE[item.category]}`}>{item.category}</span>
              <span className="flex-1">{qty > 1 ? `${qty} × ` : ""}{item.name}</span>
              <span className="font-medium">{formatMoney(item.price * qty, true)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold">
          <span>Total</span>
          <span>{formatMoney(plan.total, true)}</span>
        </div>
        <p className="mt-1 text-xs text-stone-500">Typical US prices as estimates. Check your local store.</p>

        <Button variant="secondary" className="mt-3 w-full" disabled={ideas.loading || !plan.items.length} onClick={getIdeas}>
          {ideas.loading ? "Thinking up meals…" : "✨ Get meal ideas from this list (AI)"}
        </Button>
        {ideas.error && <p className="mt-2 text-sm text-red-700">{ideas.error}</p>}
        {ideas.meals && (
          <ul className="mt-3 space-y-2">
            {ideas.meals.map((m) => (
              <li key={m.name} className="rounded-xl bg-stone-50 p-3 text-sm">
                <p className="font-semibold text-stone-900">{m.name}</p>
                <p className="text-xs text-stone-500">{m.uses.join(" · ")}</p>
                <p className="mt-1 text-stone-700">{m.how}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="font-bold text-stone-900">Adjust</h3>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Weekly budget" value={goal.weeklyBudget} onChange={(v) => onChange({ ...goal, weeklyBudget: Number(v || 0) })} />
            <NumberField label="Home meals/week" value={goal.mealsPerWeek} onChange={(v) => onChange({ ...goal, mealsPerWeek: Number(v || 0) })} prefix="" />
            <NumberField label="Eat out/week" value={goal.mealsOutPerWeek} onChange={(v) => onChange({ ...goal, mealsOutPerWeek: Number(v || 0), swapPerWeek: Math.min(goal.swapPerWeek, Number(v || 0)) })} prefix="" />
            <NumberField label="Cost per meal out" value={goal.costPerMealOut} onChange={(v) => onChange({ ...goal, costPerMealOut: Number(v || 0) })} />
          </div>
          <div className="flex flex-wrap gap-2">
            {DIETS.map((d) => (
              <Chip key={d} active={goal.diets.includes(d)} onClick={() => onChange({ ...goal, diets: goal.diets.includes(d) ? goal.diets.filter((x) => x !== d) : [...goal.diets, d] })}>
                {d}
              </Chip>
            ))}
          </div>
        </div>
      </Card>

      <Button variant="ghost" className="w-full text-red-700" onClick={onDelete}>Delete this food plan</Button>
    </div>
  );
}
