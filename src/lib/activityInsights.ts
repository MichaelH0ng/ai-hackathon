// Pure math for the Activity page: ranges, sorting, totals, trends, and flags. Nothing here touches the
// browser, so it can be tested on its own. Plaid convention: amount > 0 is money out, amount < 0 is money in.
import { addDays, toISO } from "./dates";
import { type BankTransaction, categoryLabel, isTransfer, moneyKind } from "./money";
import type { MoneyGoal } from "./types";

// ---------- range and sort ----------

export type ActivityRange = "7d" | "30d" | "90d" | "all";
export type ActivitySort = "newest" | "oldest" | "biggest";

/** The first date (inclusive) a range covers, or null for "all". */
export function rangeStart(range: ActivityRange, now = new Date()): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return addDays(toISO(now), -days);
}

export function sortTransactions(list: BankTransaction[], sort: ActivitySort): BankTransaction[] {
  const copy = [...list];
  if (sort === "oldest") return copy.sort((a, b) => a.date.localeCompare(b.date));
  if (sort === "biggest") return copy.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || b.date.localeCompare(a.date));
  return copy.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- totals ----------

/** Money out and in for a list, posted and non-transfer only. Pending ones are counted so the page can say so. */
export function summarize(list: BankTransaction[], transferIds: Set<string>) {
  let out = 0;
  let income = 0;
  let pending = 0;
  for (const t of list) {
    if (t.pending) { pending += 1; continue; }
    if (isTransfer(t, transferIds)) continue;
    if (t.amount > 0) out += t.amount;
    else income += -t.amount;
  }
  return { out, in: income, pending, count: list.length };
}

/** Money out per day (posted, non-transfer), for the day headers. */
export function outByDay(list: BankTransaction[], transferIds: Set<string>): Map<string, number> {
  const days = new Map<string, number>();
  for (const t of list) {
    if (t.pending || t.amount <= 0 || isTransfer(t, transferIds)) continue;
    days.set(t.date, (days.get(t.date) ?? 0) + t.amount);
  }
  return days;
}

/**
 * What a transaction adds to spending. Refunds and paybacks come off, earned money and family support add
 * nothing. This is the same rule the "Where it went" bars use, so the numbers agree.
 */
function spendDelta(t: BankTransaction, transferIds: Set<string>): number {
  if (t.pending || isTransfer(t, transferIds)) return 0;
  const kind = moneyKind(t);
  return kind === "spent" || kind === "offset" ? t.amount : 0;
}

/** Spending so far this calendar month. */
export function monthSpending(transactions: BankTransaction[], transferIds: Set<string>, now = new Date()): number {
  const start = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
  let total = 0;
  for (const t of transactions) if (t.date >= start) total += spendDelta(t, transferIds);
  return Math.max(0, total);
}

/** How the month's spending compares to a monthly budget and to how far through the month you are. */
export function budgetPace(spent: number, budget: number, now = new Date()) {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthPct = Math.min(1, now.getDate() / daysInMonth);
  const spentPct = budget > 0 ? spent / budget : 0;
  const status: "over" | "ahead" | "on-track" = spent > budget ? "over" : spentPct > monthPct + 0.05 ? "ahead" : "on-track";
  return { spentPct, monthPct, status, left: budget - spent };
}

// ---------- trend and calendar ----------

export interface DaySpend { date: string; spent: number }

/** Spending for each of the last `days` days, today last. Days with no spending are 0. */
export function dailySpending(transactions: BankTransaction[], transferIds: Set<string>, days = 30, now = new Date()): DaySpend[] {
  const today = toISO(now);
  const totals = new Map<string, number>();
  for (const t of transactions) totals.set(t.date, (totals.get(t.date) ?? 0) + spendDelta(t, transferIds));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - (days - 1));
    return { date, spent: Math.max(0, totals.get(date) ?? 0) };
  });
}

export interface CalendarCell { date: string; day: number; spent: number }

/** A month as weeks (Sunday first). Cells outside the month are null. */
export function monthGrid(transactions: BankTransaction[], transferIds: Set<string>, year: number, month: number): (CalendarCell | null)[][] {
  const totals = new Map<string, number>();
  for (const t of transactions) totals.set(t.date, (totals.get(t.date) ?? 0) + spendDelta(t, transferIds));
  const lead = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (CalendarCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = toISO(new Date(year, month, day));
    cells.push({ date, day, spent: Math.max(0, totals.get(date) ?? 0) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (CalendarCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 0 (nothing) to 4 (a heavy day), relative to the biggest day shown. */
export function heatLevel(spent: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (spent <= 0 || max <= 0) return 0;
  const ratio = spent / max;
  return ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
}

// ---------- category change ----------

export interface CategoryChange { key: string; label: string; current: number; previous: number; pct: number | null }

/**
 * Each category's spending over the last `days` days next to the `days` before that. The current window is
 * the same one the "Where it went" bars use. `pct` is null when there was nothing before to compare to.
 */
export function categoryChanges(transactions: BankTransaction[], transferIds: Set<string>, days = 30, now = new Date()): CategoryChange[] {
  const today = toISO(now);
  const currentStart = addDays(today, -days);
  const previousStart = addDays(today, -2 * days);
  const current = new Map<string, number>();
  const previous = new Map<string, number>();
  for (const t of transactions) {
    const delta = spendDelta(t, transferIds);
    if (delta === 0) continue;
    if (t.date >= currentStart) current.set(t.category, (current.get(t.category) ?? 0) + delta);
    else if (t.date >= previousStart) previous.set(t.category, (previous.get(t.category) ?? 0) + delta);
  }
  const keys = new Set([...current.keys(), ...previous.keys()]);
  return [...keys]
    .map((key) => {
      const spentNow = Math.max(0, current.get(key) ?? 0);
      const before = Math.max(0, previous.get(key) ?? 0);
      return { key, label: categoryLabel(key), current: spentNow, previous: before, pct: before > 0 ? (spentNow - before) / before : null };
    })
    .filter((c) => c.current > 0 || c.previous > 0)
    .sort((a, b) => b.current - a.current);
}

/** "up 30%" / "down 12%" / "same", or null when there is no earlier period to compare to. Small moves read as same. */
export function changeText(c: Pick<CategoryChange, "pct">): string | null {
  if (c.pct === null) return null;
  const pct = Math.round(Math.abs(c.pct) * 100);
  if (pct < 5) return "about the same";
  return `${c.pct > 0 ? "up" : "down"} ${pct}%`;
}

// ---------- things worth a look ----------

export interface UnusualCharge { id: string; name: string; amount: number; typical: number; date: string }

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/** Charges grouped by merchant name, oldest first, for posted non-transfer money out. */
function chargesByMerchant(transactions: BankTransaction[], transferIds: Set<string>): Map<string, BankTransaction[]> {
  const groups = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    if (t.pending || t.amount <= 0 || isTransfer(t, transferIds)) continue;
    const key = t.name.trim().toLowerCase();
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  for (const list of groups.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return groups;
}

/**
 * Recent charges at least double what you normally pay that merchant (and $20 or more above it). A merchant
 * needs three earlier charges first, so a new place never counts as unusual.
 */
export function unusualCharges(transactions: BankTransaction[], transferIds: Set<string>, now = new Date(), recentDays = 30): UnusualCharge[] {
  const since = addDays(toISO(now), -recentDays);
  const found: UnusualCharge[] = [];
  for (const list of chargesByMerchant(transactions, transferIds).values()) {
    for (let i = 3; i < list.length; i++) {
      const t = list[i]!;
      if (t.date < since) continue;
      const typical = median(list.slice(Math.max(0, i - 12), i).map((p) => p.amount));
      if (t.amount >= typical * 2 && t.amount - typical >= 20) found.push({ id: t.id, name: t.name, amount: t.amount, typical, date: t.date });
    }
  }
  return found.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
}

export interface PriceChange { name: string; from: number; to: number; date: string }

/**
 * A charge that used to be the same every time and just changed. It takes two matching earlier charges and
 * a move of at least $1 and 5%, so a grocery run or a gas fill-up never shows up here.
 */
export function priceChanges(transactions: BankTransaction[], transferIds: Set<string>, now = new Date(), withinDays = 60): PriceChange[] {
  const since = addDays(toISO(now), -withinDays);
  const found: PriceChange[] = [];
  for (const list of chargesByMerchant(transactions, transferIds).values()) {
    if (list.length < 3) continue;
    const [latest, before, earlier] = [list.at(-1)!, list.at(-2)!, list.at(-3)!];
    const steady = Math.abs(before.amount - earlier.amount) <= Math.max(0.01, before.amount * 0.02);
    const moved = Math.abs(latest.amount - before.amount);
    if (steady && latest.date >= since && moved >= 1 && moved >= before.amount * 0.05) {
      found.push({ name: latest.name, from: before.amount, to: latest.amount, date: latest.date });
    }
  }
  return found.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- tie to goals ----------

/**
 * What a purchase means in days of saving: the amount divided by what the first unfinished goal gets each day.
 * Returns null when there is no goal to compare to or the amount is under a day's worth.
 */
export function goalImpact(amount: number, goals: MoneyGoal[]): { goalName: string; days: number } | null {
  const goal = goals.find((g) => g.saved < g.target && !g.boughtAt && g.weekly > 0);
  if (!goal || amount <= 0) return null;
  const days = Math.round(amount / (goal.weekly / 7));
  return days >= 1 ? { goalName: goal.name, days } : null;
}

// ---------- export ----------

/** A cell safe for a spreadsheet: quoted, and defanged if it starts like a formula. */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The list as CSV: money out is negative, money in is positive. */
export function toCsv(list: BankTransaction[], accountName: (id: string) => string, transferIds: Set<string>): string {
  const rows = list.map((t) =>
    [
      t.date,
      csvText(t.name),
      csvText(isTransfer(t, transferIds) ? "Transfer" : categoryLabel(t.category)),
      csvText(accountName(t.accountId)),
      (-t.amount).toFixed(2),
      t.pending ? "Pending" : "Posted",
    ].join(","),
  );
  return ["Date,Description,Category,Account,Amount,Status", ...rows].join("\n");
}
