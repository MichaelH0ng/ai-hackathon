import { ArrowRight, Clock, Lightbulb, PiggyBank, RotateCcw, Tag, Wallet } from "lucide-react";
import { goalForItem } from "../lib/envelopes";
import { formatDate } from "../lib/dates";
import { useMemo, useState } from "react";
import { formatDelay, formatMoney, priceInContext, projectedDate, whatIfSpend } from "../lib/finance";
import type { BankSnapshot, MoneyGoal, Profile } from "../lib/types";
import type { BankData } from "../lib/money";
import { buildForecast, cashFromAccounts, evaluatePurchase, isEmergencyFund, monthlyIncome } from "../lib/safeToSpend";
import { readPlan } from "./WealthDashboard";
import { SafeToSpendCard } from "./SafeToSpend";
import { SavingsPlanAgent } from "./SavingsPlanAgent";
import type { WhatIfItem } from "./MoneyWhatIf";
import { Button, Card, NumberField, TextField } from "./ui";

/** Compare a typed purchase price with savings goals. */
export function PriceCheck({
  moneyGoals,
  profile,
  bank,
  bankData,
  onNewGoal,
  onCreateGoal,
  onOpenGoal,
  onSettings,
}: {
  moneyGoals: MoneyGoal[];
  profile: Profile;
  bank?: BankSnapshot;
  /** Connected-bank accounts and transactions, for the Safe-to-Spend forecast. */
  bankData?: BankData | null;
  onNewGoal: () => void;
  /** Saves a goal Polaris planned (and opens it). */
  onCreateGoal: (g: MoneyGoal) => void;
  onOpenGoal: (id: string) => void;
  onSettings: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [item, setItem] = useState<WhatIfItem | null>(null);
  const [goalId, setGoalId] = useState(moneyGoals[0]?.id ?? "");

  // The emergency fund never pays for a purchase, so it can't be chosen as the goal that funds one.
  const fundable = moneyGoals.filter((g) => !isEmergencyFund(g));
  const goal = fundable.find((g) => g.id === goalId) ?? fundable[0];
  // A purchase with its own goal ("AirPods") is paid from that goal, so its savings count as available.
  const fund = item ? goalForItem(item.label, moneyGoals) : null;
  // Fully saved for: the goal pays for it, so there's no cash verdict or goal trade-off to show.
  const covered = !!fund && !!item && fund.saved >= item.price;

  // Safe-to-Spend: a 30-day forecast from connected accounts plus any manual ones.
  // Keyed on the goals' numbers so a re-render with equal goals doesn't rebuild it.
  const [plan] = useState(readPlan);
  const goalsSig = JSON.stringify(moneyGoals.filter((g) => g.id !== fund?.id).map(({ name, target, saved, weekly, emergency }) => ({ name, target, saved, weekly, emergency })));
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
  // Take-home pay per month, to put big prices in perspective: paychecks first, then the Budget.
  const income = useMemo(() => {
    const fromBank = bankData ? monthlyIncome(bankData.transactions, cashFromAccounts(bankData.accounts).cashAccountIds) : 0;
    return fromBank || plan.income || 0;
  }, [bankData, plan]);
  const goalNames = useMemo(() => (JSON.parse(goalsSig) as { name: string }[]).map((g) => g.name), [goalsSig]);

  function show(next: WhatIfItem) {
    setItem(next);
    setTimeout(() => document.getElementById("price-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function reset() {
    setItem(null);
    setName("");
    setPrice("");
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
                {(() => {
                  const context = priceInContext(item.price, { hourlyWage: profile.hourlyWage, monthlyIncome: income });
                  return context && <p className="text-sm text-stone-700">{context.before}<strong>{context.strong}</strong>{context.after}</p>;
                })() ?? (
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

          {fund && (
            <div className={`purchase-fund${covered ? " is-covered" : ""}`}>
              <PiggyBank className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm">
                {fund.saved >= item.price
                  ? <><strong className="block text-base">Covered by your {fund.name} goal</strong>You've saved {money(fund.saved)} for this, so buying it won't touch your spending money or your other goals.</>
                  : <>Your <strong>{fund.name}</strong> goal has {money(Math.max(0, fund.saved))} saved toward this, and that money counts as available below.</>}
              </p>
              {fund.saved >= item.price && <button className="wealth-secondary purchase-fund-button" onClick={() => onOpenGoal(fund.id)}>Mark as bought <ArrowRight size={15} aria-hidden="true" /></button>}
            </div>
          )}

          {forecast && !covered && (
            <SafeToSpendCard item={item.label} price={item.price} forecast={forecast} goals={goalNames}>
              {evaluatePurchase(forecast, item.price).verdict === "not-yet" && (
                <SavingsPlanAgent
                  key={`${item.label}|${item.price}`}
                  item={item.label}
                  price={item.price}
                  hourlyWage={profile.hourlyWage}
                  goals={moneyGoals}
                  budget={plan.income ? { monthlyIncome: plan.income, monthlySpending: plan.essentials + plan.lifestyle } : undefined}
                  onCreateGoal={onCreateGoal}
                />
              )}
            </SafeToSpendCard>
          )}

          {covered ? null : moneyGoals.length === 0 ? (
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
                    if (isEmergencyFund(g)) return (
                      <li key={g.id} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl px-4 ring-1 ring-stone-200">
                        <span className="font-semibold text-ink">{g.name}</span>
                        <span className="text-sm font-semibold text-stone-600">Not affected: never used for purchases</span>
                      </li>
                    );
                    const w = whatIfSpend(g.target, g.saved, g.weekly, item.price);
                    const on = g.id === goal?.id;
                    return (
                      <li key={g.id}>
                        <button
                          role="radio"
                          aria-checked={on}
                          onClick={() => setGoalId(g.id)}
                          className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left ring-1 transition-colors duration-200 ${on ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-stone-200 hover:bg-stone-50"}`}
                        >
                          <span className="min-w-0">
                            <span className="block font-semibold text-ink">{g.name}</span>
                            {(() => {
                              const from = projectedDate(w.originalWeeks);
                              const to = projectedDate(w.newWeeks);
                              return from && to && w.delayDays > 0 && <span className="block text-sm text-stone-600">{formatDate(from)} → {formatDate(to)}{g.deadline && to > g.deadline && from <= g.deadline && <strong className="text-amber-700"> · past your {formatDate(g.deadline)} target</strong>}</span>;
                            })()}
                          </span>
                          <span className={`shrink-0 text-right font-display text-lg font-bold ${!isFinite(w.delayDays) ? "text-stone-600" : w.delayDays > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                            {isFinite(w.delayDays) ? (w.delayDays > 0 ? `+${formatDelay(w.delayDays)}` : "no delay") : "Set a weekly amount"}
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
                    const finishISO = projectedDate(impact.newWeeks);
                    const baselineISO = projectedDate(impact.originalWeeks);
                    const finish = finishISO && formatDate(finishISO);
                    if (goal.weekly <= 0) return "Set a weekly savings amount before deciding: there isn’t enough information to estimate how long recovery would take.";
                    if (!Number.isFinite(impact.delayDays)) return "A timeline cannot be calculated with the current goal settings.";
                    if (goal.deadline && finishISO && finishISO > goal.deadline) return `${baselineISO && baselineISO > goal.deadline ? "Your plan already misses its target date. This purchase would delay it further" : "This purchase would push your goal past its target date"} to ${finish}. Consider skipping it or choosing a cheaper option if that deadline matters most.`;
                    if (impact.delayDays <= 0) return "This scenario adds no delay to this goal. That alone doesn’t establish whether the purchase fits your overall budget.";
                    return `The trade-off is ${formatDelay(impact.delayDays)} of extra saving${finish ? `, reaching this goal around ${finish}` : ""}${goal.deadline ? ", still within your target date" : ""}. It may be worth it if the purchase matters more to you than that wait; skipping it protects your current timeline.`;
                  })()}</p>
                  {(() => {
                    const impact = whatIfSpend(goal.target, goal.saved, goal.weekly, item.price);
                    const from = projectedDate(impact.originalWeeks);
                    const to = projectedDate(impact.newWeeks);
                    if (!from || !to || impact.delayDays <= 0) return null;
                    const alt = item.alternative && item.alternative.price < item.price ? item.alternative : null;
                    const altImpact = alt ? whatIfSpend(goal.target, goal.saved, goal.weekly, alt.price) : null;
                    const altTo = altImpact ? projectedDate(altImpact.newWeeks) : null;
                    return (
                      <div className="goal-shift" aria-label={`${goal.name}: ${formatDate(from)} without it, ${formatDate(to)} if you buy it`}>
                        <div className="goal-shift-tile">
                          <small>Without it</small>
                          <strong>{formatDate(from)}</strong>
                          {goal.deadline && <span>Target date {formatDate(goal.deadline)}</span>}
                        </div>
                        <ArrowRight className="goal-shift-arrow" size={20} aria-hidden="true" />
                        <div className="goal-shift-tile is-later">
                          <small>If you buy {item.label}</small>
                          <strong>{formatDate(to)}</strong>
                          <span>+{formatDelay(impact.delayDays)}</span>
                        </div>
                        {alt && altTo && altImpact && (
                          <div className="goal-shift-tile is-alt">
                            <small>{alt.description} ({money(alt.price)})</small>
                            <strong>{formatDate(altTo)}</strong>
                            <span>{altImpact.delayDays > 0.05 ? `+${formatDelay(altImpact.delayDays)}` : "No delay"}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <p className="wealth-note">Assumes the full price comes from this goal’s savings and weekly contributions stay unchanged. This is a planning comparison, not a guarantee of affordability.</p>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

