// Plaid routes for the Money dashboard. Modeled on the money-dashboard project.
// Keys come from .env (PLAID_CLIENT_ID, PLAID_ENV, and PLAID_SANDBOX_SECRET or
// PLAID_PRODUCTION_SECRET to match PLAID_ENV; plain PLAID_SECRET still works) and stay on the server.
// Access tokens are saved in server/data/plaid-items.json, which is git-ignored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { mapLiabilities, mapRecurring, type LiabilitiesResponse, type RecurringResponse } from "../src/lib/debt.js";
import { netWorth, type BankData, type NetWorthSnapshot } from "../src/lib/money.js";
import { studentBanks } from "./sandboxStudent.js";
import { applyPage, deleteSyncState, readSyncState, writeSyncState } from "./syncStore.js";
import { forgetAccounts, mergeWithArchive, readArchive, writeArchive } from "./transactionArchive.js";

const ENV = process.env.PLAID_ENV || "sandbox";
/** The secret for the chosen environment: PLAID_SANDBOX_SECRET / PLAID_PRODUCTION_SECRET, else PLAID_SECRET. */
const SECRET_VAR = `PLAID_${ENV.toUpperCase()}_SECRET`;
const SECRET = process.env[SECRET_VAR] || process.env.PLAID_SECRET || "";
export const plaidConfigured = Boolean(process.env.PLAID_CLIENT_ID && SECRET);

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[ENV],
    baseOptions: { headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "", "PLAID-SECRET": SECRET } },
  }),
);

// ---------- tiny file store for connected banks ----------

interface Item {
  itemId: string;
  accessToken: string;
  institution: string;
  /** "all" is a single Link session that may include both bank activity and investments. */
  kind?: "bank" | "investments" | "all";
}
// Vercel's file system is read-only except /tmp, which lasts only while a function instance is warm,
// so sandbox connections made on the live site are temporary there.
const DATA_DIR = process.env.VERCEL ? path.join("/tmp", "northstar-data") : path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const FILE = path.join(DATA_DIR, ENV === "sandbox" ? "plaid-items.json" : `plaid-items-${ENV}.json`);
/** Every posted transaction seen so far, kept past Plaid's ~2-year window (see transactionArchive.ts). */
const ARCHIVE_FILE = path.join(DATA_DIR, ENV === "sandbox" ? "transaction-archive.json" : `transaction-archive-${ENV}.json`);
const SNAPSHOT_FILE = path.join(DATA_DIR, ENV === "sandbox" ? "net-worth-snapshots.json" : `net-worth-snapshots-${ENV}.json`);
const SNAPSHOT_LIMIT = 730;
/** Bank logos and colors from Plaid (public branding, not account data), cached so each bank is looked up once. */
const LOGO_FILE = path.join(DATA_DIR, "institution-logos.json");
type Branding = { logo: string | null; color: string | null; at: number };
let brandingCache: Record<string, Branding> | null = null;
/** Logos added by hand for banks Plaid has none for: server/logos/<Plaid institution id>.png (Wells Fargo is ins_127991). */
const LOGO_OVERRIDE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "logos");
function logoOverride(institutionId: string): string | null {
  try {
    return `data:image/png;base64,${fs.readFileSync(path.join(LOGO_OVERRIDE_DIR, `${institutionId}.png`)).toString("base64")}`;
  } catch {
    return null;
  }
}
async function branding(institutionId: string | null | undefined): Promise<Branding | null> {
  if (!institutionId) return null;
  const found = await plaidBranding(institutionId);
  const own = logoOverride(institutionId);
  return own ? { logo: own, color: found?.color ?? null, at: found?.at ?? Date.now() } : found;
}
async function plaidBranding(institutionId: string): Promise<Branding | null> {
  if (!brandingCache) {
    try { brandingCache = JSON.parse(fs.readFileSync(LOGO_FILE, "utf8")) as Record<string, Branding>; } catch { brandingCache = {}; }
  }
  const known = brandingCache[institutionId];
  // Re-check about monthly; a failed lookup is retried after a day.
  if (known && Date.now() - known.at < (known.logo || known.color ? 30 : 1) * 86_400_000) return known;
  try {
    const r = await plaid.institutionsGetById({ institution_id: institutionId, country_codes: [CountryCode.Us], options: { include_optional_metadata: true } });
    const found: Branding = { logo: r.data.institution.logo ? `data:image/png;base64,${r.data.institution.logo}` : null, color: r.data.institution.primary_color ?? null, at: Date.now() };
    brandingCache[institutionId] = found;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOGO_FILE, JSON.stringify(brandingCache));
    return found;
  } catch {
    brandingCache[institutionId] = { logo: null, color: null, at: Date.now() };
    return null;
  }
}

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

function getSnapshots(): NetWorthSnapshot[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((snapshot): snapshot is NetWorthSnapshot => !!snapshot && typeof snapshot === "object" && typeof (snapshot as NetWorthSnapshot).date === "string" && typeof (snapshot as NetWorthSnapshot).capturedAt === "string" && typeof (snapshot as NetWorthSnapshot).value === "number" && Number.isFinite((snapshot as NetWorthSnapshot).value))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-SNAPSHOT_LIMIT);
  } catch {
    return [];
  }
}

function recordSnapshot(accounts: BankData["accounts"], snapshots: NetWorthSnapshot[], now = new Date()): NetWorthSnapshot[] {
  const capturedAt = now.toISOString();
  const date = capturedAt.slice(0, 10);
  const next = { date, capturedAt, value: Math.round(netWorth(accounts).net * 100) / 100 };
  const updated = [...snapshots.filter((snapshot) => snapshot.date !== date), next].sort((a, b) => a.date.localeCompare(b.date)).slice(-SNAPSHOT_LIMIT);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(updated, null, 2), { mode: 0o600 });
  return updated;
}

// Plaid errors carry a readable message in response.data; never echo keys or tokens.
function plaidError(err: unknown): { error: string; code?: string } {
  const data = (err as { response?: { data?: { error_message?: string; error_code?: string } } })?.response?.data;
  return { error: data?.error_message ?? "Plaid request failed.", code: data?.error_code };
}

async function exchange(publicToken: string, institution: string, kind: "bank" | "investments" | "all" = "bank") {
  const res = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const items = getItems().filter((i) => i.itemId !== res.data.item_id);
  saveItems([...items, { itemId: res.data.item_id, accessToken: res.data.access_token, institution, kind }]);
}

// ---------- routes ----------

export const plaidRouter = Router();

plaidRouter.get("/api/plaid/status", (_req, res) => {
  res.json({ env: ENV, configured: plaidConfigured, missing: [!process.env.PLAID_CLIENT_ID && "PLAID_CLIENT_ID", !SECRET && SECRET_VAR].filter(Boolean), items: getItems().map(({ itemId, institution, kind }) => ({ itemId, institution, kind: kind ?? "bank" })) });
});

plaidRouter.use("/api/plaid", (_req, res, next) => {
  if (!plaidConfigured) {
    res.status(503).json({ error: "Account connections need one more setup step. You can still add accounts manually." });
    return;
  }
  next();
});



// Step 1 of connecting: a short-lived link token for the Plaid Link popup.
plaidRouter.post("/api/plaid/link-token", async (req, res) => {
  // Update mode: re-open Link for a connection that already exists (an expired login, or to add card,
  // loan, or investment details). It uses the saved access token and no products. Link then fixes the
  // same connection in place, so nothing is exchanged and no second, separately billed connection is created.
  if (typeof req.body?.itemId === "string") {
    const item = getItems().find((i) => i.itemId === req.body.itemId);
    if (!item) {
      res.status(404).json({ error: "That connection isn't saved here anymore. Connect it again from scratch." });
      return;
    }
    try {
      const additionalConsent = [
        ...(req.body?.addInvestments ? [Products.Investments] : []),
        ...(req.body?.addDebts ? [Products.Liabilities] : []),
      ];
      const r = await plaid.linkTokenCreate({
        user: { client_user_id: "tradeoff-local-user" },
        client_name: "NorthStar",
        language: "en",
        country_codes: [CountryCode.Us],
        access_token: item.accessToken,
        ...(additionalConsent.length ? { additional_consented_products: additionalConsent } : {}),
        ...(process.env.PLAID_LINK_CUSTOMIZATION ? { link_customization_name: process.env.PLAID_LINK_CUSTOMIZATION } : {}),
        ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
      });
      res.json({ link_token: r.data.link_token });
    } catch (err) {
      res.status(500).json(plaidError(err));
    }
    return;
  }
  const investing = req.body?.kind === "investments";
  const unified = req.body?.kind === "all";
  try {
    const r = await plaid.linkTokenCreate({
      user: { client_user_id: "tradeoff-local-user" },
      client_name: "NorthStar",
      language: "en",
      country_codes: [CountryCode.Us],
      // A single Link session can cover an everyday bank or a brokerage. Keep
      // Investments as consented-on-demand for the unified button, so linking a
      // bank does not automatically add an Investments subscription.
      products: investing ? [Products.Investments] : [Products.Transactions],
      // Card and loan details (Liabilities) are consented now and only billed when first read, so
      // they don't narrow which banks appear in Link. Brokerage-only connections have no debts.
      ...(investing ? {} : { additional_consented_products: unified ? [Products.Investments, Products.Liabilities] : [Products.Liabilities] }),
      // Two years (Plaid's maximum), fixed when a bank is linked: re-link older connections to get it.
      ...(investing ? {} : { transactions: { days_requested: 730 } }),
      // Branding saved in the Plaid Dashboard (Link > Link customization), e.g. "northstar".
      ...(process.env.PLAID_LINK_CUSTOMIZATION ? { link_customization_name: process.env.PLAID_LINK_CUSTOMIZATION } : {}),
      // Banks that log in on their own site (Chase, Capital One…) return here. Must be allowed in
      // the Plaid Dashboard (API > Allowed redirect URIs); Production requires https.
      ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
    });
    res.json({ link_token: r.data.link_token });
  } catch (err) {
    res.status(500).json(plaidError(err));
  }
});

// After update mode finishes, forget what we remembered about the connection so the next load sees the fix.
plaidRouter.post("/api/plaid/items/:id/reconnected", (req, res) => {
  extrasCache.delete(String(req.params.id));
  res.json({ ok: true });
});

// Step 2: trade the public token from Link for an access token and save it.
plaidRouter.post("/api/plaid/exchange", async (req, res) => {
  const { public_token, institution } = req.body ?? {};
  if (typeof public_token !== "string") {
    res.status(400).json({ error: "Missing public_token." });
    return;
  }
  try {
    const kind = req.body?.kind === "investments" ? "investments" : req.body?.kind === "all" ? "all" : "bank";
    await exchange(public_token, typeof institution === "string" ? institution : "Your institution", kind);
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
        ? [{ institution: "First Platypus Bank", options: undefined, hasCard: true }]
        : studentBanks().map((b) => ({
            institution: b.institution,
            options: { override_username: "user_custom", override_password: JSON.stringify(b.config) },
            hasCard: b.config.override_accounts.some((a) => a.type === "credit" || a.type === "loan"),
          }));
    for (const b of banks) {
      // Liabilities only works on a connection that has a card or loan, so request it just there.
      const r = await plaid.sandboxPublicTokenCreate({ institution_id: "ins_109508", initial_products: b.hasCard ? [Products.Transactions, Products.Liabilities] : [Products.Transactions], options: b.options });
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
    // Saved history is kept unless the user asks to delete it too.
    if (req.query.deleteHistory === "true") {
      try {
        const r = await plaid.accountsGet({ access_token: item.accessToken });
        const accounts = r.data.accounts.map((a) => ({ id: a.account_id, name: a.name, mask: a.mask ?? null, type: a.type, subtype: a.subtype ?? null, current: 0, available: null, institution: item.institution }));
        writeArchive(ARCHIVE_FILE, forgetAccounts(readArchive(ARCHIVE_FILE), accounts));
      } catch (err) {
        res.status(502).json({ ...plaidError(err), error: "Couldn't reach the bank to find which history to delete, so nothing was changed. Try again." });
        return;
      }
    }
    try {
      await plaid.itemRemove({ access_token: item.accessToken });
    } catch {
      // already gone at Plaid; remove it locally anyway
    }
    saveItems(items.filter((i) => i !== item));
    extrasCache.delete(item.itemId);
    deleteSyncState(syncFile(item.itemId));
  }
  res.json({ ok: true });
});

// Card/loan details and detected bills change about once a day at Plaid, and the dashboard data is
// requested on every page load and every Polaris question, so remember them briefly per connection.
const EXTRAS_TTL_MS = 10 * 60 * 1000;
interface Extras {
  at: number;
  debts: NonNullable<BankData["debts"]>;
  recurring: NonNullable<BankData["recurring"]>;
  needsDebtConsent: boolean;
}
const extrasCache = new Map<string, Extras>();

/**
 * Optional extras for one connection: card and loan details, and Plaid's detected bills.
 * Neither is required for the dashboard, so any failure here leaves the extra empty and never
 * marks the connection as broken. The app falls back to estimating bills from past transactions.
 */
async function loadExtras(item: Item, accounts: BankData["accounts"], transactionsReady: boolean): Promise<Extras> {
  const cached = extrasCache.get(item.itemId);
  if (cached && Date.now() - cached.at < EXTRAS_TTL_MS) return cached;
  const extras: Extras = { at: Date.now(), debts: [], recurring: [], needsDebtConsent: false };
  // Liabilities fails on a connection with no cards or loans, so only ask when there is one.
  if (accounts.some((a) => a.type === "credit" || a.type === "loan")) {
    try {
      const r = await plaid.liabilitiesGet({ access_token: item.accessToken });
      extras.debts = mapLiabilities(r.data as unknown as LiabilitiesResponse, accounts);
    } catch (err) {
      const code = plaidError(err).code;
      if (code === "ADDITIONAL_CONSENT_REQUIRED") extras.needsDebtConsent = true; // linked before debts were requested
      else if (code !== "PRODUCT_NOT_READY" && code !== "NO_LIABILITY_ACCOUNTS") console.error("Liabilities read failed", code ?? "unknown");
    }
  }
  // Streams computed from partial history are wrong, so wait until the bank's activity has finished loading.
  if (transactionsReady) {
    try {
      const r = await plaid.transactionsRecurringGet({ access_token: item.accessToken, account_ids: accounts.map((a) => a.id) });
      extras.recurring = mapRecurring(r.data as unknown as RecurringResponse);
    } catch (err) {
      const code = plaidError(err).code;
      if (code !== "PRODUCT_NOT_READY") console.error("Recurring transactions read failed", code ?? "unknown");
    }
  }
  // A not-ready result should be retried soon, not remembered for ten minutes.
  if (transactionsReady) extrasCache.set(item.itemId, extras);
  return extras;
}

const syncFile = (itemId: string) => path.join(DATA_DIR, "sync", ENV, `${itemId}.json`);

type PlaidTransaction = Awaited<ReturnType<typeof plaid.transactionsSync>>["data"]["added"][number];
const toTransaction = (t: PlaidTransaction): BankData["transactions"][number] => ({
  id: t.transaction_id,
  accountId: t.account_id,
  date: t.date,
  name: t.merchant_name ?? t.name,
  amount: t.amount, // Plaid: positive = money out
  category: t.personal_finance_category?.primary ?? "OTHER",
  pending: t.pending,
});

/**
 * Brings one connection's transactions up to date. Picks up from the saved cursor, applies what was
 * added, changed and removed, and saves the new cursor with the result only once every page has arrived.
 */
async function syncTransactions(item: Item): Promise<{ transactions: BankData["transactions"]; ready: boolean }> {
  const file = syncFile(item.itemId);
  for (let attempt = 0; ; attempt++) {
    let state = readSyncState(file);
    let ready = true;
    try {
      let more = true;
      while (more) {
        const r = await plaid.transactionsSync({ access_token: item.accessToken, cursor: state.cursor || undefined, count: 500 });
        state = applyPage(state, { added: r.data.added.map(toTransaction), modified: r.data.modified.map(toTransaction), removed: r.data.removed.map((t) => t.transaction_id) }, r.data.next_cursor);
        if ((r.data as { transactions_update_status?: string }).transactions_update_status === "NOT_READY") ready = false;
        more = r.data.has_more;
      }
    } catch (err) {
      // The data changed while we were paging through it: nothing was saved, so start the batch over from the saved cursor.
      if (plaidError(err).code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 2) continue;
      throw err;
    }
    // A "not ready" answer is an empty first look, so don't bookmark it.
    if (ready) {
      try {
        writeSyncState(file, state);
      } catch (err) {
        console.error("Couldn't save sync progress", err instanceof Error ? err.message : err);
      }
    }
    return { transactions: Object.values(state.transactions), ready };
  }
}

// Live balances ask each bank right now, and Plaid usually bills each of those checks. Results are
// reused for 15 minutes, both for repeated "live" requests and for ordinary loads (fresher, and free).
const LIVE_BALANCE_TTL_MS = 15 * 60 * 1000;
const liveBalanceCache = new Map<string, { at: number; accounts: BankData["accounts"] }>();
const freshLive = (itemId: string) => {
  const hit = liveBalanceCache.get(itemId);
  return hit && Date.now() - hit.at < LIVE_BALANCE_TTL_MS ? hit : null;
};

// Everything the dashboard needs: balances and recent transactions from every connected bank.
export async function loadDashboardData({ liveBalances = false }: { liveBalances?: boolean } = {}): Promise<BankData> {
  const perItem = await Promise.all(
    getItems().map(async (item) => {
      const accounts: BankData["accounts"] = [];
      const transactions: BankData["transactions"] = [];
      const holdings: NonNullable<BankData["holdings"]> = [];
      const investing = item.kind === "investments" || item.kind === "all";
      let problem: string | undefined;
      let ready = true;
      let lastUpdatedAt: string | null = null;
      let brand: Branding | null = null;
      try {
        const itemStatus = await plaid.itemGet({ access_token: item.accessToken });
        brand = await branding(itemStatus.data.item.institution_id);
        // Plaid's generated type changes with API versions; only this optional
        // freshness field is needed for the dashboard label.
        lastUpdatedAt = ((itemStatus.data.item as unknown as { status?: { transactions?: { last_successful_update?: string | null } } }).status?.transactions?.last_successful_update) ?? null;
      } catch {
        // A balance/transaction read can still succeed even if this optional status read fails.
      }
      let liveAt: number | null = null;
      try {
        // Standard loads use Plaid's saved balances (free, can be hours old). A live refresh asks the
        // bank for current balances; a live result from the last 15 minutes is reused instead.
        const cached = freshLive(item.itemId);
        if (cached) {
          accounts.push(...cached.accounts);
          liveAt = cached.at;
        }
        const r = cached ? null : liveBalances
          ? await plaid.accountsBalanceGet({ access_token: item.accessToken })
          : await plaid.accountsGet({ access_token: item.accessToken });
        if (r && liveBalances) liveAt = Date.now();
        for (const a of r?.data.accounts ?? []) {
          accounts.push({
            id: a.account_id,
            name: a.name,
            mask: a.mask ?? null,
            type: a.type,
            subtype: a.subtype ?? null,
            current: a.balances.current ?? 0,
            available: a.balances.available ?? null,
            institution: item.institution,
            limit: a.balances.limit ?? null,
          });
        }
        if (r && liveBalances) liveBalanceCache.set(item.itemId, { at: liveAt!, accounts: [...accounts] });
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
          // A unified Link session starts with Transactions consent. A person
          // can connect only a bank, so there may simply be no investment
          // account to fetch; that is not a dashboard failure.
          else if (code === "NO_INVESTMENT_ACCOUNTS" && item.kind === "all") { /* bank-only unified connection */ }
          else problem ??= code ?? "HOLDINGS_FAILED";
        }
      }
      // A unified Link connection can contain a checking account and a brokerage.
      // It needs both reads; treating it as investment-only silently omitted bank activity.
      if (item.kind !== "investments") try {
        const synced = await syncTransactions(item);
        transactions.push(...synced.transactions);
        if (!synced.ready) ready = false;
      } catch (err) {
        const code = plaidError(err).code;
        if (code === "PRODUCT_NOT_READY") ready = false;
        else problem ??= code ?? "TRANSACTIONS_FAILED";
      }
      const extras: Extras = item.kind === "investments" ? { at: 0, debts: [], recurring: [], needsDebtConsent: false } : await loadExtras(item, accounts, ready && !problem);
      return {
        accounts,
        liveAt,
        transactions,
        holdings,
        debts: extras.debts,
        recurring: extras.recurring,
        status: { itemId: item.itemId, institution: item.institution, problem, ready, lastUpdatedAt, ...(extras.needsDebtConsent ? { needsDebtConsent: true } : {}), ...(brand?.logo || brand?.color ? { logo: brand.logo, color: brand.color } : {}) },
      };
    }),
  );
  const accounts = perItem.flatMap((r) => r.accounts);
  // Add archived history from before Plaid's window, and save what Plaid returned today.
  const merged = mergeWithArchive(perItem.flatMap((r) => r.transactions), accounts, readArchive(ARCHIVE_FILE));
  try {
    writeArchive(ARCHIVE_FILE, merged.archive);
  } catch (err) {
    console.error("Couldn't save transaction archive", err instanceof Error ? err.message : err);
  }
  const data: BankData = {
    env: ENV,
    accounts,
    holdings: perItem.flatMap((r) => r.holdings),
    debts: perItem.flatMap((r) => r.debts),
    recurring: perItem.flatMap((r) => r.recurring),
    transactions: merged.transactions,
    status: perItem.map((r) => r.status),
    fetchedAt: new Date().toISOString(),
    // When every bank's balance was last checked live (the oldest of them), or null if any is Plaid's saved copy.
    balancesCheckedAt: perItem.length && perItem.every((r) => r.liveAt) ? new Date(Math.min(...perItem.map((r) => r.liveAt!))).toISOString() : null,
  };
  // Don't store a whole-net-worth snapshot if any institution's account list
  // failed: a partial total would be less trustworthy than no point at all.
  const accountLoadFailed = perItem.some((item) => item.status.problem === "ACCOUNTS_FAILED");
  const snapshots = getSnapshots();
  if (data.accounts.length && !accountLoadFailed) {
    try {
      data.netWorthSnapshots = recordSnapshot(data.accounts, snapshots, new Date(data.fetchedAt));
    } catch (err) {
      // The live dashboard remains useful if a local snapshot cannot be saved.
      console.error("Couldn't save net-worth snapshot", err instanceof Error ? err.message : err);
      data.netWorthSnapshots = snapshots;
    }
  } else {
    data.netWorthSnapshots = snapshots;
  }
  return data;
}

plaidRouter.get("/api/plaid/dashboard", async (req, res) => {
  try {
    res.json(await loadDashboardData({ liveBalances: req.query?.live === "1" }));
  } catch (err) {
    // Keep an upstream Plaid failure in the JSON API contract so the UI can
    // show a useful retry state instead of an Express HTML error page.
    console.error("Plaid dashboard error", err instanceof Error ? err.message : err);
    res.status(502).json({ error: "Couldn't refresh your connected accounts. Try again in a moment." });
  }
});
