import { describe, expect, it } from "vitest";
import type { BankTransaction } from "../src/lib/money.ts";
import { comparisonPeriods, goalFinishDate, hasUnmatchedSubject, matchCategory, matchGoal, matchMerchant, windowTotals } from "./assistantData.ts";

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
  const goals = [{ name: "Spring break trip", target: 800, saved: 320, weekly: 40 }, { name: "Hoodie", target: 60, saved: 60, weekly: 10 }];
  it("matches the goal a question names", () => {
    expect(matchGoal("When will I reach my spring break goal?", goals)?.name).toBe("Spring break trip");
    expect(matchGoal("How are my goals doing?", goals)).toBeNull();
  });
  it("projects a finish date from the weekly amount", () => {
    expect(goalFinishDate(goals[0], new Date(2026, 10, 14))).toBe("Feb 6, 2027");
    expect(goalFinishDate(goals[1])).toBeNull();
  });
});
