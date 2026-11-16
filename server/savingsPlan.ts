// The numbers behind a Polaris savings plan. The app measures income, bills, and everyday
// spending from real transactions and offers "levers" (places money could come from);
// the model only chooses levers and words the plan, and every amount it proposes is
// capped here so a plan can't promise money the student doesn't spend.
import { addDays } from "../src/lib/dates.js";
import { detectTransferIds, isTransfer, type BankAccount, type BankTransaction } from "../src/lib/money.js";
import { recurring } from "../src/lib/safeToSpend.js";
import { categoryLabel } from "./assistantData.js";

const LOOKBACK_DAYS = 60;
/** Spending that can't be trimmed this month: housing, utilities, debt payments. */
const FIXED = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS", "BANK_FEES", "GOVERNMENT_AND_NON_PROFIT"]);

export interface Lever {
  id: string;
  kind: "category" | "merchant" | "subscription";
  name: string;
  /** Cuts in one group share its monthly total, so "Starbucks" and "food and drink" can't double count. */
  group: string;
  monthly: number;
  visits?: number;
}

export interface PlanFacts {
  item: string;
  price: number;
  historyDays: number;
  monthlyIncome: number;
  monthlyBills: number;
  monthlyEveryday: number;
  monthlyGoalSavings: number;
  /** Income minus bills, everyday spending, and existing goal savings. Can be negative. */
  monthlyLeftover: number;
  hourlyWage: number | null;
  levers: Lever[];
  groupCaps: Record<string, number>;
}

export interface PlanMove {
  name: string;
  action: string;
  monthly: number;
}

export interface SavingsPlan {
  summary: string;
  cuts: PlanMove[];
  earn: PlanMove[];
  monthlyLeftover: number;
  monthlyTotal: number;
  weekly: number;
  weeks: number | null;
  finishDate: string | null;
}

const round = (n: number) => Math.round(n);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const friendly = (name: string) => (name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name);

export function planFacts(input: {
  item: string;
  price: number;
  transactions: BankTransaction[];
  accounts: BankAccount[];
  goals: { target: number; saved: number; weekly: number }[];
  hourlyWage: number | null;
  budget?: { monthlyIncome: number; monthlySpending: number };
  today: string;
}): PlanFacts {
  const { transactions, today } = input;
  const transferIds = detectTransferIds(transactions);
  const usable = transactions.filter((t) => !t.pending && !isTransfer(t, transferIds));
  const cashIds = new Set(input.accounts.filter((a) => a.type === "depository").map((a) => a.id));
  const monthlyGoalSavings = round(input.goals.filter((g) => g.saved < g.target).reduce((s, g) => s + Math.max(0, g.weekly), 0) * 52 / 12);

  if (!usable.length) {
    const income = round(input.budget?.monthlyIncome ?? 0);
    const spending = round(input.budget?.monthlySpending ?? 0);
    return { item: input.item, price: input.price, historyDays: 0, monthlyIncome: income, monthlyBills: 0, monthlyEveryday: spending, monthlyGoalSavings, monthlyLeftover: income - spending - monthlyGoalSavings, hourlyWage: input.hourlyWage, levers: [], groupCaps: {} };
  }

  const perMonth = (r: { amount: number; everyDays: number }) => (r.amount * 30) / r.everyDays;
  const income = recurring(usable.filter((t) => cashIds.has(t.accountId)), "in", today);
  const bills = recurring(usable, "out", today);
  const billNames = new Set(bills.map((b) => b.name));
  const categoryOf = (name: string) => usable.find((t) => t.name === name)?.category ?? "OTHER";

  const since = addDays(today, -LOOKBACK_DAYS);
  const recent = usable.filter((t) => t.date > since && t.date <= today);
  const earliest = recent.reduce((min, t) => (t.date < min ? t.date : min), today);
  const historyDays = Math.max(14, Math.min(LOOKBACK_DAYS, days(earliest, today) + 1));
  const scale = 30 / historyDays;

  const everyday = recent.filter((t) => t.amount > 0 && !billNames.has(t.name));
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, { total: number; visits: number; category: string }>();
  for (const t of everyday) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    const m = byMerchant.get(t.name) ?? { total: 0, visits: 0, category: t.category };
    byMerchant.set(t.name, { total: m.total + t.amount, visits: m.visits + 1, category: t.category });
  }

  const levers: Lever[] = [];
  const groupCaps: Record<string, number> = {};
  for (const [category, total] of [...byCategory].sort(([, a], [, b]) => b - a)) {
    const monthly = round(total * scale);
    if (FIXED.has(category) || monthly < 10) continue;
    groupCaps[category] = monthly;
    levers.push({ id: `category:${category}`, kind: "category", name: categoryLabel(category), group: category, monthly });
  }
  for (const [name, m] of [...byMerchant].sort(([, a], [, b]) => b.total - a.total)) {
    const monthly = round(m.total * scale);
    if (!groupCaps[m.category] || monthly < 8 || levers.filter((l) => l.kind === "merchant").length >= 6) continue;
    levers.push({ id: `merchant:${name}`, kind: "merchant", name: friendly(name), group: m.category, monthly, visits: round(m.visits * scale) });
  }
  for (const bill of bills) {
    if (FIXED.has(categoryOf(bill.name))) continue;
    const monthly = round(perMonth(bill));
    groupCaps[`bill:${bill.name}`] = monthly;
    levers.push({ id: `subscription:${bill.name}`, kind: "subscription", name: friendly(bill.name), group: `bill:${bill.name}`, monthly });
  }

  const monthlyIncome = round(income.reduce((s, r) => s + perMonth(r), 0)) || round(input.budget?.monthlyIncome ?? 0);
  const monthlyBills = round(bills.reduce((s, b) => s + perMonth(b), 0));
  const monthlyEveryday = round(everyday.reduce((s, t) => s + t.amount, 0) * scale);
  return {
    item: input.item,
    price: input.price,
    historyDays,
    monthlyIncome,
    monthlyBills,
    monthlyEveryday,
    monthlyGoalSavings,
    monthlyLeftover: monthlyIncome - monthlyBills - monthlyEveryday - monthlyGoalSavings,
    hourlyWage: input.hourlyWage,
    levers,
    groupCaps,
  };
}

/** Most a student could plausibly add per month from extra work: 10 more hours a week at their wage. */
export const earnCap = (facts: PlanFacts) => round(facts.hourlyWage ? facts.hourlyWage * 10 * 52 / 12 : 400);

/**
 * Turns proposed moves into a checked plan: cuts must name a real lever and can't exceed what's
 * actually spent in its group; extra income is capped; the weekly amount and finish date are
 * computed here, never by the model.
 */
export function buildPlan(
  facts: PlanFacts,
  proposal: { summary: string; cuts: { leverId: string; action: string; monthlySavings: number }[]; earn: { action: string; monthlyAmount: number }[] },
  today: string,
): SavingsPlan {
  const left = { ...facts.groupCaps };
  const cuts: PlanMove[] = [];
  for (const cut of proposal.cuts.slice(0, 4)) {
    const lever = facts.levers.find((l) => l.id === cut.leverId);
    if (!lever || cuts.some((c) => c.name === lever.name)) continue;
    const monthly = round(Math.min(Math.max(0, cut.monthlySavings), lever.monthly, left[lever.group] ?? 0));
    if (monthly < 1) continue;
    left[lever.group] -= monthly;
    cuts.push({ name: lever.name, action: cleanText(cut.action) ?? `Spend less on ${lever.name}`, monthly });
  }
  let earnLeft = earnCap(facts);
  const earn: PlanMove[] = [];
  for (const idea of proposal.earn.slice(0, 2)) {
    const monthly = round(Math.min(Math.max(0, idea.monthlyAmount), earnLeft));
    const action = cleanText(idea.action);
    if (monthly < 1 || !action) continue;
    earnLeft -= monthly;
    earn.push({ name: "Extra income", action, monthly });
  }
  const monthlyTotal = facts.monthlyLeftover + [...cuts, ...earn].reduce((s, m) => s + m.monthly, 0);
  const weekly = Math.max(0, round((monthlyTotal * 12) / 52));
  const weeks = weekly > 0 ? Math.ceil(facts.price / weekly) : null;
  return {
    summary: cleanText(proposal.summary, 420) ?? templateSummary(facts),
    cuts,
    earn,
    monthlyLeftover: facts.monthlyLeftover,
    monthlyTotal,
    weekly,
    weeks,
    finishDate: weeks ? addDays(today, weeks * 7) : null,
  };
}

/** Model text may not carry its own dollar amounts (the app shows the checked ones). */
function cleanText(text: string, max = 240): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || /\$\s?\d/.test(t) || t.length > max) return null;
  return t;
}

export function templateSummary(facts: PlanFacts): string {
  return facts.levers.length
    ? `Here's a plan for ${facts.item} built from your last ${facts.historyDays} days of spending: a few small cuts plus what you already have left each month.`
    : `Here's a starting plan for ${facts.item} based on your budget. Connect a bank account for a plan built from your real spending.`;
}

/** The no-AI plan: trim the three biggest flexible categories by a quarter. */
export function templateProposal(facts: PlanFacts) {
  const cuts = facts.levers
    .filter((l) => l.kind === "category")
    .slice(0, 3)
    .map((l) => ({ leverId: l.id, action: `Spend about a quarter less on ${l.name}`, monthlySavings: Math.max(5, Math.round((l.monthly * 0.25) / 5) * 5) }));
  const earn = facts.hourlyWage ? [{ action: "Pick up two extra hours of work a week", monthlyAmount: (facts.hourlyWage * 2 * 52) / 12 }] : [];
  return { summary: templateSummary(facts), cuts, earn };
}
