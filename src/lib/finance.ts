// Pure money math. No React, no storage — easy to test.

import { addDays, daysBetween, todayISO } from "./dates";

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
