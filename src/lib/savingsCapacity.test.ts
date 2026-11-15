import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { savingsCapacity } from "./savingsCapacity";
import type { BankData, BankTransaction } from "./money";
import type { MoneyGoal } from "./types";

const transaction = (daysAgo: number, name: string, amount: number, category: string): BankTransaction => ({
  id: `${name}-${daysAgo}`, accountId: "checking", date: addDays("2026-11-15", -daysAgo), name, amount, category, pending: false,
});
const car: MoneyGoal = { kind: "money", id: "car", name: "Car", target: 10_000, saved: 0, weekly: 674 };
const bankData = (transactions: BankTransaction[]): BankData => ({
  env: "sandbox", fetchedAt: "2026-11-15T12:00:00.000Z", status: [], transactions,
  accounts: [{ id: "checking", name: "Checking", mask: null, type: "depository", subtype: "checking", current: 500, available: 500, institution: "NorthStar Bank" }],
});

describe("savingsCapacity", () => {
  it("does not recommend saving when there is no detected or entered income", () => {
    const result = savingsCapacity({ goals: [car], selectedGoalId: car.id, bankData: bankData([]), manualMonthlyIncome: 0 });
    expect(result.status).toBe("missing-income");
    expect(result.weeklyLimit).toBe(0);
  });

  it("uses recurring deposits and leaves room for spending and a buffer", () => {
    const transactions = [
      transaction(0, "Campus Payroll", -500, "INCOME"), transaction(14, "Campus Payroll", -500, "INCOME"), transaction(28, "Campus Payroll", -500, "INCOME"),
      transaction(2, "Rent", 300, "RENT_AND_UTILITIES"), transaction(32, "Rent", 300, "RENT_AND_UTILITIES"),
      transaction(5, "Groceries", 120, "FOOD_AND_DRINK"), transaction(15, "Groceries", 120, "FOOD_AND_DRINK"),
    ];
    const result = savingsCapacity({ goals: [car], selectedGoalId: car.id, bankData: bankData(transactions) });
    expect(result.incomeSource).toBe("detected");
    expect(result.monthlyIncome).toBeGreaterThan(1_000);
    expect(result.monthlySpending).toBeGreaterThan(500);
    expect(result.monthlyBuffer).toBeGreaterThan(0);
    expect(result.weeklyLimit).toBeGreaterThan(0);
    expect(result.weeklyLimit).toBeLessThan(150);
  });

  it("accounts for other goal commitments but not the goal being adjusted", () => {
    const result = savingsCapacity({
      goals: [car, { kind: "money", id: "trip", name: "Trip", target: 1_000, saved: 0, weekly: 50 }],
      selectedGoalId: car.id,
      manualMonthlyIncome: 1_000,
      manualMonthlyExpenses: 500,
    });
    expect(result.monthlyOtherGoals).toBeCloseTo(216.67, 1);
    expect(result.weeklyLimit).toBeGreaterThan(0);
    expect(result.weeklyLimit).toBeLessThan(60);
  });

  it("does not count a completed goal as an ongoing monthly contribution", () => {
    const result = savingsCapacity({
      goals: [{ ...car, saved: car.target, weekly: 674 }],
      selectedGoalId: "__monthly-plan__",
      manualMonthlyIncome: 1_000,
      manualMonthlyExpenses: 100,
    });
    expect(result.monthlyOtherGoals).toBe(0);
    expect(result.status).toBe("available");
  });
});
