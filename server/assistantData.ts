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
  const hits = CATEGORY_WORDS.map(([re, cat]) => ({ cat, at: text.search(re) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  return hits[0]?.cat ?? null;
}

/** A merchant from the user's own transactions that the question names (e.g. "Starbucks"). */
export function matchMerchant(question: string, transactions: BankTransaction[]): string | null {
  const text = question.toLowerCase();
  const names = [...new Set(transactions.map((t) => t.name))];
  const found = names
    .map((name) => {
      const first = name.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 4)[0];
      return { name, first, at: first ? text.indexOf(first) : -1 };
    })
    .filter((h) => h.at >= 0);
  if (!found.length) return null;
  // The earliest-mentioned merchant wins; two merchants sharing that word ("Uber", "Uber Eats") stay ambiguous.
  const at = Math.min(...found.map((h) => h.at));
  const first = found.filter((h) => h.at === at);
  return first.length === 1 ? first[0].name : null;
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
  const spendingTotal = round2(out.reduce((s, t) => s + t.amount, 0));
  const inflowTotal = round2(posted.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0));
  return {
    spendingTotal,
    inflowTotal,
    /** Money in minus money out for the window: positive means you came out ahead. */
    netCashFlow: round2(inflowTotal - spendingTotal),
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

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, "a couple of": 2, "couple of": 2, "a couple": 2, few: 3, "a few": 3 };
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

/**
 * Rolling windows like "last 2 weeks", "past ten days", "previous 3 months", "last fortnight".
 * Returns null for anything else (calendar phrases like "last week" are handled elsewhere).
 */
export function rollingRange(question: string, now = new Date()): DateRange | null {
  const text = question.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (offset: number) => isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
  if (/\b(last|past)\s+fortnight\b/.test(text)) return { label: "the last 2 weeks", start: day(-13), endExclusive: day(1) };
  const m = text.match(/\b(?:last|past|previous)\s+(\d+|a couple of|couple of|a couple|a few|few|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week|month)s?\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  if (!n || n > 400) return null;
  const days = n * UNIT_DAYS[m[2]];
  return { label: `the last ${n} ${m[2]}${n === 1 ? "" : "s"}`, start: day(-(days - 1)), endExclusive: day(1) };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A named year ("in 2024") or month ("in October", "October 2026"). The latest such month not in the future. */
export function explicitRange(question: string, now = new Date()): DateRange | null {
  const text = question.toLowerCase();
  // Month names count after "in/during/for/of/since/from" or before a year, so "I may need…" isn't May.
  const names = `${MONTHS.join("|")}|${MONTHS.map((m) => m.slice(0, 3)).join("|")}`;
  const month = text.match(new RegExp(`\\b(?:in|during|for|of|since|from)\\s+(${names})\\b(?:\\s+(20\\d\\d))?`)) ?? text.match(new RegExp(`\\b(${names})\\s+(20\\d\\d)\\b`));
  if (month) {
    const m = MONTHS.findIndex((name) => name.startsWith(month[1].slice(0, 3)));
    let y = month[2] ? Number(month[2]) : now.getFullYear();
    if (!month[2] && m > now.getMonth()) y -= 1; // "in December" asked in November means last December
    const label = `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${y}`;
    return { label, start: isoDate(new Date(y, m, 1)), endExclusive: isoDate(new Date(y, m + 1, 1)) };
  }
  const year = text.match(/(?<![$\d,.])\b(20\d\d)\b/); // not "$2025"
  if (year) {
    const y = Number(year[1]);
    return { label: String(y), start: `${y}-01-01`, endExclusive: `${y + 1}-01-01` };
  }
  return null;
}

/**
 * Short follow-ups ("And last month?", "what about Uber?") carry the previous question's topic:
 * the earlier question with its time words removed, plus the follow-up. Used only for routing
 * and date ranges; the model still sees the real conversation.
 */
const TIME_PHRASE = /\b(this|last|past|previous|next)\s+(\d+\s+)?(day|week|month|year|fortnight)s?\b|\b(today|yesterday|so far)\b|\b20\d\d\b|\b(in|during|for)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

export function followUpQuestion(question: string, history: { role: string; content: string }[]): string {
  const prev = [...history].reverse().find((m) => m.role === "user")?.content;
  const q = question.trim();
  const short = q.split(/\s+/).length <= 5 || /^(and|what about|how about|also|ok,? and|same for)\b/i.test(q);
  if (!prev || !short) return question;
  // New time ("And last month?"): drop the earlier time words. New subject ("What about Chipotle?"):
  // keep the earlier time. Either way the follow-up comes first, so its subject is found first.
  const context = TIME_PHRASE.test(q) ? prev.replace(new RegExp(TIME_PHRASE.source, "gi"), " ") : prev;
  return `${q} ${context}`.replace(/\s+/g, " ").trim();
}
