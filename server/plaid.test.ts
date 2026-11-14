import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import type { BankData } from "../src/lib/money.ts";

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  client: {
    linkTokenCreate: vi.fn(), accountsGet: vi.fn(), investmentsHoldingsGet: vi.fn(), transactionsSync: vi.fn(), sandboxPublicTokenCreate: vi.fn(), itemPublicTokenExchange: vi.fn(), itemRemove: vi.fn(),
  },
}));
vi.mock("node:fs", () => ({ default: { readFileSync: () => JSON.stringify(mocks.items), mkdirSync: vi.fn(), writeFileSync: (_file: string, value: string) => { mocks.items = JSON.parse(value); } } }));
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
  mocks.items = [{ itemId: "investment-item", accessToken: "private-access-token", institution: "Test broker", kind: "investments" }];
  mocks.client.accountsGet.mockResolvedValue({ data: { accounts: [{ account_id: "ira", name: "My IRA", mask: "1234", type: "investment", subtype: "roth", balances: { current: 1000, available: null } }] } });
  mocks.client.investmentsHoldingsGet.mockResolvedValue({ data: { securities: [{ security_id: "fund", name: "Example fund", ticker_symbol: "TEST", iso_currency_code: "USD", close_price_as_of: "2026-11-13" }], holdings: [{ account_id: "ira", security_id: "fund", quantity: 10, institution_price: 100, institution_value: 1000 }] } });
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
  it("rejects test portfolio creation in Production", async () => {
    vi.stubEnv("PLAID_ENV", "production");
    const result = await invoke("/api/plaid/sandbox-connect", { profile: "investments" });
    expect(result.status).toBe(400);
    expect(mocks.client.sandboxPublicTokenCreate).not.toHaveBeenCalled();
  });
});
