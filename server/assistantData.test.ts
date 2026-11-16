import { describe, expect, it } from "vitest";
import type { BankTransaction } from "../src/lib/money.ts";
import { monthlySummaries, needsSonnet, comparisonPeriods, goalFinishDate, hasUnmatchedSubject, matchCategory, matchGoal, matchMerchant, rollingRange, windowTotals, explicitRange, followUpQuestion } from "./assistantData.ts";

const tx = (id: string, name: string, amount: number, category: string, date = "2026-11-10"): BankTransaction => ({ id, accountId: "a", date, name, amount, category, pending: false });
const transactions = [
  tx("1", "Starbucks", 6.45, "FOOD_AND_DRINK"),
  tx("2", "Starbucks", 4.75, "FOOD_AND_DRINK"),
  tx("3", "Chipotle", 14.6, "FOOD_AND_DRINK"),
  tx("4", "Uber", 14.2, "TRANSPORTATION"),
  tx("5", "Mustang Village", 350, "RENT_AND_UTILITIES"),
  tx("6", "CAMPUS BOOKSTORE PAYROLL", -412.5, "INCOME"),
];

describe("matching what a question is about", () => {
  it("finds one category from everyday words", () => {
    expect(matchCategory("How much did I spend on food this month?")).toBe("FOOD_AND_DRINK");
    expect(matchCategory("transportation last month")).toBe("TRANSPORTATION");
    expect(matchCategory("How much did I spend?")).toBeNull();
  });
  it("finds a merchant the user actually paid", () => {
    expect(matchMerchant("How much have I spent at Starbucks?", transactions)).toBe("Starbucks");
    expect(matchMerchant("spent at Target?", transactions)).toBeNull();
  });
  it("notices a narrower subject it can't match exactly", () => {
    expect(hasUnmatchedSubject("how much did i spnd on coffe")).toBe(true);
    expect(hasUnmatchedSubject("How much did I spend last month?")).toBe(false);
  });
});

describe("windowTotals", () => {
  it("adds spending by category and merchant, and inflows separately", () => {
    const totals = windowTotals(transactions, new Set());
    expect(totals.spendingTotal).toBe(390);
    expect(totals.inflowTotal).toBe(412.5);
    expect(totals.netCashFlow).toBe(22.5);
    expect(totals.spendingByCategory["food and drink"]).toBe(25.8);
    expect(totals.spendingByMerchant[1]).toEqual({ merchant: "Chipotle", total: 14.6, count: 1 });
    expect(totals.spendingByMerchant.find((m) => m.merchant === "Starbucks")).toEqual({ merchant: "Starbucks", total: 11.2, count: 2 });
  });
});

describe("comparisonPeriods", () => {
  const now = new Date(2026, 10, 14); // Saturday, Nov 14 2026
  it("returns both weeks for a this-vs-last-week question", () => {
    expect(comparisonPeriods("Did I spend more this week than last week?", now)).toEqual([
      { label: "last week", start: "2026-11-01", endExclusive: "2026-11-08" },
      { label: "this week so far", start: "2026-11-08", endExclusive: "2026-11-15" },
    ]);
  });
  it("ignores single-period questions", () => {
    expect(comparisonPeriods("How much did I spend last week?", now)).toBeNull();
  });
});

describe("goals", () => {
  const goals = [{ name: "Spring break trip", target: 800, saved: 320, weekly: 40 }, { name: "New phone", target: 60, saved: 60, weekly: 10 }];
  it("matches the goal a question names", () => {
    expect(matchGoal("When will I reach my spring break goal?", goals)?.name).toBe("Spring break trip");
    expect(matchGoal("How are my goals doing?", goals)).toBeNull();
  });
  it("projects a finish date from the weekly amount", () => {
    expect(goalFinishDate(goals[0], new Date(2026, 10, 14))).toBe("Feb 6, 2027");
    expect(goalFinishDate(goals[1])).toBeNull();
  });
});

describe("rollingRange", () => {
  const now = new Date(2026, 10, 14); // Nov 14, 2026
  it("reads rolling windows in digits or words", () => {
    expect(rollingRange("how much money did i get in the last 2 weeks?", now)).toEqual({ label: "the last 2 weeks", start: "2026-11-01", endExclusive: "2026-11-15" });
    expect(rollingRange("spending over the past ten days", now)).toEqual({ label: "the last 10 days", start: "2026-11-05", endExclusive: "2026-11-15" });
    expect(rollingRange("last couple of months", now)?.label).toBe("the last 2 months");
    expect(rollingRange("this past fortnight", now)?.label).toBe("the last 2 weeks");
    expect(rollingRange("last fortnight", now)?.start).toBe("2026-11-01");
  });
  it("leaves calendar phrases to the existing rules", () => {
    expect(rollingRange("what did I spend last week?", now)).toBeNull();
    expect(rollingRange("how much this month?", now)).toBeNull();
  });
});

describe("explicitRange", () => {
  const now = new Date(2026, 10, 14); // Nov 14, 2026
  it("reads named years and months", () => {
    expect(explicitRange("How much did I spend in 2024?", now)).toEqual({ label: "2024", start: "2024-01-01", endExclusive: "2025-01-01" });
    expect(explicitRange("What did I spend in October?", now)).toEqual({ label: "October 2026", start: "2026-10-01", endExclusive: "2026-11-01" });
    expect(explicitRange("spending during December", now)?.label).toBe("December 2025");
    expect(explicitRange("income for sep 2026", now)?.label).toBe("September 2026");
  });
  it("ignores lookalikes", () => {
    expect(explicitRange("I may need a new laptop", now)).toBeNull();
    expect(explicitRange("Can I afford a $2025 trip?", now)).toBeNull();
  });
});

describe("followUpQuestion", () => {
  const history = [{ role: "user", content: "How much did I spend on food this month?" }, { role: "assistant", content: "$77.45" }];
  it("carries the previous topic into a short follow-up", () => {
    expect(followUpQuestion("And last month?", history)).toBe("And last month? How much did I spend on food ?");
    // A new subject keeps the earlier time window, and is mentioned first so it wins.
    const coffee = [{ role: "user", content: "How much did I spend at Starbucks this month?" }];
    expect(followUpQuestion("What about Chipotle?", coffee)).toBe("What about Chipotle? How much did I spend at Starbucks this month?");
    expect(matchMerchant("What about Chipotle? How much did I spend at Starbucks this month?", transactions)).toBe("Chipotle");
  });
  it("leaves full questions alone", () => {
    expect(followUpQuestion("What's my credit card balance right now?", history)).toBe("What's my credit card balance right now?");
  });
});

describe("monthlySummaries", () => {
  const tx = (date: string, amount: number, name = "Cafe", category = "FOOD_AND_DRINK") => ({ id: `${date}-${name}-${amount}`, accountId: "chk", date, name, amount, category, pending: false });
  it("summarizes each calendar month, newest first, with exact totals", () => {
    const rows = monthlySummaries([tx("2026-10-02", 10), tx("2026-10-20", 5.5), tx("2026-09-01", 20), tx("2026-09-15", -500, "Payroll", "INCOME"), tx("2026-11-03", 7)], new Set(), new Date(2026, 10, 15));
    expect(rows.map((r) => r.month)).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(rows[0]).toMatchObject({ partialMonth: true, spending: 7 });
    expect(rows[1]).toMatchObject({ spending: 15.5, income: 0 });
    expect(rows[1].partialMonth).toBeUndefined();
    expect(rows[2]).toMatchObject({ spending: 20, income: 500, net: 480 });
  });
  it("keeps only the newest months", () => {
    const many = Array.from({ length: 30 }, (_, i) => tx(`${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-05`, 1));
    const rows = monthlySummaries(many, new Set(), new Date(2026, 10, 15), 24);
    expect(rows).toHaveLength(24);
    expect(rows[0].month).toBe("2026-06");
  });
});

describe("needsSonnet", () => {
  it("keeps everyday questions on Haiku", () => {
    for (const q of ["Where is my money going?", "Why did I spend more this month?", "Compare food this month to last month", "Can you explain my spending trend this year?", "What subscriptions do I have?"]) expect(needsSonnet(q)).toBe(false);
  });
  it("sends planning and trade-off decisions to Sonnet", () => {
    for (const q of ["Make me a plan to save $2,000 by June", "Should I pay off my card or save?", "How should I start investing?", "What's the best strategy for my student loans?"]) expect(needsSonnet(q)).toBe(true);
  });
});

describe("rollingRange in years", () => {
  it("reads 'last 2 years'", () => {
    expect(rollingRange("what did I spend in the last 2 years", new Date(2026, 10, 14))).toMatchObject({ label: "the last 2 years", start: "2024-11-15", endExclusive: "2026-11-15" });
  });
});
