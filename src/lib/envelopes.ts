// Goals as envelopes: your cash (checking + savings) is one pool, and each savings goal
// claims part of it. Whatever no goal claims is free money; Safe-to-Spend only uses that.
import type { BankAccount } from "./money.js";
import { cashFromAccounts, isEmergencyFund } from "./safeToSpend.js";
import type { MoneyGoal } from "./types.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Goals still being saved for (bought ones no longer hold any cash). */
export const activeGoals = (goals: MoneyGoal[]) => goals.filter((g) => !g.boughtAt);
export const boughtGoals = (goals: MoneyGoal[]) => goals.filter((g) => g.boughtAt).sort((a, b) => (b.boughtAt ?? "").localeCompare(a.boughtAt ?? ""));

/** Checking and savings from connected banks plus manual Checking/Savings balances. */
export function cashOnHand(accounts: BankAccount[], manual: { kind: string; balance: number }[]): number {
  const bank = cashFromAccounts(accounts);
  const typed = manual.filter((a) => a.kind === "Checking" || a.kind === "Savings").reduce((s, a) => s + a.balance, 0);
  return round2(bank.checking + bank.savings + typed);
}

export interface Envelopes {
  cash: number;
  /** Each active goal's share of the cash. */
  goals: { id: string; name: string; amount: number }[];
  setAside: number;
  /** Cash no goal claims (0 when goals claim more than you have). */
  free: number;
  /** How much more the goals claim than the cash you have. */
  over: number;
}

export function envelopes(goals: MoneyGoal[], cash: number): Envelopes {
  const shares = activeGoals(goals).map((g) => ({ id: g.id, name: g.name, amount: round2(Math.max(0, g.saved)) })).filter((g) => g.amount > 0);
  const setAside = round2(shares.reduce((s, g) => s + g.amount, 0));
  return { cash: round2(cash), goals: shares, setAside, free: round2(Math.max(0, cash - setAside)), over: round2(Math.max(0, setAside - cash)) };
}

/** The goal a purchase is for ("AirPods" → the AirPods goal), matched on distinctive words. Never the emergency fund. */
export function goalForItem(item: string, goals: MoneyGoal[]): MoneyGoal | null {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const itemWords = words(item);
  const hits = activeGoals(goals).filter((g) => !isEmergencyFund(g) && (g.name.toLowerCase() === item.trim().toLowerCase() || words(g.name).some((w) => itemWords.includes(w))));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Marks a goal as bought. Its money leaves the envelopes (you spent it); anything saved beyond
 * the price is either moved to another goal or simply becomes free cash again.
 */
export function markBought(goal: MoneyGoal, paid: number, today: string, leftoverTo?: MoneyGoal): { bought: MoneyGoal; leftover: number; receiver: MoneyGoal | null } {
  const leftover = round2(Math.max(0, goal.saved - paid));
  const receiver = leftoverTo && leftover > 0 ? { ...leftoverTo, saved: round2(leftoverTo.saved + leftover) } : null;
  return { bought: { ...goal, boughtAt: today, boughtFor: round2(paid) }, leftover, receiver };
}

/** Puts a bought goal back in the active list (for an accidental tap). */
export const unmarkBought = (goal: MoneyGoal): MoneyGoal => { const { boughtAt: _a, boughtFor: _b, ...rest } = goal; return rest; };

