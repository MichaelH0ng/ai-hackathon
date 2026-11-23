import { describe, expect, it } from "vitest";
import { type BankAccount, type BankTransaction, isTransfer, accountBalanceSeries, assetsByInstitution, monthlyBillTotal, detectTransferIds, findRepeating, markCollegeSavings, markOwnTransfers, netWorth, mergeNetWorthHistory, netWorthSeries, periodFlow, spendableCash, topCategories, upcomingBills } from "./money";

const acct = (p: Partial<BankAccount>): BankAccount => ({ id: "a", name: "A", mask: null, type: "depository", subtype: "checking", current: 0, available: null, institution: "Bank", ...p });
let n = 0;
const tx = (p: Partial<BankTransaction>): BankTransaction => ({ id: `t${n++}`, accountId: "chk", date: "2026-11-10", name: "X", amount: 10, category: "FOOD_AND_DRINK", pending: false, ...p });
const NOW = new Date(2026, 10, 14); // Nov 14, 2026 (a Saturday)

describe("net worth", () => {
  it("subtracts credit cards and loans", () => {
    const r = netWorth([acct({ current: 1000 }), acct({ type: "credit", current: 300 }), acct({ type: "loan", current: 200 }), acct({ type: "investment", current: 500 })]);
    expect(r).toEqual({ assets: 1500, debts: 500, net: 1000 });
  });
  it("spendable cash is checking + savings, preferring available", () => {
    expect(spendableCash([acct({ current: 110, available: 100 }), acct({ subtype: "savings", current: 210 }), acct({ subtype: "cd", current: 1000 })])).toBe(310);
  });
});

describe("transfers", () => {
  it("pairs opposite amounts on different accounts within 3 days", () => {
    const a = tx({ accountId: "chk", amount: 500, date: "2026-11-01", category: "GENERAL_MERCHANDISE" });
    const b = tx({ accountId: "sav", amount: -500, date: "2026-11-02", category: "INCOME" });
    const c = tx({ accountId: "chk", amount: 500, date: "2026-11-20" });
    const ids = detectTransferIds([a, b, c]);
    expect(ids.has(a.id) && ids.has(b.id)).toBe(true);
    expect(ids.has(c.id)).toBe(false);
  });

  it("never hides a real purchase behind a transfer Plaid already labeled", () => {
    // A $50 savings transfer on Sep 30 and a $50 grocery run on Oct 2 are unrelated.
    const out = tx({ accountId: "chk", amount: 50, date: "2026-09-30", category: "TRANSFER_OUT", name: "Transfer to Savings" });
    const into = tx({ accountId: "sav", amount: -50, date: "2026-09-30", category: "TRANSFER_IN", name: "Transfer from Checking" });
    const groceries = tx({ accountId: "chk", amount: 50, date: "2026-10-02", name: "Trader Joe's" });
    expect(detectTransferIds([into, groceries, out]).has(groceries.id)).toBe(false);
  });
});

describe("markOwnTransfers", () => {
  const wells = acct({ id: "wf", name: "Everyday Checking", mask: "2793", institution: "Wells Fargo" });
  const wellsSavings = acct({ id: "wfs", name: "Way2Save Savings", mask: "9469", subtype: "savings", institution: "Wells Fargo" });
  const wealthfront = acct({ id: "wfc", name: "Individual Cash Account", mask: "4410", subtype: "savings", institution: "Wealthfront" });
  const card = acct({ id: "visa", name: "Active Cash Visa", mask: "6839", type: "credit", subtype: "credit card", institution: "Wells Fargo" });
  const accounts = [wells, wellsSavings, wealthfront, card];
  const category = (list: BankTransaction[], id: string) => list.find((t) => t.id === id)!.category;

  it("relabels a deposit Plaid called income when the other side is your own transfer", () => {
    const out = tx({ accountId: "wfc", amount: 300, category: "TRANSFER_OUT", name: "Wells Fargo (Account ****2793) Withdrawal WITHDRAWAL" });
    const into = tx({ accountId: "wf", amount: -300, category: "INCOME", name: "Wealthfront" });
    const result = markOwnTransfers([out, into], accounts);
    expect(category(result, into.id)).toBe("TRANSFER_IN");
    expect(isTransfer(result.find((t) => t.id === into.id)!, new Set())).toBe(true);
  });

  it("relabels a one-sided deposit named after another linked brokerage", () => {
    const into = tx({ accountId: "wf", amount: -300, category: "INCOME", name: "Wealthfront" });
    expect(category(markOwnTransfers([into], accounts), into.id)).toBe("TRANSFER_IN");
  });

  it("relabels a move between your accounts that Plaid filed under rent", () => {
    const out = tx({ accountId: "wf", amount: 748.75, category: "RENT_AND_UTILITIES", name: "ONLINE TRANSFER TO HONG M REF #IB0R3X8JDM EVERYDAY CHECKING BRYAN RENT" });
    const into = tx({ accountId: "wfs", amount: -748.75, category: "TRANSFER_IN", name: "ONLINE TRANSFER FROM HONG M REF #IB0R3X8JDM WELLS FARGO CLEAR ACCESS BA BRYAN RENT" });
    expect(category(markOwnTransfers([out, into], accounts), out.id)).toBe("TRANSFER_OUT");
  });

  it("relabels a card payment received when checking sent it", () => {
    const pay = tx({ accountId: "wf", amount: 300, category: "LOAN_PAYMENTS", name: "ONLINE TRANSFER TO WELLS FARGO ACTIVE CASH VISA CARD XXXXXXXXXXXX6839" });
    const received = tx({ accountId: "visa", amount: -300, category: "OTHER", name: "ONLINE PAYMENT THANK YOU" });
    expect(category(markOwnTransfers([pay, received], accounts), received.id)).toBe("TRANSFER_IN");
  });

  it("keeps a paycheck that happens to match a transfer amount", () => {
    const out = tx({ accountId: "wf", amount: 300, category: "TRANSFER_OUT", name: "ONLINE TRANSFER TO HONG M WAY2SAVE SAVINGS XXXXXX9469" });
    const into = tx({ accountId: "wfs", amount: -300, category: "TRANSFER_IN", name: "ONLINE TRANSFER FROM HONG M EVERYDAY CHECKING XXXXXX2793" });
    const pay = tx({ accountId: "wfc", amount: -300, category: "INCOME", name: "ACME CORP PAYROLL" });
    const lonePay = tx({ accountId: "wf", date: "2026-11-01", amount: -649.02, category: "INCOME", name: "ACME CORP PAYROLL" });
    const result = markOwnTransfers([out, into, pay, lonePay], accounts);
    expect(category(result, pay.id)).toBe("INCOME");
    expect(category(result, lonePay.id)).toBe("INCOME");
  });

  it("keeps a refund that matches a transfer amount", () => {
    const out = tx({ accountId: "wf", amount: 20, category: "TRANSFER_OUT", name: "VENMO PAYMENT JOHN" });
    const refund = tx({ accountId: "visa", amount: -20, category: "GENERAL_MERCHANDISE", name: "TARGET REFUND" });
    expect(category(markOwnTransfers([out, refund], accounts), refund.id)).toBe("GENERAL_MERCHANDISE");
  });

  it("keeps a purchase at a store that shares a linked institution's name", () => {
    const apple = acct({ id: "apple", institution: "Apple", type: "credit" });
    const buy = tx({ accountId: "wf", amount: 999, category: "GENERAL_MERCHANDISE", name: "APPLE STORE" });
    expect(category(markOwnTransfers([buy], [...accounts, apple]), buy.id)).toBe("GENERAL_MERCHANDISE");
  });
});

describe("markCollegeSavings", () => {
  it("treats 529 withdrawals as family support and contributions as transfers", () => {
    const withdrawal = tx({ amount: -7787.5, category: "INCOME", name: "ScholarShare ACH DEPOSIT 080526 0094652123801#17201437" });
    const contribution = tx({ amount: 100, category: "GENERAL_SERVICES", name: "MY529 CONTRIB" });
    const nyPlan = tx({ amount: -500, category: "INCOME", name: "NY 529 DIRECT WITHDRAWAL" });
    const [a, b, c] = markCollegeSavings([withdrawal, contribution, nyPlan]);
    expect([a.category, b.category, c.category]).toEqual(["FAMILY_SUPPORT", "TRANSFER_OUT", "FAMILY_SUPPORT"]);
  });
  it("never predicts family support as a paycheck", () => {
    const deposits = ["2026-08-05", "2026-09-04", "2026-10-05", "2026-11-04"].map((date) => tx({ date, amount: -945, category: "FAMILY_SUPPORT", name: "ScholarShare ACH DEPOSIT" }));
    expect(findRepeating(deposits, "in", "2026-11-14")).toEqual([]);
    expect(findRepeating(deposits.map((t) => ({ ...t, category: "INCOME" })), "in", "2026-11-14").length).toBe(1);
  });
  it("leaves paychecks and numbers that only contain 529 alone", () => {
    const pay = tx({ amount: -1317.85, category: "INCOME", name: "PROTIVITI INC. EARNINGS 260731" });
    const ref = tx({ amount: -40, category: "INCOME", name: "DEPOSIT REF 17201529" });
    const list = [pay, ref];
    expect(markCollegeSavings(list)).toBe(list);
  });
});

describe("cash flow", () => {
  it("splits this month and last month, skipping transfers and loan payments", () => {
    const txs = [
      tx({ date: "2026-11-03", amount: 40 }),
      tx({ date: "2026-11-05", amount: -1000, category: "INCOME" }),
      tx({ date: "2026-11-06", amount: 25, category: "LOAN_PAYMENTS" }),
      tx({ date: "2026-10-20", amount: 60 }),
      tx({ date: "2026-09-20", amount: 999 }),
    ];
    const f = periodFlow(txs, new Set(), "month", NOW);
    expect(f.current).toEqual({ in: 1000, out: 40 });
    expect(f.previous).toEqual({ in: 0, out: 60 });
  });

  it("keeps pending activity out of historical cash-flow totals", () => {
    const txs = [
      tx({ date: "2026-11-03", amount: 40 }),
      tx({ date: "2026-11-04", amount: 25, pending: true }),
      tx({ date: "2026-11-05", amount: -1000, category: "INCOME" }),
    ];
    expect(periodFlow(txs, new Set(), "month", NOW).current).toEqual({ in: 1000, out: 40 });
  });
});

describe("top categories", () => {
  it("totals the last 30 days of spending, biggest first", () => {
    const r = topCategories([tx({ amount: 20 }), tx({ amount: 30 }), tx({ amount: 80, category: "TRAVEL" }), tx({ amount: 500, date: "2026-09-01" })], new Set(), 30, NOW);
    expect(r.map((c) => [c.label, c.value])).toEqual([["Travel", 80], ["Food & drink", 50]]);
  });
});

describe("upcoming bills", () => {
  it("finds a monthly charge and projects the next date", () => {
    const txs = ["2026-08-15", "2026-09-15", "2026-10-15"].map((date) => tx({ name: "Spotify", amount: 11.99, date }));
    const [bill] = upcomingBills(txs, new Set(), NOW);
    expect(bill.name).toBe("Spotify");
    expect(bill.cadence).toBe("Monthly");
    expect(bill.nextDue >= "2026-11-14" && bill.nextDue <= "2026-11-16").toBe(true);
  });
  it("drops a subscription that stopped (no charge in months)", () => {
    // $1 monthly through June, nothing since: not due "tomorrow" in November.
    const txs = ["2026-04-27", "2026-05-28", "2026-06-29"].map((date) => tx({ name: "Acorns", amount: 1, date, category: "GENERAL_SERVICES" }));
    expect(upcomingBills(txs, new Set(), NOW)).toEqual([]);
  });
  it("doesn't turn two charges months apart into a bill", () => {
    const txs = [tx({ name: "U-Haul", amount: 69.81, date: "2026-06-09", category: "GENERAL_SERVICES" }), tx({ name: "U-Haul", amount: 64.37, date: "2026-09-17", category: "GENERAL_SERVICES" })];
    expect(upcomingBills(txs, new Set(), NOW)).toEqual([]);
  });
  it("doesn't count a favorite restaurant as a bill", () => {
    // Same order a few weeks running is still eating out, not a subscription.
    const lunches = [["2026-10-17", 14.79], ["2026-10-24", 17.52], ["2026-10-31", 14.79], ["2026-11-07", 14.79]] as const;
    expect(upcomingBills(lunches.map(([date, amount]) => tx({ name: "Taqueria Santa Cruz", amount, date })), new Set(), NOW)).toEqual([]);
  });
  it("still counts a fixed-price everyday subscription", () => {
    const txs = ["2026-08-20", "2026-09-20", "2026-10-20"].map((date) => tx({ name: "DashPass", amount: 9.99, date }));
    expect(upcomingBills(txs, new Set(), NOW)[0]).toMatchObject({ name: "DashPass", cadence: "Monthly", nextDue: "2026-11-20" });
  });
  it("counts rent after two months in a row", () => {
    const txs = ["2026-09-01", "2026-10-01"].map((date) => tx({ name: "Mustang Village", amount: 950, date, category: "RENT_AND_UTILITIES" }));
    expect(upcomingBills(txs, new Set(), NOW)[0]).toMatchObject({ name: "Mustang Village", nextDue: "2026-11-14", daysUntil: 0 });
  });
  it("ignores irregular amounts", () => {
    const txs = [tx({ name: "Shop", amount: 10, date: "2026-10-01" }), tx({ name: "Shop", amount: 90, date: "2026-11-01" })];
    expect(upcomingBills(txs, new Set(), NOW)).toEqual([]);
  });
});

describe("net worth over time", () => {
  it("walks backward from today's balance, skipping transfers", () => {
    const accounts = [acct({ current: 1000 })];
    const txs = [
      tx({ date: "2026-11-13", amount: 50 }), // spent 50 yesterday
      tx({ date: "2026-11-12", amount: -400, category: "INCOME" }), // paid 400 two days ago
      tx({ date: "2026-11-12", amount: 100, category: "TRANSFER_OUT" }), // ignored
    ];
    const s = netWorthSeries(accounts, txs, 3, NOW);
    expect(s.map((p) => [p.date, p.value])).toEqual([
      ["2026-11-11", 650],
      ["2026-11-12", 1050],
      ["2026-11-13", 1000],
      ["2026-11-14", 1000],
    ]);
  });
});

describe("assets by institution", () => {
  it("groups assets by bank or brokerage and ignores debts", () => {
    const r = assetsByInstitution([
      acct({ institution: "Campus Bank (test)", current: 700 }),
      acct({ institution: "Campus Bank (test)", type: "credit", current: 200 }),
      acct({ institution: "Summit Investing (test)", type: "investment", current: 2100 }),
      acct({ institution: "Sunrise (test)", subtype: "savings", current: 200 }),
    ]);
    expect(r.map((x) => [x.name, x.kind, x.value, Math.round(x.pct)])).toEqual([
      ["Summit Investing", "Brokerage", 2100, 70],
      ["Campus Bank", "Bank", 700, 23],
      ["Sunrise", "Bank", 200, 7],
    ]);
  });
});

describe("accountBalanceSeries", () => {
  const now = new Date(2026, 10, 16);
  const tx = (id: string, accountId: string, date: string, amount: number, pending = false): BankTransaction =>
    ({ id, accountId, date, name: id, amount, category: "OTHER", pending });

  it("works a checking balance backward, counting transfers and skipping pending", () => {
    const checking: BankAccount = { id: "chk", name: "Checking", mask: null, type: "depository", subtype: "checking", current: 1000, available: null, institution: "Bank" };
    const series = accountBalanceSeries(checking, [
      tx("pay", "chk", "2026-11-15", -500), // paycheck in yesterday
      tx("move", "chk", "2026-11-14", 200), // transfer out to savings
      tx("p", "chk", "2026-11-16", 50, true), // pending: ignored
      tx("other", "sav", "2026-11-15", 999), // another account: ignored
    ], 3, now);
    expect(series.map((p) => p.value)).toEqual([700, 500, 1000, 1000]);
    expect(series.at(-1)).toEqual({ date: "2026-11-16", value: 1000 });
  });

  it("tracks what a card owes: spending raises it, payments lower it", () => {
    const card: BankAccount = { id: "cc", name: "Card", mask: null, type: "credit", subtype: "credit card", current: 300, available: null, institution: "Bank" };
    const series = accountBalanceSeries(card, [tx("buy", "cc", "2026-11-16", 100), tx("payment", "cc", "2026-11-15", -400)], 2, now);
    expect(series.map((p) => p.value)).toEqual([600, 200, 300]);
  });
});

describe("monthlyBillTotal", () => {
  it("converts each cadence to a monthly amount", () => {
    expect(monthlyBillTotal([
      { amount: 100, cadence: "Monthly" },
      { amount: 12, cadence: "Weekly" }, // 52 a year
      { amount: 50, cadence: "Every 2 weeks" }, // 26 a year
      { amount: 120, cadence: "Yearly" },
    ])).toBeCloseTo(100 + 52 + 108.33 + 10, 1);
  });
});

describe("mergeNetWorthHistory", () => {
  it("keeps the estimated history before NorthStar's first recorded day", () => {
    const estimated = [{ date: "2026-11-14", value: 100 }, { date: "2026-11-15", value: 110 }, { date: "2026-11-16", value: 999 }, { date: "2026-11-17", value: 999 }];
    const recorded = [{ date: "2026-11-17", value: 130, capturedAt: "x" }, { date: "2026-11-16", value: 120, capturedAt: "x" }];
    expect(mergeNetWorthHistory(estimated, recorded)).toEqual([
      { date: "2026-11-14", value: 100 }, { date: "2026-11-15", value: 110 }, { date: "2026-11-16", value: 120 }, { date: "2026-11-17", value: 130 },
    ]);
    expect(mergeNetWorthHistory(estimated, [])).toBe(estimated);
  });
});
