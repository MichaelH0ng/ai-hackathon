import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import type { BankTransaction } from "./money";
import { buildForecast, cashFromAccounts, emergencyReserve, evaluatePurchase, goalReserve, isEmergencyFund, recurring, type SafeToSpendInputs } from "./safeToSpend";

const today = "2026-11-14";
let n = 0;
const tx = (daysAgo: number, name: string, amount: number, accountId = "chk", category = "GENERAL_MERCHANDISE"): BankTransaction => ({
  id: `t${++n}`, accountId, date: addDays(today, -daysAgo), name, amount, category, pending: false,
});

// Shaped like the sandbox student: paid every 2 weeks, rent and phone monthly, small card purchases.
const transactions: BankTransaction[] = [
  ...[3, 17, 31, 45, 59, 73, 87].map((d) => tx(d, "CAMPUS BOOKSTORE PAYROLL", -412.5, "chk", "INCOME")),
  ...[2, 32, 62].map((d) => tx(d, "Mustang Village", 350, "chk", "RENT_AND_UTILITIES")),
  ...[5, 35, 65].map((d) => tx(d, "Verizon", 45, "chk", "RENT_AND_UTILITIES")),
  ...[10, 40, 70].map((d) => tx(d, "Payment Thank You", -150, "card", "LOAN_PAYMENTS")),
  ...Array.from({ length: 30 }, (_, i) => tx(i * 2 + 1, i % 2 ? "Chipotle" : "Trader Joe's", i % 2 ? 14 : 22, "card", "FOOD_AND_DRINK")),
];

const inputs: SafeToSpendInputs = {
  cash: 742.18,
  savings: 860,
  transactions,
  cashAccountIds: ["chk", "sav"],
  goals: [{ name: "Spring break trip", target: 800, saved: 320, weekly: 40 }],
  today,
};

describe("recurring", () => {
  it("finds the paycheck and projects the next one", () => {
    const income = recurring(transactions.filter((t) => t.accountId === "chk"), "in", today);
    expect(income).toEqual([{ name: "CAMPUS BOOKSTORE PAYROLL", amount: 412.5, cadence: "Every 2 weeks", everyDays: 14, nextDate: "2026-11-25" }]);
  });
});

describe("buildForecast", () => {
  const forecast = buildForecast(inputs);

  it("projects 30 days with paychecks in and bills out", () => {
    expect(forecast.days).toHaveLength(30);
    expect(forecast.nextIncome).toMatchObject({ date: "2026-11-25", amount: 412.5, kind: "income" });
    expect(forecast.events.some((e) => e.name === "Mustang Village" && e.date === "2026-12-12")).toBe(true);
    expect(forecast.confidence).toBe("full");
  });

  it("does not treat a card payment as income or a bill as everyday spending", () => {
    expect(forecast.events.some((e) => e.name === "Payment Thank You")).toBe(false);
    // 30 purchases averaging $18 over the last 60 days ≈ $9/day; rent and phone excluded.
    expect(forecast.dailySpending).toBeCloseTo(9, 0);
  });

  it("lets you spend down to the lowest projected balance, no further", () => {
    expect(forecast.headroom).toBeCloseTo(forecast.lowPoint, 2);
  });
});

describe("evaluatePurchase", () => {
  const forecast = buildForecast(inputs);

  it("gives green, yellow, and red as the price grows", () => {
    expect(evaluatePurchase(forecast, 20).verdict).toBe("safe");
    expect(evaluatePurchase(forecast, Math.floor(forecast.headroom * 0.8)).verdict).toBe("tight");
    expect(evaluatePurchase(forecast, forecast.headroom + 50).verdict).toBe("not-yet");
  });

  it("names the paycheck after which a red purchase becomes safe", () => {
    const result = evaluatePurchase(forecast, forecast.headroom + 50);
    expect(result.safeDate).toEqual({ date: "2026-11-25", after: "CAMPUS BOOKSTORE PAYROLL" });
    expect(result.options.map((o) => o.id)).toContain("wait-until");
  });

  it("offers savings or a new goal when no date in the window works", () => {
    const covered = evaluatePurchase(forecast, forecast.headroom + 800);
    expect(covered.safeDate).toBeNull();
    expect(covered.coveredBySavings).toBe(true);
    const tooBig = evaluatePurchase(forecast, 5000);
    expect(tooBig.options.map((o) => o.id)).toContain("save-for-it");
  });

  it("lowers the projected low point by exactly the price", () => {
    expect(evaluatePurchase(forecast, 100).lowPointAfter).toBeCloseTo(forecast.lowPoint - 100, 2);
  });
});

describe("emergency fund", () => {
  it("recognizes emergency-fund goals by name and counts what's saved", () => {
    expect(emergencyReserve([{ name: "Emergency fund", target: 1000, saved: 400, weekly: 25 }, { name: "Spring break trip", target: 800, saved: 320, weekly: 40 }]))
      .toEqual({ amount: 400, name: "Emergency fund" });
    expect(emergencyReserve([{ name: "Rainy day money", target: 300, saved: 500, weekly: 0 }])).toEqual({ amount: 300, name: "Rainy day money" });
    expect(emergencyReserve([{ name: "Japan trip", target: 2000, saved: 900, weekly: 50 }])).toEqual({ amount: 0, name: null });
  });

  it("lets the user's checkbox override the name in either direction", () => {
    expect(emergencyReserve([{ name: "Just in case", target: 500, saved: 250, weekly: 10, emergency: true }])).toEqual({ amount: 250, name: "Just in case" });
    expect(emergencyReserve([{ name: "Emergency fund", target: 1000, saved: 400, weekly: 25, emergency: false }])).toEqual({ amount: 0, name: null });
    expect(isEmergencyFund({ name: "Rainy-day savings" })).toBe(true);
    expect(isEmergencyFund({ name: "Rainy-day savings", emergency: false })).toBe(false);
  });

  it("keeps the fund out of spendable cash, so the same price can turn red", () => {
    const withFund = buildForecast({ ...inputs, goals: [...inputs.goals, { name: "Emergency fund", target: 1000, saved: 400, weekly: 0 }] });
    const without = buildForecast(inputs);
    expect(withFund.reserved).toBe(720); // every goal's savings are set aside: 400 + the trip's 320
    expect(withFund.cash).toBe(without.cash); // cash today is unchanged; the fund is set aside from it
    expect(withFund.lowPoint).toBeCloseTo(without.lowPoint - 400, 2);
    const price = without.headroom - 100; // fits without the fund...
    expect(evaluatePurchase(without, price).verdict).toBe("tight");
    expect(evaluatePurchase(withFund, price).verdict).toBe("not-yet"); // ...but would dip into it
  });
});

describe("goalReserve", () => {
  it("sets aside every goal's savings, naming the goal only when there's one", () => {
    expect(goalReserve([{ name: "Car", target: 20000, saved: 600, weekly: 50 }, { name: "AirPods", target: 100, saved: 170, weekly: 0 }])).toEqual({ amount: 770, name: null });
    expect(goalReserve([{ name: "AirPods", target: 100, saved: 170, weekly: 0 }, { name: "Car", target: 20000, saved: 0, weekly: 50 }])).toEqual({ amount: 170, name: "AirPods" });
  });

  it("does not reserve the same linked balance twice", () => {
    expect(goalReserve([
      { name: "Car", target: 10_000, saved: 600, weekly: 50, linkedAccountId: "savings" },
      { name: "Study abroad", target: 8_000, saved: 600, weekly: 40, linkedAccountId: "savings" },
      { name: "Textbooks", target: 300, saved: 100, weekly: 10 },
    ])).toEqual({ amount: 700, name: null });
  });
});

describe("without transaction history", () => {
  it("falls back to the Budget's monthly spending and marks the result an estimate", () => {
    const forecast = buildForecast({ ...inputs, transactions: [], fallbackMonthlySpending: 600 });
    expect(forecast.dailySpending).toBe(20);
    expect(forecast.events).toEqual([]);
    expect(forecast.confidence).toBe("estimate");
  });
});

describe("cashFromAccounts", () => {
  it("counts checking as spendable and keeps savings separate", () => {
    const accounts = [
      { id: "chk", name: "Checking", mask: null, type: "depository", subtype: "checking", current: 742.18, available: 742.18, institution: "Campus Bank" },
      { id: "sav", name: "Savings", mask: null, type: "depository", subtype: "savings", current: 860, available: null, institution: "Sunrise" },
      { id: "card", name: "Visa", mask: null, type: "credit", subtype: "credit card", current: 184.62, available: 815.38, institution: "Campus Bank" },
    ];
    expect(cashFromAccounts(accounts)).toEqual({ checking: 742.18, savings: 860, cashAccountIds: ["chk", "sav"] });
  });
});

describe("lowPointBreakdown", () => {
  it("adds up exactly to the lowest point", async () => {
    const { lowPointBreakdown } = await import("./safeToSpend");
    const b = lowPointBreakdown(buildForecast(inputs));
    const total = b.cash - b.reserved + b.income - b.bills.reduce((s, x) => s + x.amount, 0) - b.everyday;
    expect(total).toBeCloseTo(b.lowPoint, 1);
  });
  it("treats weekly goal amounts as targets, not money leaving the account", () => {
    const big = buildForecast({ ...inputs, goals: [{ name: "Car", target: 20000, saved: 0, weekly: 275 }] });
    const none = buildForecast({ ...inputs, goals: [] });
    expect(big.lowPoint).toBe(none.lowPoint);
  });
});
