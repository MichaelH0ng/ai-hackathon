// Pure helpers behind Polaris's answers. Everything here is exact arithmetic over
// Plaid-shaped data, so the model reads totals instead of adding transactions itself.
import { isTransfer, type BankTransaction } from "../src/lib/money.ts";

export type DateRange = { label: string; start: string; endExclusive?: string };

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Plaid personal_finance_category.primary values, keyed by the words people use for them. */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(food|food and drink|dining|restaurants?|eating out)\b/, "FOOD_AND_DRINK"],
  [/\b(transport|transportation|rides?|commut\w*)\b/, "TRANSPORTATION"],
  [/\b(rent|utilities|housing)\b/, "RENT_AND_UTILITIES"],
  [/\b(entertainment|movies?|concerts?)\b/, "ENTERTAINMENT"],
  [/\b(shopping|merchandise)\b/, "GENERAL_MERCHANDISE"],
  [/\b(personal care)\b/, "PERSONAL_CARE"],
];

export const categoryLabel = (category: string) => category.toLowerCase().replace(/_/g, " ");

/** The single spending category a question names, if any. */
export function matchCategory(question: string): string | null {
  const text = question.toLowerCase();
  const hits = CATEGORY_WORDS.filter(([re]) => re.test(text)).map(([, cat]) => cat);
  return hits.length === 1 ? hits[0] : null;
}

/** A merchant from the user's own transactions that the question names (e.g. "Starbucks"). */
export function matchMerchant(question: string, transactions: BankTransaction[]): string | null {
  const text = question.toLowerCase();
  const names = [...new Set(transactions.map((t) => t.name))];
  const hits = names.filter((name) => {
    const words = name.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 4);
    return words.length > 0 && text.includes(words[0]);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** True when a spending question asks about something narrower than "all spending" that we can't match exactly. */
export function hasUnmatchedSubject(question: string): boolean {
  const text = question
    .toLowerCase()
    .replace(/\b(this|last|past|next) (week|month|year|7 days|30 days|12 months)\b/g, " ")
    .replace(/\b(on average|in total|so far)\b/g, " ");
  return /\b(on|at|for)\s+[a-z]/.test(text);
}

/** Spending (money out, excluding transfers and card/loan payments) and inflows for a set of transactions. */
export function windowTotals(transactions: BankTransaction[], transferIds: Set<string>) {
  const posted = transactions.filter((t) => !t.pending && !isTransfer(t, transferIds));
  const out = posted.filter((t) => t.amount > 0);
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const t of out) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    const m = byMerchant.get(t.name) ?? { total: 0, count: 0 };
    byMerchant.set(t.name, { total: m.total + t.amount, count: m.count + 1 });
  }
  return {
    spendingTotal: round2(out.reduce((s, t) => s + t.amount, 0)),
    inflowTotal: round2(posted.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0)),
    spendingByCategory: Object.fromEntries([...byCategory].sort(([, a], [, b]) => b - a).map(([k, v]) => [categoryLabel(k), round2(v)])),
    spendingByMerchant: [...byMerchant]
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 20)
      .map(([merchant, { total, count }]) => ({ merchant, total: round2(total), count })),
  };
}

/**
 * For "this week vs last week" style questions: both periods, so the model (and we) can compare.
 * Returns null when the question isn't a two-period comparison.
 */
export function comparisonPeriods(question: string, now = new Date()): DateRange[] | null {
  const text = question.toLowerCase();
  const compares = /\b(than|vs\.?|versus|compare[sd]?|compared|more|less)\b/.test(text);
  if (!compares) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  if (/\bthis week\b/.test(text) && /\blast week\b/.test(text)) {
    const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const lastSunday = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() - 7);
    return [
      { label: "last week", start: isoDate(lastSunday), endExclusive: isoDate(sunday) },
      { label: "this week so far", start: isoDate(sunday), endExclusive: tomorrow },
    ];
  }
  if (/\bthis month\b/.test(text) && /\blast month\b/.test(text)) {
    return [
      { label: "last month", start: isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), endExclusive: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)) },
      { label: "this month so far", start: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), endExclusive: tomorrow },
    ];
  }
  return null;
}

export const inRange = (t: { date: string }, range: DateRange) => t.date >= range.start && (!range.endExclusive || t.date < range.endExclusive);

/** The one goal a question names, matched on any distinctive word of its name. */
export function matchGoal<G extends { name: string }>(question: string, goals: G[]): G | null {
  const text = question.toLowerCase();
  const hits = goals.filter((g) => g.name.toLowerCase().split(/\s+/).some((w) => w.length >= 4 && text.includes(w)));
  return hits.length === 1 ? hits[0] : null;
}

/** "around Feb 6" style finish date for a goal saving `weekly` per week, or null if it can't finish. */
export function goalFinishDate(goal: { target: number; saved: number; weekly: number }, now = new Date()): string | null {
  const remaining = Math.max(0, goal.target - goal.saved);
  if (remaining === 0 || goal.weekly <= 0) return null;
  const weeks = Math.ceil(remaining / goal.weekly);
  const finish = new Date(now.getFullYear(), now.getMonth(), now.getDate() + weeks * 7);
  return finish.toLocaleDateString("en-US", { month: "short", day: "numeric", year: finish.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
