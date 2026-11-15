import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadDashboardData, plaidConfigured, plaidRouter } from "./plaid.ts";
import { detectTransferIds, isTransfer, upcomingBills } from "../src/lib/money.ts";
import { sentenceMatchesFacts, templateSentence, type VerdictFacts } from "../src/lib/safeToSpendExplain.ts";
import { categoryLabel, comparisonPeriods, goalFinishDate, hasUnmatchedSubject, inRange, matchCategory, matchGoal, matchMerchant, rollingRange, windowTotals, explicitRange, followUpQuestion, type DateRange } from "./assistantData.ts";
import { shortDate } from "../src/lib/safeToSpendExplain.ts";
import { recurring } from "../src/lib/safeToSpend.ts";
import { todayISO } from "../src/lib/dates.ts";
import { buildPlan, planFacts, templateProposal } from "./savingsPlan.ts";

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

function transactionRange(question: string, now = new Date()): DateRange {
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
  if (/\b(last|past) year\b|\b12 months\b/.test(text)) return { label: "the last 12 months", start: day(-365), endExclusive: day(1) };
  // Most questions are about recent activity. A smaller default window keeps each
  // AI request focused and inexpensive; users can still ask for a specific period.
  return { label: "the last 30 days", start: day(-29), endExclusive: day(1) };
}

function selectedTransactions(data: ChatData, range: DateRange) {
  return data.transactions.filter((transaction) => transaction.date >= range.start && (!range.endExclusive || transaction.date < range.endExclusive)).slice(0, 500);
}

function financialContext(data: ChatData, goals: z.infer<typeof ChatRequest>["goals"], range: DateRange, planning?: z.infer<typeof ChatRequest>["planning"], question = "") {
  // Only send fields useful for answering a question. IDs and account masks never
  // need to leave this server, and removing them trims every model request.
  const accountNames = new Map(data.accounts.map((a) => [a.id, `${a.institution} — ${a.name}`]));
  const accounts = data.accounts.map(({ institution, name, type, subtype, current, available }) => ({ institution, name, type, subtype, current, available }));
  const transactions = selectedTransactions(data, range)
    .filter((t) => !t.pending)
    .map(({ id: _id, accountId, ...transaction }) => ({ ...transaction, account: accountNames.get(accountId) ?? "Unknown account" }));

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
    projectedRecurringBills: upcomingBills(data.transactions.filter((t) => !t.pending), transferIds)
      .slice(0, 8)
      .map(({ name, amount, cadence, nextDue, daysUntil }) => ({ name, amount: Math.round(amount * 100) / 100, cadence, nextDue, daysUntil })),
    conventions: { plaidAmount: "positive means money out; negative means money in" },
    accounts,
    moneyGoals: goals.map((goal) => ({ ...goal, projectedFinish: goalFinishDate(goal) })),
    // Everything the user sees in the app, including manually entered accounts and budget.
    // Prefer appAccounts/netWorth here for totals; `accounts` above adds Plaid detail for connected ones.
    appPlan: planning ?? null,
    postedTransactions: transactions,
    dataStatus: data.status,
  });
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** Cents only when there are cents ($350, $412.50), matching the app's formatExact. */
const exact = (n: number) => money.format(n).replace(/\.00$/, "");

function instantAnswer(question: string, data: ChatData, goals: z.infer<typeof ChatRequest>["goals"], hasManualAccounts = false): string | null {
  const text = question.toLowerCase();
  const range = transactionRange(question);
  const transactions = selectedTransactions(data, range).filter((transaction) => !transaction.pending);
  const transferIds = detectTransferIds(data.transactions);
  // Asked about a period before the history starts: say so instead of answering about a different period.
  const earliest = data.transactions.reduce((min, t) => (t.date < min ? t.date : min), "9999-12-31");
  const noDataFor = !transactions.length && data.transactions.length && range.start < earliest
    ? `I don't have any transactions for ${range.label}. Your history in NorthStar starts ${shortDate(earliest)}, ${earliest.slice(0, 4)}.`
    : null;

  if (/\b(recurring|subscription|subscriptions)\b/.test(text) || /\b(upcoming|next)\b.*\bbills?\b|\bbills?\b.*\b(upcoming|next)\b/.test(text)) {
    const allBills = upcomingBills(data.transactions.filter((transaction) => !transaction.pending), transferIds);
    const nextThirtyDays = allBills.filter((bill) => bill.daysUntil >= 0 && bill.daysUntil <= 30);
    const bills = /\b(next month|next 30 days|coming month)\b/.test(text) ? nextThirtyDays : allBills.slice(0, 6);
    if (!bills.length) {
      return "I couldn't identify recurring bills from your posted transaction history yet. NorthStar needs at least two similarly priced charges from the same merchant on a regular schedule before it projects a bill.";
    }
    const projected = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const detail = bills.map((bill) => `• ${bill.name}: about ${money.format(bill.amount)} (${bill.cadence.toLowerCase()}; expected ${bill.nextDue}, in ${bill.daysUntil} day${bill.daysUntil === 1 ? "" : "s"})`).join("\n");
    return `Here are the recurring charges NorthStar projects${bills === nextThirtyDays ? " in the next 30 days" : " next"}:\n${detail}\n\nExpected next charges total about ${money.format(projected)}. These are projections based on repeated posted transactions, so a merchant's billing date or amount can change.`;
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
    const cash = data.accounts
      .filter((account) => account.type === "depository" && (account.subtype === "checking" || account.subtype === "savings"))
      .reduce((sum, account) => sum + (account.available ?? account.current), 0);
    return `Based on your current connected-account balances, you have ${money.format(assets)} in assets and ${money.format(debts)} in credit-card and loan balances, for an estimated net worth of ${money.format(assets - debts)}. Spendable checking and savings cash is ${money.format(cash)}.\n\nThis uses current balances, not a credit report or a complete net-worth statement.`;
  }

  if (noDataFor && /\b(spent|spend|spnd|spending|earn|earned|made|income|money|cash ?flow|positive|negative)\b/.test(text)) return noDataFor;

  if (/\b(am i|are we|was i|were we|i'?m) (positive|negative|in the (red|green)|ahead|behind|up|down)\b|\bnet (cash ?flow|income|change)\b|\bcash ?flow\b|\b(more|less) than i (spent|spend|made|make|earned|earn)\b|\b(spent|spend) more than i\b/.test(text)) {
    const totals = windowTotals(transactions, transferIds);
    const lastDay = range.endExclusive ? shortDate(new Date(Date.parse(range.endExclusive) - 86_400_000).toISOString().slice(0, 10)) : "today";
    const net = totals.netCashFlow;
    // "Did I spend more than I made?" and "am I in the red?" are yes when net is negative.
    const askedNegative = /\b(am i|are we|was i|were we|i'?m) (negative|in the red|behind|down)\b|\b(spent|spend) more than i\b|\b(made|make|earned|earn) less than i\b/.test(text);
    const verdict = net === 0 ? "You broke even" : (askedNegative ? net < 0 : net > 0) ? "Yes" : "No";
    const outcome = net > 0 ? `so you're up ${exact(net)}` : net < 0 ? `so you're down ${exact(-net)}` : "so you broke even";
    const period = range.label === "this month" ? "So far this month" : range.label === "this week" ? "So far this week" : range.label === "last calendar month" ? "Last month" : range.label === "last calendar week" ? "Last week" : `Over ${range.label}`;
    const biggest = totals.spendingByMerchant[0];
    // Only lead with yes/no when the question asks one ("am I…", "did I…"), not for "what is my cash flow".
    const yesNo = /\b(am i|are we|was i|were we|did i|do i|have i|i'?m)\b/.test(text);
    return `${yesNo ? `${verdict}. ` : ""}${period} (${shortDate(range.start)}–${lastDay}), ${exact(totals.inflowTotal)} came in and ${exact(totals.spendingTotal)} went out, ${outcome}.${biggest && net < 0 ? ` The biggest expense was ${biggest.merchant} (${exact(biggest.total)}).` : ""}`;
  }

  if (/\b(spent|spending|spend|spnd)\b/.test(text) && /\b(how much|what|where|categories?|on|at)\b/.test(text)) {
    // Two-period comparisons go to the model, which gets exact totals for both periods.
    if (comparisonPeriods(question)) return null;
    const spending = transactions.filter((transaction) => transaction.amount > 0 && !isTransfer(transaction, transferIds));
    const merchant = matchMerchant(question, data.transactions.filter((t) => t.amount > 0));
    const category = merchant ? null : matchCategory(question);
    // "On coffee", "for clothes": narrower than a category we can match exactly, so let the model look.
    if (!merchant && !category && hasUnmatchedSubject(question)) return null;
    const count = (n: number) => `${n} purchase${n === 1 ? "" : "s"}`;
    if (merchant) {
      const matched = spending.filter((t) => t.name === merchant);
      const total = matched.reduce((sum, t) => sum + t.amount, 0);
      return `You spent ${money.format(total)} at ${merchant} during ${range.label} (${count(matched.length)}).`;
    }
    if (category) {
      const matched = spending.filter((t) => t.category === category);
      const total = matched.reduce((sum, t) => sum + t.amount, 0);
      const byMerchant = new Map<string, number>();
      for (const t of matched) byMerchant.set(t.name, (byMerchant.get(t.name) ?? 0) + t.amount);
      const top = [...byMerchant].sort(([, x], [, y]) => y - x).slice(0, 3).map(([name, amount]) => `${name} (${money.format(amount)})`);
      return `You spent ${money.format(total)} on ${categoryLabel(category)} during ${range.label} (${count(matched.length)}).${top.length ? ` Biggest: ${top.join(", ")}.` : ""}`;
    }
    const total = spending.reduce((sum, transaction) => sum + transaction.amount, 0);
    const categories = new Map<string, number>();
    for (const transaction of spending) categories.set(transaction.category, (categories.get(transaction.category) ?? 0) + transaction.amount);
    const biggest = [...categories.entries()]
      .sort(([, x], [, y]) => y - x)
      .slice(0, 3)
      .map(([cat, amount]) => `${categoryLabel(cat)} (${money.format(amount)})`);
    return `You had ${money.format(total)} in posted spending during ${range.label}, excluding transfers and loan/card payments.${biggest.length ? ` Largest categories: ${biggest.join(", ")}.` : ""}`;
  }

  if (/\b(goal|goals|how close|saving for|savings progress)\b/.test(text) && goals.length) {
    const describe = (goal: (typeof goals)[number]) => {
      const remaining = Math.max(0, goal.target - goal.saved);
      const percent = goal.target ? Math.min(100, (goal.saved / goal.target) * 100) : 100;
      const finish = goalFinishDate(goal);
      const weeks = goal.weekly > 0 ? Math.ceil(remaining / goal.weekly) : 0;
      const timing = remaining === 0 ? "It's fully funded." : finish ? `At ${money.format(goal.weekly)}/week, that's about ${weeks} week${weeks === 1 ? "" : "s"}, so around ${finish}.` : "Add a weekly savings amount to estimate a finish date.";
      return `${goal.name}: ${money.format(goal.saved)} of ${money.format(goal.target)} saved (${percent.toFixed(0)}%), ${money.format(remaining)} to go. ${timing}`;
    };
    const named = matchGoal(question, goals);
    if (named) return describe(named);
    return `Here's where your goals stand:\n${goals.map((goal) => `• ${describe(goal)}`).join("\n")}`;
  }

  if (/\b(interest|apy)\b/.test(text)) {
    const accountNames = new Map(data.accounts.map((account) => [account.id, `${account.institution} — ${account.name}`]));
    const interest = transactions.filter((transaction) => transaction.amount < 0 && /\binterest\b|\bapy\b/i.test(transaction.name));
    if (!interest.length) return `I couldn't find any posted transactions explicitly labeled interest or APY during ${range.label}. I don't infer interest from balance changes.`;
    const byAccount = new Map<string, number>();
    for (const transaction of interest) {
      const name = accountNames.get(transaction.accountId) ?? "Unknown account";
      byAccount.set(name, (byAccount.get(name) ?? 0) + Math.abs(transaction.amount));
    }
    const total = [...byAccount.values()].reduce((sum, value) => sum + value, 0);
    const detail = [...byAccount.entries()].map(([name, amount]) => `• ${name}: ${money.format(amount)}`).join("\n");
    return `I found ${money.format(total)} in posted interest during ${range.label}:\n${detail}\n\nThis excludes dividends and anything not explicitly labeled interest or APY.`;
  }

  if (/\b(made|make|earn|earned|income|money came in|money in|inflow|inflows|deposits|received|did i get|have i gotten|get paid|got paid)\b/.test(text)) {
    const inflows = transactions.filter((transaction) => transaction.amount < 0 && !isTransfer(transaction, transferIds));
    const total = inflows.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    const largest = [...inflows].sort((a, b) => a.amount - b.amount).slice(0, 3).map((transaction) => `${transaction.name} (${money.format(Math.abs(transaction.amount))})`);
    return `You had ${money.format(total)} in posted inflows during ${range.label}${largest.length ? `. Largest entries: ${largest.join(", ")}.` : "."}\n\nThis is posted money in, excluding transactions categorized as transfers or loan payments; it is not necessarily wages or investment return.`;
  }
  return null;
}

function needsDeeperReasoning(question: string) {
  return /\b(why|recommend|should i|plan|strategy|forecast|budget|prioriti[sz]e|compare|trade[- ]?off|risk|optimi[sz]e|analy[sz]e|explain)\b/i.test(question);
}

const FINANCE_SYSTEM_PROMPT = `You are Polaris, the in-app financial assistant in NorthStar. Use the current financial context below for claims about the user. You may use general financial knowledge to explain investing concepts. Do not invent transactions, interest, balances, rates, or dates.

Use conversation history to interpret replies to your own clarification questions. Acknowledge the facts the user supplied, use them to answer the original question, and ask only for information that is still missing. Treat corrections as replacing earlier statements. Do not infer units, account type, tax eligibility, or risk tolerance from ambiguous replies such as "yes" or a bare number; ask a concise clarification. Distinguish user-stated assumptions from dashboard facts. Follow explicit topic changes instead of forcing the previous topic. If history is insufficient, say what context you need rather than inventing it.

Be direct: name the key figures behind a number (totals, the biggest item), not every transaction. Plaid transaction amounts use a positive number for money out and a negative number for money in. Treat transfers, card payments, and pending transactions carefully; do not count them as earnings unless the data clearly supports that. For questions about "money made," explain whether you are reporting posted inflows, net cash flow, or something else. For interest, report only transactions whose description clearly identifies interest; do not infer it from a balance change. Explain when the available data cannot answer the question.

Explain and compare US retirement and tax-advantaged accounts when asked: traditional and Roth IRAs, traditional and Roth 401(k)s, 403(b)s, governmental versus nongovernmental 457(b)s, SEP/SIMPLE IRAs, solo 401(k)s, HSAs, health FSAs, and 529 plans. Cover purpose, eligibility, federal contribution and withdrawal tax treatment, access restrictions, and relevant trade-offs. Distinguish account structures from their underlying investments. Do not infer eligibility from a dashboard balance. Do not quote unverified annual contribution limits, income thresholds, or deadlines; explain that a live tax-rule lookup is unavailable and direct users to the applicable tax-year IRS guidance and plan documents. Mention state treatment may differ.

Give useful investment education and planning options: explain diversified low-cost funds, stocks versus bonds, fees, regular contributions, and retirement versus taxable accounts. Connect options to the supplied budget and goals, clearly distinguishing recorded facts from assumptions. Before suggesting an allocation or contribution amount, ask about missing time horizon, cash reserves, debt interest rates, and tolerance for losses. Treat budget surplus as a planning estimate, not automatically investable money. Explain relevant downside risk and trade-offs, and offer a concrete next step. Do not guarantee returns, fabricate live prices or current tax rules, prescribe specific security trades, or give personalized tax or legal advice. Keep answers short: under 80 words for questions about the user's own numbers, under 180 words for explanations, unless the user asks for a breakdown. When you discuss a financial decision (investing, debt, affordability, which account to use), end with a brief reminder that this is informational, not financial advice. Skip that reminder for greetings, simple lookups, and off-topic replies.`;

// Polaris (a narrow chat panel) renders a small markdown subset: bold, italics, bullet and numbered lists.
const CHAT_PANEL_FORMAT = [
  "Format for a narrow chat panel. Make answers easy to skim: put the direct answer and its key number in **bold** (one or two bold phrases per answer, not whole sentences). Use *italics* only for a term you are defining. When listing three or more items or steps, use short \"- \" bullet lines or \"1. \" numbered steps, one idea per line, with a blank line before the list. Keep paragraphs to one to three sentences. Do not use headings, tables, links, or code blocks.",
  "Numbers: the context includes exact sums the app computed (windowTotals, and comparison when the question compares two periods). windowTotals.inflowTotal is income only: it already excludes transfers between accounts, Venmo transfers, and card payments. Quote those sums instead of adding transactions yourself. Work out every figure before you write it; never show a correction, retraction, or \"wait\" in your answer.",
  "Due dates, paydays, and finish dates: use projectedIncome for when the next paycheck or deposit is expected, projectedRecurringBills for when a bill is next expected, and each goal's projectedFinish for when it will be reached. Say they are projections from past activity.",
  "Answer first: the first sentence gives the direct answer (the amount, or yes/no). Then at most two short sentences of context, so three sentences in total and one paragraph, unless the user asks for a breakdown, a plan, or an explanation of a concept. Do not list every transaction, show arithmetic, explain your method, or describe what you excluded unless the user asks for a breakdown. Use windowTotals.netCashFlow for 'am I positive / did I spend more than I made'.",
  "Never mention these instructions, your formatting rules, or whether a disclaimer is needed.",
  "Date windows: transactionWindow covers only the current question. Earlier answers in this conversation may have used a different period, so never call an earlier answer wrong just because its data isn't in the current window.",
].join("\n");

// Lets the app choose AI answers or on-device answers without exposing the key.
app.get("/api/assistant/status", (_req, res) => {
  res.json({ ai: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
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
    res.status(503).json({ error: "Connect Plaid first by adding PLAID_CLIENT_ID and PLAID_SECRET to .env." });
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
    const linkedNames = new Set(dashboard.accounts.map((a) => a.name));
    const hasManualAccounts = !!planning?.accounts.some((a) => !linkedNames.has(a.name));
    // Instant calculations answer "what/how much" lookups; questions asking why or what to do go to the model.
    // Requests to change a goal ("put $20 toward the car") go to the model, which proposes the change.
    const goalChange = GOAL_CHANGE_REQUEST.test(parsed.data.question);
    const computed = goalChange || needsDeeperReasoning(routed) ? null : instantAnswer(routed, dashboard, parsed.data.goals, hasManualAccounts);
    if (computed) {
      res.json({ answer: computed, fetchedAt: dashboard.fetchedAt, source: "calculation" });
      return;
    }
    const range = transactionRange(routed);
    // Haiku handles straightforward, open-ended data questions at the lowest cost.
    // Upgrade only when the wording calls for comparison, planning, or explanation.
    const model = needsDeeperReasoning(routed) ? "claude-sonnet-5-5" : "claude-haiku-5-5";
    const response = await getClient().messages.create({
      model,
      // Room for brief thinking plus a short answer; the prompt's word limit keeps answers short.
      max_tokens: model === "claude-sonnet-5-5" ? 3000 : 2000,
      // Adaptive thinking (the default when `thinking` is omitted) at low effort: a moment to check
      // figures before writing, so doubts don't surface as on-screen corrections. Validation showed
      // visible "let me correct this" answers with thinking turned off.
      output_config: { effort: "low" },
      tools: [GOAL_CHANGE_TOOL],
      system: `${FINANCE_SYSTEM_PROMPT}\n\n${CHAT_PANEL_FORMAT}\n\n${GOAL_CHANGE_INSTRUCTIONS}\n\nCURRENT FINANCIAL CONTEXT:\n${financialContext(dashboard, parsed.data.goals, range, planning, routed)}`,
      messages: [...parsed.data.history.slice(-4), { role: "user", content: parsed.data.question }],
    });
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
    res.json({ answer, fetchedAt: dashboard.fetchedAt });
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
        model: "claude-sonnet-5-5",
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
      model: "claude-opus-5-5",
      max_tokens: 4000,
      // If a safety classifier declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
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

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`Scan API on http://localhost:${PORT}`));
