import { describe, expect, it } from "vitest";
import { feeAlerts, interestAndFees, investingFlow, investmentAccountsSummary, investmentsTogether, lastPayments, movesBetweenAccounts } from "./accountInsights";
import type { BankAccount, BankTransaction, PortfolioHolding } from "./money";

const now = new Date(2026, 10, 16);
const account = (id: string, type: string, subtype: string | null = null, name = id): BankAccount =>
  ({ id, name, mask: null, type, subtype, current: 0, available: null, institution: "Bank" });
const tx = (id: string, accountId: string, date: string, amount: number, name = id, category = "OTHER"): BankTransaction =>
  ({ id, accountId, date, name, amount, category, pending: false });

describe("movesBetweenAccounts", () => {
  const accounts = [account("chk", "depository", "checking"), account("sav", "depository", "savings"), account("rh", "investment", "brokerage"), account("cc", "credit")];

  it("pairs money out of one account with the same amount arriving in another, grouped by route", () => {
    const moves = movesBetweenAccounts([
      tx("a1", "chk", "2026-11-14", 200), tx("a2", "rh", "2026-11-15", -200),
      tx("b1", "chk", "2026-10-31", 200), tx("b2", "rh", "2026-11-02", -200),
      tx("c1", "chk", "2026-11-10", 450), tx("c2", "cc", "2026-11-10", -450), // card payment
      tx("d1", "chk", "2026-11-09", 50), // a purchase: nothing arrived anywhere
      tx("e1", "chk", "2026-11-05", 75), tx("e2", "sav", "2026-11-12", -75), // 7 days apart: not a pair
    ], accounts, 30, now);
    expect(moves).toEqual([
      { fromId: "chk", toId: "cc", total: 450, count: 1, lastDate: "2026-11-10", matchedBy: "both" },
      { fromId: "chk", toId: "rh", total: 400, count: 2, lastDate: "2026-11-14", matchedBy: "both" },
    ]);
  });
});

describe("interestAndFees", () => {
  it("finds interest earned, card interest paid, and fees in the last year", () => {
    const result = interestAndFees([
      tx("i1", "sav", "2026-10-31", -1.4, "INTEREST PAYMENT"),
      tx("i2", "wf", "2026-09-30", -12.8, "Interest earned"),
      tx("p1", "cc", "2026-10-20", 18.5, "INTEREST CHARGE ON PURCHASES"),
      tx("f1", "chk", "2026-08-01", 35, "Overdraft fee", "BANK_FEES"),
      tx("f2", "chk", "2026-07-01", 2.5, "ATM FEE"),
      tx("old", "sav", "2025-06-01", -9, "INTEREST PAYMENT"), // over a year ago
      tx("rent", "chk", "2026-11-04", 1030.4, "McNamara Realty Inc"),
    ], 365, now);
    expect(result).toMatchObject({ earned: 14.2, interestPaid: 18.5, fees: 37.5 });
    expect(result.byAccount.find((r) => r.accountId === "chk")).toEqual({ accountId: "chk", earned: 0, interestPaid: 0, fees: 37.5 });
  });
});

describe("investmentsTogether", () => {
  it("adds the same fund across accounts and splits retirement from taxable", () => {
    const accounts = [account("roth", "investment", "roth", "Roth IRA"), account("rh", "investment", "brokerage", "Individual")];
    const h = (id: string, accountId: string, ticker: string | null, value: number, name = ticker ?? id): PortfolioHolding =>
      ({ id, accountId, name, ticker, quantity: 1, price: value, value, currency: "USD", priceAsOf: null, institution: "Broker" });
    const result = investmentsTogether([
      h("1", "roth", "VTI", 3000), h("2", "rh", "VTI", 1000), h("3", "rh", "AAPL", 500), h("4", "roth", null, 200, "Cash sweep"), h("5", "rh", "TSLA", 0),
    ], accounts, 2);
    expect(result).toEqual({
      total: 4700, retirement: 3200, taxable: 1500,
      top: [{ label: "VTI", name: "VTI", value: 4000, accounts: 2 }, { label: "AAPL", name: "AAPL", value: 500, accounts: 1 }],
      otherValue: 200, otherCount: 1,
    });
  });
});

describe("investmentAccountsSummary", () => {
  it("totals every investment account's balance and lists the ones without holdings", () => {
    const roth = { ...account("roth", "investment", "roth", "ROTH IRA"), institution: "Fidelity", current: 4100 };
    const rh = { ...account("rh", "investment", "brokerage", "Individual"), institution: "Robinhood", current: 1850 };
    const chk = { ...account("chk", "depository", "checking"), current: 900 };
    const holding: PortfolioHolding = { id: "h", accountId: "rh", name: "AAPL", ticker: "AAPL", quantity: 1, price: 1850, value: 1850, currency: "USD", priceAsOf: null, institution: "Robinhood" };
    expect(investmentAccountsSummary([roth, rh, chk], [holding])).toEqual({
      total: 5950, retirement: 4100, taxable: 1850,
      withoutHoldings: [{ id: "roth", name: "ROTH IRA", institution: "Fidelity", balance: 4100 }],
    });
  });
});

describe("movesBetweenAccounts: one-sided transfers", () => {
  it("counts a transfer named after another connected institution when only one side is reported", () => {
    const wf = { ...account("chk", "depository", "checking", "Everyday Checking"), institution: "Wells Fargo" };
    const rh = { ...account("rh", "investment", "brokerage", "Robinhood individual"), institution: "Robinhood" };
    const crypto = { ...account("rhc", "investment", "crypto exchange", "Crypto"), institution: "Robinhood" };
    const moves = movesBetweenAccounts([
      tx("r1", "chk", "2026-11-13", 250, "Robinhood", "TRANSFER_OUT"),
      tx("r2", "chk", "2026-11-03", 300, "Robinhood", "TRANSFER_OUT"),
      tx("gold", "chk", "2026-11-05", 5, "Robinhood Gold", "GENERAL_SERVICES"), // a subscription, not a move
    ], [wf, rh, crypto], 30, now);
    expect(moves).toEqual([{ fromId: "chk", toId: "rh", total: 550, count: 2, lastDate: "2026-11-13", matchedBy: "name" }]);
  });
});

describe("account row facts", () => {
  const accounts = [account("chk", "depository", "checking"), account("rh", "investment", "brokerage"), account("cc", "credit")];

  it("counts money added to investments, and money taken back out", () => {
    const flow = investingFlow([
      tx("o1", "chk", "2026-11-10", 500, "Transfer to Robinhood", "TRANSFER_OUT"), tx("i1", "rh", "2026-11-10", -500, "Deposit", "TRANSFER_IN"),
      tx("o2", "rh", "2026-11-12", 200, "Withdrawal", "TRANSFER_OUT"), tx("i2", "chk", "2026-11-12", -200, "From Robinhood", "TRANSFER_IN"),
    ], accounts, 30, now);
    expect(flow).toEqual({ added: 500, withdrawn: 200 });
  });

  it("finds the latest card payment, not a store refund", () => {
    const paid = lastPayments([
      tx("p1", "cc", "2026-10-30", -1992.88, "ONLINE PAYMENT THANK YOU", "LOAN_PAYMENTS"),
      tx("p0", "cc", "2026-09-30", -1500, "ONLINE PAYMENT THANK YOU", "LOAN_PAYMENTS"),
      tx("r1", "cc", "2026-11-05", -40, "Target refund", "GENERAL_MERCHANDISE"),
    ], accounts, 60, now);
    expect(paid.get("cc")).toEqual({ amount: 1992.88, date: "2026-10-30" });
  });

  it("raises an alert only for interest charged and fees, one per account and kind", () => {
    const alerts = feeAlerts([
      tx("f1", "chk", "2026-11-03", 35, "OVERDRAFT FEE", "BANK_FEES"), tx("f2", "chk", "2026-10-03", 3, "ATM FEE", "BANK_FEES"),
      tx("c1", "cc", "2026-11-01", 12.4, "INTEREST CHARGE ON PURCHASES", "BANK_FEES"),
      tx("e1", "chk", "2026-11-01", -0.03, "INTEREST PAYMENT", "INCOME"),
      tx("old", "chk", "2026-06-01", 35, "OVERDRAFT FEE", "BANK_FEES"),
    ], 90, now);
    expect(alerts.map((a) => [a.accountId, a.kind, a.total, a.count])).toEqual([["chk", "fee", 38, 2], ["cc", "charged", 12.4, 1]]);
    expect(feeAlerts([tx("e1", "chk", "2026-11-01", -0.03, "INTEREST PAYMENT", "INCOME")], 90, now)).toEqual([]);
  });
});
