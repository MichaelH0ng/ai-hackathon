import { Clock, Lightbulb, PiggyBank, RotateCcw, Tag, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMoney, hoursOfWork, projectedDate, whatIfSpend } from "../lib/finance";
import type { BankSnapshot, MoneyGoal, Profile } from "../lib/types";
import type { BankData } from "../lib/money";
import { buildForecast, cashFromAccounts } from "../lib/safeToSpend";
import { readPlan } from "./WealthDashboard";
import { SafeToSpendCard } from "./SafeToSpend";
import { type LogDecision, MoneyWhatIf, type WhatIfItem } from "./MoneyWhatIf";
import { Button, Card, NumberField, Notice, TextField } from "./ui";

/** Compare a typed purchase price with savings goals. */
export function PriceCheck({
  moneyGoals,
  profile,
  bank,
  bankData,
  onUpdateGoal,
  onLog,
  onNewGoal,
  onSettings,
}: {
  moneyGoals: MoneyGoal[];
  profile: Profile;
  bank?: BankSnapshot;
  /** Connected-bank accounts and transactions, for the Safe-to-Spend forecast. */
  bankData?: BankData | null;
  onUpdateGoal: (g: MoneyGoal) => void;
  onLog: (goal: MoneyGoal, d: LogDecision) => void;
  onNewGoal: () => void;
  onSettings: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [item, setItem] = useState<WhatIfItem | null>(null);
  const [goalId, setGoalId] = useState(moneyGoals[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // resets the What-If when the item changes

  const goal = moneyGoals.find((g) => g.id === goalId) ?? moneyGoals[0];

  // Safe-to-Spend: a 30-day forecast from connected accounts plus any manual ones.
  // Keyed on the goals' numbers so a re-render with equal goals doesn't rebuild it.
  const [plan] = useState(readPlan);
  const goalsSig = JSON.stringify(moneyGoals.map(({ name, target, saved, weekly, emergency }) => ({ name, target, saved, weekly, emergency })));
  const forecast = useMemo(() => {
    const accounts = bankData?.accounts ?? [];
    const fromBank = cashFromAccounts(accounts);
    const manualChecking = plan.assets.filter((a) => a.kind === "Checking").reduce((sum, a) => sum + a.balance, 0);
    const manualSavings = plan.assets.filter((a) => a.kind === "Savings").reduce((sum, a) => sum + a.balance, 0);
    if (!fromBank.cashAccountIds.length && !manualChecking && !manualSavings) return null;
    return buildForecast({
      // Checking and savings are both cash you can reach today, so both count as spendable.
      cash: fromBank.checking + fromBank.savings + manualChecking + manualSavings,
      savings: 0,
      transactions: bankData?.transactions ?? [],
      cashAccountIds: fromBank.cashAccountIds,
      goals: JSON.parse(goalsSig),
      fallbackMonthlySpending: plan.essentials + plan.lifestyle || undefined,
    });
  }, [bankData, plan, goalsSig]);
  const goalNames = useMemo(() => (JSON.parse(goalsSig) as { name: string }[]).map((g) => g.name), [goalsSig]);

  function show(next: WhatIfItem) {
    setItem(next);
    setMessage(null);
    setVersion((v) => v + 1);
    setTimeout(() => document.getElementById("price-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function reset() {
    setItem(null);
    setName("");
    setPrice("");
    setMessage(null);
  }

  const money = (n: number) => formatMoney(n, n % 1 !== 0);

  return (
    <section id="goal-price-check" className="goal-price-check space-y-4 scroll-mt-28" aria-labelledby="goal-price-check-title">
      <div>
        <h2 id="goal-price-check-title" className="text-3xl font-bold text-ink">Check a purchase</h2>
        <p className="mt-1 text-stone-600">See how a price changes your goal timeline.</p>
      </div>

      {/* 1. Enter a purchase */}
      <Card className="purchase-check-entry">
        <div className="grid grid-cols-[1fr_8rem] gap-2">
          <TextField label="What is it?" value={name} onChange={setName} placeholder="AirPods" />
          <NumberField label="How much?" value={price} onChange={setPrice} />
        </div>
        <Button
          className="purchase-check-compare mt-3 w-full"
          disabled={!price}
          onClick={() => show({ label: name.trim() || "this item", price: Number(price), alternative: item?.label === (name.trim() || "this item") ? item.alternative : null })}
        >
          <span className="inline-flex items-center gap-2"><Tag className="h-4 w-4" aria-hidden="true" /> Compare with my goals</span>
        </Button>
      </Card>

      {/* 2. Result */}
      {item && (
        <div id="price-result" className="scroll-mt-20 space-y-4">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-500">You're looking at</p>
                <h2 className="truncate text-2xl font-bold capitalize text-ink">{item.label}</h2>
              </div>
              <button onClick={reset} className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-stone-500 hover:bg-stone-100" aria-label="Start over">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> New
              </button>
            </div>
            <p className="mt-1 font-display text-5xl font-bold text-ink">{money(item.price)}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-2xl bg-brand-50 p-3">
                <Clock className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                {profile.hourlyWage ? (
                  <p className="text-sm text-stone-700">
                    That's <strong>{formatHours(hoursOfWork(item.price, profile.hourlyWage))}</strong> of work at {money(profile.hourlyWage)}/hr.
                  </p>
                ) : (
                  <p className="text-sm text-stone-700">
                    <button onClick={onSettings} className="font-bold text-brand-700 underline">Add your pay</button> to see how many hours of work this is.
                  </p>
                )}
              </div>
              {item.alternative && item.alternative.price < item.price && (
                <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-3">
                  <Lightbulb className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <p className="text-sm text-stone-700">
                    Cheaper idea: <strong>{item.alternative.description}</strong>, about {money(item.alternative.price)}.
                  </p>
                </div>
              )}
            </div>
            {bank && !forecast && (
              <div className="mt-2 flex items-center gap-3 rounded-2xl bg-sky-50 p-3">
                <Wallet className="h-5 w-5 shrink-0 text-sky-600" aria-hidden="true" />
                <p className="text-sm text-stone-700">
                  Your cash: <strong>{formatMoney(bank.cash)}</strong> → <strong className={bank.cash - item.price < 0 ? "text-red-700" : ""}>{formatMoney(bank.cash - item.price)}</strong> after this
                  {bank.cash - item.price < 0 ? ". That's more than you have in checking and savings." : "."}
                </p>
              </div>
            )}
          </Card>

          {forecast && <SafeToSpendCard item={item.label} price={item.price} forecast={forecast} goals={goalNames} />}

          {message && (
            <Notice tone="good">
              <div className="flex items-start justify-between gap-2">
                <span>{message}</span>
                <button onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
              </div>
            </Notice>
          )}

          {moneyGoals.length === 0 ? (
            <Card className="text-center">
              <PiggyBank className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
              <h3 className="mt-2 text-xl font-bold text-ink">See how this moves a goal</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">Add something you're saving for, and NorthStar will show how many days this purchase pushes it back.</p>
              <Button className="mt-4" onClick={onNewGoal}>Start a savings goal</Button>
            </Card>
          ) : (
            <>
              <Card>
                <h3 className="text-lg font-bold text-ink">What it costs your goals</h3>
                <p className="text-sm text-stone-600">Choose which goal would fund the purchase. Each row is a separate scenario, not a combined deduction from every goal.</p>
                <ul className="mt-3 space-y-2" role="radiogroup" aria-label="Choose a goal">
                  {moneyGoals.map((g) => {
                    const w = whatIfSpend(g.target, g.saved, g.weekly, item.price);
                    const on = g.id === goal?.id;
                    return (
                      <li key={g.id}>
                        <button
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            setGoalId(g.id);
                            setVersion((v) => v + 1);
                          }}
                          className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left ring-1 transition-colors duration-200 ${on ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-stone-200 hover:bg-stone-50"}`}
                        >
                          <span className="font-semibold text-ink">{g.name}</span>
                          <span className={`font-display text-lg font-bold ${w.delayDays > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                            {isFinite(w.delayDays) ? (w.delayDays > 0 ? `+${w.delayDays.toFixed(1)} days` : "no delay") : "—"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              {goal && (
                <Card className="purchase-verdict">
                  <h3>Trade-off for {goal.name}</h3>
                  <p>{(() => {
                    const impact = whatIfSpend(goal.target, goal.saved, goal.weekly, item.price);
                    const finish = projectedDate(impact.newWeeks);
                    const baseline = projectedDate(impact.originalWeeks);
                    if (goal.weekly <= 0) return "Set a weekly savings amount before deciding: there isn’t enough information to estimate how long recovery would take.";
                    if (!Number.isFinite(impact.delayDays)) return "A timeline cannot be calculated with the current goal settings.";
                    if (goal.deadline && finish && finish > goal.deadline) return `${baseline && baseline > goal.deadline ? "Your plan already misses its target date. This purchase would delay it further" : "This purchase would push your goal past its target date"} to ${finish}. Consider skipping it or choosing a cheaper option if that deadline matters most.`;
                    if (impact.delayDays <= 0) return "This scenario adds no delay to this goal. That alone doesn’t establish whether the purchase fits your overall budget.";
                    return `The trade-off is ${impact.delayDays.toFixed(1)} extra days of saving${finish ? `, reaching this goal around ${finish}` : ""}${goal.deadline ? ", still within your target date" : ""}. It may be worth it if the purchase matters more to you than that wait; skipping it protects your current timeline.`;
                  })()}</p>
                  <p className="wealth-note">Assumes the full price comes from this goal’s savings and weekly contributions stay unchanged. This is a planning comparison, not a guarantee of affordability.</p>
                </Card>
              )}
              {goal && (
                <MoneyWhatIf
                  key={`${goal.id}-${version}`}
                  goal={goal}
                  initial={item}
                  hideInputs
                  onApply={(changes, msg, decision) => {
                    onUpdateGoal({ ...goal, ...changes });
                    if (decision) onLog(goal, decision);
                    setMessage(msg);
                    setVersion((v) => v + 1);
                    document.getElementById("price-result")?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole} hour${whole === 1 ? "" : "s"}`;
}
