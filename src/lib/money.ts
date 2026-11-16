// Money dashboard math, ported from the money-dashboard project so the numbers agree.
// Plaid convention: amount > 0 is money going out, amount < 0 is money coming in.

export interface BankAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string; // depository | credit | loan | investment | other
  subtype: string | null;
  current: number;
  available: number | null;
  institution: string;
}

export interface BankTransaction {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  name: string;
  amount: number;
  category: string; // Plaid personal_finance_category.primary
  pending: boolean;
}

export interface PortfolioHolding {
  id: string;
  accountId: string;
  name: string;
  ticker: string | null;
  quantity: number;
  price: number;
  value: number;
  currency: string | null;
  priceAsOf: string | null;
  institution: string;
}

/** A credit card or loan from Plaid Liabilities. Every field except the balance can be missing at a given bank. */
export interface DebtAccount {
  accountId: string;
  institution: string;
  name: string;
  mask: string | null;
  kind: "credit" | "student" | "mortgage" | "loan";
  balance: number;
  minimumPayment: number | null;
  nextDueDate: string | null; // YYYY-MM-DD
  /** Purchase APR for cards, the stated interest rate for loans. */
  apr: number | null;
  lastStatementBalance: number | null;
  isOverdue: boolean | null;
}

/** A repeating bill or paycheck that Plaid detected (Recurring Transactions). */
export interface RecurringStream {
  id: string;
  accountId: string;
  name: string;
  amount: number; // positive; use `direction` for which way the money moves
  direction: "out" | "in";
  frequency: "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "ANNUALLY" | "UNKNOWN";
  nextDate: string | null; // YYYY-MM-DD
  category: string;
  isActive: boolean;
}

export interface BankData {
  holdings?: PortfolioHolding[];
  /** Cards and loans with minimums, due dates and APRs. Empty when no connected bank has shared them. */
  debts?: DebtAccount[];
  /** Bills and paychecks Plaid detected. Empty until Plaid has enough history; the app then estimates bills itself. */
  recurring?: RecurringStream[];
  env: string;
  accounts: BankAccount[];
  transactions: BankTransaction[];
  /** Each connection's latest successful Plaid Transactions update, when available. */
  status: {
    itemId: string;
    institution: string;
    problem?: string;
    ready: boolean;
    lastUpdatedAt?: string | null;
    /** This connection was made before card and loan details were requested; reconnecting adds them. */
    needsDebtConsent?: boolean;
  }[];
  fetchedAt: string;
  /** When balances were last checked live with the banks (within 15 minutes), or null for Plaid's saved balances. */
  balancesCheckedAt?: string | null;
  /** One recorded whole-net-worth value per day, captured after a complete account load. */
  netWorthSnapshots?: NetWorthSnapshot[];
}

const LIABILITY = new Set(["credit", "loan"]);
export const isLiability = (a: BankAccount) => LIABILITY.has(a.type);

/** Assets minus what you owe. */
export function netWorth(accounts: BankAccount[]) {
  let assets = 0;
  let debts = 0;
  for (const a of accounts) {
    if (isLiability(a)) debts += a.current;
    else assets += a.current;
  }
  return { assets, debts, net: assets - debts };
}

/** Cash you could spend today: checking + savings (available balance when Plaid has it). */
export function spendableCash(accounts: BankAccount[]): number {
  return accounts
    .filter((a) => a.type === "depository" && (a.subtype === "checking" || a.subtype === "savings"))
    .reduce((s, a) => s + (a.available ?? a.current), 0);
}

export const ACCOUNT_GROUPS: { key: string; label: string; match: (a: BankAccount) => boolean }[] = [
  { key: "cash", label: "Cash", match: (a) => a.type === "depository" },
  { key: "invest", label: "Investments", match: (a) => a.type === "investment" || a.type === "brokerage" },
  { key: "credit", label: "Credit cards", match: (a) => a.type === "credit" },
  { key: "loan", label: "Loans", match: (a) => a.type === "loan" },
  { key: "other", label: "Other", match: (a) => !["depository", "investment", "brokerage", "credit", "loan"].includes(a.type) },
];

/**
 * Pairs of transactions on different accounts, opposite sign, same amount, within 3 days:
 * money moving between your own accounts, even when Plaid's category misses it.
 */
export function detectTransferIds(transactions: BankTransaction[]): Set<string> {
  // Only look at transactions Plaid hasn't already labeled as transfers or loan payments:
  // those are excluded anyway, and letting them pair could hide a real purchase of the same
  // amount nearby (e.g. a $50 grocery run two days after a $50 savings transfer).
  // Pending transactions can disappear or be replaced when they post. They do
  // not belong in historical transfer detection or spending calculations.
  const candidates = transactions.filter((t) => !t.pending && !t.category.startsWith("TRANSFER") && t.category !== "LOAN_PAYMENTS");
  const ids = new Set<string>();
  const buckets = new Map<string, BankTransaction[]>();
  for (const t of candidates) {
    const key = Math.abs(t.amount).toFixed(2);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }
  const daysApart = (a: BankTransaction, b: BankTransaction) => Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) / 86400000;
  for (const group of buckets.values()) {
    for (const a of group) {
      if (ids.has(a.id)) continue;
      // Pair with the closest-dated opposite transaction on another account, not just the first one found.
      let best: BankTransaction | null = null;
      for (const b of group) {
        if (b === a || ids.has(b.id) || a.accountId === b.accountId || Math.sign(a.amount) === Math.sign(b.amount)) continue;
        if (daysApart(a, b) > 3) continue;
        if (!best || daysApart(a, b) < daysApart(a, best)) best = b;
      }
      if (best) {
        ids.add(a.id);
        ids.add(best.id);
      }
    }
  }
  return ids;
}

export function isTransfer(t: BankTransaction, transferIds: Set<string>): boolean {
  return transferIds.has(t.id) || t.category.startsWith("TRANSFER") || t.category === "LOAN_PAYMENTS";
}

const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type FlowPeriod = "week" | "month";

/** Money in vs out for this week (Sunday start) or this month, plus the period before it. */
export function periodFlow(transactions: BankTransaction[], transferIds: Set<string>, period: FlowPeriod, now = new Date()) {
  const start =
    period === "week" ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()) : new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = period === "week" ? new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const s = localISO(start);
  const p = localISO(prevStart);
  const current = { in: 0, out: 0 };
  const previous = { in: 0, out: 0 };
  for (const t of transactions) {
    if (t.pending || t.date < p || isTransfer(t, transferIds)) continue;
    const bucket = t.date >= s ? current : previous;
    if (t.amount > 0) bucket.out += t.amount;
    else bucket.in += -t.amount;
  }
  return { current, previous };
}

/** Spending by category over the last `days` days, biggest first. */
export function topCategories(transactions: BankTransaction[], transferIds: Set<string>, days = 30, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const c = localISO(cutoff);
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.pending || t.amount <= 0 || t.date < c || isTransfer(t, transferIds)) continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
  }
  const total = [...totals.values()].reduce((s, v) => s + v, 0) || 1;
  return [...totals.entries()]
    .map(([key, value]) => ({ key, label: categoryLabel(key), emoji: categoryEmoji(key), value, pct: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

export interface Bill {
  name: string;
  amount: number;
  cadence: string;
  nextDue: string; // YYYY-MM-DD
  daysUntil: number;
  /** "plaid" = detected by Plaid; "estimated" = this app's guess from past transactions. */
  source?: "plaid" | "estimated";
}

const FREQUENCY_LABEL: Record<RecurringStream["frequency"], string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  ANNUALLY: "Yearly",
  UNKNOWN: "Repeats",
};
export const frequencyLabel = (f: RecurringStream["frequency"]) => FREQUENCY_LABEL[f] ?? "Repeats";

/** Active repeating charges from Plaid's detection, soonest first. Skips income and transfers between your accounts. */
export function billsFromStreams(streams: RecurringStream[], now = new Date()): Bill[] {
  const today = new Date(localISO(now)).getTime();
  const bills: Bill[] = [];
  for (const s of streams) {
    if (s.direction !== "out" || !s.isActive || !s.nextDate || s.category.startsWith("TRANSFER")) continue;
    const daysUntil = Math.round((new Date(s.nextDate).getTime() - today) / 86400000);
    if (Number.isNaN(daysUntil) || daysUntil < 0) continue;
    bills.push({ name: s.name, amount: s.amount, cadence: frequencyLabel(s.frequency), nextDue: s.nextDate, daysUntil, source: "plaid" });
  }
  return bills.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Plaid-detected bills when there are any, otherwise the app's own estimate from past transactions. */
export function billsFor(data: Pick<BankData, "transactions" | "recurring">, transferIds: Set<string>, now = new Date()): Bill[] {
  const detected = billsFromStreams(data.recurring ?? [], now);
  return detected.length ? detected : upcomingBills(data.transactions, transferIds, now);
}

// ---------- repeating charges and deposits ----------

export type Cadence = "Weekly" | "Every 2 weeks" | "Monthly";
/**
 * What counts as a schedule. Each needs several charges in a row at that spacing, so two lunches
 * a week apart or two moving-truck rentals months apart never look like a bill.
 * (Twice-a-month paychecks land 13 to 17 days apart, so they read as every 2 weeks.)
 */
const CADENCES: { cadence: Cadence; days: number; minGap: number; maxGap: number; minCount: number }[] = [
  { cadence: "Weekly", days: 7, minGap: 5, maxGap: 9, minCount: 4 },
  { cadence: "Every 2 weeks", days: 14, minGap: 11, maxGap: 17, minCount: 3 },
  { cadence: "Monthly", days: 30, minGap: 26, maxGap: 35, minCount: 3 },
];
/**
 * Everyday spending (restaurants, shopping, rides, travel, fun, personal care) only counts as a
 * bill when the price never changes, like a meal-plan or gym membership. A favorite taco spot doesn't.
 */
const EVERYDAY_CATEGORIES = new Set(["FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "TRANSPORTATION", "TRAVEL", "ENTERTAINMENT", "PERSONAL_CARE"]);
/** Rent, utilities and loan payments are bills by nature: two months in a row is enough. */
const BILL_CATEGORIES = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS"]);

export interface Repeating {
  name: string;
  amount: number;
  cadence: Cadence;
  everyDays: number;
  nextDate: string; // YYYY-MM-DD
  lastDate: string;
}

const dayMs = 86_400_000;
const isoDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const gapDays = (a: string, b: string) => Math.round((isoDay(b) - isoDay(a)) / dayMs);
const plusDays = (iso: string, days: number) => new Date(isoDay(iso) + days * dayMs).toISOString().slice(0, 10);
/** Same day next month, clamped to the month's last day (Jan 31 → Feb 28). */
function plusMonth(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * Charges (or deposits) from one merchant that are still happening on a steady schedule.
 * Rules, all required:
 *  - the latest run of charges is evenly spaced: at least 3 in a row monthly or every 2 weeks, 4 weekly
 *    (2 months in a row for rent, utilities and loan payments);
 *  - those charges cost about the same (within 20%), or exactly the same for everyday spending;
 *  - it's still active: the last one was no more than half a cycle overdue (Acorns stopping in June
 *    means no Acorns bill in November).
 */
export function findRepeating(transactions: BankTransaction[], direction: "out" | "in", today: string): Repeating[] {
  const byName = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    if (t.pending || (direction === "out" ? t.amount <= 0 : t.amount >= 0)) continue;
    byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
  }
  const found: Repeating[] = [];
  for (const [name, all] of byName) {
    const list = [...all].sort((a, b) => a.date.localeCompare(b.date));
    const last = list[list.length - 1];
    for (const rule of CADENCES) {
      // Walk back from the newest charge while the spacing fits this schedule.
      const run = [last];
      for (let i = list.length - 2; i >= 0; i--) {
        const gap = gapDays(list[i].date, run[0].date);
        if (gap < rule.minGap || gap > rule.maxGap) break;
        run.unshift(list[i]);
      }
      const needed = rule.cadence === "Monthly" && BILL_CATEGORIES.has(last.category) ? 2 : rule.minCount;
      if (run.length < needed) continue;
      const amounts = run.map((t) => Math.abs(t.amount));
      const avg = amounts.reduce((sum, v) => sum + v, 0) / amounts.length;
      const spread = Math.max(...amounts) - Math.min(...amounts);
      const fixedPrice = spread <= 0.02;
      if (EVERYDAY_CATEGORIES.has(last.category) ? !fixedPrice : spread / avg >= 0.2) continue;
      const overdue = gapDays(last.date, today) - rule.days;
      if (overdue > rule.days / 2) continue; // stopped
      const projected = rule.cadence === "Monthly" ? plusMonth(last.date) : plusDays(last.date, rule.days);
      // A little late (within the grace above): expect it any day now rather than skipping a cycle.
      const nextDate = projected < today ? today : projected;
      const recent = amounts.slice(-3);
      found.push({ name, amount: Math.round((recent.reduce((s, v) => s + v, 0) / recent.length) * 100) / 100, cadence: rule.cadence, everyDays: rule.days, nextDate, lastDate: last.date });
      break;
    }
  }
  return found.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

/** This app's estimate of upcoming bills from past transactions (used when Plaid hasn't detected any). */
export function upcomingBills(transactions: BankTransaction[], transferIds: Set<string>, now = new Date()): Bill[] {
  const today = localISO(now);
  const charges = transactions.filter((t) => !isTransfer(t, transferIds));
  return findRepeating(charges, "out", today).map((r) => ({
    name: r.name,
    amount: r.amount,
    cadence: r.cadence,
    nextDue: r.nextDate,
    daysUntil: gapDays(today, r.nextDate),
    source: "estimated" as const,
  }));
}

const CATEGORIES: Record<string, [string, string]> = {
  INCOME: ["Income", "💰"],
  RENT_AND_UTILITIES: ["Rent & utilities", "🏠"],
  FOOD_AND_DRINK: ["Food & drink", "🍽️"],
  TRANSPORTATION: ["Transportation", "🚗"],
  TRAVEL: ["Travel", "✈️"],
  GENERAL_MERCHANDISE: ["Shopping", "🛍️"],
  PERSONAL_CARE: ["Personal care", "💆"],
  ENTERTAINMENT: ["Entertainment", "🎬"],
  MEDICAL: ["Health", "🩺"],
  GENERAL_SERVICES: ["Services", "🧾"],
  HOME_IMPROVEMENT: ["Home", "🔨"],
  GOVERNMENT_AND_NON_PROFIT: ["Gov & charity", "🏛️"],
  BANK_FEES: ["Bank fees", "🏦"],
  LOAN_PAYMENTS: ["Loan payments", "💳"],
  TRANSFER_IN: ["Transfer in", "↘️"],
  TRANSFER_OUT: ["Transfer out", "↗️"],
};

export function categoryLabel(key: string): string {
  return CATEGORIES[key]?.[0] ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ");
}
export function categoryEmoji(key: string): string {
  return CATEGORIES[key]?.[1] ?? "•";
}

export interface NetWorthPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** A point NorthStar recorded on the day, not a value reconstructed from transactions. */
export interface NetWorthSnapshot extends NetWorthPoint {
  capturedAt: string;
}

/**
 * Daily net worth for the last `days` days. Plaid only gives today's balances, so (like
 * money-dashboard) we walk backward from today, undoing each day's spending and income.
 * Transfers between your own accounts don't change net worth, so they're skipped.
 */
export function netWorthSeries(accounts: BankAccount[], transactions: BankTransaction[], days = 90, now = new Date()): NetWorthPoint[] {
  const transferIds = detectTransferIds(transactions);
  const dailyNet = new Map<string, number>();
  for (const t of transactions) {
    if (t.pending || isTransfer(t, transferIds)) continue;
    dailyNet.set(t.date, (dailyNet.get(t.date) ?? 0) - t.amount); // money in raises net worth
  }
  const points: NetWorthPoint[] = [];
  let running = netWorth(accounts).net;
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const date = localISO(d);
    points.push({ date, value: Math.round(running * 100) / 100 });
    running -= dailyNet.get(date) ?? 0;
  }
  return points.reverse();
}

export interface InstitutionSlice {
  name: string;
  kind: "Bank" | "Brokerage" | "Bank + investing";
  value: number;
  pct: number;
  accounts: number;
}

/** Your assets (not debts) split by bank or brokerage, biggest first. */
export function assetsByInstitution(accounts: BankAccount[]): InstitutionSlice[] {
  const map = new Map<string, { value: number; invest: boolean; bank: boolean; accounts: number }>();
  for (const a of accounts) {
    if (isLiability(a) || a.current <= 0) continue;
    const name = a.institution.replace(/ \(test\)$/, "");
    const e = map.get(name) ?? { value: 0, invest: false, bank: false, accounts: 0 };
    e.value += a.current;
    e.accounts += 1;
    if (a.type === "investment" || a.type === "brokerage") e.invest = true;
    else e.bank = true;
    map.set(name, e);
  }
  const total = [...map.values()].reduce((s, e) => s + e.value, 0) || 1;
  return [...map.entries()]
    .map(([name, e]) => ({
      name,
      kind: (e.invest && e.bank ? "Bank + investing" : e.invest ? "Brokerage" : "Bank") as InstitutionSlice["kind"],
      value: e.value,
      pct: (e.value / total) * 100,
      accounts: e.accounts,
    }))
    .sort((a, b) => b.value - a.value);
}
