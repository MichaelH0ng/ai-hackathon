export type SpendingFrequency = "once" | "weekly" | "monthly" | "custom";
export type RepeatUnit = "days" | "weeks" | "months" | "years";

export function annualSpending(cost: number, frequency: SpendingFrequency, interval = 1, unit: RepeatUnit = "weeks") {
  if (!Number.isFinite(cost) || cost < 0) throw new RangeError("Cost must be a nonnegative number.");
  if (frequency === "once") return cost;
  if (frequency === "weekly") return cost * 52;
  if (frequency === "monthly") return cost * 12;
  if (!Number.isSafeInteger(interval) || interval < 1) throw new RangeError("Repeat interval must be a positive whole number.");
  return cost * ({ days: 364, weeks: 52, months: 12, years: 1 }[unit]) / interval;
}

export interface RetirementPoint {
  year: number;
  balance: number;
  contributions: number;
}

export function budgetBalanceProgress(income: number, remainder: number): number {
  if (!Number.isFinite(income) || !Number.isFinite(remainder) || income <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - Math.abs(remainder) / income) * 100));
}

/** Project a retirement balance with monthly contributions deposited at month end. */
export function retirementProjection(
  currentBalance: number,
  monthlyContribution: number,
  annualReturnPercent: number,
  years: number,
): RetirementPoint[] {
  if (
    ![currentBalance, monthlyContribution, annualReturnPercent, years].every(Number.isFinite) ||
    currentBalance < 0 ||
    monthlyContribution < 0 ||
    annualReturnPercent < 0 ||
    annualReturnPercent > 100 ||
    years < 0 ||
    years > 100 ||
    !Number.isInteger(years)
  ) {
    throw new RangeError("Retirement projection inputs are outside the supported range.");
  }

  const monthlyRate = annualReturnPercent / 100 / 12;
  const points: RetirementPoint[] = [{ year: 0, balance: currentBalance, contributions: currentBalance }];
  let balance = currentBalance;
  for (let year = 1; year <= years; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      balance = balance * (1 + monthlyRate) + monthlyContribution;
    }
    points.push({
      year,
      balance,
      contributions: currentBalance + monthlyContribution * year * 12,
    });
  }
  return points;
}

export function opportunityCost(cost: number, frequency: SpendingFrequency, target: number, saved: number, weekly: number, interval = 1, unit: RepeatUnit = "weeks") {
  const remaining = Math.max(0, target - saved);
  const monthlySavings = weekly * 52 / 12;
  const annualCost = annualSpending(cost, frequency, interval, unit);
  const monthlyCost = frequency === "once" ? 0 : annualCost / 12;
  const baselineMonths = remaining === 0 ? 0 : monthlySavings > 0 ? remaining / monthlySavings : Infinity;
  const afterMonths = remaining === 0 ? 0 : frequency === "once"
    ? monthlySavings > 0 ? (remaining + cost) / monthlySavings : Infinity
    : monthlySavings > monthlyCost ? remaining / (monthlySavings - monthlyCost) : Infinity;
  return { monthlyCost, annualCost,
    baselineMonths, afterMonths, delayDays: Number.isFinite(afterMonths) && Number.isFinite(baselineMonths) ? (afterMonths - baselineMonths) * 52 / 12 * 7 : Infinity };
}
