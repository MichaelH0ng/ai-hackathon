import { formatMoneyRaw } from "./finance";
import type { MoneyAssistantContext } from "./moneyAssistant";

export interface PolarisMoodNote {
  mood: "happy" | "worried";
  text: string;
}

/**
 * How Polaris feels about the dashboard right now, with one line saying why.
 * Worried wins over happy: a budget that runs over income is the more useful thing to point out.
 * Returns null when there's nothing to react to.
 */
export function polarisMood(context: Pick<MoneyAssistantContext, "goals" | "monthlyIncome" | "monthlyExpenses" | "monthlyGoalContributions">): PolarisMoodNote | null {
  const { goals, monthlyIncome, monthlyExpenses, monthlyGoalContributions } = context;
  const overBy = monthlyExpenses + monthlyGoalContributions - monthlyIncome;
  if (monthlyIncome > 0 && overBy > 0) {
    return { mood: "worried", text: `Your monthly plan is ${formatMoneyRaw(overBy)} over your income. Want help trimming it?` };
  }
  const funded = goals.filter(g => g.target > 0);
  const done = funded.find(g => g.saved >= g.target);
  if (done) return { mood: "happy", text: `You fully funded ${done.name}! 🎉` };
  const close = funded
    .filter(g => g.saved / g.target >= 0.9)
    .sort((a, b) => b.saved / b.target - a.saved / a.target)[0];
  if (close) return { mood: "happy", text: `${close.name} is ${Math.floor(close.saved / close.target * 100)}% funded. Almost there!` };
  return null;
}
