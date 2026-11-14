import { ArrowRight, CalendarClock, Camera, GraduationCap, PiggyBank, ShoppingBag, Wallet } from "lucide-react";
import { useMemo } from "react";
import { formatMoney, goalPhrase, whatIfSpend } from "../lib/finance";
import { assetsByInstitution, detectTransferIds, netWorthSeries, periodFlow, spendableCash, upcomingBills } from "../lib/money";
import type { MoneyGoal } from "../lib/types";
import type { Bank } from "../lib/useBank";
import { AssetSplit } from "./AssetSplit";
import { ConnectCard } from "./MoneyDashboard";
import { NetWorthChart } from "./NetWorthChart";
import type { PathKind } from "./PathCards";
import { SavingsPlanner } from "./SavingsPlanner";

/**
 * Home page = your money dashboard: net worth over time and where it's held.
 * Check a price (the photo feature) and Study sit alongside as add-ons.
 */
export function Landing({
  bank,
  goalCount,
  moneyGoals = [],
  onOpenGoal,
  onUpdateGoal,
  onMoney,
  onPick,
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
  onPick: (k: PathKind) => void;
  onDemo: () => void;
  onGoals: () => void;
  onCheck: () => void;
}) {
  const goal = moneyGoals.find((g) => g.saved < g.target) ?? moneyGoals[0];

  return (
    <main id="main">
      {bank.connected ? (
        <Dashboard bank={bank} goal={goal} onCheck={onCheck} onMoney={onMoney} />
      ) : bank.loading && !bank.status ? (
        <section className="px-4 pt-6">
          <div className="clay mx-auto h-[28rem] max-w-6xl animate-pulse" aria-label="Loading your accounts" />
        </section>
      ) : (
        <Welcome bank={bank} goal={goal} goalCount={goalCount} onCheck={onCheck} onDemo={onDemo} onGoals={onGoals} />
      )}

      {moneyGoals.length > 0 && <SavingsPlanner goals={moneyGoals} onUpdate={onUpdateGoal} onOpen={onOpenGoal} />}

      <section aria-label="More in TradeOff" className="px-4 pb-14">
        <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2">
          <MoreCard icon={<PiggyBank className="h-5 w-5" />} tint="bg-emerald-100 text-emerald-700" title="Save for something" line="Set a goal and a weekly amount. Your finish date moves with every choice." cta={moneyGoals.length ? "Add another goal" : "Start a savings goal"} onClick={() => onPick("money")} />
          <MoreCard icon={<GraduationCap className="h-5 w-5" />} tint="bg-amber-100 text-amber-700" title="Study smarter" line="A day-by-day exam plan, hard topics first, and what a movie night really costs." cta="Plan my studying" onClick={() => onPick("study")} />
        </div>
      </section>

      <footer className="border-t border-brand-100 px-4 py-6 text-center text-sm text-stone-500">
        <strong className="font-display text-ink">TradeOff</strong> · Built for the Cal Poly AI Hackathon · A planning tool, not financial advice.
      </footer>
    </main>
  );
}

// ---------- connected: the dashboard ----------

function Dashboard({ bank, goal, onCheck, onMoney }: { bank: Bank; goal?: MoneyGoal; onCheck: () => void; onMoney: () => void }) {
  const data = bank.data!;
  const view = useMemo(() => {
    const transferIds = detectTransferIds(data.transactions);
    return {
      series: netWorthSeries(data.accounts, data.transactions, 90),
      slices: assetsByInstitution(data.accounts),
      cash: spendableCash(data.accounts),
      flow: periodFlow(data.transactions, transferIds, "month"),
      bill: upcomingBills(data.transactions, transferIds)[0],
    };
  }, [data]);
  const spent = view.flow.current.out;
  const lastSpent = view.flow.previous.out;

  return (
    <section className="px-4 pb-10 pt-6">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[1.75fr_1fr] [&>*]:min-w-0">
        <div className="clay p-5 sm:p-7">
          <NetWorthChart series={view.series} note={data.env === "sandbox" ? "Sandbox test data" : "Estimated from transactions"} />
          <div className="mt-6">
            <AssetSplit slices={view.slices} />
          </div>
        </div>

        <aside className="space-y-4">
          <PriceAddon goal={goal} cash={view.cash} onCheck={onCheck} />

          <div className="clay divide-y divide-stone-100 px-5 py-2">
            <Stat icon={<Wallet className="h-4 w-4 text-sky-600" />} label="Spendable cash" value={formatMoney(view.cash)} />
            <Stat
              icon={<ShoppingBag className="h-4 w-4 text-amber-600" />}
              label="Spent this month"
              value={formatMoney(spent)}
              sub={lastSpent ? `${formatMoney(lastSpent)} last month` : undefined}
            />
            {view.bill && (
              <Stat
                icon={<CalendarClock className="h-4 w-4 text-brand-600" />}
                label={`Next bill: ${view.bill.name}`}
                value={formatMoney(view.bill.amount, true)}
                sub={view.bill.daysUntil === 0 ? "due today" : `in ${view.bill.daysUntil} days`}
              />
            )}
          </div>

          <button onClick={onMoney} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 font-bold text-white transition-colors duration-200 hover:bg-brand-700">
            Open full money dashboard <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
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

/** The photo feature, as an add-on to the dashboard. */
function PriceAddon({ goal, cash, onCheck }: { goal?: MoneyGoal; cash?: number; onCheck: () => void }) {
  const example = 49.99;
  const delay = goal ? whatIfSpend(goal.target, goal.saved, goal.weekly, example).delayDays : null;
  return (
    <button
      onClick={onCheck}
      className="block w-full rounded-3xl bg-brand-600 p-5 text-left text-white shadow-[0_6px_0_0_rgb(59_7_100/0.25)] transition-all duration-200 hover:bg-brand-700 active:translate-y-0.5"
    >
      <span className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Camera className="h-5 w-5" aria-hidden="true" /></span>
        <span>
          <span className="block font-display text-lg font-bold leading-tight">Thinking about buying something?</span>
          <span className="block text-sm text-brand-100">Snap the price tag or type the price.</span>
        </span>
      </span>
      <span className="mt-4 block rounded-2xl bg-white/10 px-4 py-3 text-sm">
        {goal && delay != null && isFinite(delay) ? (
          <>
            A ${example} buy pushes your {goalPhrase(goal.name)} back <strong>{Math.round(delay)} days</strong>
            {cash != null ? <> and leaves {formatMoney(cash - example)} to spend.</> : "."}
          </>
        ) : (
          <>See the hours of work, what it does to your goals and a cheaper idea, before you buy.</>
        )}
      </span>
      <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold">
        Check a price <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  );
}

// ---------- not connected yet ----------

function Welcome({
  bank,
  goal,
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
            <PriceAddon goal={goal} onCheck={onCheck} />
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
