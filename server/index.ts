import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadDashboardData, plaidConfigured, plaidRouter, startDailySnapshots } from "./plaid.js";
import { billsFor, detectTransferIds, isTransfer, moneyKind, type BankTransaction } from "../src/lib/money.js";
import { sentenceMatchesFacts, templateSentence, type VerdictFacts } from "../src/lib/safeToSpendExplain.js";
import { categoryLabel, comparisonPeriods, goalFinishDate, hasUnmatchedSubject, inRange, matchCategory, matchGoal, matchMerchant, matchSubcategory, monthlySummaries, payee, needsSonnet, rollingRange, windowTotals, explicitRange, followUpQuestion, type DateRange } from "./assistantData.js";
import { shortDate } from "../src/lib/safeToSpendExplain.js";
import { recurring } from "../src/lib/safeToSpend.js";
import { todayISO } from "../src/lib/dates.js";
import { buildPlan, planFacts, templateProposal } from "./savingsPlan.js";

const ScanResult = z.object({
  kind: z.enum(["single_item", "cart", "no_price_found"]),
  items: z.array(
    z.object({
      name: z.string(),
      price: z.number(),
      estimated: z.boolean(), // true if no price was visible and Claude estimated it
    }),
  ),
  total: z.number().nullable(), // total shown on a cart/receipt, if any
  // A realistic cheaper way to get the same need met (e.g. cook at home instead of eating out)
  cheaper_alternative: z
    .object({ description: z.string(), price: z.number() })
    .nullable(),
  note: z.string(),
});

const PROMPT = `You help someone decide whether to buy something. Look at the image and extract prices in US dollars.

- Photo of a product with a visible price tag: return that one item and its price.
- Screenshot of a shopping cart, checkout or receipt: list each line item (name + price for the line, including quantity), and set "total" to the subtotal or total shown (null if none is shown).
- Product with no visible price: name it, estimate a typical US retail price, and set "estimated" to true.
- Nothing to buy in the image: kind "no_price_found", empty items.

Also suggest one realistic cheaper alternative that meets the same need, with an estimated US price: for example "Cook pasta at home" for a restaurant meal, "Brew coffee at home" for a latte, or a store brand or used version for a product. Keep its description under 40 characters. Use null if no sensible cheaper option exists.

Keep item names short (under 40 characters). "note" is one short sentence about anything uncertain, or an empty string.`;

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof ALLOWED)[number];

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY (or an `ant auth login` profile)
  return client;
}

const app = express();
// Locally, only answer requests addressed to this machine: blocks DNS-rebinding pages
// from reading bank data through the browser. (Vercel sets its own Host.)
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (!process.env.VERCEL) {
  app.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (LOCAL_HOSTS.has(host)) return next();
    res.status(403).json({ error: "This local server only accepts requests from this computer." });
  });
}
app.use(express.json({ limit: "15mb" }));
app.use(plaidRouter);

const ChatRequest = z.object({
  question: z.string().trim().min(1).max(1_200),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2_000) }))
    .max(4)
    .default([]),
  // Goals live in browser storage, so only their answer-relevant fields are sent.
  goals: z
    .array(
      z.object({
        kind: z.literal("money"),
        name: z.string().trim().min(1).max(100),
        target: z.number().finite().nonnegative(),
        saved: z.number().finite(),
        weekly: z.number().finite().nonnegative(),
        deadline: z.string().max(20).optional(),
      }),
    )
    .max(30)
    .default([]),
  // The user can still view these accounts in Money, but has opted them out of
  // financial planning and assistant answers.
  excludedAccountIds: z.array(z.string().trim().min(1).max(200)).max(60).default([]),
  // "Get a deeper answer": the user chose to rerun this question on Sonnet.
  deep: z.boolean().default(false),
  // Numbers the app computes in the browser: every account shown (connected + manual),
  // plus the budget and retirement plan. Plaid alone doesn't know about these.
  planning: z
    .object({
      accounts: z.array(z.object({ name: z.string().trim().min(1).max(100), kind: z.string().max(40), balance: z.number().finite(), isDebt: z.boolean() })).max(60),
      netWorth: z.number().finite(),
      monthlyIncome: z.number().finite(),
      monthlyExpenses: z.number().finite(),
      monthlyGoalContributions: z.number().finite(),
      retirementBalance: z.number().finite(),
      retirementEstimate: z.number().finite().nullable(),
      retirementAge: z.number().finite().nullable(),
    })
    .optional(),
});

type ChatData = Awaited<ReturnType<typeof loadDashboardData>>;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function transactionRange(question: string, now = new Date(), defaultDays = 30, allTimeDefault = false): DateRange {
  const periods = comparisonPeriods(question, now);
  if (periods) return { label: `${periods[0].label} and ${periods[1].label}`, start: periods[0].start, endExclusive: periods[1].endExclusive };
  const rolling = rollingRange(question, now);
  if (rolling) return rolling;
  const named = explicitRange(question, now);
  if (named) return named;
  const text = question.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (offset: number) => isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
  if (/\blast week\b/.test(text)) {
    const thisSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    return { label: "last calendar week", start: isoDate(new Date(thisSunday.getFullYear(), thisSunday.getMonth(), thisSunday.getDate() - 7)), endExclusive: isoDate(thisSunday) };
  }
  if (/\bthis week\b/.test(text)) return { label: "this week", start: day(-today.getDay()), endExclusive: day(1) };
  if (/\b(last|past) (7 days|week)\b/.test(text)) return { label: "the last 7 days", start: day(-6), endExclusive: day(1) };
  if (/\blast month\b/.test(text)) return { label: "last calendar month", start: isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), endExclusive: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)) };
  if (/\bthis month\b/.test(text)) return { label: "this month", start: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), endExclusive: day(1) };
  if (/\b(last|past) (30 days|month)\b/.test(text)) return { label: "the last 30 days", start: day(-29), endExclusive: day(1) };
  if (/\btoday\b/.test(text)) return { label: "today", start: day(0), endExclusive: day(1) };
  if (/\byesterday\b/.test(text)) return { label: "yesterday", start: day(-1), endExclusive: day(0) };
  if (/\b(this year|so far this year|year to date|ytd)\b/.test(text)) return { label: "this year", start: `${today.getFullYear()}-01-01`, endExclusive: day(1) };
  // "Last year" is the calendar year before this one; "the past year" and "12 months" are rolling.
  if (/\blast year\b/.test(text)) {
    const y = today.getFullYear() - 1;
    return { label: String(y), start: `${y}-01-01`, endExclusive: `${y + 1}-01-01` };
  }
  if (/\bpast year\b|\b12 months\b/.test(text)) return { label: "the last 12 months", start: day(-365), endExclusive: day(1) };
  // "Ever", "all time": everything saved. Questions about a person or store with no period ("how much have I paid Christian?"): all of it too.
  if (allTimeDefault || /\b(ever|all[- ]time|of all time|lifetime)\b/.test(text)) return { label: "all time", start: "0000-01-01", endExclusive: day(1) };
  // No period named: instant answers mean the last 30 days; Polaris reads 90 days of
  // individual transactions (older months arrive as monthly summaries).
  return { label: `the last ${defaultDays} days`, start: day(-(defaultDays - 1)), endExclusive: day(1) };
}

/** Every transaction in the range: totals must see all of them, so nothing is cut here. */
function selectedTransactions(data: ChatData, range: DateRange) {
  return data.transactions.filter((transaction) => transaction.date >= range.start && (!range.endExclusive || transaction.date < range.endExclusive));
}

/** Most individual transactions sent to Polaris per question (newest kept). Totals and summaries still cover the rest. */
const MAX_LISTED_TRANSACTIONS = 400;
/** Days of individual transactions Polaris reads when a question names no period (older months come as summaries). */
const POLARIS_DEFAULT_DAYS = 90;
/** Months of history Polaris sees as monthly summaries. */
const SUMMARY_MONTHS = 24;

function financialContext(data: ChatData, goals: z.infer<typeof ChatRequest>["goals"], range: DateRange, planning?: z.infer<typeof ChatRequest>["planning"], question = "", lean = false) {
  // Only send fields useful for answering a question. IDs and account masks never
  // need to leave this server, and removing them trims every model request.
  const accountNames = new Map(data.accounts.map((a) => [a.id, `${a.institution} — ${a.name}`]));
  const accounts = data.accounts.map(({ institution, name, type, subtype, current, available }) => ({ institution, name, type, subtype, current, available }));
  const posted = selectedTransactions(data, range)
    .filter((t) => !t.pending)
    .sort((a, b) => b.date.localeCompare(a.date));
  const transactions = posted
    .slice(0, MAX_LISTED_TRANSACTIONS)
    // Logos and websites are for the screen; counterparties stay (they can name what was bought).
    .map(({ id: _id, accountId, logo: _logo, website: _site, ...transaction }) => ({ ...transaction, account: accountNames.get(accountId) ?? "Unknown account" }));

  const transferIds = detectTransferIds(data.transactions);
  const windowed = selectedTransactions(data, range);
  const periods = comparisonPeriods(question);
  return JSON.stringify({
    asOf: data.fetchedAt,
    transactionWindow: range.label,
    // Exact sums computed by the app. Quote these instead of adding transactions yourself.
    windowTotals: windowTotals(windowed, transferIds),
    comparison: periods?.map((period) => ({ period: period.label, from: period.start, toExclusive: period.endExclusive, ...windowTotals(windowed.filter((t) => inRange(t, period)), transferIds) })) ?? null,
    // Paydays, from the same detection Safe-to-Spend uses (deposits into checking/savings).
    projectedIncome: recurring(
      data.transactions.filter((t) => !isTransfer(t, transferIds) && data.accounts.some((a) => a.id === t.accountId && a.type === "depository")),
      "in",
      todayISO(),
    ).map(({ name, amount, cadence, nextDate }) => ({ name, amount, cadence, nextDate })),
    projectedRecurringBills: billsFor({ transactions: data.transactions.filter((t) => !t.pending), recurring: data.recurring }, transferIds)
      .slice(0, 8)
      .map(({ name, amount, cadence, nextDue, daysUntil, source }) => ({ name, amount: Math.round(amount * 100) / 100, cadence, nextDue, daysUntil, source })),
    // Cards and loans from the bank. Any field can be null when the bank doesn't share it; say so rather than guessing.
    debts: (data.debts ?? []).map(({ institution, name, mask, kind, balance, minimumPayment, nextDueDate, apr, lastStatementBalance, isOverdue }) => ({ institution, name, mask, kind, balance, minimumPayment, nextDueDate, apr, lastStatementBalance, isOverdue })),
    // Investments, with what was paid when the brokerage shares it (value minus costBasis is the gain so far).
    holdings: (data.holdings ?? []).filter((h) => !h.cash).sort((x, y) => y.value - x.value).slice(0, 25)
      .map(({ institution, name, ticker, quantity, value, costBasis }) => ({ institution, name, ticker, quantity, value, costBasis: costBasis ?? null })),
    conventions: { plaidAmount: "positive means money out; negative means money in" },
    accounts,
    moneyGoals: goals.map((goal) => ({ ...goal, projectedFinish: goalFinishDate(goal) })),
    // Everything the user sees in the app, including manually entered accounts and budget.
    // Prefer appAccounts/netWorth here for totals; `accounts` above adds Plaid detail for connected ones.
    appPlan: planning ?? null,
    // Long-term memory: one summary per calendar month, newest first. Use these for
    // trends and older periods; the individual transactions above cover transactionWindow only.
    monthlySummaries: monthlySummaries(data.transactions, transferIds, new Date(), SUMMARY_MONTHS),
    // Lean context (deeper Sonnet answers): totals and monthly summaries carry the numbers,
    // so individual transactions, most of the tokens, stay out. Only the largest few go in.
    postedTransactions: lean ? [...transactions].sort((a, b) => b.amount - a.amount).slice(0, 15) : transactions,
    ...(lean ? { postedTransactionsNote: "Only the 15 largest posted transactions in the window are listed; windowTotals and monthlySummaries include all of them." } : {}),
    ...(!lean && posted.length > transactions.length ? { postedTransactionsNote: `Showing the newest ${transactions.length} of ${posted.length} posted transactions in the window; windowTotals and monthlySummaries include all of them.` } : {}),
    // Bank logos are images (tens of thousands of characters each question); the model needs only the words.
    dataStatus: data.status.map(({ logo: _logo, color: _color, itemId: _id, ...status }) => status),
  });
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** Cents only when there are cents ($350, $412.50), matching the app's formatExact. */
const exact = (n: number) => money.format(n).replace(/\.00$/, "");

/** Says how much of an answer rests on NorthStar's guesses about payments with people, so a number is never presented as more certain than it is. */
function guessNote(totals: ReturnType<typeof windowTotals>): string {
  const { count, amount } = totals.unconfirmed;
  // A few dollars of guesses can't change the answer; only mention it when it could.
  if (!count || (amount < 20 && amount < totals.grossSpending * 0.01)) return "";
  return `\n\n${whole(amount)} of this is still NorthStar's guess. Answer Polaris's quick questions to confirm it.`;
}

/** Whole dollars for breakdowns, so the headline number is the only one with cents. */
const whole = (n: number) => money.format(Math.round(n)).replace(/\.00$/, "");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Nov 3" this year, "Nov 3, 2025" otherwise. */
const when = (iso: string) => `${shortDate(iso)}${iso.slice(0, 4) === String(new Date().getFullYear()) ? "" : `, ${iso.slice(0, 4)}`}`;

/** "Paychecks", "Mobile deposit", "Interest", or the payer's name, instead of raw bank text like "PAYROLL ST OF CA … XXXXX7052". */
function earnedSource(name: string): string {
  if (/\binterest\b|\bapy\b/i.test(name)) return "interest";
  if (/tax ?r(e)?f(un)?d|taxrfd|irs treas|franchise tax/i.test(name)) return "tax refunds";
  if (/payroll|earnings|direct dep|salary|\bpay\b/i.test(name)) return "paychecks";
  if (/mobile deposit/i.test(name)) return "mobile deposit";
  if (/deposit/i.test(name)) return "deposits";
  return name.split(/\s+(?=\S*\d)|\s*[:#*]/)[0].replace(/\s+\w*ACH$/i, "").trim() || name;
}

/** Where the money you made came from, biggest first: "paychecks $1,550, mobile deposit $325". */
function earnedBreakdown(earned: { name: string; amount: number }[], limit = 3): string {
  const bySource = new Map<string, number>();
  for (const t of earned) bySource.set(earnedSource(t.name), (bySource.get(earnedSource(t.name)) ?? 0) - t.amount);
  return [...bySource].sort(([, a], [, b]) => b - a).slice(0, limit).map(([source, amount]) => `${source} ${whole(amount)}`).join(", ");
}

/**
 * A name a person recognizes: "Joaquin Boyd" from 'Joaquin Boyd "Utilities"', "Cal Poly" from the
 * university's full name, and the bank's own words when Plaid's merchant name misleads
 * ("Shell Beach Brewhouse", which Plaid calls "Shell").
 */
function shortMerchant(name: string, t?: Pick<BankTransaction, "raw" | "categorized">): string {
  if (t?.raw && t.categorized?.by === "bank text" && t.categorized.confirmed) {
    // "SHELL BEACH BREWHOUSE PISMO BEACH CA" → "Shell Beach Brewhouse": up to the word that says what it is.
    const raw = t.raw.replace(/\s+\d.*$|\s{2,}.*$/, "");
    const named = /^.*?\b(brew(house|ery|ing)|cafe|grill|pizza|restaurant|taqueria|burgers?|kitchen|bistro|diner|eatery|tavern|pub)\b/i.exec(raw)?.[0] ?? raw.replace(/\s+[A-Z]{2}$/, "");
    const words = named.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    if (words) return words;
  }
  return payee(name).replace(/California Polytechnic State University.*/i, "Cal Poly").replace(/\s+Inc\.?$/i, "");
}

/** Top spending categories: "rent and utilities $3,355, transportation $920". */
function categoryBreakdown(byCategory: Record<string, number>, limit = 3): string {
  return Object.entries(byCategory).filter(([, v]) => v > 0).slice(0, limit).map(([cat, amount]) => `${cat} ${whole(amount)}`).join(", ");
}

/** The biggest places in a list of purchases: "Costco $177, Platinum Gas $65". */
function merchantBreakdown(bought: BankTransaction[], limit = 3): string {
  const byMerchant = new Map<string, number>();
  for (const t of bought) byMerchant.set(shortMerchant(t.name, t), (byMerchant.get(shortMerchant(t.name, t)) ?? 0) + t.amount);
  return [...byMerchant].sort(([, x], [, y]) => y - x).slice(0, limit).map(([name, amount]) => `${name} ${whole(amount)}`).join(", ");
}

/** "Since Aug 24" / "This month" / "In October": the period as a sentence opener. */
function periodOpener(label: string): string {
  const fixed: Record<string, string> = {
    "this month": "This month", "this week": "This week", "last calendar month": "Last month", "last calendar week": "Last week",
    today: "Today", yesterday: "Yesterday", "this year": "This year", "all time": "In total",
  };
  if (fixed[label]) return fixed[label];
  const since = /^the period since (.+?)(, \d{4})?$/.exec(label);
  if (since) return `Since ${since[1]}`;
  // "October 2026" asked in 2026 reads as "In October".
  const month = /^([A-Z][a-z]+) (\d{4})$/.exec(label);
  if (month && Number(month[2]) === new Date().getFullYear()) return `In ${month[1]}`;
  return capitalize(`in ${label}`);
}

/** Whether the question names its own period; without one, store and person questions cover all history. */
const namesPeriod = (question: string) => transactionRange(question, new Date(), 30, true).label !== "all time";

/** Stores that sell groceries but that banks file as shopping (Costco's gas station is filed as gas, so it stays out). */
const WAREHOUSE_STORES = /\b(costco|sam'?s club|target|walmart)\b/i;
const AVERAGE_WORDS = /\b(average|avg|typical(ly)?|usually|normally)\b|\b(a|per|each|every) month\b|\bmonthly\b/;

/** "State of California" from "PAYROLL ST OF CA CA PAYROLL XX7052", or the payer's own words. */
function payerName(name: string): string {
  if (/\bST(ATE)? OF CA\b/i.test(name)) return "State of California";
  const words = name.replace(/\b(payroll|ppd|ach|dir(ect)? dep(osit)?|pay|xx+\w*)\b|\d+|[*#:]/gi, " ").replace(/\s+/g, " ").trim();
  return words ? words.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Your employer";
}

const FREQUENCY_WORDS: Record<string, string> = { WEEKLY: "weekly", BIWEEKLY: "every two weeks", SEMI_MONTHLY: "twice a month", MONTHLY: "monthly", ANNUALLY: "yearly" };

/**
 * The next paycheck Plaid predicts. Only income streams that look like pay: not interest, and not
 * money from your own accounts (a regular Wealthfront transfer is labeled income by Plaid too).
 */
function nextPaycheck(data: ChatData): string | null {
  const today = todayISO();
  const own = [...new Set(data.accounts.map((a) => a.institution.toLowerCase().split(/\s+/)[0]))].filter((w) => w.length >= 4);
  const streams = (data.recurring ?? []).filter((s) => s.direction === "in" && s.isActive && s.category === "INCOME" && s.nextDate && s.nextDate >= today
    && s.amount >= 20 && !/\binterest\b/i.test(s.name) && !own.some((w) => s.name.toLowerCase().includes(w)))
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!));
  const next = streams[0];
  if (!next) return null;
  // The paychecks themselves, to show what they've actually been: amounts vary for hourly and state pay.
  const key = (name: string) => name.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !/^x+$/.test(w)).slice(0, 3).join(" ");
  const sixMonthsAgo = isoDate(new Date(Date.now() - 183 * 86_400_000));
  const paid = data.transactions.filter((t) => t.amount < 0 && !t.pending && t.date >= sixMonthsAgo && key(t.name) === key(next.name)).sort((a, b) => b.date.localeCompare(a.date));
  const amounts = paid.map((t) => -t.amount);
  const last = paid[0];
  const lines = [`**Your next paycheck should arrive around ${when(next.nextDate!)}**, from ${payerName(next.name)} (${FREQUENCY_WORDS[next.frequency] ?? "on a regular schedule"}).`];
  if (last) lines.push(`The last one was ${exact(-last.amount)} on ${when(last.date)}.`);
  if (amounts.length >= 3 && Math.max(...amounts) - Math.min(...amounts) > Math.max(...amounts) * 0.1) {
    lines.push(`Over the last 6 months they ranged from ${whole(Math.min(...amounts))} to ${whole(Math.max(...amounts))}, so the amount may differ.`);
  }
  const others = streams.slice(1).filter((s) => s.nextDate! <= isoDate(new Date(Date.now() + 31 * 86_400_000)));
  if (others.length) lines.push(`Also expected: ${others.map((s) => `${payerName(s.name)} around ${shortDate(s.nextDate!)}`).join(", ")}.`);
  lines.push("", "The date is Plaid's prediction from your past paychecks, so it can shift by a day or two.");
  return lines.join("\n");
}

const signedWhole = (n: number) => `${n < 0 ? "−" : "+"}${whole(Math.abs(n))}`;
const pct = (gain: number, basis: number) => (basis > 0 ? ` (${gain < 0 ? "−" : "+"}${Math.abs((gain / basis) * 100).toFixed(1)}%)` : "");

/** Gains and losses on what was paid, from the cost basis brokerages share. Cash has no gain, so it's left out. */
function investmentGains(data: ChatData, text: string): string | null {
  const brokers = [...new Set((data.holdings ?? []).map((h) => h.institution))];
  const asked = brokers.filter((b) => text.includes(b.toLowerCase().split(/\s+/)[0]));
  const holdings = (data.holdings ?? []).filter((h) => !h.cash && (!asked.length || asked.includes(h.institution)));
  const priced = holdings.filter((h) => typeof h.costBasis === "number" && h.costBasis > 0);
  if (!priced.length) return null;
  const sum = (list: typeof priced, f: (h: (typeof priced)[number]) => number) => list.reduce((total, h) => total + f(h), 0);
  const value = sum(priced, (h) => h.value);
  const basis = sum(priced, (h) => h.costBasis!);
  const gain = value - basis;
  const where = asked.length === 1 ? ` at ${asked[0]}` : "";
  const lines = [`**Your investments${where} are ${gain >= 0 ? "up" : "down"} ${whole(Math.abs(gain))}${pct(gain, basis).replace(/[+−]/, "")}** on what you paid: worth ${whole(value)}, bought for ${whole(basis)}.`];
  const byBroker = asked.length === 1 ? [] : brokers.map((b) => {
    const list = priced.filter((h) => h.institution === b);
    const v = sum(list, (h) => h.value), c = sum(list, (h) => h.costBasis!);
    return { b, gain: v - c, basis: c, n: list.length };
  }).filter((x) => x.n).sort((x, y) => y.gain - x.gain);
  if (byBroker.length > 1) lines.push(...byBroker.map((x) => `• ${x.b}: ${signedWhole(x.gain)}${pct(x.gain, x.basis)}`));
  const sorted = [...priced].sort((a, b) => (b.value - b.costBasis!) - (a.value - a.costBasis!));
  const best = sorted[0], worst = sorted.at(-1)!;
  const label = (h: (typeof priced)[number]) => h.ticker || h.name;
  if (best.value - best.costBasis! > 0) lines.push(`Biggest gain: ${label(best)} ${signedWhole(best.value - best.costBasis!)}.${worst !== best && worst.value - worst.costBasis! < 0 ? ` Biggest drop: ${label(worst)} ${signedWhole(worst.value - worst.costBasis!)}.` : ""}`);
  else if (worst.value - worst.costBasis! < 0) lines.push(`Biggest drop: ${label(worst)} ${signedWhole(worst.value - worst.costBasis!)}.`);
  const unpriced = holdings.length - priced.length;
  const notes = [unpriced ? `${unpriced} holding${unpriced === 1 ? "" : "s"} worth ${whole(sum(holdings.filter((h) => !priced.includes(h)), (h) => h.value))} ${unpriced === 1 ? "isn't" : "aren't"} counted because the brokerage doesn't share ${unpriced === 1 ? "its" : "their"} purchase price.` : "", "Gains aren't locked in until you sell."].filter(Boolean);
  return `${lines.join("\n")}\n\n${notes.join(" ")}`;
}

function instantAnswer(question: string, data: ChatData, goals: z.infer<typeof ChatRequest>["goals"], hasManualAccounts = false): string | null {
  const text = question.toLowerCase();
  const transferIds = detectTransferIds(data.transactions);
  const spentAt = data.transactions.filter((t) => t.amount > 0);
  // A store or person the question names ("Costco", "Christian Lim"). Without a period, that means all of it.
  const merchant = matchMerchant(question, spentAt);
  // Only spending-type questions about a store reach back through all history ("interest" can also be a merchant's first word).
  const range = transactionRange(question, new Date(), 30, !!merchant && /\b(spen[dt]|spending|spnd|paid|pay|refund\w*|biggest|largest|bought)\b/.test(text));
  const transactions = selectedTransactions(data, range).filter((transaction) => !transaction.pending);
  // Spending and the refunds/paybacks that come off it; earned money and family support aren't spending.
  const counted = transactions.filter((t) => !isTransfer(t, transferIds) && (moneyKind(t) === "spent" || moneyKind(t) === "offset"));
  // Asked about a period before the history starts: say so instead of answering about a different period.
  const earliest = data.transactions.reduce((min, t) => (t.date < min ? t.date : min), "9999-12-31");
  const noDataFor = !transactions.length && data.transactions.length && range.start < earliest && range.label !== "all time"
    ? `I don't have any transactions for ${range.label}. Your history in NorthStar starts ${when(earliest)}.`
    : null;
  // A person (Venmo, Zelle) rather than a store: payments to them carry a note ('Christian Lim "🍕"') or went
  // through NorthStar's people review.
  const named = merchant ? data.transactions.filter((t) => t.amount > 0 && payee(t.name) === merchant) : [];
  const isPerson = named.filter((t) => t.review || /"[^"]*"\s*$/.test(t.name)).length > named.length / 2;
  // The same person through Zelle reads "ZELLE TO LIM CHRISTIAN ON 08/08…": every part of their name, in any order.
  const nameParts = merchant && isPerson ? merchant.toLowerCase().split(/\s+/).filter((w) => w.length >= 2) : [];
  const atMerchant = (t: BankTransaction) => !!merchant && (payee(t.name) === merchant
    || (nameParts.length >= 2 && /\bzelle\b/i.test(t.name) && nameParts.every((w) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, "")}\\b`, "i").test(t.name))));

  if (/\b(recurring|subscription|subscriptions)\b/.test(text) || /\b(upcoming|next)\b.*\bbills?\b|\bbills?\b.*\b(upcoming|next|due)\b|\bwhat bills\b/.test(text)) {
    const allBills = billsFor({ transactions: data.transactions.filter((transaction) => !transaction.pending), recurring: data.recurring }, transferIds);
    // Subscriptions are services you signed up for; rent, utilities and loans are bills but not subscriptions.
    const categoryOf = (name: string) => data.transactions.find((t) => t.name === name && t.amount > 0)?.category;
    const subscriptionsOnly = /\bsubscriptions?\b/.test(text);
    const pool = subscriptionsOnly ? allBills.filter((b) => !["RENT_AND_UTILITIES", "LOAN_PAYMENTS"].includes(categoryOf(b.name) ?? "")) : allBills;
    const nextThirtyDays = pool.filter((bill) => bill.daysUntil >= 0 && bill.daysUntil <= 30);
    const bills = /\b(next month|next 30 days|coming month)\b/.test(text) ? nextThirtyDays : pool.slice(0, 8);
    if (!bills.length) {
      return subscriptionsOnly
        ? "I don't see any subscriptions yet. NorthStar counts one after it sees the same charge from a company on a regular schedule a few times."
        : "I couldn't find recurring bills in your history yet. NorthStar needs to see the same charge on a regular schedule a few times before it predicts the next one.";
    }
    const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const monthly = bills.reduce((sum, bill) => sum + (bill.cadence === "Weekly" ? bill.amount * 52 / 12 : bill.cadence === "Every 2 weeks" ? bill.amount * 26 / 12 : bill.amount), 0);
    const detail = bills.map((bill) => `• ${shortMerchant(bill.name)}: **${exact(Math.round(bill.amount * 100) / 100)}** ${bill.daysUntil === 0 ? "today" : bill.daysUntil === 1 ? "tomorrow" : `on ${shortDate(bill.nextDue)}`}${bill.cadence === "Monthly" ? "" : ` (${bill.cadence.toLowerCase()})`}`).join("\n");
    const headline = subscriptionsOnly
      ? `**You have ${bills.length} subscription${bills.length === 1 ? "" : "s"}, about ${whole(monthly)} a month.**`
      : `**${bills.length} bill${bills.length === 1 ? "" : "s"} coming up, about ${whole(total)} in all.**`;
    return `${headline}\n${detail}\n\nDates and amounts are predicted from past charges, so they can shift a little.`;
  }

  // "When's my next paycheck?": Plaid's own prediction from the paycheck stream it detected.
  if (/\b(next|when)\b.*\b(pay ?check|pay ?day|get paid|direct deposit)\b|\bwhen (do|will) i get paid\b|\bnext (pay|payment from work)\b/.test(text)) {
    const answer = nextPaycheck(data);
    if (answer) return answer;
  }

  // "How are my investments doing?": what they're worth now against what was paid for them.
  if (/\b(investments?|portfolio|stocks?|holdings?|brokerage|robinhood|fidelity|schwab|wealthfront|roth|ira)\b/.test(text) && /\b(doing|perform\w*|up|down|gain\w*|los[st]|losing|return\w*|profit\w*|made|make)\b/.test(text)) {
    const answer = investmentGains(data, text);
    if (answer) return answer;
  }

  // "How much money do I have" is a balance question; "how much money have I earned/made" is about income.
  const aboutEarning = /\b(earn|earned|earning|made|make|income|paid|paycheck)\b/.test(text);
  if (!hasManualAccounts && !aboutEarning && /\b(net worth|how much (money|cash) (do )?i (currently )?have|total (balance|balances)|account balances?)\b/.test(text)) {
    let assets = 0;
    let debts = 0;
    for (const account of data.accounts) {
      if (account.type === "credit" || account.type === "loan") debts += account.current;
      else assets += account.current;
    }
    const cashAccounts = data.accounts.filter((account) => account.type === "depository");
    const cash = cashAccounts.reduce((sum, account) => sum + (account.available ?? account.current), 0);
    const invested = data.accounts.filter((a) => a.type === "investment").reduce((sum, a) => sum + a.current, 0);
    if (/\b(cash|money)\b/.test(text) && !/\bnet worth\b/.test(text)) {
      const largest = [...cashAccounts].sort((a, b) => (b.available ?? b.current) - (a.available ?? a.current)).slice(0, 3);
      const onHold = cashAccounts.reduce((sum, a) => sum + a.current, 0) - cash;
      return `**You have ${exact(Math.round(cash * 100) / 100)} in cash** across checking, savings and Venmo${onHold >= 1 ? `, after ${whole(onHold)} held for pending charges` : ""}.\n${largest.map((a) => `• ${a.institution} ${a.name}: ${whole(a.available ?? a.current)}`).join("\n")}${invested ? `\n\nPlus ${whole(invested)} invested.` : ""}`;
    }
    // Current balances throughout, so the lines add up to the total.
    const cashNow = cashAccounts.reduce((sum, a) => sum + a.current, 0);
    return `**Your net worth is ${exact(Math.round((assets - debts) * 100) / 100)}.**\n• Cash: ${whole(cashNow)}\n• Investments: ${whole(invested)}\n• Owed on cards and loans: ${whole(debts)}`;
  }

  if (noDataFor && /\b(spent|spend|spnd|spending|earn|earned|made|income|money|cash ?flow|positive|negative)\b/.test(text)) return noDataFor;

  // "Did I get a refund from Amazon?": money back from a store, never pay that happens to share its name.
  if (/\brefund(s|ed)?\b|\b(returned|return)\b.*\b(money|back)\b/.test(text)) {
    const refunds = counted.filter((t) => t.amount < 0 && (!merchant || atMerchant(t)) && !t.review);
    const where = merchant ? ` from ${merchant}` : "";
    if (!refunds.length) return `**No, I don't see a refund${where}** ${range.label === "all time" ? "in your history" : `${periodOpener(range.label).toLowerCase()}`}.${merchant ? "" : " Refunds can take a few days to post after a return."}`;
    const total = -refunds.reduce((s, t) => s + t.amount, 0);
    const list = [...refunds].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((t) => `• ${when(t.date)}: ${exact(-t.amount)}${merchant ? "" : ` from ${shortMerchant(t.name, t)}`}`);
    return `**Yes, ${exact(Math.round(total * 100) / 100)} in ${refunds.length === 1 ? "a refund" : `${refunds.length} refunds`}${where}.**\n${list.join("\n")}${refunds.length > 5 ? `\n…and ${refunds.length - 5} more.` : ""}`;
  }

  // "What was my biggest purchase last month?": exact, from every purchase in the period.
  if (/\b(biggest|largest|most expensive|highest|top)\b.*\b(purchases?|charges?|expenses?|transactions?|things? i bought|buys?)\b/.test(text)) {
    const bought = counted.filter((t) => t.amount > 0 && (!merchant || atMerchant(t))).sort((a, b) => b.amount - a.amount).slice(0, 3);
    if (!bought.length) return `I don't see any purchases ${periodOpener(range.label).toLowerCase()}.`;
    const [top, ...rest] = bought;
    return `**${range.label === "all time" ? "Of everything on record" : periodOpener(range.label)}, your biggest purchase was ${exact(top.amount)} at ${shortMerchant(top.name, top)}** on ${when(top.date)}.${rest.length ? `\nNext: ${rest.map((t) => `${shortMerchant(t.name, t)} ${whole(t.amount)} (${shortDate(t.date)})`).join(", ")}.` : ""}`;
  }

  // "Am I spending more this month than last month?" / "this week than last week": the fair comparison is
  // the same number of days, so a partial month isn't compared with a whole one.
  const periods = comparisonPeriods(question);
  if (periods && /\b(spent|spend|spending|spnd)\b/.test(text)) {
    const subject = matchSubcategory(question);
    const category = subject ? null : matchCategory(question);
    const keep = (t: BankTransaction) => (subject ? subject.test(t) : category ? t.category === category : true);
    const [prev, cur] = periods;
    const days = Math.round((Date.parse(cur.endExclusive!) - Date.parse(cur.start)) / 86_400_000);
    const prevSameEnd = isoDate(new Date(Date.parse(prev.start) + days * 86_400_000));
    const spend = (start: string, endExclusive: string) => windowTotals(data.transactions.filter((t) => t.date >= start && t.date < endExclusive && keep(t)), transferIds).spendingTotal;
    const now = spend(cur.start, cur.endExclusive!);
    const before = spend(prev.start, prevSameEnd < prev.endExclusive! ? prevSameEnd : prev.endExclusive!);
    const full = spend(prev.start, prev.endExclusive!);
    const unit = /week/.test(cur.label) ? "week" : "month";
    const diff = now - before;
    const about = subject ? ` on ${subject.label}` : category ? ` on ${categoryLabel(category)}` : "";
    const verdict = Math.abs(diff) < Math.max(10, before * 0.05)
      ? `About the same as last ${unit}`
      : diff > 0 ? `Yes, ${whole(diff)} more than at this point last ${unit}` : `No, ${whole(-diff)} less than at this point last ${unit}`;
    return `**${verdict}.**\n• This ${unit} so far${about}: **${exact(now)}**\n• Same days last ${unit}: ${exact(before)}\n• All of last ${unit}: ${exact(full)}`;
  }

  // "How much did I spend and how much did I make…": answer both halves, not just the first one matched.
  const asksSpending = /\b(spent|spend|spending|spnd)\b/.test(text);
  const asksEarning = /\b(made|make|earn|earned|income|money came in|money in|inflows?|received|get paid|got paid)\b/.test(text);
  if (asksSpending && asksEarning && !periods && !/\b(more|less) than\b/.test(text)) {
    const totals = windowTotals(transactions, transferIds);
    const earned = transactions.filter((t) => !isTransfer(t, transferIds) && moneyKind(t) === "earned");
    const net = totals.netCashFlow;
    const outcome = net > 0 ? `you're up ${exact(net)}` : net < 0 ? `you're down ${exact(-net)}` : "you broke even";
    const made = earnedBreakdown(earned);
    const spentOn = categoryBreakdown(totals.spendingByCategory);
    return `**${periodOpener(range.label)}, ${outcome}.**\n`
      + `• Made **${exact(totals.earnedTotal)}**${made ? `: ${made}` : ""}\n`
      + (totals.familySupportTotal ? `• Family support (529): **${exact(totals.familySupportTotal)}**\n` : "")
      + `• Spent **${exact(totals.spendingTotal)}**${spentOn ? `: ${spentOn}` : ""}`
      + guessNote(totals);
  }

  if (/\b(am i|are we|was i|were we|i'?m) (positive|negative|in the (red|green)|ahead|behind|up|down)\b|\bnet (cash ?flow|income|change)\b|\bcash ?flow\b|\b(more|less) than i (spent|spend|made|make|earned|earn)\b|\b(spent|spend) more than i\b/.test(text)) {
    const totals = windowTotals(transactions, transferIds);
    const net = totals.netCashFlow;
    // "Did I spend more than I made?" and "am I in the red?" are yes when net is negative.
    const askedNegative = /\b(am i|are we|was i|were we|i'?m) (negative|in the red|behind|down)\b|\b(spent|spend) more than i\b|\b(made|make|earned|earn) less than i\b/.test(text);
    const verdict = net === 0 ? "You broke even" : (askedNegative ? net < 0 : net > 0) ? "Yes" : "No";
    const outcome = net > 0 ? `you're up ${exact(net)}` : net < 0 ? `you're down ${exact(-net)}` : "you broke even";
    const biggest = totals.spendingByMerchant[0];
    // Only lead with yes/no when the question asks one ("am I…", "did I…"), not for "what is my cash flow".
    // "Am I up or down?" offers both, so a yes or no would answer nothing.
    const yesNo = /\b(am i|are we|was i|were we|did i|do i|have i|i'?m)\b/.test(text) && !/\bup or down\b|\bpositive or negative\b|\bahead or behind\b/.test(text);
    const inLine = totals.familySupportTotal ? `${exact(totals.inflowTotal)} came in (${exact(totals.familySupportTotal)} of it from your 529)` : `${exact(totals.inflowTotal)} came in`;
    return `**${yesNo ? `${verdict}. ` : ""}${periodOpener(range.label)}, ${outcome}.**\n• ${inLine}\n• Spent ${exact(totals.spendingTotal)}${biggest && net < 0 ? `, biggest was ${shortMerchant(biggest.merchant)} (${whole(biggest.total)})` : ""}${guessNote(totals)}`;
  }

  const subject = merchant ? null : matchSubcategory(question);
  const category = merchant || subject ? null : matchCategory(question);
  const keep = (t: BankTransaction) => (merchant ? atMerchant(t) : subject ? subject.test(t) : category ? t.category === category : true);
  const about = merchant ? `${isPerson ? "with" : "at"} ${merchant}` : subject ? `on ${subject.label}` : category ? `on ${categoryLabel(category)}` : "";

  // "What's my average monthly spending?", "How much do I spend on groceries a month?": the last three full months.
  if (asksSpending && AVERAGE_WORDS.test(text) && !namesPeriod(question.replace(AVERAGE_WORDS, " "))) {
    if (!merchant && !subject && !category && hasUnmatchedSubject(question)) return null;
    const now = new Date();
    const months = [1, 2, 3].map((back) => {
      const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
      const list = data.transactions.filter((t) => t.date >= isoDate(start) && t.date < isoDate(end) && keep(t));
      return { name: start.toLocaleDateString("en-US", { month: "long" }), list, total: windowTotals(list, transferIds).spendingTotal };
    });
    if (earliest > isoDate(new Date(now.getFullYear(), now.getMonth() - 3, 1))) return null;
    const average = months.reduce((s, m) => s + m.total, 0) / 3;
    // One big charge (tuition, a deposit) can make an average misleading: name it.
    const outlier = months
      .map((m) => ({ m, top: m.list.filter((t) => t.amount > 0 && !isTransfer(t, transferIds)).sort((a, b) => b.amount - a.amount)[0] }))
      .find(({ m, top }) => top && top.amount > 1000 && top.amount > m.total * 0.5 && top.amount > average);
    const withoutIt = outlier ? (months.reduce((s, m) => s + m.total, 0) - outlier.top.amount) / 3 : 0;
    const warehouse = subject?.label === "groceries" ? data.transactions.filter((t) => t.date >= isoDate(new Date(now.getFullYear(), now.getMonth() - 3, 1)) && t.date < isoDate(new Date(now.getFullYear(), now.getMonth(), 1)) && t.amount > 0 && !t.pending && WAREHOUSE_STORES.test(t.name) && !subject.test(t) && !isTransfer(t, transferIds)) : [];
    const warehouseNote = warehouse.length ? `\n\nNot included: about ${whole(warehouse.reduce((s, t) => s + t.amount, 0) / 3)} a month at ${[...new Set(warehouse.map((t) => shortMerchant(t.name)))].join(" and ")}. Banks file it as shopping, so its groceries can't be split out.` : "";
    return `**You spend about ${whole(average)} a month${about ? ` ${about}` : ""}**, averaged over ${months[2].name} to ${months[0].name}.\n${months.map((m) => `• ${m.name}: ${whole(m.total)}`).join("\n")}${outlier ? `\n\n${outlier.m.name} includes ${exact(outlier.top.amount)} at ${shortMerchant(outlier.top.name, outlier.top)}. Without it, about ${whole(withoutIt)} a month.` : ""}${warehouseNote}`;
  }

  // "How much have I paid Christian?" is spending with a person; "did I get paid" is not.
  const paidSomeone = !!merchant && /\b(paid|pay|sent|send|given|gave)\b/.test(text) && !/\b(paid me|pay me|sent me|gave me|get paid|got paid)\b/.test(text);
  if ((/\b(spent|spending|spend|spnd)\b/.test(text) || paidSomeone) && /\b(how much|what|where|categories?|on|at)\b/.test(text)) {
    // "On boba runs", "for clothes": narrower than anything we can match exactly, so let the model look.
    if (!merchant && !subject && !category && hasUnmatchedSubject(question)) return null;
    const count = (n: number) => `${n} ${isPerson ? "payment" : "purchase"}${n === 1 ? "" : "s"}`;
    const describe = (list: typeof counted) => {
      const bought = list.filter((t) => t.amount > 0);
      const back = -list.filter((t) => t.amount < 0).reduce((sum, t) => sum + t.amount, 0);
      const net = Math.round((bought.reduce((sum, t) => sum + t.amount, 0) - back) * 100) / 100;
      return { bought, back, net, after: back > 0.004 ? `, after ${whole(back)} ${isPerson ? "back" : "in refunds and paybacks"}` : "" };
    };
    const opener = periodOpener(range.label);
    if (merchant) {
      const m = describe(counted.filter(atMerchant));
      if (!m.bought.length) {
        const last = data.transactions.filter((t) => atMerchant(t) && t.amount > 0 && !t.pending).sort((a, b) => b.date.localeCompare(a.date))[0];
        return `**${opener}, you didn't spend anything ${about}.**${last ? `\nYour last charge there was ${exact(last.amount)} on ${when(last.date)}.` : ""}`;
      }
      const since = range.label === "all time" ? ` since ${when(m.bought.reduce((min, t) => (t.date < min ? t.date : min), "9999"))}` : "";
      const verb = isPerson ? "paid" : "spent";
      const headline = range.label === "all time" ? `You've ${verb} ${exact(m.net)} ${isPerson ? "to" : "at"} ${merchant}` : `${opener}, you ${verb} ${exact(m.net)} ${isPerson ? "to" : "at"} ${merchant}`;
      const latest = [...m.bought].sort((a, b) => b.date.localeCompare(a.date))[0];
      return `**${headline}** (${count(m.bought.length)}${since}${m.after}).\nMost recent: ${exact(latest.amount)} on ${when(latest.date)}.${guessNote(windowTotals(counted.filter(atMerchant), transferIds))}`;
    }
    if (subject || category) {
      const subset = counted.filter(keep);
      const c = describe(subset);
      const top = merchantBreakdown(c.bought);
      // Plaid files Costco and other warehouse stores under shopping, so their groceries can't be counted here.
      const warehouse = subject?.label === "groceries" ? counted.filter((t) => t.amount > 0 && WAREHOUSE_STORES.test(t.name) && !subject.test(t)) : [];
      const warehouseNote = warehouse.length ? `\n\nNot included: ${whole(warehouse.reduce((s, t) => s + t.amount, 0))} at ${[...new Set(warehouse.map((t) => shortMerchant(t.name)))].join(" and ")}. Banks file it as shopping, so its groceries can't be split out.` : "";
      if (!c.bought.length) return `**${opener}, you didn't spend anything ${about}.**${warehouseNote}`;
      return `**${opener}, you spent ${exact(c.net)} ${about}**${c.after}.${top ? `\nBiggest: ${top}.` : ""}${warehouseNote}${guessNote(windowTotals(subset, transferIds))}`;
    }
    const totals = windowTotals(transactions, transferIds);
    const spentOn = categoryBreakdown(totals.spendingByCategory);
    const offsets = totals.refundsAndPaybacks ? ` after ${whole(totals.refundsAndPaybacks)} in refunds and paybacks` : "";
    if (!totals.grossSpending) return `**${opener}, you didn't spend anything.**`;
    return `**${opener}, you spent ${exact(totals.spendingTotal)}**${offsets}.${spentOn ? `\nBiggest: ${spentOn}.` : ""}${guessNote(totals)}`;
  }

  if (/\b(goal|goals|how close|saving for|savings progress)\b/.test(text) && goals.length) {
    const describe = (goal: (typeof goals)[number]) => {
      const remaining = Math.max(0, goal.target - goal.saved);
      const percent = goal.target ? Math.min(100, (goal.saved / goal.target) * 100) : 100;
      const finish = goalFinishDate(goal);
      const timing = remaining === 0 ? "Fully funded." : finish ? `On track for ${finish} at ${exact(goal.weekly)}/week.` : "Add a weekly amount to see a finish date.";
      return `**${goal.name}**: ${exact(goal.saved)} of ${exact(goal.target)} (${percent.toFixed(0)}%). ${timing}`;
    };
    const named = matchGoal(question, goals);
    if (named) return describe(named);
    const saved = goals.reduce((s, g) => s + g.saved, 0);
    const target = goals.reduce((s, g) => s + g.target, 0);
    return `**You've saved ${exact(saved)} of ${exact(target)} across ${goals.length} goal${goals.length === 1 ? "" : "s"}.**\n${goals.map((goal) => `• ${describe(goal)}`).join("\n")}`;
  }

  if (/\b(interest|apy)\b/.test(text)) {
    const interest = transactions.filter((transaction) => transaction.amount < 0 && /\binterest\b|\bapy\b/i.test(transaction.name));
    if (!interest.length) return `**I don't see any interest ${periodOpener(range.label).toLowerCase()}.** I only count deposits your bank labels as interest.`;
    const byAccount = new Map<string, number>();
    for (const transaction of interest) {
      const account = data.accounts.find((a) => a.id === transaction.accountId);
      const name = account ? `${account.institution} ${account.name}` : "Unknown account";
      byAccount.set(name, (byAccount.get(name) ?? 0) + Math.abs(transaction.amount));
    }
    const total = Math.round([...byAccount.values()].reduce((sum, value) => sum + value, 0) * 100) / 100;
    const detail = byAccount.size > 1 ? `\n${[...byAccount.entries()].sort(([, a], [, b]) => b - a).map(([name, amount]) => `• ${name}: ${exact(Math.round(amount * 100) / 100)}`).join("\n")}` : ` All of it from ${[...byAccount.keys()][0]}.`;
    return `**${periodOpener(range.label)}, you earned ${exact(total)} in interest.**${detail}`;
  }

  if (/\b(made|make|earn|earned|income|money came in|money in|inflow|inflows|deposits|received|did i get|have i gotten|get paid|got paid)\b/.test(text)) {
    const totals = windowTotals(transactions, transferIds);
    const earned = transactions.filter((t) => !isTransfer(t, transferIds) && moneyKind(t) === "earned");
    const made = earnedBreakdown(earned);
    const support = totals.familySupportTotal ? `\nPlus ${exact(totals.familySupportTotal)} from your 529 (not counted as made).` : "";
    // Only guesses about money in matter here; a guessed payment out doesn't change what you made.
    return `**${periodOpener(range.label)}, you made ${exact(totals.earnedTotal)}.**${made ? `\nFrom ${made}.` : ""}${support}${guessNote(windowTotals(earned, transferIds))}`;
  }
  return null;
}

function needsDeeperReasoning(question: string) {
  return /\b(why|recommend|should i|plan|strategy|forecast|budget|prioriti[sz]e|compare|trade[- ]?off|risk|optimi[sz]e|analy[sz]e|explain)\b/i.test(question);
}

const FINANCE_SYSTEM_PROMPT = `You are Polaris, the in-app financial assistant in NorthStar. Use the current financial context below for claims about the user. You may use general financial knowledge to explain investing concepts. Do not invent transactions, interest, balances, rates, or dates.

Use conversation history to interpret replies to your own clarification questions. Acknowledge the facts the user supplied, use them to answer the original question, and ask only for information that is still missing. Treat corrections as replacing earlier statements. Do not infer units, account type, tax eligibility, or risk tolerance from ambiguous replies such as "yes" or a bare number; ask a concise clarification. Distinguish user-stated assumptions from dashboard facts. Follow explicit topic changes instead of forcing the previous topic. If history is insufficient, say what context you need rather than inventing it.

Be direct: name the key figures behind a number (totals, the biggest item), not every transaction. Plaid transaction amounts use a positive number for money out and a negative number for money in. Treat transfers, card payments, and pending transactions carefully; do not count them as earnings unless the data clearly supports that. Money moved between the user's own connected accounts (for example Wealthfront to Wells Fargo, or checking to savings), is a transfer, never income, earnings, or spending, whatever its category says. Money from a 529 college savings plan such as ScholarShare is family support (category FAMILY_SUPPORT): it counts as money in for cash flow, but never call it income, earnings, or pay. For questions about "money made," explain whether you are reporting posted inflows, net cash flow, or something else. For interest, report only transactions whose description clearly identifies interest; do not infer it from a balance change. Explain when the available data cannot answer the question.

Explain and compare US retirement and tax-advantaged accounts when asked: traditional and Roth IRAs, traditional and Roth 401(k)s, 403(b)s, governmental versus nongovernmental 457(b)s, SEP/SIMPLE IRAs, solo 401(k)s, HSAs, health FSAs, and 529 plans. Cover purpose, eligibility, federal contribution and withdrawal tax treatment, access restrictions, and relevant trade-offs. Distinguish account structures from their underlying investments. Do not infer eligibility from a dashboard balance. Do not quote unverified annual contribution limits, income thresholds, or deadlines; explain that a live tax-rule lookup is unavailable and direct users to the applicable tax-year IRS guidance and plan documents. Mention state treatment may differ.

Give useful investment education and planning options: explain diversified low-cost funds, stocks versus bonds, fees, regular contributions, and retirement versus taxable accounts. Connect options to the supplied budget and goals, clearly distinguishing recorded facts from assumptions. Before suggesting an allocation or contribution amount, ask about missing time horizon, cash reserves, debt interest rates, and tolerance for losses. Treat budget surplus as a planning estimate, not automatically investable money. Explain relevant downside risk and trade-offs, and offer a concrete next step. Do not guarantee returns, fabricate live prices or current tax rules, prescribe specific security trades, or give personalized tax or legal advice. Keep answers short: under 80 words for questions about the user's own numbers, under 180 words for explanations, unless the user asks for a breakdown. When you discuss a financial decision (investing, debt, affordability, which account to use), end with a brief reminder that this is informational, not financial advice. Skip that reminder for greetings, simple lookups, and off-topic replies.`;

// Polaris (a narrow chat panel) renders a small markdown subset: bold, italics, bullet and numbered lists.
const CHAT_PANEL_FORMAT = [
  "Format for a narrow chat panel. Make answers easy to skim: put the direct answer and its key number in **bold** (one or two bold phrases per answer, not whole sentences). Use *italics* only for a term you are defining. When listing three or more items or steps, use short \"- \" bullet lines or \"1. \" numbered steps, one idea per line, with a blank line before the list. Keep paragraphs to one to three sentences. Do not use headings, tables, links, or code blocks.",
  "Numbers: the context includes exact sums the app computed (windowTotals, and comparison when the question compares two periods). windowTotals.inflowTotal is all money in and already excludes transfers between accounts, Venmo transfers, and card payments. spendingTotal is what the user really spent: grossSpending (purchases) minus refundsAndPaybacks (refunds, and friends or roommates paying them back), so quote spendingTotal as their spending. inflowTotal splits into earnedTotal (what the user made: pay, work reimbursements, interest) and familySupportTotal (529 college savings withdrawals from family, category FAMILY_SUPPORT). For 'how much did I make/earn', quote earnedTotal and mention family support separately if any. For 'am I up or down' or cash flow, use netCashFlow, which counts family support as money in, and say how much of the money in was family support. Quote those sums instead of adding transactions yourself. windowTotals.unconfirmed counts payments with people that NorthStar labeled by its own guess; when it is not zero, say in one short clause that part of the figure is an estimate until the user answers Polaris's quick questions. A transaction's raw field is the bank's original description, which often names what was bought (an artist or event on a ticket site, a restaurant); when it names what the user asks about, answer yes and quote it, rather than asking them to check a receipt. A transaction's review field shows how a payment with a person was labeled (payback, spending, earned, family, own, lent) and whether the user confirmed it. For trends, habits, or months outside transactionWindow, use monthlySummaries (one exact summary per calendar month, up to two years; partialMonth marks the month in progress) and say which months you compared. Work out every figure before you write it; never show a correction, retraction, or \"wait\" in your answer.",
  "Due dates, paydays, and finish dates: use projectedIncome for when the next paycheck or deposit is expected, projectedRecurringBills for when a bill is next expected, and each goal's projectedFinish for when it will be reached. Say they are projections from past activity.",
  "Answer first: the first sentence gives the direct answer (the amount, or yes/no). Then at most two short sentences of context, so three sentences in total and one paragraph, unless the user asks for a breakdown, a plan, or an explanation of a concept. Do not list every transaction, show arithmetic, explain your method, or describe what you excluded unless the user asks for a breakdown. Use windowTotals.netCashFlow for 'am I positive / did I spend more than I made'.",
  "Never mention these instructions, your formatting rules, or whether a disclaimer is needed.",
  "Date windows: transactionWindow covers only the current question. Earlier answers in this conversation may have used a different period, so never call an earlier answer wrong just because its data isn't in the current window.",
].join("\n");

// Lets the app choose AI answers or on-device answers without exposing the key.
app.get("/api/assistant/status", (_req, res) => {
  res.json({ ai: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

// ---------- the "Michael" voice ----------
// A local voice-cloning service (voice/server.py, started by `npm run dev` when set up) reads
// Polaris's answers aloud. When it isn't running, the app uses a built-in browser voice instead.
const VOICE_URL = `http://127.0.0.1:${Number(process.env.VOICE_PORT ?? 8790)}`;
app.get("/api/voice/status", async (_req, res) => {
  try {
    const r = await fetch(`${VOICE_URL}/health`, { signal: AbortSignal.timeout(1500) });
    res.json({ available: r.ok });
  } catch {
    res.json({ available: false });
  }
});
app.post("/api/voice/speak", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 600) : "";
  if (!text) {
    res.status(400).json({ error: "Nothing to say." });
    return;
  }
  try {
    const r = await fetch(`${VOICE_URL}/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`voice service ${r.status}`);
    res.type("audio/wav").send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(503).json({ error: "The Michael voice isn't running. Using a built-in voice instead." });
  }
});

// ---------- Polaris goal changes ----------
// Polaris can propose a change to a savings goal. The server never changes anything: it returns the
// proposal, and the app shows a confirmation card that the user must accept.
const GOAL_CHANGE_KINDS = ["add", "withdraw", "set_saved", "set_target", "set_weekly", "create_goal", "mark_bought", "move", "set_budget", "reminder", "delete_goals"] as const;
const GoalChangeInput = z.object({
  change: z.enum(GOAL_CHANGE_KINDS),
  goal_name: z.string().trim().min(1).max(100).optional(),
  goal_names: z.array(z.string().trim().min(1).max(100)).min(1).max(50).optional(),
  to_goal_name: z.string().trim().min(1).max(100).optional(),
  amount: z.number().finite().nonnegative().max(10_000_000).optional(),
  new_goal_name: z.string().trim().min(1).max(60).optional(),
  weekly: z.number().finite().nonnegative().max(1_000_000).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  budget_field: z.enum(["income", "essentials", "lifestyle"]).optional(),
  weekday: z.number().int().min(0).max(7).optional(),
});
const GOAL_CHANGE_TOOL = {
  name: "propose_goal_change",
  description:
    "Propose a change to the user's goals or budget when they explicitly ask for one. The app shows a confirmation card; nothing changes until they confirm. Never use this for what-if questions or advice.",
  input_schema: {
    type: "object" as const,
    properties: {
      change: {
        type: "string",
        enum: [...GOAL_CHANGE_KINDS],
        description:
          "add = put money into goal_name; withdraw = take money out; set_saved / set_target / set_weekly = set that goal's saved amount, total, or weekly amount; create_goal = new goal (new_goal_name, amount = target, optional weekly and deadline); mark_bought = the user bought goal_name (amount = price paid); move = move amount from goal_name to to_goal_name; set_budget = set budget_field to amount per month; reminder = remind the user weekly (weekday 0=Sunday…6=Saturday, 7=every day) to add amount to goal_name. delete_goals = delete the goals in goal_names (only when the user asks to delete or remove whole goals, not money).",
      },
      goal_name: { type: "string", description: "An existing goal's name exactly as in the financial context (the source goal for move)." },
      goal_names: { type: "array", items: { type: "string" }, description: "For delete_goals: every goal to delete, names exactly as in the financial context. For \"delete all my goals\", list every current goal." },
      to_goal_name: { type: "string", description: "For move: the goal receiving the money." },
      amount: { type: "number", description: "Dollar amount: the change, the new value, the price paid, or the new goal's target." },
      new_goal_name: { type: "string", description: "For create_goal: a short name like \"Laptop\"." },
      weekly: { type: "number", description: "For create_goal: optional weekly savings amount." },
      deadline: { type: "string", description: "For create_goal: optional target date, YYYY-MM-DD." },
      budget_field: { type: "string", enum: ["income", "essentials", "lifestyle"], description: "For set_budget." },
      weekday: { type: "integer", description: "For reminder: 0=Sunday … 6=Saturday, 7=every day." },
    },
    required: ["change"],
  },
};
const GOAL_CHANGE_INSTRUCTIONS =
  "Goal and budget changes: when the user asks you to change something (add to or take money out of a goal, set a goal's saved amount, target, or weekly amount, create a goal, mark a goal as bought, move money between goals, change their monthly income/essentials/lifestyle budget, or set a savings reminder, or delete goals), call propose_goal_change. If you also write text, keep it to one short sentence; the app shows the before and after for them to confirm, so never say the change is already done. If something needed is unclear (which goal, how much), ask instead of calling the tool.";
const GOAL_CHANGE_REQUEST = /\b(add|put|move|deposit|contribute|transfer|throw|stash|withdraw|take out|pull out|remove|subtract|set|change|update|bump|raise|lower|create|make|start|new goal|bought|purchased|remind|budget|income)\b[\s\S]*\d|\b(bought|purchased|remind me)\b|\b(delete|remove|get rid of|erase)\b[\s\S]*\bgoals?\b/i;

app.post("/api/financial-chat", async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send a question and valid chat context." });
    return;
  }
  const planning = parsed.data.planning;
  if (!plaidConfigured && !planning) {
    res.status(503).json({ error: "Connect Plaid first by adding PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET or PLAID_PRODUCTION_SECRET (matching PLAID_ENV) to .env." });
    return;
  }

  try {
    // Fresh Plaid data is loaded for every question; credentials and access tokens stay on this server.
    // Without Plaid, the app's own numbers (manual accounts, budget, goals) are enough to answer.
    const loaded: ChatData = plaidConfigured ? await loadDashboardData() : { env: "manual", accounts: [], transactions: [], status: [], fetchedAt: new Date().toISOString() };
    const excluded = new Set(parsed.data.excludedAccountIds);
    const dashboard: ChatData = {
      ...loaded,
      accounts: loaded.accounts.filter((account) => !excluded.has(account.id)),
      transactions: loaded.transactions.filter((transaction) => !excluded.has(transaction.accountId)),
      holdings: loaded.holdings?.filter((holding) => !excluded.has(holding.accountId)),
    };
    if (!dashboard.accounts.length && !dashboard.transactions.length && !planning?.accounts.length && !parsed.data.goals.length) {
      res.status(422).json({ error: "No account data is available yet. Add or connect an account, then try again." });
      return;
    }
    // "And last month?" carries the previous question's topic for routing and dates.
    const routed = followUpQuestion(parsed.data.question, parsed.data.history);
    // Accounts added by hand in the app (a car, a 401(k)) aren't in Plaid. Linked accounts can be renamed in the
    // app, so count rather than compare names.
    const hasManualAccounts = !!planning && planning.accounts.length > dashboard.accounts.length;
    // Instant calculations answer "what/how much" lookups; questions asking why or what to do go to the model.
    // Requests to change a goal ("put $20 toward the car") go to the model, which proposes the change.
    const goalChange = GOAL_CHANGE_REQUEST.test(parsed.data.question);
    const computed = goalChange || needsDeeperReasoning(routed) ? null : instantAnswer(routed, dashboard, parsed.data.goals, hasManualAccounts);
    if (computed) {
      res.json({ answer: computed, fetchedAt: dashboard.fetchedAt, source: "calculation" });
      return;
    }
    // "All time" would hand Polaris every transaction; older months already arrive as monthly summaries.
    const asked = transactionRange(routed, new Date(), POLARIS_DEFAULT_DAYS);
    const range = asked.label === "all time" ? transactionRange("", new Date(), POLARIS_DEFAULT_DAYS) : asked;
    // Every question runs on Haiku 5.5 (about 20x cheaper): the app hands it exact totals and
    // monthly summaries. Sonnet runs only when the user taps "Get a deeper answer", with a lean
    // context. Planning and trade-off questions offer that button.
    const deep = parsed.data.deep;
    const model = deep ? "claude-sonnet-5-5" : "claude-haiku-5-5";
    const offerDeeper = !deep && needsSonnet(routed);
    const response = await getClient().messages.create({
      model,
      // Room for brief thinking plus a short answer; the prompt's word limit keeps answers short.
      max_tokens: model === "claude-sonnet-5-5" ? 3000 : 2000,
      // Adaptive thinking (the default when `thinking` is omitted) at low effort: a moment to check
      // figures before writing, so doubts don't surface as on-screen corrections. Validation showed
      // visible "let me correct this" answers with thinking turned off.
      output_config: { effort: "low" },
      tools: [GOAL_CHANGE_TOOL],
      system: `${FINANCE_SYSTEM_PROMPT}\n\n${CHAT_PANEL_FORMAT}\n\n${GOAL_CHANGE_INSTRUCTIONS}\n\nCURRENT FINANCIAL CONTEXT:\n${financialContext(dashboard, parsed.data.goals, range, planning, routed, deep)}`,
      messages: [...parsed.data.history.slice(-4), { role: "user", content: parsed.data.question }],
    });
    // Token counts only (no content), so you can watch what each question costs in the terminal.
    const { input_tokens: inTok, output_tokens: outTok } = response.usage;
    const [inRate, outRate] = model === "claude-sonnet-5-5" ? [2, 10] : inTok > 100_000 ? [0.5, 2.5] : [0.1, 0.5];
    console.log(`Polaris ${model}: ${inTok} in / ${outTok} out tokens ≈ $${((inTok * inRate + outTok * outRate) / 1e6).toFixed(4)}`);
    const answer = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    // A proposed goal change: the app asks the user to confirm before anything is saved.
    const toolUse = response.content.find((block) => block.type === "tool_use" && block.name === GOAL_CHANGE_TOOL.name);
    const proposal = toolUse && toolUse.type === "tool_use" ? GoalChangeInput.safeParse(toolUse.input) : null;
    if (proposal?.success) {
      const p = proposal.data;
      res.json({
        answer,
        action: { kind: p.change, goalName: p.goal_name, goalNames: p.goal_names, toGoalName: p.to_goal_name, amount: p.amount, name: p.new_goal_name, target: p.change === "create_goal" ? p.amount : undefined, weekly: p.weekly, deadline: p.deadline, field: p.budget_field, weekday: p.weekday },
        fetchedAt: dashboard.fetchedAt,
      });
      return;
    }
    if (!answer) {
      // Log provider metadata only—never financial context or the user's question.
      console.warn("Financial assistant returned no text", {
        model,
        stopReason: response.stop_reason,
        contentTypes: response.content.map((block) => block.type),
      });
      res.status(502).json({ error: "The assistant couldn't form an answer from the available data. Try asking with a date range or a more specific account, category, or merchant." });
      return;
    }
    console.info("Financial assistant usage", {
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
    res.json({ answer, fetchedAt: dashboard.fetchedAt, model: deep ? "sonnet" : "haiku", ...(offerDeeper ? { deeper: true } : {}) });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: "Invalid API key. Check ANTHROPIC_API_KEY in .env." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "The assistant is busy. Wait a moment and try again." });
    } else if (err instanceof Anthropic.APIError) {
      console.error("Claude financial chat error", err.status, err.message);
      res.status(502).json({ error: "The financial assistant couldn't respond right now." });
    } else {
      console.error("Financial chat error", err);
      res.status(502).json({ error: "Couldn't refresh your financial data. Try again in a moment." });
    }
  }
});
// ---------- Safe-to-Spend: explain a verdict the app already computed ----------
const OPTION_IDS = ["buy-now", "wait-until", "use-savings", "cheaper-option", "skip", "save-for-it"] as const;
const money2 = z.number().finite();
const VerdictFactsSchema = z.object({
  item: z.string().trim().min(1).max(80),
  price: money2.positive(),
  verdict: z.enum(["safe", "tight", "not-yet"]),
  cash: money2, savings: money2,
  reserved: money2.nonnegative().default(0), reservedName: z.string().max(100).nullable().default(null),
  lowPointBefore: money2, lowPointAfter: money2, lowPointDate: z.string().max(10),
  driver: z.object({ name: z.string().max(80), amount: money2, date: z.string().max(10) }).nullable(),
  nextIncome: z.object({ name: z.string().max(80), amount: money2, date: z.string().max(10) }).nullable(),
  safeDate: z.object({ date: z.string().max(10), after: z.string().max(80) }).nullable(),
  comfortableLimit: money2, safeLimit: money2, coveredBySavings: z.boolean(),
  goalSavingsPerWeek: money2, mainReason: z.enum(["bills", "spending"]).default("bills"), goals: z.array(z.string().max(100)).max(20),
  confidence: z.enum(["full", "limited", "estimate"]),
  options: z.array(z.object({ id: z.enum(OPTION_IDS), label: z.string().max(120) })).min(1).max(6),
});
const VerdictExplanation = z.object({
  sentence: z.string().describe("One or two short sentences explaining the verdict."),
  recommended: z.enum(OPTION_IDS).describe("The single best next step; must be one of the provided options."),
  category: z.string().describe("A short purchase category such as electronics, clothing, food, travel, or entertainment."),
});
const VERDICT_PROMPT = `You are Polaris, the assistant in NorthStar, a money app for students. The app has already decided whether a purchase is safe ("safe"), tight ("tight"), or not safe yet ("not-yet") from a 30-day cash forecast. You do not change that verdict.

What the facts mean: cash = checking plus savings today (savings are already counted in cash, so never say they have no savings); reserved = money the student has set aside in their savings goals (reservedName names the goal when there's only one; otherwise call it "your goals"), which is never counted as spendable, so mention that it stays untouched when it helps reassure them; lowPointBefore = the lowest balance in the next 30 days if they don't buy it, on lowPointDate; lowPointAfter = that same lowest balance if they buy it today; driver = the bill that pulls the balance down to that low point; nextIncome = the next expected deposit; safeDate = the first date buying it keeps their balance above $0; comfortableLimit / safeLimit = the most they could spend today and stay "safe" / stay above $0.

Write one or two short, plain sentences that explain the verdict to the student, naming the main reason. mainReason says what pulls the balance down most: "bills" means the bill that makes money tight (driver) and, if the verdict is "not-yet", when it becomes safe (safeDate) or the next paycheck. Keep it under 40 words. Speak directly ("you"). Never mention field names (like "driver" or "lowPointAfter"); if driver is null, simply don't mention a bill. Use only the numbers and dates in the facts; round dollars to whole numbers; never compute new amounts. Do not lecture or moralize, and do not give investment or credit advice.

Only mention a cheaper version or the comfortableLimit amount if "cheaper-option" is one of the options; otherwise don't suggest a cheaper version at all.

Then pick the single best next step from the provided options, considering the student's goals, and give a short category for the item.`;

app.post("/api/safe-to-spend/explain", async (req, res) => {
  const parsed = VerdictFactsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send the verdict facts computed by the app." });
    return;
  }
  const facts = parsed.data as VerdictFacts;
  const fallback = { sentence: templateSentence(facts), recommended: facts.options[0].id, category: null, source: "template" };
  try {
    const response = await getClient().beta.messages.parse({
      // Fast and inexpensive: the verdict is already decided, this only explains it.
      model: "claude-haiku-5-5",
      max_tokens: 400,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: betaZodOutputFormat(VerdictExplanation) },
      system: VERDICT_PROMPT,
      messages: [{ role: "user", content: `Facts:\n${JSON.stringify(facts)}` }],
    });
    const out = response.parsed_output;
    if (response.stop_reason === "refusal" || !out) {
      res.json(fallback);
      return;
    }
    // The model may only pick an option the app offered and only cite numbers from the facts.
    const recommended = facts.options.some((o) => o.id === out.recommended) ? out.recommended : facts.options[0].id;
    const honest = sentenceMatchesFacts(out.sentence, facts);
    if (!honest) console.warn("Safe-to-Spend: AI sentence cited numbers outside the facts; using template");
    res.json({ sentence: honest ? out.sentence.trim() : fallback.sentence, recommended, category: out.category.trim().toLowerCase().slice(0, 40), source: honest ? "ai" : "template" });
  } catch (err) {
    // The verdict never depends on the AI: answer with the template on any failure.
    if (err instanceof Anthropic.APIError) console.error("Safe-to-Spend explain error", err.status, err.message);
    else console.error("Safe-to-Spend explain error", err instanceof Error ? err.message : err);
    res.json(fallback);
  }
});

// ---------- Savings plan: Polaris turns real spending into a plan for a purchase ----------
const PlanRequest = z.object({
  item: z.string().trim().min(1).max(80),
  price: z.number().finite().positive().max(10_000_000),
  hourlyWage: z.number().finite().positive().max(1_000).nullable().default(null),
  goals: z.array(z.object({ target: z.number().finite().nonnegative(), saved: z.number().finite(), weekly: z.number().finite().nonnegative() })).max(30).default([]),
  budget: z.object({ monthlyIncome: z.number().finite().nonnegative(), monthlySpending: z.number().finite().nonnegative() }).optional(),
});
const PlanProposal = z.object({
  summary: z.string().describe("One or two plain sentences framing the plan. No dollar amounts or dates."),
  cuts: z.array(z.object({
    leverId: z.string().describe("The id of one lever from the facts."),
    action: z.string().describe("A short, specific action, e.g. 'Make coffee at home on weekdays'. No dollar amounts."),
    monthlySavings: z.number().describe("Realistic dollars per month this saves; a part of that lever's monthly amount."),
  })).describe("2 to 4 cuts, each from a different lever."),
  earn: z.array(z.object({
    action: z.string().describe("A realistic way for a college student to earn more. No dollar amounts."),
    monthlyAmount: z.number().describe("Conservative extra dollars per month."),
  })).describe("1 or 2 ideas."),
});
const PLAN_PROMPT = `You are Polaris, the savings coach in NorthStar, a money app for college students. A student wants something they can't afford yet. Build a realistic plan to save for it from their actual spending.

The facts are monthly averages the app measured from their transactions: monthlyIncome (take-home pay), monthlyBills (repeating bills), monthlyEveryday (other spending), monthlyGoalSavings (already promised to other goals), and monthlyLeftover (what's left after all of that). levers are the places money could come from: spending categories, merchants they visit often, and subscriptions, each with its monthly amount.

Choose 2 to 4 cuts from the levers, using their ids, and favor the ones that matter most. Each cut's monthlySavings must be a realistic part of that lever's monthly amount: usually 20 to 50 percent for food, shopping, or rides, and up to 100 percent only for a subscription they could cancel or downgrade. Don't pick a merchant and its whole category together. Make each action specific to how they actually spend (for a coffee shop visited often: "Make coffee at home on weekdays").

Suggest 1 or 2 realistic ways for a student to earn more: an extra shift (based on hourlyWage when given), selling things they no longer use, tutoring, or a campus job. Keep the monthly amounts conservative.

summary: one or two plain, encouraging sentences specific to the item. When there's a realistic way to pay less for the same thing, mention it: student or education pricing and refurbished models for computers and tablets, a used car instead of a new one. Don't suggest a version so cheap it wouldn't do the job. Never shame or lecture.

Never write dollar amounts or dates in the summary or actions: the app shows the checked numbers. No investment or credit advice.`;

app.post("/api/savings-plan", async (req, res) => {
  const parsed = PlanRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send the item, its price, and your goals." });
    return;
  }
  const { item, price, hourlyWage, goals, budget } = parsed.data;
  try {
    const dashboard = plaidConfigured ? await loadDashboardData() : { accounts: [], transactions: [] };
    if (!dashboard.transactions.length && !budget?.monthlyIncome) {
      res.status(422).json({ error: "Connect a bank account or fill in your Budget so Polaris has something to plan from." });
      return;
    }
    const today = todayISO();
    const facts = planFacts({ item, price, transactions: dashboard.transactions, accounts: dashboard.accounts, goals, hourlyWage, budget, today });
    const fallback = () => ({ ...buildPlan(facts, templateProposal(facts), today), source: "template" as const });
    try {
      const response = await getClient().beta.messages.parse({
        // Haiku: the app computes every number and checks the plan (buildPlan), so the model only picks cuts.
        model: "claude-haiku-5-5",
        max_tokens: 4000,
        output_config: { effort: "low", format: betaZodOutputFormat(PlanProposal) },
        system: PLAN_PROMPT,
        messages: [{ role: "user", content: `Facts:\n${JSON.stringify({ ...facts, groupCaps: undefined })}` }],
      });
      const out = response.parsed_output;
      if (response.stop_reason === "refusal" || !out) {
        res.json(fallback());
        return;
      }
      const plan = buildPlan(facts, out, today);
      // A plan with no usable moves isn't a plan: fall back to the template's.
      res.json(plan.cuts.length || plan.earn.length ? { ...plan, source: "ai" } : fallback());
    } catch (err) {
      if (err instanceof Anthropic.APIError) console.error("Savings plan error", err.status, err.message);
      else console.error("Savings plan error", err instanceof Error ? err.message : err);
      res.json(fallback());
    }
  } catch (err) {
    console.error("Savings plan data error", err instanceof Error ? err.message : err);
    res.status(502).json({ error: "Couldn't load your transactions. Try again in a moment." });
  }
});

app.post("/api/scan", async (req, res) => {
  const image: unknown = req.body?.image;
  const match = typeof image === "string" ? image.match(/^data:(image\/[a-z]+);base64,(.+)$/) : null;
  if (!match || !ALLOWED.includes(match[1] as MediaType)) {
    res.status(400).json({ error: "Send a JPEG, PNG, WebP or GIF image." });
    return;
  }

  try {
    const response = await getClient().beta.messages.parse({
      // Haiku 5.5 reads price tags and receipts at a fraction of Opus's cost. (Haiku has no
      // server-side refusal fallback; a refusal falls through to "type the price" below.)
      model: "claude-haiku-5-5",
      max_tokens: 4000,
      output_config: { effort: "low", format: betaZodOutputFormat(ScanResult) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: match[1] as MediaType, data: match[2] } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      res.status(422).json({ error: "Couldn't read a price from that image. Try another photo or type the price." });
      return;
    }
    res.json(response.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: "Invalid API key. Check ANTHROPIC_API_KEY in .env." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Rate limited. Wait a moment and try again." });
    } else if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      res.status(502).json({ error: `Claude API error (${err.status ?? "network"}).` });
    } else {
      console.error(err);
      const msg = err instanceof Error && /api ?key|auth/i.test(err.message)
        ? "No API key found. Add ANTHROPIC_API_KEY to a .env file and restart."
        : "Scan failed. Type the price instead.";
      res.status(500).json({ error: msg });
    }
  }
});

// On Vercel the app runs as a serverless function (api/index.ts imports it); locally it listens on a port.
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT ?? 8787);
  // Save a net-worth point each day the server is running (checked hourly), not just when the app is opened.
  startDailySnapshots();
  // 127.0.0.1 only: other devices on the same Wi-Fi can't reach your bank data.
  app.listen(PORT, "127.0.0.1", () => console.log(`Scan API on http://127.0.0.1:${PORT}`));
}

export default app;
