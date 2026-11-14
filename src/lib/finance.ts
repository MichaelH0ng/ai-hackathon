// Pure money math. No React, no storage — easy to test.

import { addDays, daysBetween, todayISO } from "./dates";

export type Risk = "low" | "medium" | "high";

const DAYS_PER_MONTH = 30.44;
const WEEKS_PER_MONTH = 4.345;

// ---------- Weekly savings plan (the core TradeOff flow) ----------

/** Weeks until the goal is funded at this weekly rate. 0 if done, Infinity if no savings. */
export function weeksToGoal(target: number, saved: number, weekly: number): number {
  const remaining = target - saved;
  if (remaining <= 0) return 0;
  if (weekly <= 0) return Infinity;
  return remaining / weekly;
}

/** Date the goal is reached if saving starts today. null if it never is. */
export function projectedDate(weeks: number, from: string = todayISO()): string | null {
  if (!isFinite(weeks)) return null;
  return addDays(from, Math.ceil(weeks * 7));
}

export interface WhatIf {
  originalWeeks: number;
  newWeeks: number;
  delayDays: number;
}

/**
 * What happens to the goal if `spend` comes out of savings and the weekly rate stays the same.
 * Example: $150 hoodie, $60 saved, $15/week → 6.0 weeks; spend $20 → 7.3 weeks (9.3 days later).
 */
export function whatIfSpend(target: number, saved: number, weekly: number, spend: number): WhatIf {
  const originalWeeks = weeksToGoal(target, saved, weekly);
  const newWeeks = weeksToGoal(target, saved - spend, weekly);
  return { originalWeeks, newWeeks, delayDays: (newWeeks - originalWeeks) * 7 };
}

/** Weekly amount that keeps the original finish date after spending `spend`. */
export function weeklyToKeepDate(target: number, saved: number, weekly: number, spend: number): number {
  const weeks = weeksToGoal(target, saved, weekly);
  if (!isFinite(weeks) || weeks <= 0) return weekly;
  return (target - saved + spend) / weeks;
}

/** Weekly amount needed to hit a deadline. */
export function weeklyNeededForDeadline(
  target: number,
  saved: number,
  deadline: string,
  from: string = todayISO(),
): number {
  const remaining = target - saved;
  if (remaining <= 0) return 0;
  const weeks = daysBetween(from, deadline) / 7;
  return weeks <= 0 ? remaining : remaining / weeks;
}

/**
 * Non-judgmental recommendation (decision assistant, not a scolding budget coach).
 */
export function recommendation(opts: {
  goalName: string;
  spendLabel: string;
  spendDelayDays: number;
  altLabel?: string;
  altPrice?: number;
  altDelayDays?: number;
  value?: string; // what the spend is really about, e.g. "spending time with friends"
  choiceLabel?: string; // how to name the choice at the end, e.g. "dinner out" (defaults to spendLabel)
}): string {
  const { goalName, spendLabel, spendDelayDays, altLabel, altPrice, altDelayDays, value } = opts;
  const choice = opts.choiceLabel ?? spendLabel;
  const parts = [`${capitalize(spendLabel)} will delay your ${goalName} goal by ${aboutDays(spendDelayDays)}.`];
  if (altLabel && altPrice != null && altDelayDays != null) {
    parts.push(
      altPrice > 0
        ? `${capitalize(altLabel)} for ${formatMoney(altPrice, altPrice % 1 !== 0)} instead would reduce that delay to ${aboutDays(altDelayDays)}.`
        : `${capitalize(altLabel)} instead would keep you on schedule.`,
    );
  }
  parts.push(
    value
      ? `However, if ${value} is important to you, you can still choose ${choice} and adjust your savings plan.`
      : `However, if it's important to you, you can still choose it and adjust your savings plan.`,
  );
  return parts.join(" ");
}

/** Positive opportunity cost of a repeated choice: saving `extraPerWeek` more each week. */
export function habitImpact(target: number, saved: number, weekly: number, extraPerWeek: number) {
  const before = weeksToGoal(target, saved, weekly);
  const after = weeksToGoal(target, saved, weekly + extraPerWeek);
  const daysSooner = isFinite(before) ? (before - after) * 7 : Infinity;
  return { before, after, daysSooner };
}

// ---------- Decision score (not every decision is purely financial) ----------

export interface ScoreInput {
  delayDays: number;
  goalWeeks: number; // current weeks to goal, to judge how big the delay is
  enjoyment: number; // 1–5
  importance: number; // 1–5
  urgency: number; // 1–5
  goalCertainty: number; // 0–100: how sure you are you want the goal itself
}

export interface Score {
  score: number; // 0–100
  verdict: string;
  reasons: string[];
}

export function decisionScore(i: ScoreInput): Score {
  const benefit = (i.enjoyment + i.importance + i.urgency - 3) / 12; // 0..1
  const relDelay =
    i.delayDays <= 0 ? 0 : isFinite(i.goalWeeks) && i.goalWeeks > 0 ? Math.min(1, i.delayDays / (i.goalWeeks * 7)) : 0.5;
  const cost = relDelay * (0.4 + 0.6 * (i.goalCertainty / 100));
  const score = Math.round(Math.max(0, Math.min(100, 50 + 50 * (benefit - cost))));

  const reasons: string[] = [];
  if (i.enjoyment >= 4) reasons.push("You'd really enjoy it");
  if (i.importance >= 4) reasons.push("It matters to you");
  if (i.urgency >= 4) reasons.push("It's now-or-never");
  if (i.enjoyment <= 2 && i.importance <= 2) reasons.push("Low enjoyment and importance");
  if (i.delayDays > 0) reasons.push(`Delays your goal ~${Math.round(i.delayDays)} days (${Math.round(relDelay * 100)}% of your timeline)`);
  else reasons.push("No delay to your goal");
  if (i.goalCertainty < 50) reasons.push("You're unsure about the goal itself, so the delay matters less");

  const verdict = score >= 70 ? "Worth it for you" : score >= 45 ? "Your call" : "Probably not worth it right now";
  return { score, verdict, reasons };
}

/** Advice when the user isn't sure they want the thing they're saving for. */
export function certaintyAdvice(certainty: number): string | null {
  if (certainty >= 70) return null;
  if (certainty >= 40)
    return "You're not totally sure you want this. Keep saving, but wait a week before buying. If you still want it then, go for it.";
  return "You're unsure you want this. Try waiting 30 days before committing money. The savings are yours either way, and you can put them toward another goal.";
}

/** "A new hoodie" → "new hoodie", so sentences read "your new hoodie goal". */
export function goalPhrase(name: string): string {
  return name.trim().replace(/^(a|an|the|my)\s+/i, "").toLowerCase();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function aboutDays(days: number): string {
  if (!isFinite(days)) return "an unknown amount (set a weekly savings amount)";
  const d = Math.round(days);
  if (d <= 0) return "less than a day";
  if (d < 14) return `about ${d} day${d === 1 ? "" : "s"}`;
  return `about ${(days / 7).toFixed(1)} weeks`;
}

// ---------- Hours of work ----------

export function hoursOfWork(price: number, hourlyWage: number): number {
  if (hourlyWage <= 0) return 0;
  return price / hourlyWage;
}

// ---------- Growth (longer-term goals) ----------

/** Months from today until `dateStr` (one decimal, at least 0). */
export function monthsUntil(dateStr: string, from: Date = new Date()): number {
  const days = daysBetween(todayISO(from), dateStr);
  return Math.max(0, Math.round((days / DAYS_PER_MONTH) * 10) / 10);
}

export function weeksToMonths(weeks: number): number {
  return weeks / WEEKS_PER_MONTH;
}

/** Value after `months` of monthly deposits, compounding monthly. */
export function projectedValue(current: number, monthly: number, months: number, annualRate: number): number {
  const r = annualRate / 12;
  if (r === 0) return current + monthly * months;
  const growth = Math.pow(1 + r, months);
  return current * growth + monthly * ((growth - 1) / r);
}

/** Monthly deposit needed to reach `target` in `months`, given an annual return. */
export function monthlyNeeded(target: number, current: number, months: number, annualRate = 0): number {
  const remainingNow = target - current;
  if (remainingNow <= 0) return 0;
  if (months <= 0) return remainingNow;
  const r = annualRate / 12;
  const growth = Math.pow(1 + r, months);
  const gap = target - current * growth;
  if (gap <= 0) return 0;
  if (r === 0) return gap / months;
  return (gap * r) / (growth - 1);
}

/** Annual return needed to reach `target`. 0 if none needed, null if even 50%/yr wouldn't do it. */
export function requiredRate(target: number, current: number, monthly: number, months: number): number | null {
  if (projectedValue(current, monthly, months, 0) >= target) return 0;
  if (months <= 0) return null;
  let lo = 0;
  let hi = 0.5;
  if (projectedValue(current, monthly, months, hi) < target) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (projectedValue(current, monthly, months, mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Lump sum grown for `years` at `annualRate`, compounded yearly. */
export function futureValue(amount: number, years: number, annualRate: number): number {
  return amount * Math.pow(1 + annualRate, years);
}

export interface Guidance {
  horizon: string;
  assumedReturn: number;
  options: string[];
  why: string;
}

/** General, educational guidance by time horizon. Not personalized advice. */
export function horizonGuidance(months: number, risk: Risk): Guidance {
  if (months < 12) {
    return {
      horizon: "Short term (under 1 year)",
      assumedReturn: 0.035,
      options: ["High-yield savings account", "Money market account", "Short-term CDs or Treasury bills"],
      why: "Money you need within a year usually stays out of the stock market. A drop right before you need it could leave you short, and there's no time to recover.",
    };
  }
  if (months < 36) {
    return {
      horizon: "Medium term (1–3 years)",
      assumedReturn: risk === "high" ? 0.05 : 0.04,
      options:
        risk === "high"
          ? ["High-yield savings or CDs for most of it", "Short-term bond funds", "A small slice in a broad stock index fund"]
          : ["High-yield savings account", "CD ladder or Treasury bills", "Short-term bond funds"],
      why: "With 1–3 years, protecting the money still matters more than growth. Stocks can lose 20%+ in a single year.",
    };
  }
  const byRisk: Record<Risk, { r: number; options: string[] }> = {
    low: { r: 0.05, options: ["Mostly bond index funds with some stock index funds", "Target-date fund near your goal year", "CDs / Treasuries for the part you can't risk"] },
    medium: { r: 0.06, options: ["Target-date fund matching your goal year", "Mix of broad stock and bond index funds", "Low-fee brokerage account (or Roth IRA for long-term goals)"] },
    high: { r: 0.07, options: ["Broad-market stock index funds (total market or S&P 500)", "Some international index fund for diversification", "Low-fee brokerage account (or Roth IRA for long-term goals)"] },
  };
  return {
    horizon: "Long term (3+ years)",
    assumedReturn: byRisk[risk].r,
    options: byRisk[risk].options,
    why: "Over long periods, diversified stock index funds have historically averaged roughly 7–10% a year, but with big down years (around −37% in 2008). More time means more room to ride those out.",
  };
}

// ---------- Formatting ----------

export function formatMoney(n: number, cents = false): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export function formatWeeks(weeks: number): string {
  if (!isFinite(weeks)) return "—";
  return `${weeks.toFixed(1)} weeks`;
}
