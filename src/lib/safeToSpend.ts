// Safe-to-Spend: a 30-day cash forecast and a purchase verdict.
//
// Everything here is plain, deterministic math so the verdict (color, numbers, safe date)
// is testable and identical everywhere it appears. The AI only explains a result
// computed here; it never decides it. Kept free of React so it can also serve as an
// agent tool later.
import { addDays, todayISO } from "./dates.js";
import { detectTransferIds, findRepeating, isTransfer, type BankAccount, type BankTransaction } from "./money.js";

export const FORECAST_DAYS = 30;
const SPENDING_LOOKBACK_DAYS = 60;

export type Verdict = "safe" | "tight" | "not-yet";
export type Confidence = "full" | "limited" | "estimate";

/** A repeating money event (a bill going out or a paycheck coming in). */
export interface Recurring {
  name: string;
  amount: number; // always positive; direction comes from which list it's in
  cadence: string;
  everyDays: number;
  nextDate: string; // YYYY-MM-DD, today or later
}

export interface ForecastEvent {
  date: string;
  name: string;
  amount: number; // + money in, − money out
  kind: "income" | "bill";
}

export interface ForecastDay {
  date: string;
  balance: number; // projected end-of-day balance, before any new purchase
}

/** How the lowest point is reached, step by step, so the number is never a mystery. */
export interface LowPointBreakdown {
  cash: number;
  reserved: number;
  income: number;
  bills: { name: string; amount: number }[];
  everyday: number;
  days: number;
  lowPoint: number;
  lowPointDate: string;
}

export interface SafeToSpendInputs {
  /** Spendable cash today: checking (and any manual checking balances). */
  cash: number;
  /** Savings kept as a backup, not counted as spendable. */
  savings: number;
  transactions: BankTransaction[];
  /** Accounts whose deposits count as income (checking/savings). */
  cashAccountIds: string[];
  goals: { name: string; target: number; saved: number; weekly: number; emergency?: boolean; linkedAccountId?: string }[];
  /** Used only when there's no transaction history (manual accounts): monthly spending from Budget. */
  fallbackMonthlySpending?: number;
  today?: string;
}

export interface Forecast {
  today: string;
  cash: number;
  /** Money set aside in savings goals: subtracted from cash before the forecast runs. */
  reserved: number;
  /** The goal's name when one goal holds it all; null means "your goals". */
  reservedName: string | null;
  savings: number;
  dailySpending: number;
  /** The weekly amounts on goals still being saved for, per day. A target, not a bill: it isn't subtracted. */
  goalSavingsPerDay: number;
  events: ForecastEvent[];
  days: ForecastDay[];
  lowPoint: number;
  lowPointDate: string;
  /** The biggest bill on or before the low point: usually the reason money gets tight. */
  driver: ForecastEvent | null;
  nextIncome: ForecastEvent | null;
  /** How much could be spent today without the balance dropping below $0 in the window. */
  headroom: number;
  confidence: Confidence;
}

export type OptionId = "buy-now" | "wait-until" | "use-savings" | "cheaper-option" | "skip" | "save-for-it";

export interface PurchaseOption {
  id: OptionId;
  label: string;
}

export interface PurchaseVerdict {
  verdict: Verdict;
  price: number;
  /** Lowest projected balance in the window if bought today. */
  lowPointAfter: number;
  /** Highest price that stays green / that keeps the balance above $0 at all. */
  safeLimit: number;
  comfortableLimit: number;
  /** For "not yet": first date buying keeps the rest of the window above $0. */
  safeDate: { date: string; after: string } | null;
  coveredBySavings: boolean;
  options: PurchaseOption[];
}

const EMERGENCY_GOAL = /\b(emergency|rainy[- ]?day|safety[- ]net)\b/i;

/** A goal is an emergency fund if the user said so; otherwise guess from its name. */
export const isEmergencyFund = (goal: { name: string; emergency?: boolean }) => goal.emergency ?? EMERGENCY_GOAL.test(goal.name);

/** Money in emergency-fund goals, which a "safe" purchase should never use. */
export function emergencyReserve(goals: SafeToSpendInputs["goals"]): { amount: number; name: string | null } {
  const funds = goals.filter(isEmergencyFund);
  const amount = funds.reduce((sum, g) => sum + Math.max(0, g.target > 0 ? Math.min(g.saved, g.target) : g.saved), 0);
  return { amount: Math.round(amount * 100) / 100, name: funds[0]?.name ?? null };
}

/**
 * Money set aside in savings goals. Every goal's savings are protected (not just the
 * emergency fund): goals are envelopes inside your cash, so only the rest is spending money.
 */
export function goalReserve(goals: SafeToSpendInputs["goals"]): { amount: number; name: string | null } {
  const funded = goals.filter((g) => g.saved > 0);
  // A linked goal follows an account's whole balance. Older saved states can
  // contain two goals pointing at one account; reserve that balance only once.
  const linked = new Map<string, (typeof funded)[number]>();
  const unlinked: (typeof funded)[number][] = [];
  for (const goal of funded) {
    if (!goal.linkedAccountId) {
      unlinked.push(goal);
      continue;
    }
    const current = linked.get(goal.linkedAccountId);
    if (!current || goal.saved > current.saved) linked.set(goal.linkedAccountId, goal);
  }
  const claims = [...unlinked, ...linked.values()];
  const amount = claims.reduce((sum, goal) => sum + goal.saved, 0);
  return { amount: Math.round(amount * 100) / 100, name: claims.length === 1 ? claims[0].name : null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const daysApart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Repeating transactions in one direction, from the same rules as the bill list
 * (findRepeating in money.ts): an evenly spaced recent run, steady amounts, still active.
 */
export function recurring(transactions: BankTransaction[], direction: "out" | "in", today: string): Recurring[] {
  return findRepeating(transactions, direction, today).map(({ name, amount, cadence, everyDays, nextDate }) => ({ name, amount, cadence, everyDays, nextDate }));
}

/** Take-home pay per month from repeating deposits into checking or savings (0 if none found). */
export function monthlyIncome(transactions: BankTransaction[], cashAccountIds: string[], today = todayISO()): number {
  const transferIds = detectTransferIds(transactions);
  const cash = new Set(cashAccountIds);
  const deposits = transactions.filter((t) => cash.has(t.accountId) && !isTransfer(t, transferIds));
  return round2(recurring(deposits, "in", today).reduce((sum, r) => sum + (r.amount * 30) / r.everyDays, 0));
}

/** Average everyday spending per day: money out that isn't a transfer or a recurring bill. */
export function dailySpending(transactions: BankTransaction[], transferIds: Set<string>, billNames: Set<string>, today: string): number {
  const since = addDays(today, -SPENDING_LOOKBACK_DAYS);
  const window = transactions.filter((t) => !t.pending && t.date >= since && t.date <= today);
  if (!window.length) return 0;
  const earliest = window.reduce((min, t) => (t.date < min ? t.date : min), today);
  // Divide by the history we actually have (at least a week), not a fixed 60 days.
  const spanDays = Math.max(7, Math.min(SPENDING_LOOKBACK_DAYS, daysApart(earliest, today) + 1));
  const total = window
    .filter((t) => t.amount > 0 && !isTransfer(t, transferIds) && !billNames.has(t.name))
    .reduce((s, t) => s + t.amount, 0);
  return round2(total / spanDays);
}

/** Expand recurring items into dated events inside the forecast window. */
function occurrences(items: Recurring[], kind: ForecastEvent["kind"], today: string): ForecastEvent[] {
  const end = addDays(today, FORECAST_DAYS - 1);
  const events: ForecastEvent[] = [];
  for (const item of items) {
    for (let date = item.nextDate; date <= end; date = addDays(date, item.everyDays)) {
      events.push({ date, name: item.name, amount: kind === "income" ? item.amount : -item.amount, kind });
    }
  }
  return events;
}

/** Day-by-day projected balance for the next 30 days, before any new purchase. */
export function buildForecast(inputs: SafeToSpendInputs): Forecast {
  const today = inputs.today ?? todayISO();
  const transferIds = detectTransferIds(inputs.transactions);
  const usable = inputs.transactions.filter((t) => !isTransfer(t, transferIds));
  const bills = recurring(usable, "out", today);
  const cashAccounts = new Set(inputs.cashAccountIds);
  const income = recurring(usable.filter((t) => cashAccounts.has(t.accountId)), "in", today);
  const hasHistory = inputs.transactions.length > 0;

  const everyday = hasHistory
    ? dailySpending(inputs.transactions, transferIds, new Set(bills.map((b) => b.name)), today)
    : round2((inputs.fallbackMonthlySpending ?? 0) / 30);
  // Goal money for the window is set aside first, so a "safe" purchase never takes it.
  const goalSavingsPerDay = round2(inputs.goals.filter((g) => g.saved < g.target).reduce((s, g) => s + Math.max(0, g.weekly), 0) / 7);

  const events = [...occurrences(income, "income", today), ...occurrences(bills, "bill", today)].sort((a, b) => a.date.localeCompare(b.date));
  const reserve = goalReserve(inputs.goals);
  const days: ForecastDay[] = [];
  let balance = inputs.cash - reserve.amount;
  // Only money already in goals is kept out. Weekly goal amounts are targets, not bills: that money
  // stays in your account, and what a purchase does to a goal's timeline is shown separately.
  for (let i = 0; i < FORECAST_DAYS; i++) {
    const date = addDays(today, i);
    balance += events.filter((e) => e.date === date).reduce((s, e) => s + e.amount, 0);
    balance -= everyday;
    days.push({ date, balance: round2(balance) });
  }
  const low = days.reduce((min, d) => (d.balance < min.balance ? d : min), days[0]);
  const driver = events.filter((e) => e.kind === "bill" && e.date <= low.date).sort((a, b) => a.amount - b.amount)[0] ?? null;

  const spanDays = hasHistory ? daysApart(inputs.transactions.reduce((m, t) => (t.date < m ? t.date : m), today), today) : 0;
  const confidence: Confidence = !hasHistory ? "estimate" : spanDays >= 45 && income.length > 0 ? "full" : "limited";

  return {
    today,
    cash: round2(inputs.cash),
    reserved: reserve.amount,
    reservedName: reserve.name,
    savings: round2(inputs.savings),
    dailySpending: everyday,
    goalSavingsPerDay,
    events,
    days,
    lowPoint: low.balance,
    lowPointDate: low.date,
    driver,
    nextIncome: events.find((e) => e.kind === "income") ?? null,
    headroom: round2(low.balance),
    confidence,
  };
}

/** The steps from cash today to the lowest point: what's set aside, what comes in, and what goes out. */
export function lowPointBreakdown(f: Forecast): LowPointBreakdown {
  const upTo = f.days.filter((d) => d.date <= f.lowPointDate);
  const before = f.events.filter((e) => e.date <= f.lowPointDate);
  return {
    cash: f.cash,
    reserved: f.reserved,
    income: round2(before.filter((e) => e.kind === "income").reduce((s, e) => s + e.amount, 0)),
    bills: before.filter((e) => e.kind === "bill").map((e) => ({ name: e.name, amount: -e.amount })),
    everyday: round2(f.dailySpending * upTo.length),
    days: upTo.length,
    lowPoint: f.lowPoint,
    lowPointDate: f.lowPointDate,
  };
}

/** Green / yellow / red for buying `price` today, plus the date it becomes safe if not now. */
export function evaluatePurchase(forecast: Forecast, price: number): PurchaseVerdict {
  const headroom = forecast.headroom;
  const comfortableLimit = Math.max(0, Math.floor(headroom * 0.5));
  const safeLimit = Math.max(0, Math.floor(headroom));
  const verdict: Verdict = price <= comfortableLimit ? "safe" : price <= headroom ? "tight" : "not-yet";

  // Buying on a later day only lowers balances from that day on, so check each deposit day.
  let safeDate: PurchaseVerdict["safeDate"] = null;
  if (verdict === "not-yet") {
    for (const income of forecast.events.filter((e) => e.kind === "income")) {
      const from = forecast.days.findIndex((d) => d.date === income.date);
      if (from < 0) continue;
      const before = forecast.days.slice(0, from);
      const after = forecast.days.slice(from);
      const okBefore = before.every((d) => d.balance >= 0);
      const okAfter = after.every((d) => d.balance - price >= 0);
      if (okBefore && okAfter) {
        safeDate = { date: income.date, after: income.name };
        break;
      }
    }
  }
  const coveredBySavings = verdict === "not-yet" && price - Math.max(0, headroom) <= forecast.savings;

  const options: PurchaseOption[] = [];
  if (verdict === "safe") options.push({ id: "buy-now", label: "Buy it" });
  if (verdict === "tight") options.push({ id: "buy-now", label: "Buy it, but keep an eye on spending until payday" });
  if (safeDate) options.push({ id: "wait-until", label: `Wait until ${safeDate.date}` });
  // Only suggest a cheaper version when one is realistic: at least half the price (a $2,000 laptop has no $242 version).
  if (verdict !== "safe" && comfortableLimit > 0 && comfortableLimit >= price * 0.5) options.push({ id: "cheaper-option", label: `Find a version under $${comfortableLimit}` });
  if (coveredBySavings) options.push({ id: "use-savings", label: "Cover the gap from savings" });
  if (verdict === "not-yet" && !safeDate && !coveredBySavings) options.push({ id: "save-for-it", label: "Start a savings goal for it" });
  if (verdict !== "safe") options.push({ id: "skip", label: "Skip it" });

  return {
    verdict,
    price,
    lowPointAfter: round2(forecast.lowPoint - price),
    safeLimit,
    comfortableLimit,
    safeDate,
    coveredBySavings,
    options,
  };
}

/** Cash and savings from Plaid accounts (checking counts as spendable; savings is the backup). */
export function cashFromAccounts(accounts: BankAccount[]) {
  const depository = accounts.filter((a) => a.type === "depository");
  const balance = (a: BankAccount) => a.available ?? a.current;
  const checking = depository.filter((a) => a.subtype !== "savings").reduce((s, a) => s + balance(a), 0);
  const savings = depository.filter((a) => a.subtype === "savings").reduce((s, a) => s + balance(a), 0);
  return { checking: round2(checking), savings: round2(savings), cashAccountIds: depository.map((a) => a.id) };
}
