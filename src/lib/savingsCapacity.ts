import { detectTransferIds, type BankData } from "./money";
import { todayISO } from "./dates";
import { cashFromAccounts, dailySpending, monthlyIncome, recurring } from "./safeToSpend";
import type { MoneyGoal } from "./types";

const WEEKS_PER_MONTH = 52 / 12;
const round = (value: number) => Math.round(value * 100) / 100;

export type SavingsCapacityStatus = "available" | "missing-income" | "no-room";
export type IncomeSource = "detected" | "manual" | "none";
export type SpendingSource = "observed" | "manual" | "none";

export interface SavingsCapacity {
  status: SavingsCapacityStatus;
  incomeSource: IncomeSource;
  monthlyIncome: number;
  monthlySpending: number;
  spendingSource: SpendingSource;
  monthlyOtherGoals: number;
  monthlyBuffer: number;
  weeklyLimit: number;
}

/**
 * A conservative weekly amount that can go toward one selected goal.
 * Repeating Plaid deposits take priority over a hand-entered budget; when Plaid
 * cannot establish income, the budget becomes the explicit fallback. A goal's
 * own current contribution is deliberately excluded so the user can replace it.
 */
export function savingsCapacity(input: {
  bankData?: BankData | null;
  goals: MoneyGoal[];
  selectedGoalId: string;
  manualMonthlyIncome?: number;
  manualMonthlyExpenses?: number;
}): SavingsCapacity {
  const data = input.bankData;
  const today = data?.fetchedAt.slice(0, 10) ?? todayISO();
  const cashAccountIds = data ? cashFromAccounts(data.accounts).cashAccountIds : [];
  const detectedIncome = data && cashAccountIds.length
    ? monthlyIncome(data.transactions, cashAccountIds, today)
    : 0;
  const manualIncome = Math.max(0, input.manualMonthlyIncome ?? 0);
  const incomeSource: IncomeSource = detectedIncome > 0 ? "detected" : manualIncome > 0 ? "manual" : "none";
  const income = detectedIncome > 0 ? detectedIncome : manualIncome;

  let observedSpending = 0;
  if (data?.transactions.length) {
    const transferIds = detectTransferIds(data.transactions);
    const usable = data.transactions.filter((transaction) => !transaction.pending && !transferIds.has(transaction.id));
    const bills = recurring(usable, "out", today);
    const billsPerMonth = bills.reduce((sum, bill) => sum + (bill.amount * 30) / bill.everyDays, 0);
    const everydayPerMonth = dailySpending(usable, transferIds, new Set(bills.map((bill) => bill.name)), today) * 30;
    observedSpending = billsPerMonth + everydayPerMonth;
  }
  // A user's stated budget can include cash expenses that Plaid cannot see, so
  // never allow partial transaction history to lower that estimate.
  const manualSpending = Math.max(0, input.manualMonthlyExpenses ?? 0);
  const monthlySpending = Math.max(observedSpending, manualSpending);
  const spendingSource: SpendingSource = observedSpending > 0 && observedSpending >= manualSpending
    ? "observed"
    : manualSpending > 0 ? "manual" : "none";
  const monthlyOtherGoals = input.goals
    .filter((goal) => goal.id !== input.selectedGoalId && goal.saved < goal.target)
    .reduce((sum, goal) => sum + Math.max(0, goal.weekly) * WEEKS_PER_MONTH, 0);
  if (income <= 0) {
    return { status: "missing-income", incomeSource, monthlyIncome: 0, monthlySpending: round(monthlySpending), spendingSource, monthlyOtherGoals: round(monthlyOtherGoals), monthlyBuffer: 0, weeklyLimit: 0 };
  }
  // Keep a modest amount unassigned for a normal week before recommending saving.
  const monthlyBuffer = Math.min(150, Math.max(25, income * 0.05));
  const remaining = income - monthlySpending - monthlyOtherGoals - monthlyBuffer;

  return {
    status: remaining > 0 ? "available" : "no-room",
    incomeSource,
    monthlyIncome: round(income),
    monthlySpending: round(monthlySpending),
    spendingSource,
    monthlyOtherGoals: round(monthlyOtherGoals),
    monthlyBuffer: round(monthlyBuffer),
    weeklyLimit: round(Math.max(0, remaining) / WEEKS_PER_MONTH),
  };
}
