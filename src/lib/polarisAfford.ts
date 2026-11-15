import { buildForecast, cashFromAccounts, evaluatePurchase, type Verdict } from "./safeToSpend";
import { templateSentence, verdictFacts } from "./safeToSpendExplain";
import { goalForItem } from "./envelopes";
import { formatMoney } from "./finance";
import type { BankData } from "./money";
import type { MoneyGoal } from "./types";

export interface AffordResult {
  verdict: Verdict | "covered";
  item: string;
  price: number;
  /** One plain sentence explaining the verdict (the same wording as the "Can I afford it?" page). */
  sentence: string;
  /** Most you could spend today and stay comfortable, when known. */
  comfortableLimit?: number;
}

/**
 * "Can I afford $80 shoes?" in the chat: the same 30-day Safe-to-Spend forecast the
 * "Can I afford it?" page uses (connected accounts plus manual checking/savings).
 * Returns null when there's no cash account to forecast from.
 */
export function checkAffordability(
  item: string,
  price: number,
  goals: MoneyGoal[],
  bankData: BankData | null | undefined,
  plan: { assets: { id?: string; kind: string; balance: number }[]; essentials: number; lifestyle: number },
): AffordResult | null {
  // A purchase with its own goal ("AirPods") is paid from that goal.
  const fund = goalForItem(item, goals);
  if (fund && fund.saved >= price) {
    return { verdict: "covered", item, price, sentence: `Your ${fund.name} goal already has ${formatMoney(fund.saved)} saved, so it covers this.` };
  }
  const accounts = bankData?.accounts ?? [];
  const fromBank = cashFromAccounts(accounts);
  // The plan's account list can include the linked bank accounts too; count those once, from the bank.
  const manual = plan.assets.filter(a => !accounts.some(acc => acc.id === a.id));
  const manualChecking = manual.filter(a => a.kind === "Checking").reduce((sum, a) => sum + a.balance, 0);
  const manualSavings = manual.filter(a => a.kind === "Savings").reduce((sum, a) => sum + a.balance, 0);
  if (!fromBank.cashAccountIds.length && !manualChecking && !manualSavings) return null;
  const otherGoals = goals.filter(g => g.id !== fund?.id).map(({ name, target, saved, weekly, emergency }) => ({ name, target, saved, weekly, emergency }));
  const forecast = buildForecast({
    cash: fromBank.checking + fromBank.savings + manualChecking + manualSavings,
    savings: 0,
    transactions: bankData?.transactions ?? [],
    cashAccountIds: fromBank.cashAccountIds,
    goals: otherGoals,
    fallbackMonthlySpending: plan.essentials + plan.lifestyle || undefined,
  });
  const result = evaluatePurchase(forecast, price);
  const sentence = templateSentence(verdictFacts(item, forecast, result, otherGoals.map(g => g.name)));
  return { verdict: result.verdict, item, price, sentence, comfortableLimit: result.comfortableLimit };
}
