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
  // Plaid's real shape: the refresh times are in the response's top-level status, not on the item.
  mocks.client.itemGet.mockResolvedValue({ data: { item: { institution_id: null, consent_expiration_time: null }, status: { transactions: { last_successful_update: "2026-11-14T15:00:00Z" } } } });
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
      .mockRejectedValueOnce({ response: { data: { error_type: "API_ERROR", error_code: "INTERNAL_SERVER_ERROR" } } });
    const broken = await invoke<BankData>("/api/plaid/dashboard");
    expect(broken.body.status[0].problem).toBe("INTERNAL_SERVER_ERROR");
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
  it("can ask for investment holdings on the same connection", async () => {
    await invoke("/api/plaid/link-token", { itemId: "bank-item", addInvestments: true });
    expect(mocks.client.linkTokenCreate.mock.calls[0][0].additional_consented_products).toEqual(["investments"]);
  });
  it("says so when the connection is no longer saved", async () => {
    const result = await invoke<{ error: string }>("/api/plaid/link-token", { itemId: "missing" });
    expect(result.status).toBe(404);
    expect(mocks.client.linkTokenCreate).not.toHaveBeenCalled();
  });
});

describe("daily net-worth snapshot", () => {
  const at = (iso: string) => new Date(iso);
  const point = (date: string, capturedAt: Date) => ({ date, capturedAt: capturedAt.toISOString(), value: 1 });
  it("is due when today has no point, and again in the evening if today's was taken earlier", async () => {
    const { snapshotDue } = await import("./plaid.ts");
    const morning = at("2026-11-17T09:00:00");
    expect(snapshotDue([], morning)).toBe(true);
    expect(snapshotDue([point("2026-11-17", morning)], at("2026-11-17T14:00:00"))).toBe(false);
    expect(snapshotDue([point("2026-11-17", morning)], at("2026-11-17T22:00:00"))).toBe(true);
    expect(snapshotDue([point("2026-11-17", at("2026-11-17T21:30:00"))], at("2026-11-17T23:00:00"))).toBe(false);
  });
});

describe("a bank that fails on one load", () => {
  it("still lets its name mark a transfer as your own money, without counting its balance", async () => {
    const wells = { itemId: "wells", accessToken: "private-access-token", institution: "Wells Fargo", kind: "bank" };
    const wealthfront = { itemId: "wf", accessToken: "private-access-token-2", institution: "Wealthfront", kind: "bank" };
    mocks.items = [wells, wealthfront];
    const checking = { account_id: "chk", name: "Everyday Checking", mask: "2793", type: "depository", subtype: "checking", balances: { current: 2000, available: 2000 } };
    const cash = { account_id: "cash", name: "Cash Account", mask: "4410", type: "depository", subtype: "savings", balances: { current: 30000, available: 30000 } };
    mocks.client.accountsGet.mockImplementation(({ access_token }: { access_token: string }) =>
      Promise.resolve({ data: { accounts: [access_token === "private-access-token" ? checking : cash] } }));
    mocks.client.liabilitiesGet.mockResolvedValue({ data: { liabilities: {} } });
    mocks.client.transactionsRecurringGet.mockResolvedValue({ data: { inflow_streams: [], outflow_streams: [] } });
    const fromWealthfront = { transaction_id: "t1", account_id: "chk", date: "2026-08-19", name: "Wealthfront", merchant_name: null, amount: -300, pending: false, personal_finance_category: { primary: "INCOME" } };
    mocks.client.transactionsSync.mockImplementation(({ access_token }: { access_token: string }) =>
      Promise.resolve({ data: { added: access_token === "private-access-token" ? [fromWealthfront] : [], modified: [], removed: [], next_cursor: "c", has_more: false } }));
    const { loadDashboardData } = await import("./plaid.ts");
    await loadDashboardData();
    mocks.client.accountsGet.mockImplementation(({ access_token }: { access_token: string }) =>
      access_token === "private-access-token" ? Promise.resolve({ data: { accounts: [checking] } }) : Promise.reject({ response: { data: { error_code: "INTERNAL_SERVER_ERROR" } } }));
    // A minute later, so the saved balances are read again.
    const later = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const second = await loadDashboardData();
    vi.restoreAllMocks();
    expect(second.accounts.map((a) => a.id)).toEqual(["chk"]);
    expect(second.transactions.find((t) => t.id === "t1")?.category).toMatch(/^TRANSFER/);
  });

  it("doesn't save a net-worth point that leaves out a bank, whatever its error", async () => {
    const wells = { itemId: "wells", accessToken: "private-access-token", institution: "Wells Fargo", kind: "bank" };
    const fidelity = { itemId: "fid", accessToken: "private-access-token-2", institution: "Fidelity", kind: "bank" };
    mocks.items = [wells, fidelity];
    const checking = { account_id: "chk", name: "Everyday Checking", mask: "2793", type: "depository", subtype: "checking", balances: { current: 2000, available: 2000 } };
    const roth = { account_id: "roth", name: "ROTH IRA", mask: "1111", type: "depository", subtype: "savings", balances: { current: 10000, available: 10000 } };
    mocks.client.accountsGet.mockImplementation(({ access_token }: { access_token: string }) =>
      Promise.resolve({ data: { accounts: [access_token === "private-access-token" ? checking : roth] } }));
    mocks.client.liabilitiesGet.mockResolvedValue({ data: { liabilities: {} } });
    mocks.client.transactionsRecurringGet.mockResolvedValue({ data: { inflow_streams: [], outflow_streams: [] } });
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "c", has_more: false } });
    const { loadDashboardData } = await import("./plaid.ts");
    const first = await loadDashboardData();
    expect(first.netWorthSnapshots?.at(-1)?.value).toBe(12000);
    // Fidelity needs you to sign in again: not the generic "accounts failed" code.
    mocks.client.accountsGet.mockImplementation(({ access_token }: { access_token: string }) =>
      access_token === "private-access-token" ? Promise.resolve({ data: { accounts: [checking] } }) : Promise.reject({ response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } } }));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    const second = await loadDashboardData();
    vi.restoreAllMocks();
    expect(second.accounts.map((a) => a.id)).toEqual(["chk"]);
    expect(second.netWorthSnapshots?.at(-1)?.value).toBe(12000);
  });

  it("reads saved balances once a minute, and keeps showing them when Plaid says it's been asked too often", async () => {
    mocks.items = [{ itemId: "wells", accessToken: "private-access-token", institution: "Wells Fargo", kind: "bank" }];
    const checking = { account_id: "chk", name: "WELLS FARGO ACTIVE CASH VISA\uFFFD\uFFFD CARD", mask: "2793", type: "depository", subtype: "checking", balances: { current: 2000, available: 1700 } };
    mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [checking] } });
    mocks.client.liabilitiesGet.mockResolvedValue({ data: { liabilities: {} } });
    mocks.client.transactionsRecurringGet.mockResolvedValue({ data: { inflow_streams: [], outflow_streams: [] } });
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "c", has_more: false } });
    const { loadDashboardData } = await import("./plaid.ts");
    const first = await loadDashboardData();
    await loadDashboardData();
    await loadDashboardData();
    expect(mocks.client.accountsGet).toHaveBeenCalledTimes(1);
    // Symbols Plaid couldn't decode are dropped from the name.
    expect(first.accounts[0].name).toBe("WELLS FARGO ACTIVE CASH VISA CARD");
    mocks.client.accountsGet.mockRejectedValue({ response: { data: { error_code: "ACCOUNTS_LIMIT" } } });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    const limited = await loadDashboardData();
    vi.restoreAllMocks();
    expect(limited.accounts.map((a) => [a.id, a.current])).toEqual([["chk", 2000]]);
    expect(limited.status[0]).not.toHaveProperty("problem", "ACCOUNTS_LIMIT");
  });

  it("reports when each bank last updated, when its permission ends, merchant logos and what holdings cost", async () => {
    mocks.items = [{ itemId: "wells", accessToken: "private-access-token", institution: "Wells Fargo", kind: "all" }];
    mocks.client.itemGet.mockResolvedValue({ data: { item: { institution_id: null, consent_expiration_time: "2027-03-03T00:00:00Z" }, status: { transactions: { last_successful_update: "2026-11-19T08:00:00Z" } } } });
    mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [
      { account_id: "chk", name: "Checking", mask: "1", type: "depository", subtype: "checking", balances: { current: 5, available: 5 } },
      { account_id: "brk", name: "Brokerage", mask: "2", type: "investment", subtype: "brokerage", balances: { current: 1200, available: null } },
    ] } });
    mocks.client.investmentsHoldingsGet.mockResolvedValue({ data: {
      securities: [{ security_id: "s1", name: "Vanguard Total", ticker_symbol: "VTI", type: "etf" }, { security_id: "s2", name: "Cash", ticker_symbol: null, type: "cash", is_cash_equivalent: true }],
      holdings: [{ account_id: "brk", security_id: "s1", quantity: 4, institution_price: 275, institution_value: 1100, cost_basis: 1000 }, { account_id: "brk", security_id: "s2", quantity: 100, institution_price: 1, institution_value: 100, cost_basis: null }],
    } });
    mocks.client.liabilitiesGet.mockResolvedValue({ data: { liabilities: {} } });
    mocks.client.transactionsRecurringGet.mockResolvedValue({ data: { inflow_streams: [], outflow_streams: [] } });
    const coffee = { transaction_id: "t1", account_id: "chk", date: "2026-11-01", name: "STARBUCKS 123", merchant_name: "Starbucks", amount: 4, pending: false, logo_url: "https://plaid-merchant-logos.plaid.com/starbucks.png", website: "starbucks.com", counterparties: [{ name: "Starbucks", type: "merchant", logo_url: null }], personal_finance_category: { primary: "FOOD_AND_DRINK" } };
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [coffee], modified: [], removed: [], next_cursor: "c", has_more: false } });
    const { loadDashboardData } = await import("./plaid.ts");
    const data = await loadDashboardData();
    expect(data.status[0]).toMatchObject({ lastUpdatedAt: "2026-11-19T08:00:00Z", consentExpiresAt: "2027-03-03T00:00:00Z" });
    expect(data.transactions[0]).toMatchObject({ logo: "https://plaid-merchant-logos.plaid.com/starbucks.png", website: "starbucks.com", counterparties: [{ name: "Starbucks", type: "merchant" }] });
    expect(data.holdings?.map((h) => [h.ticker, h.costBasis, h.cash])).toEqual([["VTI", 1000, false], [null, null, true]]);
  });

  it("shares one trip to Plaid between loads that overlap", async () => {
    mocks.items = [{ itemId: "wells", accessToken: "private-access-token", institution: "Wells Fargo", kind: "bank" }];
    mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [{ account_id: "chk", name: "Checking", mask: "1", type: "depository", subtype: "checking", balances: { current: 5, available: 5 } }] } });
    mocks.client.liabilitiesGet.mockResolvedValue({ data: { liabilities: {} } });
    mocks.client.transactionsRecurringGet.mockResolvedValue({ data: { inflow_streams: [], outflow_streams: [] } });
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "c", has_more: false } });
    const { loadDashboardData } = await import("./plaid.ts");
    const [a, b] = await Promise.all([loadDashboardData(), loadDashboardData()]);
    expect(a).toBe(b);
    expect(mocks.client.transactionsSync).toHaveBeenCalledTimes(1);
    expect(mocks.client.itemGet).toHaveBeenCalledTimes(1);
  });

  it("keeps the synced transactions when Plaid rate-limits the sync (by error type, whatever the code)", async () => {
    mocks.items = [{ itemId: "wells", accessToken: "private-access-token", institution: "Wells Fargo", kind: "bank" }];
    mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [{ account_id: "chk", name: "Checking", mask: "1", type: "depository", subtype: "checking", balances: { current: 5, available: 5 } }] } });
    mocks.client.liabilitiesGet.mockResolvedValue({ data: { liabilities: {} } });
    mocks.client.transactionsRecurringGet.mockResolvedValue({ data: { inflow_streams: [], outflow_streams: [] } });
    const coffee = { transaction_id: "t1", account_id: "chk", date: "2026-11-01", name: "Coffee", merchant_name: "Coffee", amount: 4, pending: false, personal_finance_category: { primary: "FOOD_AND_DRINK" } };
    mocks.client.transactionsSync.mockResolvedValue({ data: { added: [coffee], modified: [], removed: [], next_cursor: "c", has_more: false } });
    const { loadDashboardData } = await import("./plaid.ts");
    await loadDashboardData();
    mocks.client.transactionsSync.mockRejectedValue({ response: { data: { error_type: "RATE_LIMIT_EXCEEDED", error_code: "SOME_NEW_LIMIT" } } });
    const limited = await loadDashboardData();
    expect(limited.transactions.map((t) => t.id)).toContain("t1");
    expect(limited.status[0].problem).toBeUndefined();
  });
});
