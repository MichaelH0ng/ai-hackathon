import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadDashboardData, plaidConfigured, plaidRouter } from "./plaid.ts";
import { detectTransferIds, isTransfer, upcomingBills } from "../src/lib/money.ts";

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
});

type ChatData = Awaited<ReturnType<typeof loadDashboardData>>;
type DateRange = { label: string; start: string; endExclusive?: string };

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function transactionRange(question: string, now = new Date()): DateRange {
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

function financialContext(data: ChatData, goals: z.infer<typeof ChatRequest>["goals"], range: DateRange) {
  // Only send fields useful for answering a question. IDs and account masks never
  // need to leave this server, and removing them trims every model request.
  const accountNames = new Map(data.accounts.map((a) => [a.id, `${a.institution} — ${a.name}`]));
  const accounts = data.accounts.map(({ institution, name, type, subtype, current, available }) => ({ institution, name, type, subtype, current, available }));
  const transactions = selectedTransactions(data, range)
    .filter((t) => !t.pending)
    .map(({ id: _id, accountId, ...transaction }) => ({ ...transaction, account: accountNames.get(accountId) ?? "Unknown account" }));

  return JSON.stringify({
    asOf: data.fetchedAt,
    transactionWindow: range.label,
    conventions: { plaidAmount: "positive means money out; negative means money in" },
    accounts,
    moneyGoals: goals,
    postedTransactions: transactions,
    dataStatus: data.status,
  });
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function instantAnswer(question: string, data: ChatData, goals: z.infer<typeof ChatRequest>["goals"]): string | null {
  const text = question.toLowerCase();
  const range = transactionRange(question);
  const transactions = selectedTransactions(data, range).filter((transaction) => !transaction.pending);
  const transferIds = detectTransferIds(data.transactions);

  if (/\b(recurring|subscription|subscriptions)\b/.test(text) || /\b(upcoming|next)\b.*\bbills?\b|\bbills?\b.*\b(upcoming|next)\b/.test(text)) {
    const allBills = upcomingBills(data.transactions.filter((transaction) => !transaction.pending), transferIds);
    const nextThirtyDays = allBills.filter((bill) => bill.daysUntil >= 0 && bill.daysUntil <= 30);
    const bills = /\b(next month|next 30 days|coming month)\b/.test(text) ? nextThirtyDays : allBills.slice(0, 6);
    if (!bills.length) {
      return "I couldn't identify recurring bills from your posted transaction history yet. NorthStar needs at least two similarly priced charges from the same merchant on a regular schedule before it projects a bill.\n\nInformational only—not financial advice.";
    }
    const projected = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const detail = bills.map((bill) => `• ${bill.name}: about ${money.format(bill.amount)} (${bill.cadence.toLowerCase()}; expected ${bill.nextDue}, in ${bill.daysUntil} day${bill.daysUntil === 1 ? "" : "s"})`).join("\n");
    return `Here are the recurring charges NorthStar projects${bills === nextThirtyDays ? " in the next 30 days" : " next"}:\n${detail}\n\nExpected next charges total about ${money.format(projected)}. These are projections based on repeated posted transactions, so a merchant's billing date or amount can change. Informational only—not financial advice.`;
  }

  if (/\b(net worth|how much (money|cash).*(have|do i have)|total (balance|balances)|account balances?)\b/.test(text)) {
    let assets = 0;
    let debts = 0;
    for (const account of data.accounts) {
      if (account.type === "credit" || account.type === "loan") debts += account.current;
      else assets += account.current;
    }
    const cash = data.accounts
      .filter((account) => account.type === "depository" && (account.subtype === "checking" || account.subtype === "savings"))
      .reduce((sum, account) => sum + (account.available ?? account.current), 0);
    return `Based on your current connected-account balances, you have ${money.format(assets)} in assets and ${money.format(debts)} in credit-card and loan balances, for an estimated net worth of ${money.format(assets - debts)}. Spendable checking and savings cash is ${money.format(cash)}.\n\nThis uses current balances, not a credit report or a complete net-worth statement. Informational only—not financial advice.`;
  }

  if (/\b(spent|spending|spend)\b/.test(text) && /\b(how much|what|where|categories?|on)\b/.test(text)) {
    const spending = transactions.filter((transaction) => transaction.amount > 0 && !isTransfer(transaction, transferIds));
    const total = spending.reduce((sum, transaction) => sum + transaction.amount, 0);
    const categories = new Map<string, number>();
    for (const transaction of spending) categories.set(transaction.category, (categories.get(transaction.category) ?? 0) + transaction.amount);
    const biggest = [...categories.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([category, amount]) => `${category.toLowerCase().replace(/_/g, " ")} (${money.format(amount)})`);
    return `You had ${money.format(total)} in posted spending during ${range.label}, excluding transfers and loan/card payments.${biggest.length ? ` Largest categories: ${biggest.join(", ")}.` : ""}\n\nInformational only—not financial advice.`;
  }

  if (/\b(goal|goals|how close|saving for|savings progress)\b/.test(text) && goals.length) {
    const progress = goals.map((goal) => {
      const remaining = Math.max(0, goal.target - goal.saved);
      const percent = goal.target ? Math.min(100, (goal.saved / goal.target) * 100) : 100;
      const timing = remaining === 0 ? "You are fully funded." : goal.weekly > 0 ? `At ${money.format(goal.weekly)}/week, about ${Math.ceil(remaining / goal.weekly)} week${Math.ceil(remaining / goal.weekly) === 1 ? "" : "s"} remain.` : "Add a weekly savings amount to estimate a finish date.";
      return `• ${goal.name}: ${money.format(goal.saved)} of ${money.format(goal.target)} (${percent.toFixed(0)}%), with ${money.format(remaining)} remaining. ${timing}`;
    });
    return `Here is your current goal progress:\n${progress.join("\n")}\n\nCalculated from the savings goals in NorthStar. Informational only—not financial advice.`;
  }

  if (/\b(interest|apy)\b/.test(text)) {
    const accountNames = new Map(data.accounts.map((account) => [account.id, `${account.institution} — ${account.name}`]));
    const interest = transactions.filter((transaction) => transaction.amount < 0 && /\binterest\b|\bapy\b/i.test(transaction.name));
    if (!interest.length) return `I couldn't find any posted transactions explicitly labeled interest or APY during ${range.label}. I don't infer interest from balance changes.\n\nInformational only—not financial advice.`;
    const byAccount = new Map<string, number>();
    for (const transaction of interest) {
      const name = accountNames.get(transaction.accountId) ?? "Unknown account";
      byAccount.set(name, (byAccount.get(name) ?? 0) + Math.abs(transaction.amount));
    }
    const total = [...byAccount.values()].reduce((sum, value) => sum + value, 0);
    const detail = [...byAccount.entries()].map(([name, amount]) => `• ${name}: ${money.format(amount)}`).join("\n");
    return `I found ${money.format(total)} in posted interest during ${range.label}:\n${detail}\n\nThis excludes dividends and anything not explicitly labeled interest or APY. Informational only—not financial advice.`;
  }

  if (/\b(made|earned|income|money came in|money in|inflow|inflows|deposits)\b/.test(text)) {
    const inflows = transactions.filter((transaction) => transaction.amount < 0 && !isTransfer(transaction, transferIds));
    const total = inflows.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    const largest = [...inflows].sort((a, b) => a.amount - b.amount).slice(0, 3).map((transaction) => `${transaction.name} (${money.format(Math.abs(transaction.amount))})`);
    return `You had ${money.format(total)} in posted inflows during ${range.label}${largest.length ? `. Largest entries: ${largest.join(", ")}.` : "."}\n\nThis is posted money in, excluding transactions categorized as transfers or loan payments; it is not necessarily wages or investment return. Informational only—not financial advice.`;
  }
  return null;
}

function needsDeeperReasoning(question: string) {
  return /\b(why|recommend|should i|plan|strategy|forecast|budget|prioriti[sz]e|compare|trade[- ]?off|risk|optimi[sz]e|analy[sz]e|explain)\b/i.test(question);
}

const FINANCE_SYSTEM_PROMPT = `You are the in-app financial data assistant for NorthStar. Answer the user's question using only the current financial context supplied below. Do not invent transactions, interest, balances, rates, or dates.

Be direct and show the calculation or the specific transactions/accounts you used whenever a number matters. Plaid transaction amounts use a positive number for money out and a negative number for money in. Treat transfers, card payments, and pending transactions carefully; do not count them as earnings unless the data clearly supports that. For questions about "money made," explain whether you are reporting posted inflows, net cash flow, or something else. For interest, report only transactions whose description clearly identifies interest; do not infer it from a balance change. Explain when the available data cannot answer the question.

You can explain the user's savings-goal progress and math, but do not give personalized investment, tax, legal, or credit advice. Keep answers under 250 words unless the user asks for a breakdown. End with a brief reminder that this is informational, not financial advice.`;

app.post("/api/financial-chat", async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send a question and valid chat context." });
    return;
  }
  if (!plaidConfigured) {
    res.status(503).json({ error: "Connect Plaid first by adding PLAID_CLIENT_ID and PLAID_SECRET to .env." });
    return;
  }

  try {
    // Fresh Plaid data is loaded for every question; credentials and access tokens stay on this server.
    const dashboard = await loadDashboardData();
    if (!dashboard.accounts.length && !dashboard.transactions.length) {
      res.status(422).json({ error: "No connected account data is available yet. Connect a bank, then try again." });
      return;
    }
    const computed = instantAnswer(parsed.data.question, dashboard, parsed.data.goals);
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
      max_tokens: model === "claude-sonnet-5-5" ? 500 : 350,
      system: `${FINANCE_SYSTEM_PROMPT}\n\nCURRENT FINANCIAL CONTEXT:\n${financialContext(dashboard, parsed.data.goals, range)}`,
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
