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

export interface BankData {
  holdings?: PortfolioHolding[];
  env: string;
  accounts: BankAccount[];
  transactions: BankTransaction[];
  status: { itemId: string; institution: string; problem?: string; ready: boolean }[];
  fetchedAt: string;
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
  const candidates = transactions.filter((t) => !t.category.startsWith("TRANSFER") && t.category !== "LOAN_PAYMENTS");
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
    if (t.date < p || isTransfer(t, transferIds)) continue;
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
    if (t.amount <= 0 || t.date < c || isTransfer(t, transferIds)) continue;
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
}

/** Same merchant, similar amount, on a steady schedule → a bill with a projected next date. */
export function upcomingBills(transactions: BankTransaction[], transferIds: Set<string>, now = new Date()): Bill[] {
  const byName = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    if (t.amount <= 0 || isTransfer(t, transferIds)) continue;
    if (!byName.has(t.name)) byName.set(t.name, []);
    byName.get(t.name)!.push(t);
  }
  const today = new Date(localISO(now)).getTime();
  const bills: Bill[] = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const amounts = list.map((t) => t.amount);
    const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    if ((Math.max(...amounts) - Math.min(...amounts)) / avg >= 0.2) continue;
    const dates = list.map((t) => t.date).sort();
    let gapSum = 0;
    for (let i = 1; i < dates.length; i++) gapSum += (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000;
    const gap = gapSum / (dates.length - 1);
    const cadence = gap >= 5 && gap <= 9 ? "Weekly" : gap >= 12 && gap <= 16 ? "Every 2 weeks" : gap >= 25 && gap <= 35 ? "Monthly" : gap >= 85 && gap <= 100 ? "Quarterly" : null;
    if (!cadence) continue;
    let next = new Date(dates[dates.length - 1]).getTime() + gap * 86400000;
    while (next < today) next += gap * 86400000; // roll forward past today
    const nextISO = new Date(next).toISOString().slice(0, 10);
    bills.push({ name, amount: avg, cadence, nextDue: nextISO, daysUntil: Math.round((next - today) / 86400000) });
  }
  return bills.sort((a, b) => a.daysUntil - b.daysUntil);
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

/**
 * Daily net worth for the last `days` days. Plaid only gives today's balances, so (like
 * money-dashboard) we walk backward from today, undoing each day's spending and income.
 * Transfers between your own accounts don't change net worth, so they're skipped.
 */
export function netWorthSeries(accounts: BankAccount[], transactions: BankTransaction[], days = 90, now = new Date()): NetWorthPoint[] {
  const transferIds = detectTransferIds(transactions);
  const dailyNet = new Map<string, number>();
  for (const t of transactions) {
    if (isTransfer(t, transferIds)) continue;
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
