import { describe, expect, it } from "vitest";
import { answerMoneyQuestion, type MoneyAssistantContext } from "./moneyAssistant";
import type { AssistantTurn } from "./investingConversation";

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
  it("uses short follow-up replies and asks only for missing investing details", () => {
    const history: AssistantTurn[] = [];
    const ask = (question: string) => {
      const answer = answerMoneyQuestion(question, context, history);
      history.push({ role: "user", text: question }, { role: "assistant", text: answer });
      return answer;
    };
    ask("How do I start investing?");
    expect(ask("10 years")).toContain("You said you need the money in 10 years");
    const answer = ask("I would hold");
    expect(answer).toContain("10 years");
    expect(answer).toContain("stay invested");
    expect(answer).not.toContain("How would you react");
  });

  it("clarifies ambiguous replies, accepts corrections, and allows topic changes", () => {
    const history: AssistantTurn[] = [
      { role: "user", text: "How should I diversify?" },
      { role: "assistant", text: answerMoneyQuestion("How should I diversify?", context) },
    ];
    const unclear = answerMoneyQuestion("yes", context, history);
    expect(unclear).toContain("not sure");
    history.push({ role: "user", text: "yes" }, { role: "assistant", text: unclear });
    const answer = answerMoneyQuestion("6 months", context, history);
    expect(answer).toContain("near-term");
    history.push({ role: "user", text: "6 months" }, { role: "assistant", text: answer });
    expect(answerMoneyQuestion("Actually 10 years", context, history)).toContain("10 years");
    expect(answerMoneyQuestion("What is my net worth?", context, history)).toContain("$1,000.00");
    expect(answerMoneyQuestion("What is an HSA?", context, history)).toContain("HSA:");
  });
  it("compares retirement accounts before generic account and investing handlers", () => {
    const answer = answerMoneyQuestion("Compare Roth IRA vs traditional IRA for investing", context);
    expect(answer).toContain("Traditional IRA:");
    expect(answer).toContain("Roth IRA:");
    expect(answerMoneyQuestion("Explain Roth 401(k)", context)).toContain("401(k):");
    expect(answerMoneyQuestion("Explain Roth 401(k)", context)).not.toContain("Roth IRA:");
    expect(answerMoneyQuestion("How much is in checking?", context)).toContain("$1,200.00");
  });

  it("covers health and education accounts and handles unverified annual limits", () => {
    expect(answerMoneyQuestion("HSA vs FSA", context)).toContain("Unused funds are generally forfeited");
    expect(answerMoneyQuestion("What is a 529?", context)).toContain("not federally deductible");
    expect(answerMoneyQuestion("What is my IRA contribution limit?", context)).toContain("don’t have a live tax-rule lookup");
    const overview = answerMoneyQuestion("Explain different retirement and tax-benefit accounts", context);
    for (const label of ["401(k):", "403(b):", "457(b):", "HSA:", "529 plan:"]) expect(overview).toContain(label);
  });
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

  it("prioritizes investing guidance over savings lookups and uses budget context", () => {
    expect(answerMoneyQuestion("How should I invest my savings?", context)).toContain("$1,000.00");
    expect(answerMoneyQuestion("How do I start investing?", { ...context, monthlyIncome: 0 })).toContain("Add income and expenses");
    expect(answerMoneyQuestion("How do I start investing?", { ...context, monthlyExpenses: 4000 })).toContain("Review that shortfall");
  });

  it("explains investment risks without inventing security recommendations", () => {
    expect(answerMoneyQuestion("How should I diversify?", context)).toContain("can also lose value");
    expect(answerMoneyQuestion("Explain index funds", context)).toContain("expense ratios");
    expect(answerMoneyQuestion("What stocks should I buy?", context)).toContain("don’t have live prices");
  });

  it("greets, reports card debt, and dates a named goal", () => {
    const withCard: MoneyAssistantContext = { ...context, accounts: [...context.accounts, { name: "Student Visa", kind: "Credit card", balance: 200, isDebt: true }] };
    expect(answerMoneyQuestion("hi", withCard)).toContain("I’m Polaris");
    expect(answerMoneyQuestion("What's my credit card balance?", withCard)).toBe("Student Visa (Credit card): $200.00 owed.");
    expect(answerMoneyQuestion("When will I reach my emergency fund goal?", withCard)).toMatch(/Emergency fund: \$500\.00 of \$2,000\.00 \(25%\)\. At \$50\.00 per week, you’d reach it around /);
  });

  it("says plainly when a question needs transaction history", () => {
    expect(answerMoneyQuestion("How much did I spend on food this month?", context)).toContain("can’t read your transaction history");
    expect(answerMoneyQuestion("When is my rent due?", context)).toContain("can’t read your transaction history");
    // Budget questions still use the entered budget.
    expect(answerMoneyQuestion("What's my monthly income left over?", context)).toContain("$3,000.00 monthly income");
  });
});
