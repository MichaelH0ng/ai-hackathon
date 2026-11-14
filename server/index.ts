import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { plaidRouter } from "./plaid.ts";

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
