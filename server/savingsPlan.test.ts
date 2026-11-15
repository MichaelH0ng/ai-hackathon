import { describe, expect, it } from "vitest";
import { addDays } from "../src/lib/dates.ts";
import type { BankAccount, BankTransaction } from "../src/lib/money.ts";
import { buildPlan, earnCap, planFacts, templateProposal } from "./savingsPlan.ts";

const today = "2026-11-14";
let n = 0;
const tx = (daysAgo: number, name: string, amount: number, category: string, accountId = "chk"): BankTransaction => ({ id: `t${++n}`, accountId, date: addDays(today, -daysAgo), name, amount, category, pending: false });
const accounts: BankAccount[] = [
  { id: "chk", name: "Checking", mask: null, type: "depository", subtype: "checking", current: 700, available: 700, institution: "Bank" },
  { id: "card", name: "Card", mask: null, type: "credit", subtype: "credit card", current: 200, available: null, institution: "Bank" },
];
const transactions = [
  ...[3, 17, 31, 45, 59].map((d) => tx(d, "CAMPUS BOOKSTORE PAYROLL", -412.5, "INCOME")),
  ...[2, 32].map((d) => tx(d, "Mustang Village", 350, "RENT_AND_UTILITIES")),
  ...[6, 36].map((d) => tx(d, "Spotify", 11.99, "ENTERTAINMENT", "card")),
  ...Array.from({ length: 20 }, (_, i) => tx(i * 3 + 1, "Starbucks", 6, "FOOD_AND_DRINK", "card")),
  ...Array.from({ length: 6 }, (_, i) => tx(i * 10 + 4, "Target", 40, "GENERAL_MERCHANDISE", "card")),
];
const facts = planFacts({ item: "car", price: 20000, transactions, accounts, goals: [{ target: 800, saved: 320, weekly: 40 }], hourlyWage: 18, today });

describe("planFacts", () => {
  it("measures income, bills, and flexible spending per month", () => {
    expect(facts.monthlyIncome).toBe(884);
    expect(facts.monthlyBills).toBe(362); // rent + Spotify
    expect(facts.monthlyGoalSavings).toBe(173);
    expect(facts.levers.map((l) => l.id)).toEqual(["category:GENERAL_MERCHANDISE", "category:FOOD_AND_DRINK", "merchant:Target", "merchant:Starbucks", "subscription:Spotify"]);
  });
  it("never offers rent as something to cut", () => {
    expect(facts.levers.some((l) => l.name.includes("Mustang") || l.group === "RENT_AND_UTILITIES")).toBe(false);
  });
});

describe("buildPlan", () => {
  it("caps cuts at real spending, even across a merchant and its category", () => {
    const plan = buildPlan(facts, {
      summary: "A car is a big goal.",
      cuts: [
        { leverId: "merchant:Starbucks", action: "Brew coffee at home most days", monthlySavings: 500 },
        { leverId: "category:FOOD_AND_DRINK", action: "Eat out less", monthlySavings: 50 },
        { leverId: "subscription:Spotify", action: "Switch to the student plan", monthlySavings: 6 },
        { leverId: "made-up", action: "Sell your car", monthlySavings: 900 },
      ],
      earn: [{ action: "Pick up a Saturday shift", monthlyAmount: 5000 }],
    }, today);
    expect(plan.cuts).toEqual([
      { name: "Starbucks", action: "Brew coffee at home most days", monthly: 60 },
      { name: "Spotify", action: "Switch to the student plan", monthly: 6 },
    ]);
    expect(plan.earn[0].monthly).toBe(earnCap(facts));
    expect(plan.weekly).toBe(Math.round(((facts.monthlyLeftover + 66 + earnCap(facts)) * 12) / 52));
    expect(plan.finishDate).toBe(addDays(today, Math.ceil(20000 / plan.weekly) * 7));
  });
  it("drops model text that brings its own dollar amounts", () => {
    const plan = buildPlan(facts, { summary: "Save $900 a month!", cuts: [{ leverId: "merchant:Target", action: "Cut Target to $10", monthlySavings: 40 }], earn: [] }, today);
    expect(plan.summary).not.toContain("$");
    expect(plan.cuts[0].action).toBe("Spend less on Target");
  });
  it("has a no-AI plan that always works", () => {
    const plan = buildPlan(facts, templateProposal(facts), today);
    expect(plan.cuts.length).toBeGreaterThan(0);
    expect(plan.weekly).toBeGreaterThan(0);
  });
});
