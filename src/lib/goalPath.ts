import { addDays, daysBetween, todayISO } from "./dates";
import { weeklyNeededForDeadline } from "./finance";
import { categoryLabel, detectTransferIds, type BankData } from "./money";
import type { MoneyGoal } from "./types";

const WEEKS_PER_MONTH = 52 / 12;
const LOOKBACK_DAYS = 60;
const FIXED_CATEGORIES = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS", "BANK_FEES", "GOVERNMENT_AND_NON_PROFIT"]);
const round = (value: number) => Math.round(value * 100) / 100;

export interface GoalRequirement {
  id: string;
  name: string;
  deadline: string;
  remaining: number;
  weekly: number;
}

export interface GoalPath {
  goals: GoalRequirement[];
  weeklyRequired: number;
  weeklyAvailable: number;
  weeklyGap: number;
}

/** The checked arithmetic behind a multi-goal path; no AI chooses these numbers. */
export function buildGoalPath(goals: MoneyGoal[], weeklyAvailable: number, today = todayISO()): GoalPath {
  const scheduled = goals
    .filter((goal) => goal.saved < goal.target && !!goal.deadline)
    .map((goal) => ({
      id: goal.id,
      name: goal.name,
      deadline: goal.deadline!,
      remaining: Math.max(0, goal.target - goal.saved),
      weekly: round(weeklyNeededForDeadline(goal.target, goal.saved, goal.deadline!, today)),
    }))
    .filter((goal) => goal.deadline > today);
  const weeklyRequired = round(scheduled.reduce((sum, goal) => sum + goal.weekly, 0));
  const available = Math.max(0, weeklyAvailable);
  return { goals: scheduled, weeklyRequired, weeklyAvailable: round(available), weeklyGap: round(Math.max(0, weeklyRequired - available)) };
}

export interface CutOpportunity {
  id: string;
  name: string;
  monthlySpend: number;
  suggestedWeeklyCut: number;
}

/** Conservative, user-controlled cut ideas from recent non-fixed transaction categories. */
export function cutOpportunities(data: BankData | null | undefined, today = todayISO()): CutOpportunity[] {
  if (!data?.transactions.length) return [];
  const since = addDays(today, -LOOKBACK_DAYS);
  const transferIds = detectTransferIds(data.transactions);
  const recent = data.transactions.filter((transaction) => !transaction.pending && !transferIds.has(transaction.id) && transaction.amount > 0 && transaction.date >= since && transaction.date <= today && !FIXED_CATEGORIES.has(transaction.category));
  if (!recent.length) return [];
  const earliest = recent.reduce((first, transaction) => transaction.date < first ? transaction.date : first, today);
  const spanDays = Math.max(14, Math.min(LOOKBACK_DAYS, daysBetween(earliest, today) + 1));
  const totals = new Map<string, number>();
  for (const transaction of recent) totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
  return [...totals.entries()]
    .map(([category, total]) => {
      const monthlySpend = round(total * 30 / spanDays);
      return { id: category, name: categoryLabel(category), monthlySpend, suggestedWeeklyCut: round(monthlySpend * 0.2 / WEEKS_PER_MONTH) };
    })
    .filter((item) => item.suggestedWeeklyCut >= 1)
    .sort((a, b) => b.suggestedWeeklyCut - a.suggestedWeeklyCut)
    .slice(0, 3);
}
