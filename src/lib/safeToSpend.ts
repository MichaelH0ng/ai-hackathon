// Safe-to-Spend: a 30-day cash forecast and a purchase verdict.
//
// Everything here is plain, deterministic math so the verdict (color, numbers, safe date)
// is testable and identical everywhere it appears. The AI only explains a result
// computed here; it never decides it. Kept free of React so it can also serve as an
// agent tool later.
import { addDays, todayISO } from "./dates.ts";
import { detectTransferIds, isTransfer, type BankAccount, type BankTransaction } from "./money.ts";

export const FORECAST_DAYS = 30;
const SPENDING_LOOKBACK_DAYS = 60;
const MIN_CUSHION = 50;

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

export interface SafeToSpendInputs {
  /** Spendable cash today: checking (and any manual checking balances). */
  cash: number;
  /** Savings kept as a backup, not counted as spendable. */
  savings: number;
  transactions: BankTransaction[];
  /** Accounts whose deposits count as income (checking/savings). */
  cashAccountIds: string[];
  goals: { name: string; target: number; saved: number; weekly: number; emergency?: boolean }[];
  /** Used only when there's no transaction history (manual accounts): monthly spending from Budget. */
  fallbackMonthlySpending?: number;
  today?: string;
}

export interface Forecast {
  today: string;
  cash: number;
  /** Emergency-fund money kept aside: subtracted from cash before the forecast runs. */
  reserved: number;
  reservedName: string | null;
  savings: number;
  dailySpending: number;
  goalSavingsPerDay: number;
  cushion: number;
  events: ForecastEvent[];
  days: ForecastDay[];
  lowPoint: number;
  lowPointDate: string;
  /** The biggest bill on or before the low point: usually the reason money gets tight. */
  driver: ForecastEvent | null;
  nextIncome: ForecastEvent | null;
  /** How much could be spent today and still stay above the cushion for the whole window. */
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
  /** Highest price that stays green / that stays above the cushion at all. */
  safeLimit: number;
  comfortableLimit: number;
  /** For "not yet": first date buying keeps the rest of the window above the cushion. */
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

const CADENCE_DAYS: Record<string, number> = { Weekly: 7, "Every 2 weeks": 14, Monthly: 30, Quarterly: 91 };
const round2 = (n: number) => Math.round(n * 100) / 100;
const daysApart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Repeating transactions in one direction: same name, similar amount, steady gap.
 * Mirrors upcomingBills() in money.ts, but works for deposits too.
 */
export function recurring(transactions: BankTransaction[], direction: "out" | "in", today: string): Recurring[] {
  const byName = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    if (t.pending || (direction === "out" ? t.amount <= 0 : t.amount >= 0)) continue;
    const list = byName.get(t.name) ?? [];
    list.push(t);
    byName.set(t.name, list);
  }
  const found: Recurring[] = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const amounts = list.map((t) => Math.abs(t.amount));
    const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    if ((Math.max(...amounts) - Math.min(...amounts)) / avg >= 0.2) continue;
    const dates = list.map((t) => t.date).sort();
    let gapSum = 0;
    for (let i = 1; i < dates.length; i++) gapSum += daysApart(dates[i - 1], dates[i]);
    const gap = gapSum / (dates.length - 1);
    const cadence = gap >= 5 && gap <= 9 ? "Weekly" : gap >= 12 && gap <= 16 ? "Every 2 weeks" : gap >= 25 && gap <= 35 ? "Monthly" : gap >= 85 && gap <= 100 ? "Quarterly" : null;
    if (!cadence) continue;
    const everyDays = CADENCE_DAYS[cadence];
    let next = addDays(dates[dates.length - 1], everyDays);
    while (next < today) next = addDays(next, everyDays);
    found.push({ name, amount: round2(avg), cadence, everyDays, nextDate: next });
  }
  return found.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
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
  const reserve = emergencyReserve(inputs.goals);
  const days: ForecastDay[] = [];
  let balance = inputs.cash - reserve.amount;
  for (let i = 0; i < FORECAST_DAYS; i++) {
    const date = addDays(today, i);
    balance += events.filter((e) => e.date === date).reduce((s, e) => s + e.amount, 0);
    balance -= everyday + goalSavingsPerDay;
    days.push({ date, balance: round2(balance) });
  }
  const low = days.reduce((min, d) => (d.balance < min.balance ? d : min), days[0]);
  const driver = events.filter((e) => e.kind === "bill" && e.date <= low.date).sort((a, b) => a.amount - b.amount)[0] ?? null;
  const cushion = round2(Math.max(MIN_CUSHION, everyday * 7));

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
    cushion,
    events,
    days,
    lowPoint: low.balance,
    lowPointDate: low.date,
    driver,
    nextIncome: events.find((e) => e.kind === "income") ?? null,
    headroom: round2(low.balance - cushion),
    confidence,
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
      const okBefore = before.every((d) => d.balance >= forecast.cushion);
      const okAfter = after.every((d) => d.balance - price >= forecast.cushion);
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
  if (verdict !== "safe" && comfortableLimit > 0) options.push({ id: "cheaper-option", label: `Find a version under $${comfortableLimit}` });
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
