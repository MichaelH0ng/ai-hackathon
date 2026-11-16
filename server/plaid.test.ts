import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import type { BankData } from "../src/lib/money.ts";

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  files: new Map<string, string>(),
  client: {
    linkTokenCreate: vi.fn(), accountsGet: vi.fn(), investmentsHoldingsGet: vi.fn(), transactionsSync: vi.fn(), itemGet: vi.fn(), sandboxPublicTokenCreate: vi.fn(), itemPublicTokenExchange: vi.fn(), itemRemove: vi.fn(), liabilitiesGet: vi.fn(), transactionsRecurringGet: vi.fn(),
  },
}));
vi.mock("node:fs", () => ({ default: {
  readFileSync: (file: string) => {
    if (file.includes("plaid-items")) return JSON.stringify(mocks.items);
    const saved = mocks.files.get(file);
    if (saved === undefined) throw new Error("File not found");
    return saved;
  },
  mkdirSync: vi.fn(),
  writeFileSync: (file: string, value: string) => {
    if (file.includes("plaid-items")) mocks.items = JSON.parse(value);
    else mocks.files.set(file, value);
  },
  renameSync: (from: string, to: string) => {
    const saved = mocks.files.get(from);
    if (saved === undefined) throw new Error("File not found");
    mocks.files.set(to, saved);
    mocks.files.delete(from);
  },
  rmSync: (file: string) => { mocks.files.delete(file); },
} }));
vi.mock("plaid", async importOriginal => ({ ...await importOriginal<typeof import("plaid")>(), PlaidApi: vi.fn(function () { return mocks.client; }) }));

async function invoke<T>(path: string, body = {}) {
  const { plaidRouter } = await import("./plaid.ts");
  type Layer = { route?: { path: string; stack: { handle: (req: Request, res: Response, next: NextFunction) => unknown }[] } };
  const layer = (plaidRouter as unknown as { stack: Layer[] }).stack.find(l => l.route?.path === path);
  if (!layer?.route) throw new Error("Route not found");
  let result: T | undefined;
  let status = 200;
  const res = { status: (code: number) => { status = code; return res; }, json: (value: T) => { result = value; return res; } };
  await layer.route.stack[0].handle({ body } as Request, res as unknown as Response, vi.fn());
  return { body: result!, status };
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("PLAID_ENV", "sandbox"); vi.stubEnv("PLAID_CLIENT_ID", "test-client"); vi.stubEnv("PLAID_SECRET", "test-secret");
  mocks.items = [{ itemId: "investment-item", accessToken: "private-access-token", institution: "Test broker", kind: "investments" }]; mocks.files.clear();
  mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [{ account_id: "ira", name: "My IRA", mask: "1234", type: "investment", subtype: "roth", balances: { current: 1000, available: null } }] } });
  mocks.client.investmentsHoldingsGet.mockResolvedValue({ data: { securities: [{ security_id: "fund", name: "Example fund", ticker_symbol: "TEST", iso_currency_code: "USD", close_price_as_of: "2026-11-13" }], holdings: [{ account_id: "ira", security_id: "fund", quantity: 10, institution_price: 100, institution_value: 1000 }] } });
  mocks.client.itemGet.mockResolvedValue({ data: { item: { status: { transactions: { last_successful_update: "2026-11-14T15:00:00Z" } } } } });
  mocks.client.linkTokenCreate.mockResolvedValue({ data: { link_token: "short-lived-token" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("portfolio connection routes", () => {
  it("requests Investments without requiring bank Transactions", async () => {
    await invoke("/api/plaid/link-token", { kind: "investments" });
    expect(mocks.client.linkTokenCreate.mock.calls[0][0]).toMatchObject({ products: ["investments"] });
    expect(mocks.client.linkTokenCreate.mock.calls[0][0]).not.toHaveProperty("transactions");
  });
  it("returns holdings separately from balances without exposing access tokens", async () => {
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.accounts).toHaveLength(1);
    expect(result.body.accounts[0].current).toBe(1000);
    expect(result.body.holdings?.[0]).toMatchObject({ accountId: "ira", ticker: "TEST", value: 1000, currency: "USD", priceAsOf: "2026-11-13" });
    expect(mocks.client.transactionsSync).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain("private-access-token");
    expect(JSON.stringify(result.body)).not.toContain("test-secret");
  });
  it("loads both transactions and holdings for a unified bank and investment connection", async () => {
    mocks.items = [{ itemId: "all-item", accessToken: "private-access-token", institution: "Test bank and broker", kind: "all" }];
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [{ transaction_id: "coffee", account_id: "ira", date: "2026-11-14", name: "Coffee", amount: 5, pending: false, personal_finance_category: { primary: "FOOD_AND_DRINK" } }], modified: [], removed: [], next_cursor: "cursor", has_more: false } });
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.transactions).toHaveLength(1);
    expect(result.body.holdings).toHaveLength(1);
    expect(mocks.client.transactionsSync).toHaveBeenCalledTimes(1);
    expect(mocks.client.investmentsHoldingsGet).toHaveBeenCalledTimes(1);
  });
  it("keeps account balances when holdings are not ready", async () => {
    mocks.client.investmentsHoldingsGet.mockRejectedValueOnce({ response: { data: { error_code: "PRODUCT_NOT_READY" } } });
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.accounts).toHaveLength(1);
    expect(result.body.holdings).toEqual([]);
    expect(result.body.status[0].ready).toBe(false);
  });
  it("reports missing setup without revealing credentials", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "");
    const result = await invoke<{ configured: boolean; missing: string[] }>("/api/plaid/status");
    expect(result.body.configured).toBe(false);
    expect(result.body.missing).toEqual(["PLAID_CLIENT_ID"]);
    expect(JSON.stringify(result.body)).not.toContain("test-secret");
    expect(JSON.stringify(result.body)).not.toContain("private-access-token");
  });
  it("uses the secret that matches PLAID_ENV", async () => {
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("PLAID_ENV", "production"); vi.stubEnv("PLAID_SANDBOX_SECRET", "sandbox-secret");
    let result = await invoke<{ configured: boolean; missing: string[] }>("/api/plaid/status");
    expect(result.body.missing).toEqual(["PLAID_PRODUCTION_SECRET"]);
    vi.resetModules(); vi.stubEnv("PLAID_PRODUCTION_SECRET", "production-secret");
    result = await invoke<{ configured: boolean; missing: string[] }>("/api/plaid/status");
    expect(result.body.configured).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain("production-secret");
  });
  it("rejects test portfolio creation in Production", async () => {
    vi.stubEnv("PLAID_ENV", "production");
    const result = await invoke("/api/plaid/sandbox-connect", { profile: "investments" });
    expect(result.status).toBe(400);
    expect(mocks.client.sandboxPublicTokenCreate).not.toHaveBeenCalled();
  });
});
describe("live balances", () => {
  it("checks with the bank once, then reuses that for 15 minutes", async () => {
    const live = { data: { accounts: [{ account_id: "ira", name: "My IRA", mask: "1234", type: "investment", subtype: "roth", balances: { current: 1050, available: null } }] } };
    const balanceGet = vi.fn().mockResolvedValue(live);
    (mocks.client as Record<string, unknown>).accountsBalanceGet = balanceGet;
    const { loadDashboardData } = await import("./plaid.ts");
    const first = await loadDashboardData({ liveBalances: true });
    expect(first.accounts[0].current).toBe(1050);
    expect(first.balancesCheckedAt).toBeTruthy();
    // A second live request and an ordinary load both reuse it: no new billed check.
    const again = await loadDashboardData({ liveBalances: true });
    const ordinary = await loadDashboardData();
    expect(balanceGet).toHaveBeenCalledTimes(1);
    expect(again.accounts[0].current).toBe(1050);
    expect(ordinary.accounts[0].current).toBe(1050);
    expect(ordinary.balancesCheckedAt).toBe(first.balancesCheckedAt);
  });
  it("uses Plaid's saved balances by default, with no live time", async () => {
    const { loadDashboardData } = await import("./plaid.ts");
    const data = await loadDashboardData();
    expect(data.accounts[0].current).toBe(1000);
    expect(data.balancesCheckedAt).toBeNull();
  });
});
describe("card, loan and bill details", () => {
  const bankItem = { itemId: "bank-item", accessToken: "private-access-token", institution: "Campus Bank (test)", kind: "bank" };
  const cardAccount = { account_id: "card", name: "Student Visa", mask: "1177", type: "credit", subtype: "credit card", balances: { current: 184.62, available: null } };
  beforeEach(() => {
    mocks.items = [bankItem];
    mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [cardAccount] } });
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "c", has_more: false } });
    mocks.client.liabilitiesGet.mockResolvedValue({ data: { liabilities: { credit: [{ account_id: "card", minimum_payment_amount: 35, next_payment_due_date: "2026-11-28", is_overdue: false, last_statement_balance: 150, aprs: [{ apr_type: "purchase_apr", apr_percentage: 21.5 }] }] } } });
    mocks.client.transactionsRecurringGet.mockResolvedValue({ data: { inflow_streams: [], outflow_streams: [{ stream_id: "s", account_id: "card", description: "SPOTIFY", merchant_name: "Spotify", frequency: "MONTHLY", predicted_next_date: "2026-12-01", average_amount: { amount: 6 }, last_amount: { amount: 6 }, is_active: true, status: "MATURE" }] } });
  });
  it("asks for card and loan details at link time without making them required", async () => {
    await invoke("/api/plaid/link-token", { kind: "bank" });
    const request = mocks.client.linkTokenCreate.mock.calls[0][0];
    expect(request.products).toEqual(["transactions"]);
    expect(request.additional_consented_products).toEqual(["liabilities"]);
    await invoke("/api/plaid/link-token", { kind: "all" });
    expect(mocks.client.linkTokenCreate.mock.calls[1][0].additional_consented_products).toEqual(["investments", "liabilities"]);
    await invoke("/api/plaid/link-token", { kind: "investments" });
    expect(mocks.client.linkTokenCreate.mock.calls[2][0]).not.toHaveProperty("additional_consented_products");
  });
  it("returns debts and detected bills with the dashboard", async () => {
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.debts?.[0]).toMatchObject({ name: "Student Visa", minimumPayment: 35, apr: 21.5 });
    expect(result.body.recurring?.[0]).toMatchObject({ name: "Spotify", amount: 6, direction: "out" });
    expect(JSON.stringify(result.body)).not.toContain("private-access-token");
  });
  it("reads each connection's extras once within the cache window", async () => {
    await invoke<BankData>("/api/plaid/dashboard");
    await invoke<BankData>("/api/plaid/dashboard");
    expect(mocks.client.liabilitiesGet).toHaveBeenCalledTimes(1);
    expect(mocks.client.transactionsRecurringGet).toHaveBeenCalledTimes(1);
  });
  it("flags a connection made before debts were requested instead of failing", async () => {
    mocks.client.liabilitiesGet.mockRejectedValueOnce({ response: { data: { error_code: "ADDITIONAL_CONSENT_REQUIRED" } } });
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.debts).toEqual([]);
    expect(result.body.status[0]).toMatchObject({ needsDebtConsent: true });
    expect(result.body.status[0].problem).toBeUndefined();
    expect(result.body.accounts).toHaveLength(1);
  });
  it("keeps the dashboard working when detected bills are not ready or not enabled", async () => {
    mocks.client.transactionsRecurringGet.mockRejectedValueOnce({ response: { data: { error_code: "PRODUCT_NOT_READY" } } });
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.recurring).toEqual([]);
    expect(result.body.status[0].problem).toBeUndefined();
  });
  it("does not ask for card details on a connection with no cards or loans", async () => {
    mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [{ account_id: "chk", name: "Checking", mask: "1", type: "depository", subtype: "checking", balances: { current: 10, available: 10 } }] } });
    await invoke<BankData>("/api/plaid/dashboard");
    expect(mocks.client.liabilitiesGet).not.toHaveBeenCalled();
  });
});

describe("keeping transactions in sync", () => {
  const bankItem = { itemId: "bank-item", accessToken: "private-access-token", institution: "Campus Bank (test)", kind: "bank" };
  const plaidTx = (id: string, over: Record<string, unknown> = {}) => ({ transaction_id: id, account_id: "chk", date: "2026-11-10", name: "Coffee", merchant_name: null, amount: 5, pending: false, personal_finance_category: { primary: "FOOD_AND_DRINK" }, ...over });
  beforeEach(() => {
    mocks.items = [bankItem];
    mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [{ account_id: "chk", name: "Checking", mask: "1", type: "depository", subtype: "checking", balances: { current: 10, available: 10 } }] } });
  });
  it("starts from nothing the first time, then resumes from the saved cursor", async () => {
    mocks.client.transactionsSync
      .mockResolvedValueOnce({ data: { added: [plaidTx("a")], modified: [], removed: [], next_cursor: "cursor-1", has_more: false } })
      .mockResolvedValueOnce({ data: { added: [plaidTx("b")], modified: [], removed: [], next_cursor: "cursor-2", has_more: false } });
    const first = await invoke<BankData>("/api/plaid/dashboard");
    expect(mocks.client.transactionsSync.mock.calls[0][0].cursor).toBeUndefined();
    expect(first.body.transactions.map((t) => t.id)).toEqual(["a"]);
    const second = await invoke<BankData>("/api/plaid/dashboard");
    expect(mocks.client.transactionsSync.mock.calls[1][0].cursor).toBe("cursor-1");
    // The second answer only described what changed, but the earlier transaction is still there.
    expect(second.body.transactions.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
  it("applies edits and removals from Plaid", async () => {
    mocks.client.transactionsSync
      .mockResolvedValueOnce({ data: { added: [plaidTx("pending-1", { pending: true }), plaidTx("keep", { amount: 8 })], modified: [], removed: [], next_cursor: "c1", has_more: false } })
      .mockResolvedValueOnce({ data: { added: [plaidTx("posted-1")], modified: [plaidTx("keep", { amount: 9.5 })], removed: [{ transaction_id: "pending-1" }], next_cursor: "c2", has_more: false } });
    await invoke<BankData>("/api/plaid/dashboard");
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.transactions.map((t) => [t.id, t.amount]).sort()).toEqual([["keep", 9.5], ["posted-1", 5]]);
  });
  it("saves nothing until the last page has arrived", async () => {
    mocks.client.transactionsSync
      .mockResolvedValueOnce({ data: { added: [plaidTx("a")], modified: [], removed: [], next_cursor: "page-1", has_more: true } })
      .mockRejectedValueOnce({ response: { data: { error_code: "RATE_LIMIT" } } });
    const broken = await invoke<BankData>("/api/plaid/dashboard");
    expect(broken.body.status[0].problem).toBe("RATE_LIMIT");
    expect([...mocks.files.keys()].filter((f) => f.includes("sync"))).toEqual([]);
    mocks.client.transactionsSync.mockResolvedValueOnce({ data: { added: [plaidTx("a")], modified: [], removed: [], next_cursor: "page-1", has_more: false } });
    await invoke<BankData>("/api/plaid/dashboard");
    // The failed try never saved "page-1", so the retry began from the start again.
    expect(mocks.client.transactionsSync.mock.calls[2][0].cursor).toBeUndefined();
  });
  it("restarts the batch when the data changes while paging through it", async () => {
    mocks.client.transactionsSync
      .mockResolvedValueOnce({ data: { added: [plaidTx("a")], modified: [], removed: [], next_cursor: "page-1", has_more: true } })
      .mockRejectedValueOnce({ response: { data: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" } } })
      .mockResolvedValueOnce({ data: { added: [plaidTx("a"), plaidTx("b")], modified: [], removed: [], next_cursor: "done", has_more: false } });
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.status[0].problem).toBeUndefined();
    expect(result.body.transactions.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(mocks.client.transactionsSync.mock.calls[2][0].cursor).toBeUndefined();
  });
  it("does not bookmark an empty 'not ready' first look", async () => {
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "early", has_more: false, transactions_update_status: "NOT_READY" } });
    const result = await invoke<BankData>("/api/plaid/dashboard");
    expect(result.body.status[0].ready).toBe(false);
    await invoke<BankData>("/api/plaid/dashboard");
    expect(mocks.client.transactionsSync.mock.calls[1][0].cursor).toBeUndefined();
  });
  it("forgets the saved progress when a bank is disconnected", async () => {
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [plaidTx("a")], modified: [], removed: [], next_cursor: "c1", has_more: false } });
    mocks.client.itemRemove.mockResolvedValue({ data: {} });
    await invoke<BankData>("/api/plaid/dashboard");
    expect([...mocks.files.keys()].some((f) => f.includes("bank-item"))).toBe(true);
    const { plaidRouter } = await import("./plaid.ts");
    type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response, next: NextFunction) => unknown }[] } };
    const layer = (plaidRouter as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === "/api/plaid/items/:id" && l.route.methods.delete);
    const res = { status: () => res, json: () => res };
    await layer!.route!.stack[0].handle({ params: { id: "bank-item" }, query: {} } as unknown as Request, res as unknown as Response, vi.fn());
    expect([...mocks.files.keys()].some((f) => f.includes("bank-item"))).toBe(false);
  });
});

describe("reconnecting an existing bank", () => {
  beforeEach(() => { mocks.items = [{ itemId: "bank-item", accessToken: "private-access-token", institution: "Campus Bank", kind: "bank" }]; });
  it("opens Link in update mode: the saved connection, no products, nothing to exchange", async () => {
    await invoke("/api/plaid/link-token", { itemId: "bank-item" });
    const request = mocks.client.linkTokenCreate.mock.calls[0][0];
    expect(request.access_token).toBe("private-access-token");
    expect(request).not.toHaveProperty("products");
    expect(request).not.toHaveProperty("additional_consented_products");
  });
  it("can ask for card and loan details on the same connection", async () => {
    await invoke("/api/plaid/link-token", { itemId: "bank-item", addDebts: true });
    expect(mocks.client.linkTokenCreate.mock.calls[0][0].additional_consented_products).toEqual(["liabilities"]);
  });
  it("says so when the connection is no longer saved", async () => {
    const result = await invoke<{ error: string }>("/api/plaid/link-token", { itemId: "missing" });
    expect(result.status).toBe(404);
    expect(mocks.client.linkTokenCreate).not.toHaveBeenCalled();
  });
});
