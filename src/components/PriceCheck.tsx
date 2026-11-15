import { ArrowRight, Check, Clock, PiggyBank, RotateCcw, Tag, Undo2, Wallet } from "lucide-react";
import { goalForItem } from "../lib/envelopes";
import { formatDate } from "../lib/dates";
import { useMemo, useState } from "react";
import { formatDelay, formatMoney, priceInContext, projectedDate, weeksToGoal, whatIfSpend } from "../lib/finance";
import type { BankSnapshot, MoneyGoal, Profile } from "../lib/types";
import type { BankData } from "../lib/money";
import { buildForecast, cashFromAccounts, evaluatePurchase, isEmergencyFund, monthlyIncome } from "../lib/safeToSpend";
import { bankDataForPlan, includedItems } from "../lib/planningAccounts";
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
  onUpdateGoal,
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
  /** Logs a purchase against a goal by lowering its saved amount (and restores it on undo). */
  onUpdateGoal?: (g: MoneyGoal) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [item, setItem] = useState<WhatIfItem | null>(null);
  const [goalId, setGoalId] = useState("");
  // The goal a logged purchase came out of, as it was before, so the log can be undone.
  const [logged, setLogged] = useState<{ before: MoneyGoal; amount: number } | null>(null);

  // The emergency fund never pays for a purchase, so it can't be chosen as the goal that funds one.
  const fundable = moneyGoals.filter((g) => !isEmergencyFund(g));
  // A purchase with its own goal ("AirPods") is paid from that goal, so its savings count as available.
  const fund = item ? goalForItem(item.label, moneyGoals) : null;
  const goal = fundable.find((g) => g.id === goalId) ?? fundable.find((g) => g.id === fund?.id) ?? fundable[0];
  // Fully saved for: the goal pays for it, so there's no cash verdict or goal trade-off to show.
  const covered = !!fund && !!item && fund.saved >= item.price;

  // Safe-to-Spend: a 30-day forecast from connected accounts plus any manual ones.
  // Keyed on the goals' numbers so a re-render with equal goals doesn't rebuild it.
  const plan = readPlan();
  const planningBankData = bankDataForPlan(bankData, plan.excludedAccountIds);
  const goalsSig = JSON.stringify(moneyGoals.filter((g) => g.id !== fund?.id).map(({ name, target, saved, weekly, emergency }) => ({ name, target, saved, weekly, emergency })));
  const forecast = useMemo(() => {
    const accounts = planningBankData?.accounts ?? [];
    const fromBank = cashFromAccounts(accounts);
    const includedManualAssets = includedItems(plan.assets, plan.excludedAccountIds);
    const manualChecking = includedManualAssets.filter((a) => a.kind === "Checking").reduce((sum, a) => sum + a.balance, 0);
    const manualSavings = includedManualAssets.filter((a) => a.kind === "Savings").reduce((sum, a) => sum + a.balance, 0);
    if (!fromBank.cashAccountIds.length && !manualChecking && !manualSavings) return null;
    return buildForecast({
      // Checking and savings are both cash you can reach today, so both count as spendable.
      cash: fromBank.checking + fromBank.savings + manualChecking + manualSavings,
      savings: 0,
      transactions: planningBankData?.transactions ?? [],
      cashAccountIds: fromBank.cashAccountIds,
      goals: JSON.parse(goalsSig),
      fallbackMonthlySpending: plan.essentials + plan.lifestyle || undefined,
    });
  }, [planningBankData, plan, goalsSig]);
  // Take-home pay per month, to put big prices in perspective: paychecks first, then the Budget.
  const income = useMemo(() => {
    const fromBank = planningBankData ? monthlyIncome(planningBankData.transactions, cashFromAccounts(planningBankData.accounts).cashAccountIds) : 0;
    return fromBank || plan.income || 0;
  }, [planningBankData, plan]);
  const goalNames = useMemo(() => (JSON.parse(goalsSig) as { name: string }[]).map((g) => g.name), [goalsSig]);

  function show(next: WhatIfItem) {
    setItem(next);
    setLogged(null);
    setTimeout(() => document.getElementById("price-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function reset() {
    setItem(null);
    setLogged(null);
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
          onClick={() => show({ label: name.trim() || "this item", price: Number(price), alternative: null })}
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

          {!covered && (() => {
            // Spare cash pays first (the same lowest-point headroom Safe-to-Spend uses). Only what's
            // left over comes out of a goal, so a purchase spare cash covers never delays one.
            const spare = forecast ? Math.max(0, Math.floor(forecast.headroom)) : null;
            const fromGoal = spare === null ? item.price : Math.max(0, Math.round((item.price - spare) * 100) / 100);
            if (fromGoal === 0) return (
              <Card className="purchase-goal-impact is-clear">
                <h3><Check className="h-5 w-5" aria-hidden="true" /> Your goals stay on track</h3>
                <p>Your spare cash covers this, so none of your goal savings would be used.</p>
              </Card>
            );
            if (!goal) return (
              <Card className="text-center">
                <PiggyBank className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
                <h3 className="mt-2 text-xl font-bold text-ink">See how this moves a goal</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">Add something you're saving for, and NorthStar will show how much later this purchase makes it.</p>
                <Button className="mt-4" onClick={onNewGoal}>Start a savings goal</Button>
              </Card>
            );
            const impact = whatIfSpend(goal.target, goal.saved, goal.weekly, fromGoal);
            const from = projectedDate(weeksToGoal(goal.target, goal.saved, goal.weekly));
            const to = projectedDate(impact.newWeeks);
            const take = Math.min(fromGoal, Math.max(0, goal.saved));
            return (
              <Card className="purchase-goal-impact">
                <h3>{spare === null ? `${money(fromGoal)} would come from a goal` : spare > 0 ? `Spare cash covers ${money(spare)}. The other ${money(fromGoal)} comes from a goal.` : `You'd need ${money(fromGoal)} from a goal`}</h3>
                <p>{spare === null ? "NorthStar can't see your checking or savings yet, so this assumes the whole price comes from a goal." : "That's the part your spare cash can't cover in the next 30 days."}</p>
                {fundable.length > 1 && (
                  <label className="wealth-field purchase-goal-pick">
                    <span>Take it from</span>
                    <select value={goal.id} onChange={(e) => { setGoalId(e.target.value); setLogged(null); }}>
                      {fundable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </label>
                )}
                {goal.weekly <= 0 ? (
                  <p className="purchase-goal-note">Set a weekly amount for {goal.name} to see how long it takes to win this back.</p>
                ) : from && to && (
                  <div className="goal-shift" aria-label={`${goal.name}: ${formatDate(from)} without it, ${formatDate(to)} if you buy it`}>
                    <div className="goal-shift-tile">
                      <small>{goal.name} without it</small>
                      <strong>{formatDate(from)}</strong>
                      {goal.deadline && <span>Target {formatDate(goal.deadline)}</span>}
                    </div>
                    <ArrowRight className="goal-shift-arrow" size={20} aria-hidden="true" />
                    <div className="goal-shift-tile is-later">
                      <small>If you buy {item.label}</small>
                      <strong>{formatDate(to)}</strong>
                      <span>{impact.delayDays > 0 ? `+${formatDelay(impact.delayDays)}` : "No delay"}{goal.deadline && to > goal.deadline ? " · past your target" : ""}</span>
                    </div>
                  </div>
                )}
                {logged ? (
                  <p className="purchase-logged" role="status">
                    Took {money(logged.amount)} from {logged.before.name}.
                    <button type="button" onClick={() => { onUpdateGoal?.(logged.before); setLogged(null); }}><Undo2 className="h-4 w-4" aria-hidden="true" /> Undo</button>
                  </p>
                ) : onUpdateGoal && take > 0 && (
                  <button type="button" className="wealth-secondary purchase-log" onClick={() => { onUpdateGoal({ ...goal, saved: Math.round((goal.saved - take) * 100) / 100 }); setLogged({ before: goal, amount: take }); }}>
                    I bought it: take {money(take)} from {goal.name}
                  </button>
                )}
              </Card>
            );
          })()}
        </div>
      )}
    </section>
  );
}

