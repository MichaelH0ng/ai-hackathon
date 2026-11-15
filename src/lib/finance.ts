// Pure money math. No React, no storage — easy to test.

import { addDays, daysBetween, todayISO } from "./dates";

// ---------- Weekly savings plan (the core NorthStar flow) ----------

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
  // Keep the name exactly as the user wrote it ("Japan trip", "Emergency Fund"); only drop a leading article.
  return name.trim().replace(/^(a|an|the|my)\s+/i, "");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function aboutDays(days: number): string {
  if (!isFinite(days)) return "an unknown amount (set a weekly savings amount)";
  const d = Math.round(days);
  if (d <= 0) return "less than a day";
  return `about ${formatDelay(days)}`;
}

// ---------- Hours of work ----------

export function hoursOfWork(price: number, hourlyWage: number): number {
  if (hourlyWage <= 0) return 0;
  return price / hourlyWage;
}

/** A delay in the unit that reads best: days, then weeks, months, or years ("+1,813.5 days" → "5 years"). */
export function formatDelay(days: number): string {
  const d = Math.max(0, days);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (d < 14) return unit(Number(d.toFixed(d < 1 ? 1 : 0)), "day");
  if (d < 60) return unit(Math.round(d / 7), "week");
  // Two units from here on: "4 months, 1 week", "7 years, 8 months".
  const pair = (big: number, bigWord: string, small: number, smallWord: string) => (small ? `${unit(big, bigWord)}, ${unit(small, smallWord)}` : unit(big, bigWord));
  if (d < 730) {
    let months = Math.floor(d / 30.44);
    let weeks = Math.round((d - months * 30.44) / 7);
    if (weeks >= 4) { months += 1; weeks = 0; }
    return pair(months, "month", weeks, "week");
  }
  let years = Math.floor(d / 365.25);
  let months = Math.round((d - years * 365.25) / 30.44);
  if (months >= 12) { years += 1; months = 0; }
  return pair(years, "year", months, "month");
}

export function formatHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole} hour${whole === 1 ? "" : "s"}`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * Puts a price in a unit people can feel: hours of work for everyday buys, then weeks,
 * months, or years of take-home pay for big ones ("1,111 hours" means nothing; "about
 * 2 years of your paychecks" does). Returns null when there's no pay to compare with.
 */
export function priceInContext(price: number, pay: { hourlyWage?: number | null; monthlyIncome?: number | null }): { before: string; strong: string; after: string } | null {
  const wage = pay.hourlyWage && pay.hourlyWage > 0 ? pay.hourlyWage : null;
  const monthly = pay.monthlyIncome && pay.monthlyIncome > 0 ? pay.monthlyIncome : null;
  const perHour = wage ? ` at ${formatMoney(wage, wage % 1 !== 0)}/hr.` : ".";
  if (wage && price / wage <= 40) return { before: "That's ", strong: `${formatHours(price / wage)} of work`, after: perHour };
  if (monthly) {
    const months = price / monthly;
    const span = months < 1 ? plural(Math.max(1, Math.round(price / (monthly * 12 / 52))), "week")
      : months < 24 ? plural(Math.round(months), "month")
        : `${(months / 12).toFixed(1)} years`;
    return { before: "That's about ", strong: `${span} of your take-home pay`, after: ` (${formatMoney(Math.round(monthly))}/month).` };
  }
  if (wage) {
    const hours = price / wage;
    const span = hours < 2080 ? plural(Math.round(hours / 40), "week") : `${(hours / 2080).toFixed(1)} years`;
    return { before: "That's about ", strong: `${span} of full-time work`, after: perHour };
  }
  return null;
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

/**
 * NorthStar's one rule for exact amounts (balances, bills, transactions, goal amounts):
 * show cents only when there are cents. $10, $5.99, $742.18, $1,000.
 * Totals and summaries round to whole dollars with formatMoney(n).
 */
export function formatExact(n: number): string {
  return formatMoney(n, Math.round(Math.abs(n) * 100) % 100 !== 0);
}

export function formatWeeks(weeks: number): string {
  if (!isFinite(weeks)) return "—";
  return `${weeks.toFixed(1)} weeks`;
}
