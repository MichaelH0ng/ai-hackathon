import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadDashboardData, plaidConfigured, plaidRouter } from "./plaid.ts";

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
    .max(12)
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

function financialContext(data: Awaited<ReturnType<typeof loadDashboardData>>, goals: z.infer<typeof ChatRequest>["goals"]) {
  const accounts = data.accounts.map(({ id, ...account }) => ({ id, ...account }));
  const accountNames = new Map(accounts.map((a) => [a.id, `${a.institution} — ${a.name}`]));
  // Recent, posted transactions are the most useful source for time-based questions.
  // The cap keeps every request bounded even with a long-lived account connection.
  const transactions = data.transactions
    .filter((t) => !t.pending)
    .slice(0, 500)
    .map(({ id: _id, accountId, ...transaction }) => ({ ...transaction, account: accountNames.get(accountId) ?? "Unknown account" }));

  return JSON.stringify({
    asOf: data.fetchedAt,
    conventions: { plaidAmount: "positive means money out; negative means money in" },
    accounts,
    moneyGoals: goals,
    postedTransactions: transactions,
    dataStatus: data.status,
  });
}

const FINANCE_SYSTEM_PROMPT = `You are the in-app financial data assistant for TradeOff. Answer the user's question using only the current financial context supplied below. Do not invent transactions, interest, balances, rates, or dates.

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
    const response = await getClient().messages.create({
      model: "claude-opus-5-5",
      max_tokens: 1_000,
      system: `${FINANCE_SYSTEM_PROMPT}\n\nCURRENT FINANCIAL CONTEXT:\n${financialContext(dashboard, parsed.data.goals)}`,
      messages: [...parsed.data.history, { role: "user", content: parsed.data.question }],
    });
    const answer = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!answer) {
      res.status(502).json({ error: "The financial assistant didn't return an answer. Please try again." });
      return;
    }
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
