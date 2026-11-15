import { ArrowRight, CalendarClock, Camera, PiggyBank, ShoppingBag, Target, Wallet } from "lucide-react";
import { useMemo } from "react";
import { formatMoney } from "../lib/finance";
import { assetsByInstitution, detectTransferIds, netWorthSeries, periodFlow, spendableCash, upcomingBills } from "../lib/money";
import type { MoneyGoal } from "../lib/types";
import type { Bank } from "../lib/useBank";
import { AssetSplit } from "./AssetSplit";
import { AnimatedList } from "./AnimatedList";
import { ConnectCard } from "./MoneyDashboard";
import { NetWorthChart } from "./NetWorthChart";
import { SavingsPlanner } from "./SavingsPlanner";

/**
 * Home page = your money dashboard: net worth over time and where it's held.
 * Check a price (the photo feature) sits alongside the savings dashboard.
 */
export function Landing({
  bank,
  goalCount,
  moneyGoals = [],
  onOpenGoal,
  onUpdateGoal,
  onMoney,
  onNewGoal,
  onDemo,
  onGoals,
  onCheck,
}: {
  bank: Bank;
  goalCount: number;
  moneyGoals?: MoneyGoal[];
  onOpenGoal: (id: string) => void;
  onUpdateGoal: (g: MoneyGoal) => void;
  onMoney: () => void;
  onNewGoal: () => void;
  onDemo: () => void;
  onGoals: () => void;
  onCheck: () => void;
}) {
  const goal = moneyGoals.find((g) => g.saved < g.target) ?? moneyGoals[0];

  return (
    <main id="main">
      {bank.connected ? (
        <HomeOverview data={bank.data!} goal={goal} onCheck={onCheck} onMoney={onMoney} />
      ) : bank.loading && !bank.status ? (
        <section className="px-4 pt-6">
          <div className="clay mx-auto h-[28rem] max-w-6xl animate-pulse" aria-label="Loading your accounts" />
        </section>
      ) : (
        <Welcome bank={bank} goal={goal} goalCount={goalCount} onCheck={onCheck} onDemo={onDemo} onGoals={onGoals} />
      )}

      {moneyGoals.length > 0 && <SavingsPlanner goals={moneyGoals} onUpdate={onUpdateGoal} onOpen={onOpenGoal} />}

      <section aria-label="More in NorthStar" className="px-4 pb-14">
        <div className="mx-auto max-w-6xl">
          <MoreCard icon={<PiggyBank className="h-5 w-5" />} tint="bg-emerald-100 text-emerald-700" title="Save for something" line="Set a goal and a weekly amount. Your finish date moves with every choice." cta={moneyGoals.length ? "Add another goal" : "Start a savings goal"} onClick={onNewGoal} />
        </div>
      </section>

      <footer className="border-t border-brand-100 px-4 py-6 text-center text-sm text-stone-500">
        <strong className="font-display text-ink">NorthStar</strong> · Built for the Cal Poly AI Hackathon · A planning tool, not financial advice.
      </footer>
    </main>
  );
}

// ---------- connected: the dashboard ----------

export function HomeOverview({ data, goals = [], onCheck, onMoney, addAccount, onGoals, onNewGoal, onOpenGoal }: {
  data: import("../lib/money").BankData;
  goal?: MoneyGoal;
  goals?: MoneyGoal[];
  onCheck: () => void;
  onMoney: () => void;
  /** Optional "Add account" button; it shares the row with "View accounts and activity". */
  addAccount?: React.ReactNode;
  onGoals?: () => void;
  onNewGoal?: () => void;
  onOpenGoal?: (id: string) => void;
}) {
  const view = useMemo(() => {
    const transferIds = detectTransferIds(data.transactions);
    return {
      series: netWorthSeries(data.accounts, data.transactions, 90),
      slices: assetsByInstitution(data.accounts),
      cash: spendableCash(data.accounts),
      flow: periodFlow(data.transactions, transferIds, "month"),
      bills: upcomingBills(data.transactions, transferIds).slice(0, 3),
    };
  }, [data]);
  // Unfinished goals first, so the snapshot shows what still needs saving.
  const topGoals = [...goals].sort((a, b) => Number(a.saved >= a.target) - Number(b.saved >= b.target)).slice(0, 2);
  const spent = view.flow.current.out;

  return (
    <section className="dashboard-home-overview" aria-label="Money overview">
      <div className="grid gap-5 lg:grid-cols-[1.75fr_1fr] [&>*]:min-w-0">
        <div className="clay p-5 sm:p-7">
          <NetWorthChart series={view.series} />
          <div className="mt-6">
            <AssetSplit slices={view.slices} />
          </div>
        </div>

        <aside className="space-y-4">

          <div className="clay divide-y divide-stone-100 px-5 py-2">
            <Stat icon={<Wallet className="h-4 w-4 text-sky-300" />} label="Spendable cash" value={formatMoney(view.cash)} />
            <Stat
              icon={<ShoppingBag className="h-4 w-4 text-amber-300" />}
              label="Spent this month"
              value={data.transactions.length ? formatMoney(spent) : "No activity yet"}
            />
          </div>

          <div className={addAccount ? "grid grid-cols-2 gap-3" : undefined}>
            {addAccount}
            <button onClick={onMoney} className="wealth-primary w-full min-w-0 justify-center whitespace-normal! text-center leading-tight">
              View accounts and activity <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </div>

          <div className="clay p-5">
            <CardHead icon={<Target className="h-4 w-4 text-[#c294ff]" />} title="Savings goals" action={goals.length && onGoals ? { label: "See all", onClick: onGoals } : undefined} />
            {topGoals.length ? (
              <ul className="mt-3 space-y-3">
                {topGoals.map((g) => {
                  const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
                  return (
                    <li key={g.id}>
                      <button onClick={() => onOpenGoal?.(g.id)} className="block w-full rounded-xl bg-stone-50 px-3 py-2.5 text-left transition-colors duration-200 hover:bg-stone-100">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-bold text-ink">{g.name}</span>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-500">{Math.round(pct)}%</span>
                        </span>
                        <span className="wealth-progress !my-2 block" role="progressbar" aria-label={`${g.name} funded`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                          <i style={{ width: `${pct}%` }} />
                        </span>
                        <span className="flex justify-between gap-2 text-xs tabular-nums text-stone-500">
                          <span>{formatMoney(g.saved)} of {formatMoney(g.target)}</span>
                          <span>{formatMoney(g.weekly)}/week</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                Give your savings a purpose: an emergency fund, a trip, a home.{" "}
                {onNewGoal && <button onClick={onNewGoal} className="font-bold text-[var(--aurora-teal)] hover:underline">Create a goal</button>}
              </p>
            )}
          </div>

          <div className="clay p-5">
            <CardHead icon={<CalendarClock className="h-4 w-4 text-brand-500" />} title="Upcoming bills" />
            {view.bills.length ? (
              <AnimatedList className="mt-2 divide-y divide-stone-100">
                {view.bills.map((b) => (
                  <div key={b.name} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-ink">{b.name}</span>
                      <span className="block text-xs text-stone-500">{b.cadence}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold tabular-nums text-ink">{formatMoney(b.amount, true)}</span>
                      <span className="block text-xs text-stone-500">{b.daysUntil === 0 ? "Due today" : b.daysUntil === 1 ? "Tomorrow" : `In ${b.daysUntil} days`}</span>
                    </span>
                  </div>
                ))}
              </AnimatedList>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {data.transactions.length ? "No repeating bills spotted yet." : "Connect a bank account and recurring bills will show up here."}
              </p>
            )}
          </div>

          <PriceAddon onCheck={onCheck} />
        </aside>
      </div>
    </section>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="flex min-w-0 items-center gap-2 text-sm text-stone-600">
        <span aria-hidden="true">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-bold tabular-nums text-ink">{value}</span>
        {sub && <span className="block text-xs text-stone-500">{sub}</span>}
      </span>
    </div>
  );
}

function CardHead({ icon, title, action }: { icon: React.ReactNode; title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">
        <span aria-hidden="true">{icon}</span>
        {title}
      </h2>
      {action && (
        <button onClick={action.onClick} className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-[var(--aurora-teal)] hover:underline">
          {action.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The photo feature, as an add-on to the dashboard: one tap to Price check. */
function PriceAddon({ onCheck }: { onCheck: () => void }) {
  return (
    <button
      onClick={onCheck}
      className="clay flex w-full items-center gap-3 p-5 text-left transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transition-none"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgb(84_226_194/14%)] text-[var(--aurora-teal)]"><Camera className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg font-bold leading-tight text-ink">Thinking about buying something?</span>
        <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-[var(--aurora-teal)]">
          Check a price <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}

// ---------- not connected yet ----------

function Welcome({
  bank,
  goalCount,
  onCheck,
  onDemo,
  onGoals,
}: {
  bank: Bank;
  goal?: MoneyGoal;
  goalCount: number;
  onCheck: () => void;
  onDemo: () => void;
  onGoals: () => void;
}) {
  return (
    <section className="relative overflow-hidden px-4 pb-12 pt-10 sm:pt-14">
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-200/60 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 top-32 h-72 w-72 rounded-full bg-emerald-200/50 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="rise">
          <h1 className="text-5xl font-bold leading-[1.05] text-ink sm:text-6xl">
            All your money, <span className="text-brand-600">in one place.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-600">
            Connect your banks and brokerages to see your net worth, where it's held and where it goes. Then see what any purchase costs your goals before you buy.
          </p>
          {bank.error && <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{bank.error}</p>}
          <div className="mt-6 max-w-md">
            <PriceAddon onCheck={onCheck} />
          </div>
          {goalCount > 0 ? (
            <button onClick={onGoals} className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-brand-700 hover:underline">
              See your {goalCount} goal{goalCount === 1 ? "" : "s"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button onClick={onDemo} className="mt-4 min-h-11 text-sm font-bold text-brand-700 hover:underline">
              Just looking? Try it with sample goals
            </button>
          )}
        </div>
        <ConnectCard sandbox={bank.status?.env === "sandbox"} onConnected={bank.reload} />
      </div>
    </section>
  );
}

function MoreCard({ icon, tint, title, line, cta, onClick }: { icon: React.ReactNode; tint: string; title: string; line: string; cta: string; onClick: () => void }) {
  return (
    <article className="clay flex items-start gap-4 p-5">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tint}`} aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">{line}</p>
        <button onClick={onClick} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-brand-700 hover:underline">
          {cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
