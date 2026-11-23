// Pure helpers behind Polaris's answers. Everything here is exact arithmetic over
// Plaid-shaped data, so the model reads totals instead of adding transactions itself.
import { isTransfer, moneyKind, type BankTransaction } from "../src/lib/money.js";

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

/**
 * Narrower than a Plaid category, from Plaid's detailed category plus NorthStar's own gas-or-snack call:
 * "gas" is fill-ups only (not parking or rides), "groceries" is grocery stores, "coffee" is coffee shops.
 */
export type Subcategory = { label: string; test: (t: BankTransaction) => boolean };
const SUBCATEGORY_WORDS: [RegExp, Subcategory][] = [
  [/\b(gas|fuel|gasoline|fill[- ]?ups?)\b/, { label: "gas", test: (t) => t.category === "TRANSPORTATION" && (/^TRANSPORTATION_GAS/.test(t.detail ?? "") || !!t.categorized) }],
  [/\b(groceries|grocery|supermarkets?)\b/, { label: "groceries", test: (t) => /^FOOD_AND_DRINK_GROCERIES/.test(t.detail ?? "") && t.category === "FOOD_AND_DRINK" }],
  [/\b(coffee|cafes?|boba|tea)\b/, { label: "coffee", test: (t) => /^FOOD_AND_DRINK_COFFEE/.test(t.detail ?? "") && t.category === "FOOD_AND_DRINK" }],
];

/** The narrower-than-a-category subject a question names ("gas", "groceries", "coffee"), if any. */
export function matchSubcategory(question: string): Subcategory | null {
  const text = question.toLowerCase().replace(/\bgas station\b/g, "gas");
  return SUBCATEGORY_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
}

/** A merchant or person's name without a payment note: 'Joaquin Boyd "Utilities"' → "Joaquin Boyd". */
export const payee = (name: string) => name.replace(/\s*"[^"]*"\s*$/, "").trim();

/** The single spending category a question names, if any. */
export function matchCategory(question: string): string | null {
  const text = question.toLowerCase();
  const hits = CATEGORY_WORDS.map(([re, cat]) => ({ cat, at: text.search(re) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  return hits[0]?.cat ?? null;
}

/** A merchant from the user's own transactions that the question names (e.g. "Starbucks"). */
export function matchMerchant(question: string, transactions: BankTransaction[]): string | null {
  const text = question.toLowerCase();
  // People on Venmo appear once per note ('Christian Lim "Chipper"'); match the person, not one note.
  const names = [...new Set(transactions.map((t) => payee(t.name)))];
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

/**
 * Spending and money in for a set of transactions, leaving out transfers, card payments, and pending charges.
 * Money in is split three ways: earned (pay, interest: Plaid's INCOME), family support (529s), and
 * refunds and paybacks (a Costco refund, a roommate's share of the electric bill), which reduce spending
 * in their own category instead of counting as money you made. So spendingTotal is what you really spent.
 */
export function windowTotals(transactions: BankTransaction[], transferIds: Set<string>) {
  const posted = transactions.filter((t) => !t.pending && !isTransfer(t, transferIds));
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, { total: number; count: number }>();
  let gross = 0, offsets = 0, earned = 0, family = 0;
  for (const t of posted) {
    const kind = moneyKind(t);
    if (kind === "earned") earned -= t.amount;
    else if (kind === "family") family -= t.amount;
    else {
      // Spending, or a refund/payback that comes off its category.
      if (kind === "spent") gross += t.amount; else offsets -= t.amount;
      byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
      if (kind === "spent") {
        const m = byMerchant.get(t.name) ?? { total: 0, count: 0 };
        byMerchant.set(t.name, { total: m.total + t.amount, count: m.count + 1 });
      }
    }
  }
  const unconfirmed = posted.filter((t) => t.review && !t.review.confirmed && t.review.label !== "own" && t.review.label !== "lent");
  const spendingTotal = round2(gross - offsets);
  const inflowTotal = round2(earned + family);
  return {
    /** What you really spent: purchases minus refunds and paybacks. */
    spendingTotal,
    /** Purchases before refunds and paybacks. */
    grossSpending: round2(gross),
    /** Refunds and friends/roommates paying you back, already taken off spendingTotal. */
    refundsAndPaybacks: round2(offsets),
    /** Money in that isn't a refund or payback: what you earned plus family support. */
    inflowTotal,
    /** Pay, reimbursements from work, interest. */
    earnedTotal: round2(earned),
    /** 529 withdrawals and other money from family. */
    familySupportTotal: round2(family),
    /** Money in minus what you spent: positive means you came out ahead. */
    netCashFlow: round2(inflowTotal - spendingTotal),
    /** Payments with people NorthStar labeled by its own guess; the user hasn't confirmed them yet. */
    unconfirmed: { count: unconfirmed.length, amount: round2(unconfirmed.reduce((s, t) => s + Math.abs(t.amount), 0)) },
    spendingByCategory: Object.fromEntries([...byCategory].filter(([, v]) => Math.abs(v) >= 0.005).sort(([, a], [, b]) => b - a).map(([k, v]) => [categoryLabel(k), round2(v)])),
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

/**
 * One line per calendar month (newest first, up to `months`): Polaris's long-term memory.
 * A few thousand tokens cover two years, so old history is summarized instead of sent line by line.
 */
export function monthlySummaries(transactions: BankTransaction[], transferIds: Set<string>, now = new Date(), months = 24) {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const byMonth = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    if (month > current) continue;
    byMonth.set(month, [...(byMonth.get(month) ?? []), t]);
  }
  return [...byMonth.keys()]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, months)
    .map((month) => {
      const totals = windowTotals(byMonth.get(month)!, transferIds);
      return {
        month,
        ...(month === current ? { partialMonth: true } : {}),
        spending: totals.spendingTotal,
        income: totals.earnedTotal,
        ...(totals.familySupportTotal ? { familySupport: totals.familySupportTotal } : {}),
        net: totals.netCashFlow,
        topCategories: Object.fromEntries(Object.entries(totals.spendingByCategory).slice(0, 5)),
        topMerchants: totals.spendingByMerchant.slice(0, 3).map(({ merchant, total }) => `${merchant} ${total}`),
      };
    });
}

/** The few questions worth Sonnet's ~20x price: multi-step plans and weighing real trade-offs. */
export function needsSonnet(question: string) {
  return /\b(plan|strategy|strategi[sz]e|optimi[sz]e|prioriti[sz]e|trade[- ]?offs?|invest(ing|ment)?|retire(ment)?|debt|loans?|refinanc\w*|tax(es)?)\b|\bshould i (pay off|invest|move|switch|take|open|close)\b/i.test(question);
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
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

/**
 * Rolling windows like "last 2 weeks", "past ten days", "previous 3 months", "last fortnight".
 * Returns null for anything else (calendar phrases like "last week" are handled elsewhere).
 */
export function rollingRange(question: string, now = new Date()): DateRange | null {
  const text = question.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (offset: number) => isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
  if (/\b(last|past)\s+fortnight\b/.test(text)) return { label: "the last 2 weeks", start: day(-13), endExclusive: day(1) };
  const m = text.match(/\b(?:last|past|previous)\s+(\d+|a couple of|couple of|a couple|a few|few|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week|month|year)s?\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  if (!n || n > 400) return null;
  const days = n * UNIT_DAYS[m[2]];
  return { label: `the last ${n} ${m[2]}${n === 1 ? "" : "s"}`, start: day(-(days - 1)), endExclusive: day(1) };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const MONTH_NAMES = `${MONTHS.join("|")}|${MONTHS.map((m) => m.slice(0, 3)).join("|")}|sept`;
/** "August 24th", "aug 24, 2026", "8/24", "8/24/26": one calendar day. */
const DAY_PATTERN = `(?:(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?|(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2}|20\\d\\d))?)\\b`;
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1, 3)} ${d}, ${y}`;
};

/**
 * Questions about specific days: "since August 24th", "after 8/24", "from Aug 24 to Sep 10",
 * "between Sept 1 and Sept 15", "on Aug 24". A date without a year is the latest one not in the future.
 */
function specificDays(text: string, now: Date): DateRange | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toISO = (m: RegExpExecArray, offset: number): string | null => {
    const name = m[offset + 1];
    const month = name ? MONTHS.findIndex((x) => x.startsWith(name.slice(0, 3))) : Number(m[offset + 4]) - 1;
    const day = Number(name ? m[offset + 2] : m[offset + 5]);
    const rawYear = name ? m[offset + 3] : m[offset + 6];
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    let year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : today.getFullYear();
    let date = new Date(year, month, day);
    if (date.getMonth() !== month) return null; // Feb 31
    if (!rawYear && date > today) date = new Date(--year, month, day);
    return localDay(date);
  };
  const plusDay = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
  const tomorrow = plusDay(localDay(today), 1);
  const span = new RegExp(`\\b(?:from|between)\\s+${DAY_PATTERN}\\s*(?:to|until|till|through|thru|and|-|–)\\s*${DAY_PATTERN}`).exec(text);
  if (span) {
    const start = toISO(span, 0);
    const end = toISO(span, 6);
    if (start && end && start <= end) return { label: `${shortDay(start)} through ${shortDay(end)}`, start, endExclusive: plusDay(end, 1) };
  }
  const since = new RegExp(`\\b(since|after|from|starting|beginning)\\s+(?:on\\s+)?${DAY_PATTERN}`).exec(text);
  if (since) {
    const date = toISO(since, 1);
    if (date) {
      const start = since[1] === "after" ? plusDay(date, 1) : date;
      return { label: `the period since ${shortDay(date)}`, start, endExclusive: tomorrow };
    }
  }
  const on = new RegExp(`\\bon\\s+${DAY_PATTERN}`).exec(text);
  if (on) {
    const date = toISO(on, 0);
    if (date) return { label: shortDay(date), start: date, endExclusive: plusDay(date, 1) };
  }
  return null;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** A named year ("in 2024") or month ("in October", "October 2026"). The latest such month not in the future. */
export function explicitRange(question: string, now = new Date()): DateRange | null {
  const text = question.toLowerCase();
  const days = specificDays(text, now);
  if (days) return days;
  // Month names count after "in/during/for/of/since/from" or before a year, so "I may need…" isn't May.
  // Misspellings count too ("octobr", "septmber"): a word starting like a month and close to its full name.
  const names = `${MONTHS.join("|")}|${MONTHS.map((m) => m.slice(0, 3)).join("|")}|sept|(?:${MONTHS.map((m) => m.slice(0, 3)).join("|")})[a-z]{2,7}`;
  const monthOf = (word: string) => {
    const m = MONTHS.findIndex((name) => name.startsWith(word.slice(0, 3)));
    if (m < 0) return -1;
    if (word.length === 3 || word === "sept" || MONTHS[m].startsWith(word)) return m;
    // "junk", "maybe", "market" aren't months; "octobr", "febuary", "septmber" are.
    return word.length >= 5 && word.length <= MONTHS[m].length + 1 && editDistance(word, MONTHS[m]) <= 2 ? m : -1;
  };
  const month = text.match(new RegExp(`\\b(in|during|for|of|since|from)\\s+(${names})\\b(?:\\s+(20\\d\\d))?`)) ?? text.match(new RegExp(`\\b()(${names})\\s+(20\\d\\d)\\b`));
  const m = month ? monthOf(month[2]) : -1;
  if (month && m >= 0) {
    let y = month[3] ? Number(month[3]) : now.getFullYear();
    if (!month[3] && m > now.getMonth()) y -= 1; // "in December" asked in November means last December
    const name = `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)}`;
    const start = isoDate(new Date(y, m, 1));
    // "Since August": the start of August through today, not August alone.
    if (month[1] === "since") return { label: `the period since ${name} 1`, start, endExclusive: isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) };
    return { label: `${name} ${y}`, start, endExclusive: isoDate(new Date(y, m + 1, 1)) };
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

const OWN_TOPIC = /\b(spen[dt]|spending|spnd|made|make|earn\w*|income|paid|paycheck|inflows?|deposits?|cash ?flow|net worth|bills?|subscriptions?|interest|goals?|balances?)\b/i;

export function followUpQuestion(question: string, history: { role: string; content: string }[]): string {
  const prev = [...history].reverse().find((m) => m.role === "user")?.content;
  const q = question.trim();
  const short = q.split(/\s+/).length <= 5 || /^(and|what about|how about|also|ok,? and|same for)\b/i.test(q);
  if (!prev || !short) return question;
  // The follow-up names its own topic ("what about how much I made?" after a spending question):
  // only the earlier time carries over, or the old topic's words would route it back to spending.
  if (OWN_TOPIC.test(q)) {
    const times = TIME_PHRASE.test(q) ? [] : prev.match(new RegExp(TIME_PHRASE.source, "gi")) ?? [];
    return [q, ...times].join(" ").replace(/\s+/g, " ").trim();
  }
  // New time ("And last month?"): drop the earlier time words. New subject ("What about Chipotle?"):
  // keep the earlier time. Either way the follow-up comes first, so its subject is found first.
  const context = TIME_PHRASE.test(q) ? prev.replace(new RegExp(TIME_PHRASE.source, "gi"), " ") : prev;
  return `${q} ${context}`.replace(/\s+/g, " ").trim();
}
