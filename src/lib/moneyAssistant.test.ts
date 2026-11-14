import { describe, expect, it } from "vitest";
import { answerMoneyQuestion, type MoneyAssistantContext } from "./moneyAssistant";

const context: MoneyAssistantContext = {
  accounts: [{ name: "Everyday checking", kind: "Checking", balance: 1200, isDebt: false }],
  assets: 1200,
  debt: 200,
  netWorth: 1000,
  goals: [{ name: "Emergency fund", target: 2000, saved: 500, weekly: 50 }],
  monthlyIncome: 3000,
  monthlyExpenses: 1800,
  monthlyGoalContributions: 200,
  retirementBalance: 0,
  retirementEstimate: null,
  retirementAge: null,
};

describe("on-device money assistant", () => {
  it("answers questions using dashboard balances and goals", () => {
    expect(answerMoneyQuestion("What is my net worth?", context)).toContain("$1,000.00");
    expect(answerMoneyQuestion("How are my goals doing?", context)).toContain("Emergency fund");
    expect(answerMoneyQuestion("How much is in checking?", context)).toContain("$1,200.00");
  });

  it("asks for missing information instead of inventing an estimate", () => {
    expect(answerMoneyQuestion("How much can I save?", { ...context, monthlyIncome: 0 })).toContain("Add your monthly");
    expect(answerMoneyQuestion("How much will I have when I retire?", context)).toContain("Enter your ages");
  });

  it("explains common terms and answers investment questions", () => {
    expect(answerMoneyQuestion("What is a Roth IRA?", context)).toContain("after-tax money");
    expect(answerMoneyQuestion("How much is my portfolio worth?", context)).toContain("no brokerage or retirement accounts");
  });
});
