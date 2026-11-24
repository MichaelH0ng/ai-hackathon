// Small, computed facts for the home page: the greeting and the next paycheck. Pure functions (no browser APIs), so the server can share them.
import { addDays } from "./dates.js";
import type { BankData, RecurringStream } from "./money.js";

/** "Good morning" until noon, "Good afternoon" until 5pm, then "Good evening". */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export const FREQUENCY_WORDS: Record<string, string> = { WEEKLY: "weekly", BIWEEKLY: "every two weeks", SEMI_MONTHLY: "twice a month", MONTHLY: "monthly", ANNUALLY: "yearly" };

/** A readable employer from a bank's payroll line: "PAYROLL ST OF CA CA PAYROLL XXXXX7052" → "State of California". */
export function payerName(name: string): string {
  if (/\bST(ATE)? OF CA\b/i.test(name)) return "State of California";
  const words = name.replace(/\b(payroll|ppd|ach|dir(ect)? dep(osit)?|pay|xx+\w*)\b|\d+|[*#:]/gi, " ").replace(/\s+/g, " ").trim();
  return words ? words.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Your employer";
}

/**
 * Upcoming paychecks Plaid predicts, soonest first. Only income streams that look like pay: not
 * interest, and not money from your own accounts (a regular Wealthfront transfer is labeled income too).
 */
export function paycheckStreams(data: Pick<BankData, "accounts" | "recurring">, today: string): RecurringStream[] {
  const own = [...new Set(data.accounts.map((a) => a.institution.toLowerCase().split(/\s+/)[0]))].filter((w) => w.length >= 4);
  return (data.recurring ?? [])
    .filter((s) => s.direction === "in" && s.isActive && s.category === "INCOME" && !!s.nextDate && s.nextDate >= today
      && s.amount >= 20 && !/\binterest\b/i.test(s.name) && !own.some((w) => s.name.toLowerCase().includes(w)))
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!));
}

export interface NextPaycheck {
  date: string;
  payer: string;
  /** The last paycheck from this payer, or Plaid's typical amount when none is on record. */
  amount: number;
  frequency: string | null;
}

const payKey = (name: string) => name.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !/^x+$/.test(w)).slice(0, 3).join(" ");

/** The next paycheck, with what the last one actually was (hourly and state pay varies). */
export function nextPaycheck(data: Pick<BankData, "accounts" | "recurring" | "transactions">, today: string): NextPaycheck | null {
  const next = paycheckStreams(data, today)[0];
  if (!next) return null;
  const last = data.transactions
    .filter((t) => t.amount < 0 && !t.pending && t.date >= addDays(today, -183) && payKey(t.name) === payKey(next.name))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return { date: next.nextDate!, payer: payerName(next.name), amount: last ? -last.amount : next.amount, frequency: FREQUENCY_WORDS[next.frequency] ?? null };
}

