import { ArrowRight, CalendarClock, PiggyBank, Plus, RefreshCw, Sparkles, Target } from "lucide-react";
import { useMemo } from "react";
import { daysBetween, formatDate, todayISO } from "../lib/dates";
import { formatExact, formatMoney, weeklyNeededForDeadline } from "../lib/finance";
import { assetsByInstitution, billsFor, detectTransferIds, netWorthSeries } from "../lib/money";
import { buildForecast, cashFromAccounts } from "../lib/safeToSpend";
import type { MoneyGoal } from "../lib/types";
import { balancesAreFresh, type Bank } from "../lib/useBank";
import { AssetSplit } from "./AssetSplit";
import { ConnectCard } from "./MoneyDashboard";
import { NetWorthChart, type NetWorthQuickLook } from "./NetWorthChart";
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
        <HomeOverview data={bank.data!} goal={goal} goals={moneyGoals} onCheck={onCheck} onMoney={onMoney} />
      ) : bank.loading && !bank.status ? (
        <section className="px-4 pt-6">
          <div className="clay mx-auto h-[28rem] max-w-6xl animate-pulse" aria-label="Loading your accounts" />
        </section>
      ) : (
        <Welcome bank={bank} goal={goal} goalCount={goalCount} onCheck={onCheck} onDemo={onDemo} onGoals={onGoals} />
      )}

      {moneyGoals.length > 0 && <SavingsPlanner goals={moneyGoals} financials={{ bankData: bank.data }} onUpdate={onUpdateGoal} onOpen={onOpenGoal} />}

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

export function HomeOverview({ data, goals = [], profileName = "Michael", onCheck, onMoney, addAccount, onGoals, onNewGoal, onOpenGoal, onRefresh, refreshing = false }: {
  data: import("../lib/money").BankData;
  profileName?: string;
  goal?: MoneyGoal;
  goals?: MoneyGoal[];
  onCheck: () => void;
  onMoney: () => void;
  /** Optional account action shown beside the activity shortcut. */
  addAccount?: React.ReactNode;
  onGoals?: () => void;
  onNewGoal?: () => void;
  onOpenGoal?: (id: string) => void;
  /** Reloads the latest data NorthStar can retrieve; this is not a guaranteed real-time bank balance. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const view = useMemo(() => {
    // Pending card entries can change or disappear before they settle. Trends,
    // bills, and the reconstructed history are therefore based on posted data.
    const postedTransactions = data.transactions.filter((transaction) => !transaction.pending);
    const transferIds = detectTransferIds(postedTransactions);
    const oldestTransaction = postedTransactions.reduce<string | null>((oldest, transaction) => !oldest || transaction.date < oldest ? transaction.date : oldest, null);
    // Plaid bank Links request at most two years of activity. Do not pad the
    // chart with made-up flat history before the first available transaction.
    const historyDays = oldestTransaction ? Math.min(730, Math.max(1, daysBetween(oldestTransaction, todayISO()))) : 1;
    const estimatedSeries = netWorthSeries(data.accounts, postedTransactions, historyDays);
    const recorded = data.netWorthSnapshots ?? [];
    const hasRecordedHistory = recorded.length >= 2;
    return {
      // Transaction math is useful context, but only points NorthStar has
      // captured are true whole-account net-worth records.
      series: hasRecordedHistory ? recorded : estimatedSeries,
      slices: assetsByInstitution(data.accounts),
      chartTransactions: postedTransactions.filter((transaction) => !transferIds.has(transaction.id)),
      bills: billsFor({ transactions: postedTransactions, recurring: data.recurring }, transferIds).slice(0, 3),
    };
  }, [data]);
  // Unfinished goals first, so the snapshot shows what still needs saving.
  const topGoals = [...goals].sort((a, b) => Number(a.saved >= a.target) - Number(b.saved >= b.target)).slice(0, 3);
  const billsTotal = view.bills.reduce((sum, b) => sum + b.amount, 0);
  const quickLook = useMemo<NetWorthQuickLook[]>(() => {
    const cash = cashFromAccounts(data.accounts);
    const forecast = buildForecast({
      cash: cash.checking,
      savings: cash.savings,
      transactions: data.transactions,
      cashAccountIds: cash.cashAccountIds,
      goals,
      today: todayISO(),
    });
    const comfortableToday = Math.floor(Math.max(0, forecast.headroom) / 2);
    const nextBill = view.bills[0];
    const nextIncome = forecast.nextIncome;
    const activeGoal = [...goals]
      .filter((goal) => goal.saved < goal.target)
      .sort((a, b) => (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31"))[0];
    const goalPace = (() => {
      if (!activeGoal) return { value: "No active goal", detail: "Create one when you are ready." };
      if (!activeGoal.deadline) return activeGoal.weekly > 0
        ? { value: `${formatMoney(activeGoal.weekly)}/week`, detail: `${activeGoal.name} · add a date to check pace` }
        : { value: "Set a weekly amount", detail: activeGoal.name };
      const needed = weeklyNeededForDeadline(activeGoal.target, activeGoal.saved, activeGoal.deadline);
      const gap = Math.max(0, needed - activeGoal.weekly);
      return gap <= 0.01
        ? { value: "On track", detail: `${activeGoal.name} · ${formatMoney(activeGoal.weekly)}/week` }
        : { value: `${formatMoney(gap)}/week short`, detail: `${activeGoal.name} by ${formatDate(activeGoal.deadline)}` };
    })();
    const newestDate = view.chartTransactions.reduce<string | null>((newest, transaction) => !newest || transaction.date > newest ? transaction.date : newest, null);
    const newestActivity = newestDate
      ? view.chartTransactions.filter((transaction) => transaction.date === newestDate).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
      : null;

    return [
      {
        label: "Safe to spend today",
        value: comfortableToday > 0 ? formatMoney(comfortableToday) : "$0",
        detail: comfortableToday > 0 ? "Comfortable room after the next 30 days." : "Bills, goals, or everyday spending use the available room.",
        tone: "mint",
      },
      nextBill ? {
        label: "Coming up next",
        value: formatMoney(nextBill.amount),
        detail: `${nextBill.name} · ${nextBill.daysUntil === 0 ? "due today" : nextBill.daysUntil === 1 ? "due tomorrow" : `due in ${nextBill.daysUntil} days`}`,
        tone: "blue",
      } : nextIncome ? {
        label: "Coming up next",
        value: formatMoney(nextIncome.amount),
        detail: `${nextIncome.name} · expected ${formatDate(nextIncome.date)}`,
        tone: "blue",
      } : {
        label: "Coming up next",
        value: "Nothing scheduled",
        detail: "We will show recurring bills or income here.",
        tone: "blue",
      },
      { label: "Goal check-in", ...goalPace, tone: "violet" },
      newestActivity ? {
        label: "Recent money move",
        value: `${newestActivity.amount < 0 ? "+" : "−"}${formatMoney(Math.abs(newestActivity.amount))}`,
        detail: `${newestActivity.name} · ${formatDate(newestActivity.date)}`,
        tone: "sky",
      } : {
        label: "Recent money move",
        value: "No posted activity",
        detail: "New transactions will appear here once they settle.",
        tone: "sky",
      },
    ];
  }, [data.accounts, data.transactions, goals, view.bills, view.chartTransactions]);
  const lastBankUpdate = data.status
    .map((status) => status.lastUpdatedAt)
    .filter((stamp): stamp is string => !!stamp && !Number.isNaN(Date.parse(stamp)))
    .sort()
    .at(-1);
  /** "just now", "4 min ago", or a time for anything older than an hour. */
  const sinceLabel = (stamp: string) => {
    const minutes = Math.floor((Date.now() - Date.parse(stamp)) / 60_000);
    return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : formatTime(stamp);
  };
  const formatTime = (stamp: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(stamp));
  const firstName = profileName.trim().split(/\s+/)[0] || "Michael";

  return (
    <section className="dashboard-home-overview" aria-label="Money overview">
      <header className="home-welcome">
        <span className="home-welcome-orbit home-welcome-orbit-one" aria-hidden="true" />
        <span className="home-welcome-orbit home-welcome-orbit-two" aria-hidden="true" />
        <div className="home-welcome-copy"><p className="home-welcome-kicker"><Sparkles size={15} aria-hidden="true" /> YOUR NORTHSTAR</p><h1>Welcome, <span className="home-welcome-name">{firstName}<i aria-hidden="true" /></span></h1></div>
        <div className="home-sync">
          {/* Balances and transactions update separately: say which is which. */}
          <span><i aria-hidden="true" />{data.balancesCheckedAt ? `Balances checked ${sinceLabel(data.balancesCheckedAt)}` : lastBankUpdate ? `Bank data updated ${formatTime(lastBankUpdate)}` : `NorthStar checked ${formatTime(data.fetchedAt)}`}</span>
          {data.balancesCheckedAt && lastBankUpdate && <small>Transactions updated {formatTime(lastBankUpdate)}</small>}
          {onRefresh && <button type="button" className="home-sync-link" onClick={onRefresh} disabled={refreshing || balancesAreFresh(data)} title={balancesAreFresh(data) ? "Checked with your banks in the last 15 minutes" : "Ask your banks for current balances"}><RefreshCw size={14} className={refreshing ? "home-sync-spin" : ""} aria-hidden="true" />{refreshing ? "Checking…" : balancesAreFresh(data) ? "Balances up to date" : "Update balances"}</button>}
        </div>
      </header>
      {/* The trend and allocation share the primary card; action cards remain compact at right. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] min-[1600px]:gap-6 [&>*]:min-w-0">
        <div className="clay wealth-accent p-5 sm:p-7">
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_230px]">
            <NetWorthChart series={view.series} transactions={view.chartTransactions} quickLook={quickLook} />
            <div className="border-t border-stone-100 pt-5 xl:border-l xl:border-t-0 xl:pt-0 xl:pl-6">
              <AssetSplit slices={view.slices} />
              <div className="mt-4 border-t border-stone-100 pt-4">
                <div className={addAccount ? "grid grid-cols-2 gap-3" : undefined}>
                  {addAccount}
                  <button onClick={onMoney} className="wealth-secondary w-full min-w-0 justify-center whitespace-normal text-center leading-tight">
                    View accounts and activity <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4 [&>*]:min-w-0">
          <div className="clay wealth-accent flex flex-col p-4">
            <CardHead title="Savings goals" action={goals.length && onGoals ? { label: "See all", onClick: onGoals } : undefined} />
            {topGoals.length ? (
              <ul className="mt-1 divide-y divide-stone-100">
                {topGoals.map((g) => {
                  const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
                  return (
                    <li key={g.id}>
                      <button onClick={() => onOpenGoal?.(g.id)} className="overview-row block w-full py-3 text-left">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-bold text-ink">{g.name}</span>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-500">{Math.round(pct)}%</span>
                        </span>
                        <span className="wealth-progress !my-2 block" role="progressbar" aria-label={`${g.name} funded`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                          <i style={{ width: `${pct}%` }} />
                        </span>
                        <span className="flex justify-between gap-2 text-xs tabular-nums text-stone-500">
                          <span>{formatExact(g.saved)} of {formatExact(g.target)}</span>
                          <span>{formatExact(g.weekly)}/week</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--night-border)] text-[var(--aurora-teal)]" aria-hidden="true"><Target className="h-6 w-6" /></span>
                <span>
                  <span className="block text-sm font-bold text-ink">No savings goals yet</span>
                  <span className="mt-1 block text-sm text-stone-600">A laptop, a trip, an emergency fund: give your money a job.</span>
                </span>
                {onNewGoal && <button onClick={onNewGoal} className="wealth-secondary inline-flex items-center gap-1.5"><Plus className="h-4 w-4" aria-hidden="true" /> Create a goal</button>}
              </div>
            )}
          </div>

          <div className="clay wealth-accent flex flex-col p-4">
            <CardHead title="Upcoming bills" />
            {view.bills.length ? (
              <ul className="mt-1 divide-y divide-stone-100">
                {view.bills.map((b) => (
                  <li key={b.name} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-ink">{b.name}</span>
                      <span className="block text-xs text-stone-500">{b.cadence}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold tabular-nums text-ink">{formatExact(b.amount)}</span>
                      <span className="block text-xs text-stone-500">{b.daysUntil === 0 ? "Due today" : b.daysUntil === 1 ? "Tomorrow" : `In ${b.daysUntil} days`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {data.transactions.length ? "No repeating bills spotted yet." : "Connect a bank account and recurring bills will show up here."}
              </p>
            )}
            {view.bills.length > 0 && (
              <p className="mt-auto flex items-center justify-between gap-3 border-t border-stone-100 pt-3 text-sm">
                <span className="flex items-center gap-2 text-stone-600"><CalendarClock className="h-4 w-4 text-[var(--aurora-teal)]" aria-hidden="true" /> {view.bills.length} upcoming</span>
                <span className="font-bold tabular-nums text-ink">{formatExact(billsTotal)}</span>
              </p>
            )}
          </div>

          <PriceAddon onCheck={onCheck} />
        </aside>
      </div>
    </section>
  );
}

function CardHead({ icon, title, action }: { icon?: React.ReactNode; title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">
        {icon && <span aria-hidden="true">{icon}</span>}
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
      aria-label="Check a purchase: see how it affects your savings goals"
      className="clay group flex w-full items-center justify-between gap-4 p-5 text-left transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transition-none"
    >
      <span className="min-w-0">
        <span className="block font-display text-lg font-bold leading-tight text-ink">Can I afford it?</span>
        <span className="mt-1 block text-sm text-stone-600">Check a price against your cash, bills, and goals.</span>
      </span>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--night-border)] text-[var(--aurora-teal)] transition-colors duration-200 group-hover:bg-[rgb(84_226_194/12%)]" aria-hidden="true">
        <ArrowRight className="h-5 w-5" />
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
            Decide what you can <span className="text-brand-600">spend today.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-600">
            Connect your accounts or enter balances yourself. NorthStar helps you check a purchase against your cash, upcoming bills, and savings goals.
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
