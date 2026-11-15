import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadDashboardData, plaidConfigured, plaidRouter } from "./plaid.ts";
import { detectTransferIds, isTransfer, upcomingBills } from "../src/lib/money.ts";
import { categoryLabel, comparisonPeriods, goalFinishDate, hasUnmatchedSubject, inRange, matchCategory, matchGoal, matchMerchant, windowTotals, type DateRange } from "./assistantData.ts";

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

function instantAnswer(question: string, data: ChatData, goals: z.infer<typeof ChatRequest>["goals"], hasManualAccounts = false): string | null {
  const text = question.toLowerCase();
  const range = transactionRange(question);
  const transactions = selectedTransactions(data, range).filter((transaction) => !transaction.pending);
  const transferIds = detectTransferIds(data.transactions);

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

  if (/\b(made|earned|income|money came in|money in|inflow|inflows|deposits)\b/.test(text)) {
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

Be direct and show the calculation or the specific transactions/accounts you used whenever a number matters. Plaid transaction amounts use a positive number for money out and a negative number for money in. Treat transfers, card payments, and pending transactions carefully; do not count them as earnings unless the data clearly supports that. For questions about "money made," explain whether you are reporting posted inflows, net cash flow, or something else. For interest, report only transactions whose description clearly identifies interest; do not infer it from a balance change. Explain when the available data cannot answer the question.

Explain and compare US retirement and tax-advantaged accounts when asked: traditional and Roth IRAs, traditional and Roth 401(k)s, 403(b)s, governmental versus nongovernmental 457(b)s, SEP/SIMPLE IRAs, solo 401(k)s, HSAs, health FSAs, and 529 plans. Cover purpose, eligibility, federal contribution and withdrawal tax treatment, access restrictions, and relevant trade-offs. Distinguish account structures from their underlying investments. Do not infer eligibility from a dashboard balance. Do not quote unverified annual contribution limits, income thresholds, or deadlines; explain that a live tax-rule lookup is unavailable and direct users to the applicable tax-year IRS guidance and plan documents. Mention state treatment may differ.

Give useful investment education and planning options: explain diversified low-cost funds, stocks versus bonds, fees, regular contributions, and retirement versus taxable accounts. Connect options to the supplied budget and goals, clearly distinguishing recorded facts from assumptions. Before suggesting an allocation or contribution amount, ask about missing time horizon, cash reserves, debt interest rates, and tolerance for losses. Treat budget surplus as a planning estimate, not automatically investable money. Explain relevant downside risk and trade-offs, and offer a concrete next step. Do not guarantee returns, fabricate live prices or current tax rules, prescribe specific security trades, or give personalized tax or legal advice. Keep answers under 250 words unless the user asks for a breakdown. When you discuss a financial decision (investing, debt, affordability, which account to use), end with a brief reminder that this is informational, not financial advice. Skip that reminder for greetings, simple lookups, and off-topic replies.`;

// Answers render as plain text in Polaris, a narrow chat panel.
const CHAT_PANEL_FORMAT = [
  "Format for a narrow chat panel that shows plain text: short paragraphs and simple \"• \" bullet lines. Do not use markdown tables, headings, bold markers, or code blocks.",
  "Numbers: the context includes exact sums the app computed (windowTotals, and comparison when the question compares two periods). Quote those sums instead of adding transactions yourself. Work out every figure before you write it; never show a correction, retraction, or \"wait\" in your answer.",
  "Due dates and finish dates: use projectedRecurringBills for when a bill is next expected, and each goal's projectedFinish for when it will be reached. Say they are projections from past activity.",
  "Date windows: transactionWindow covers only the current question. Earlier answers in this conversation may have used a different period, so never call an earlier answer wrong just because its data isn't in the current window.",
].join("\n");

// Lets the app choose AI answers or on-device answers without exposing the key.
app.get("/api/assistant/status", (_req, res) => {
  res.json({ ai: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

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
    const dashboard: ChatData = plaidConfigured ? await loadDashboardData() : { env: "manual", accounts: [], transactions: [], status: [], fetchedAt: new Date().toISOString() };
    if (!dashboard.accounts.length && !dashboard.transactions.length && !planning?.accounts.length && !parsed.data.goals.length) {
      res.status(422).json({ error: "No account data is available yet. Add or connect an account, then try again." });
      return;
    }
    const linkedNames = new Set(dashboard.accounts.map((a) => a.name));
    const hasManualAccounts = !!planning?.accounts.some((a) => !linkedNames.has(a.name));
    // Instant calculations answer "what/how much" lookups; questions asking why or what to do go to the model.
    const computed = needsDeeperReasoning(parsed.data.question) ? null : instantAnswer(parsed.data.question, dashboard, parsed.data.goals, hasManualAccounts);
    if (computed) {
      res.json({ answer: computed, fetchedAt: dashboard.fetchedAt, source: "calculation" });
      return;
    }
    const range = transactionRange(parsed.data.question);
    // Haiku handles straightforward, open-ended data questions at the lowest cost.
    // Upgrade only when the wording calls for comparison, planning, or explanation.
    const model = needsDeeperReasoning(parsed.data.question) ? "claude-sonnet-5-5" : "claude-haiku-5-5";
    const response = await getClient().messages.create({
      model,
      // Headroom so answers finish; the prompt's word limit keeps them short.
      max_tokens: model === "claude-sonnet-5-5" ? 1200 : 700,
      // The five-series models otherwise enable adaptive thinking by default.
      // For a concise financial-data answer, reserve the small output budget for
      // user-visible text instead of allowing internal thinking to consume it.
      // Sonnet 5.5 rejects { type: "disabled" } with a 400; its "thinking off" mode is
      // "between_tools" (valid at effort high or below). Haiku 5.5 accepts "disabled" at low effort.
      thinking: model === "claude-sonnet-5-5" ? { type: "between_tools" } : { type: "disabled" },
      output_config: { effort: "low" },
      system: `${FINANCE_SYSTEM_PROMPT}\n\n${CHAT_PANEL_FORMAT}\n\nCURRENT FINANCIAL CONTEXT:\n${financialContext(dashboard, parsed.data.goals, range, planning, parsed.data.question)}`,
      messages: [...parsed.data.history.slice(-4), { role: "user", content: parsed.data.question }],
    });
    const answer = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
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
