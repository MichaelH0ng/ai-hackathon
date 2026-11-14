// Plaid routes for the Money dashboard. Modeled on the money-dashboard project.
// Keys come from .env (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV) and stay on the server.
// Access tokens are saved in server/data/plaid-items.json, which is git-ignored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { studentBanks } from "./sandboxStudent.ts";

const ENV = process.env.PLAID_ENV || "sandbox";
const configured = Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[ENV],
    baseOptions: { headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "", "PLAID-SECRET": process.env.PLAID_SECRET ?? "" } },
  }),
);

// ---------- tiny file store for connected banks ----------

interface Item {
  itemId: string;
  accessToken: string;
  institution: string;
  kind?: "bank" | "investments";
}
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const FILE = path.join(DATA_DIR, ENV === "sandbox" ? "plaid-items.json" : `plaid-items-${ENV}.json`);

function getItems(): Item[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Item[];
  } catch {
    return [];
  }
}
function saveItems(items: Item[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2), { mode: 0o600 });
}

// Plaid errors carry a readable message in response.data; never echo keys or tokens.
function plaidError(err: unknown): { error: string; code?: string } {
  const data = (err as { response?: { data?: { error_message?: string; error_code?: string } } })?.response?.data;
  return { error: data?.error_message ?? "Plaid request failed.", code: data?.error_code };
}

async function exchange(publicToken: string, institution: string, kind: "bank" | "investments" = "bank") {
  const res = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const items = getItems().filter((i) => i.itemId !== res.data.item_id);
  saveItems([...items, { itemId: res.data.item_id, accessToken: res.data.access_token, institution, kind }]);
}

// ---------- routes ----------

export const plaidRouter = Router();

plaidRouter.get("/api/plaid/status", (_req, res) => {
  res.json({ env: ENV, configured, missing: [!process.env.PLAID_CLIENT_ID && "PLAID_CLIENT_ID", !process.env.PLAID_SECRET && "PLAID_SECRET"].filter(Boolean), items: getItems().map(({ itemId, institution, kind }) => ({ itemId, institution, kind: kind ?? "bank" })) });
});

plaidRouter.use("/api/plaid", (_req, res, next) => {
  if (!configured) {
    res.status(503).json({ error: "Account connections need one more setup step. You can still add accounts manually." });
    return;
  }
  next();
});



// Step 1 of connecting: a short-lived link token for the Plaid Link popup.
plaidRouter.post("/api/plaid/link-token", async (req, res) => {
  const investing = req.body?.kind === "investments";
  try {
    const r = await plaid.linkTokenCreate({
      user: { client_user_id: "tradeoff-local-user" },
      client_name: "NorthStar",
      language: "en",
      country_codes: [CountryCode.Us],
      products: investing ? [Products.Investments] : [Products.Transactions],
      ...(investing ? {} : { transactions: { days_requested: 180 } }),
    });
    res.json({ link_token: r.data.link_token });
  } catch (err) {
    res.status(500).json(plaidError(err));
  }
});

// Step 2: trade the public token from Link for an access token and save it.
plaidRouter.post("/api/plaid/exchange", async (req, res) => {
  const { public_token, institution } = req.body ?? {};
  if (typeof public_token !== "string") {
    res.status(400).json({ error: "Missing public_token." });
    return;
  }
  try {
    await exchange(public_token, typeof institution === "string" ? institution : "Your institution", req.body?.kind === "investments" ? "investments" : "bank");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json(plaidError(err));
  }
});

// Sandbox only: connect Plaid's test bank in one step, no popup. Handy for demos.
plaidRouter.post("/api/plaid/sandbox-connect", async (req, res) => {
  if (ENV !== "sandbox") {
    res.status(400).json({ error: "Test banks only work in sandbox." });
    return;
  }
  try {
    if (req.body?.profile === "investments") {
      const r = await plaid.sandboxPublicTokenCreate({ institution_id: "ins_109508", initial_products: [Products.Investments] });
      await exchange(r.data.public_token, "Sandbox portfolio (test)", "investments");
      res.json({ ok: true });
      return;
    }
    // Default: a college student's money across 3 institutions, built from our own JSON.
    // "plaid" = Plaid's stock test bank instead.
    const banks =
      req.body?.profile === "plaid"
        ? [{ institution: "First Platypus Bank", options: undefined }]
        : studentBanks().map((b) => ({ institution: b.institution, options: { override_username: "user_custom", override_password: JSON.stringify(b.config) } }));
    for (const b of banks) {
      const r = await plaid.sandboxPublicTokenCreate({ institution_id: "ins_109508", initial_products: [Products.Transactions], options: b.options });
      await exchange(r.data.public_token, `${b.institution} (test)`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json(plaidError(err));
  }
});

plaidRouter.delete("/api/plaid/items/:id", async (req, res) => {
  const items = getItems();
  const item = items.find((i) => i.itemId === req.params.id);
  if (item) {
    try {
      await plaid.itemRemove({ access_token: item.accessToken });
    } catch {
      // already gone at Plaid; remove it locally anyway
    }
    saveItems(items.filter((i) => i !== item));
  }
  res.json({ ok: true });
});

// Everything the dashboard needs: balances and recent transactions from every connected bank.
plaidRouter.get("/api/plaid/dashboard", async (_req, res) => {
  const perItem = await Promise.all(
    getItems().map(async (item) => {
      const accounts: unknown[] = [];
      const transactions: unknown[] = [];
      const holdings: unknown[] = [];
      const investing = item.kind === "investments";
      let problem: string | undefined;
      let ready = true;
      try {
        const r = await plaid.accountsGet({ access_token: item.accessToken });
        for (const a of r.data.accounts) {
          accounts.push({
            id: a.account_id,
            name: a.name,
            mask: a.mask,
            type: a.type,
            subtype: a.subtype,
            current: a.balances.current ?? 0,
            available: a.balances.available,
            institution: item.institution,
          });
        }
      } catch (err) {
        problem = plaidError(err).code ?? "ACCOUNTS_FAILED";
      }
      if (investing) {
        try {
          const r = await plaid.investmentsHoldingsGet({ access_token: item.accessToken });
          const securities = new Map(r.data.securities.map(s => [s.security_id, s]));
          for (const h of r.data.holdings) {
            const security = securities.get(h.security_id);
            holdings.push({ id: h.account_id + ":" + h.security_id, accountId: h.account_id, name: security?.name ?? "Investment holding", ticker: security?.ticker_symbol ?? null, quantity: h.quantity, price: h.institution_price, value: h.institution_value, currency: h.iso_currency_code ?? security?.iso_currency_code ?? null, priceAsOf: h.institution_price_as_of ?? security?.close_price_as_of ?? null, institution: item.institution });
          }
        } catch (err) {
          const code = plaidError(err).code;
          if (code === "PRODUCT_NOT_READY") ready = false;
          else problem ??= code ?? "HOLDINGS_FAILED";
        }
      }
      if (!investing) try {
        let cursor: string | undefined;
        let more = true;
        while (more) {
          const r = await plaid.transactionsSync({ access_token: item.accessToken, cursor, count: 500 });
          for (const t of r.data.added) {
            transactions.push({
              id: t.transaction_id,
              accountId: t.account_id,
              date: t.date,
              name: t.merchant_name ?? t.name,
              amount: t.amount, // Plaid: positive = money out
              category: t.personal_finance_category?.primary ?? "OTHER",
              pending: t.pending,
            });
          }
          if ((r.data as { transactions_update_status?: string }).transactions_update_status === "NOT_READY") ready = false;
          cursor = r.data.next_cursor;
          more = r.data.has_more;
        }
      } catch (err) {
        const code = plaidError(err).code;
        if (code === "PRODUCT_NOT_READY") ready = false;
        else problem ??= code ?? "TRANSACTIONS_FAILED";
      }
      return { accounts, transactions, holdings, status: { itemId: item.itemId, institution: item.institution, problem, ready } };
    }),
  );
  res.json({
    env: ENV,
    accounts: perItem.flatMap((r) => r.accounts),
    holdings: perItem.flatMap((r) => r.holdings),
    transactions: perItem.flatMap((r) => r.transactions).sort((a, b) => ((a as { date: string }).date < (b as { date: string }).date ? 1 : -1)),
    status: perItem.map((r) => r.status),
    fetchedAt: new Date().toISOString(),
  });
});
