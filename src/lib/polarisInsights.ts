// Polaris's free, on-device insights: a weekly check-in, heads-ups for bills due soon,
// and "what changed?" for this month. Pure arithmetic over your transactions: no AI call.
import { addDays, todayISO } from "./dates";
import { formatMoney } from "./finance";
import { billsFor, categoryLabel, detectTransferIds, isTransfer, spendableCash, type BankData, type BankTransaction } from "./money";
import type { MoneyGoal } from "./types";

const usd = (n: number) => formatMoney(Math.round(n));
const usdCents = (n: number) => formatMoney(n, n % 1 !== 0);
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Money out in [start, endExclusive): no transfers between your accounts, card payments, or pending charges. */
function spending(transactions: BankTransaction[], transferIds: Set<string>, start: string, endExclusive: string) {
  const list = transactions.filter((t) => !t.pending && t.amount > 0 && t.date >= start && t.date < endExclusive && !isTransfer(t, transferIds));
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, number>();
  for (const t of list) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    byMerchant.set(t.name, (byMerchant.get(t.name) ?? 0) + t.amount);
  }
  return { total: list.reduce((sum, t) => sum + t.amount, 0), byCategory, byMerchant, largest: [...list].sort((a, b) => b.amount - a.amount)[0] };
}

const earliestDate = (transactions: BankTransaction[]) => transactions.reduce((min, t) => (t.date < min ? t.date : min), "9999-12-31");

// ---------- weekly check-in ----------

/** The Sunday that starts the week containing `iso`. */
export function weekStart(iso: string): string {
  return addDays(iso, -new Date(`${iso}T12:00:00`).getDay());
}

/**
 * A summary of last week (Sunday to Saturday), shown once per week the first time Polaris opens.
 * Compares with your usual week: the average of up to 8 earlier weeks you have history for.
 */
export function weeklyCheckIn(data: Pick<BankData, "transactions">, goals: MoneyGoal[], today = todayISO()): { key: string; text: string } | null {
  const end = weekStart(today);
  const start = addDays(end, -7);
  const first = earliestDate(data.transactions);
  if (first > start) return null; // not a full week of history yet
  const transferIds = detectTransferIds(data.transactions);
  const week = spending(data.transactions, transferIds, start, end);

  const earlier: ReturnType<typeof spending>[] = [];
  for (let i = 1; i <= 8; i++) {
    const s = addDays(start, -7 * i);
    if (s < first) break;
    earlier.push(spending(data.transactions, transferIds, s, addDays(s, 7)));
  }
  const usual = earlier.length >= 2 ? earlier.reduce((sum, w) => sum + w.total, 0) / earlier.length : null;
  const usualFor = (category: string) => earlier.reduce((sum, w) => sum + (w.byCategory.get(category) ?? 0), 0) / Math.max(1, earlier.length);

  const label = `${shortDate(start)}–${shortDate(addDays(end, -1))}`;
  const diff = usual === null ? 0 : week.total - usual;
  const vsUsual = usual === null
    ? "."
    : Math.abs(diff) < Math.max(15, usual * 0.1)
      ? `, right around your usual week (${usd(usual)}).`
      : `, **${usd(Math.abs(diff))} ${diff > 0 ? "more" : "less"}** than your usual week (${usd(usual)}).`;
  const lines = [`**Weekly check-in (${label}):** you spent **${usd(week.total)}**${vsUsual}`];

  const top = [...week.byCategory].sort(([, a], [, b]) => b - a).slice(0, 3);
  if (top.length) lines.push("", ...top.map(([cat, amount]) => `- ${categoryLabel(cat)}: ${usd(amount)}${earlier.length >= 2 ? ` (usually ${usd(usualFor(cat))})` : ""}`));
  if (week.largest) lines.push("", `Biggest charge: ${week.largest.name} (${usdCents(week.largest.amount)}).`);

  // One concrete pointer: the category that ran furthest over its usual week.
  if (earlier.length >= 2) {
    const jump = [...week.byCategory].map(([cat, amount]) => ({ cat, over: amount - usualFor(cat) })).sort((a, b) => b.over - a.over)[0];
    if (jump && jump.over >= 20) lines.push(`Most of the extra was **${categoryLabel(jump.cat)}** (+${usd(jump.over)}). Keeping that near usual this week frees up about ${usd(jump.over)}.`);
    else if (diff < 0 && Math.abs(diff) >= 20) lines.push(`Nice: that's ${usd(-diff)} you could put toward a goal.`);
  }
  const goal = goals.filter((g) => g.saved < g.target).sort((a, b) => b.saved / b.target - a.saved / a.target)[0];
  if (goal) lines.push(`${goal.name} is **${Math.round((goal.saved / goal.target) * 100)}%** funded (${usd(goal.saved)} of ${usd(goal.target)}).`);
  return { key: start, text: lines.join("\n") };
}

// ---------- bills due soon ----------

/**
 * Bills due in the next `days` days that haven't been mentioned yet, with what your cash would be
 * after them. Each bill and due date is announced once.
 */
export function billHeadsUp(data: Pick<BankData, "transactions" | "recurring" | "accounts">, alreadyShown: Set<string>, days = 3, now = new Date()): { keys: string[]; text: string } | null {
  const transferIds = detectTransferIds(data.transactions);
  const due = billsFor({ transactions: data.transactions.filter((t) => !t.pending), recurring: data.recurring }, transferIds, now)
    .filter((b) => b.daysUntil >= 0 && b.daysUntil <= days);
  const fresh = due.filter((b) => !alreadyShown.has(`${b.name}|${b.nextDue}`));
  if (!fresh.length) return null;
  const when = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
  const cash = spendableCash(data.accounts);
  const totalDue = due.reduce((sum, b) => sum + b.amount, 0);
  const after = cash - totalDue;
  const list = fresh.map((b) => `- **${b.name}**: about ${usdCents(Math.round(b.amount * 100) / 100)}, due ${when(b.daysUntil)} (${weekday(b.nextDue)})`);
  const text = [
    fresh.length === 1 ? "**Heads up:** a bill is due soon." : `**Heads up:** ${fresh.length} bills are due soon.`,
    "",
    ...list,
    "",
    cash > 0
      ? `Your checking and savings would be about **${usd(after)}** after ${due.length === 1 ? "it" : "them"}${after < 100 ? ". That's tight, so hold off on extras until it clears." : "."}`
      : "Connect a checking account to see what you'd have left after.",
  ].join("\n");
  return { keys: fresh.map((b) => `${b.name}|${b.nextDue}`), text };
}

// ---------- what changed? ----------

export const WHAT_CHANGED = /\bwhat(?:'?s| has| have)?\s+(?:changed|different)\b|\bwhy\b.*\bspend\w*\b.*\b(?:more|less|higher|lower|up|down)\b|\bspend\w*\b.*\b(?:higher|lower|more|less)\b.*\b(?:than )?(?:last|usual|normal)\b/i;

/**
 * This month so far vs the same days last month (early in a month: last month vs the one before):
 * the total, the categories that moved most, and new places you spent at.
 */
export function whatChanged(data: Pick<BankData, "transactions">, today = todayISO()): string {
  const transferIds = detectTransferIds(data.transactions);
  const [y, m, d] = today.split("-").map(Number);
  const iso = (year: number, month: number, day: number) => {
    const last = new Date(year, month, 0).getDate();
    return `${new Date(year, month - 1, 1).getFullYear()}-${String(new Date(year, month - 1, 1).getMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  // In the first few days of a month there's too little to compare, so use the last two full months.
  const early = d <= 3;
  const cur = early ? { start: iso(y, m - 1, 1), end: iso(y, m, 1), label: "last month" } : { start: iso(y, m, 1), end: addDays(today, 1), label: "this month so far" };
  const prevEnd = early ? iso(y, m - 1, 1) : addDays(iso(y, m - 1, d), 1);
  const prev = { start: iso(y, m - (early ? 2 : 1), 1), end: prevEnd, label: early ? "the month before" : "the same point last month" };
  if (earliestDate(data.transactions) > prev.start) return "I need a bit more history to compare months. Ask again once NorthStar has a full previous month of transactions.";

  const now = spending(data.transactions, transferIds, cur.start, cur.end);
  const before = spending(data.transactions, transferIds, prev.start, prev.end);
  const diff = now.total - before.total;
  const headline = Math.abs(diff) < Math.max(20, before.total * 0.05)
    ? `**${cur.label[0].toUpperCase()}${cur.label.slice(1)}: ${usd(now.total)}**, about the same as ${prev.label} (${usd(before.total)}).`
    : `**${cur.label[0].toUpperCase()}${cur.label.slice(1)}: ${usd(now.total)}**, **${usd(Math.abs(diff))} ${diff > 0 ? "more" : "less"}** than ${prev.label} (${usd(before.total)}).`;

  const categories = new Set([...now.byCategory.keys(), ...before.byCategory.keys()]);
  const movers = [...categories]
    .map((cat) => ({ cat, now: now.byCategory.get(cat) ?? 0, before: before.byCategory.get(cat) ?? 0 }))
    .map((c) => ({ ...c, change: c.now - c.before }))
    .filter((c) => Math.abs(c.change) >= 15)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 3);

  // Places you spent $25+ this period but not at all in the 60 days before it.
  const lookback = spending(data.transactions, transferIds, addDays(cur.start, -60), cur.start);
  const newPlaces = [...now.byMerchant].filter(([name, amount]) => amount >= 25 && !lookback.byMerchant.has(name)).sort(([, a], [, b]) => b - a).slice(0, 3);

  const lines = [headline];
  if (movers.length) lines.push("", "What moved most:", ...movers.map((c) => `- ${categoryLabel(c.cat)}: ${c.change > 0 ? "+" : "−"}${usd(Math.abs(c.change))} (${usd(c.now)} vs ${usd(c.before)})`));
  if (newPlaces.length) lines.push("", `New this period: ${newPlaces.map(([name, amount]) => `${name} (${usd(amount)})`).join(", ")}.`);
  if (!movers.length && !newPlaces.length) lines.push("No category moved by more than $15, so your spending mix is steady.");
  return lines.join("\n");
}
