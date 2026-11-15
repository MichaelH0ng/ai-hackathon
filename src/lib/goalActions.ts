import { formatMoney, weeklyNeededForDeadline } from "./finance";
import { markBought } from "./envelopes";
import { todayISO } from "./dates";
import type { MoneyGoal } from "./types";

/**
 * Changes Polaris can make for you. Every one is shown as a confirmation card first;
 * nothing is saved until the user taps Confirm, and the last change can be undone.
 */
export type GoalChangeKind = "add" | "withdraw" | "set_saved" | "set_target" | "set_weekly";
export type BudgetField = "income" | "essentials" | "lifestyle";
export type PolarisAction =
  | { kind: GoalChangeKind; goalId: string; amount: number }
  | { kind: "create_goal"; name: string; target: number; weekly: number; deadline?: string }
  | { kind: "mark_bought"; goalId: string; amount: number }
  | { kind: "move"; goalId: string; toGoalId: string; amount: number }
  | { kind: "set_budget"; field: BudgetField; amount: number }
  | { kind: "reminder"; goalId: string; amount: number; weekday: number }; // weekday 0–6 (Sun–Sat), 7 = every day
/** @deprecated kept for older imports; use PolarisAction. */
export type GoalAction = PolarisAction;
export type GoalActionKind = PolarisAction["kind"];

export interface Budget { income: number; essentials: number; lifestyle: number }
export interface World { goals: MoneyGoal[]; budget: Budget }

export interface Reminder { id: string; goalId: string; amount: number; weekday: number; lastShown?: string }

export type Command = { ok: true; action: PolarisAction } | { ok: false; message: string };
/** @deprecated use Command */
export type GoalCommand = Command;

export interface ActionSummary { title: string; rows: { label?: string; before: string; after: string }[]; note?: string }

/** What confirming does: the goals to save, budget changes, a reminder, and how to undo it all. */
export interface ActionResult {
  updatedGoals: MoneyGoal[];
  newGoal?: MoneyGoal;
  budget?: Partial<Budget>;
  reminder?: Reminder;
  undo: Undo;
  done: string;
}
export interface Undo { goals?: MoneyGoal[]; removeGoalId?: string; budget?: Partial<Budget>; removeReminderId?: string; label: string }

const cents = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number) => formatMoney(n, Math.round(n * 100) % 100 !== 0); // cents only when there are some
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dayLabel = (weekday: number) => (weekday === 7 ? "every day" : `every ${WEEKDAYS[weekday]}`);
const BUDGET_LABEL: Record<BudgetField, string> = { income: "Monthly income", essentials: "Essentials budget", lifestyle: "Lifestyle budget" };

// ---------- reading amounts, goals, dates ----------

// "$1,250.50", "20 dollars", "20 bucks", "$20k"
const AMOUNT_SOURCE = String.raw`\$\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\b|\b([\d,]+(?:\.\d{1,2})?)\s*(k)?\s*(?:dollars?|bucks|usd)\b`;
const toNumber = (m: RegExpExecArray | RegExpMatchArray) => cents(Number((m[1] ?? m[3]).replace(/,/g, "")) * ((m[2] ?? m[4]) ? 1000 : 1));
export function parseAmount(text: string): number | null {
  const m = new RegExp(AMOUNT_SOURCE, "i").exec(text);
  if (!m) return null;
  const value = toNumber(m);
  return Number.isFinite(value) && value > 0 ? value : null;
}
/** Every amount in the text, with whether it reads as a weekly amount ("$25 a week"). */
function amounts(text: string): { value: number; weekly: boolean; index: number; end: number }[] {
  return [...text.matchAll(new RegExp(AMOUNT_SOURCE, "gi"))].map(m => {
    const end = (m.index ?? 0) + m[0].length;
    return { value: toNumber(m), weekly: /^\s*(?:a|per|each|every)\s+week|^\s*\/\s*w(?:ee)?k|^\s*weekly/i.test(text.slice(end)), index: m.index ?? 0, end };
  }).filter(a => a.value > 0);
}

const STOP = new Set(["goal", "goals", "fund", "funds", "savings", "saving", "save", "the", "my", "for", "and", "new", "account"]);
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
/** "cars" matches "Car", "trip" matches "Spring break trip". */
const sameWord = (a: string, b: string) => a === b || (a.length >= 3 && b.length >= 3 && (a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`));

/** The goal a phrase names, or why it can't tell. Bought goals can't be changed. */
export function findGoal<G extends Pick<MoneyGoal, "name"> & { boughtAt?: string }>(text: string, goals: G[]): G | "none" | "ambiguous" {
  const said = words(text);
  const active = goals.filter(g => !g.boughtAt);
  const exact = active.filter(g => text.toLowerCase().includes(g.name.toLowerCase()));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact.sort((a, b) => b.name.length - a.name.length)[0]; // "Car repair" over "Car"
  const scored = active
    .map(g => ({ g, score: words(g.name).filter(w => !STOP.has(w) && said.some(s => sameWord(s, w))).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return "none";
  if (scored.length > 1 && scored[0].score === scored[1].score) return "ambiguous";
  return scored[0].g;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** "by June", "by Dec 15", "by March 2027", "by 2027-06-30": the next such date (end of month if no day). */
export function parseDeadline(text: string, now = new Date()): string | undefined {
  const isoMatch = /\bby\s+(\d{4}-\d{2}-\d{2})\b/i.exec(text);
  if (isoMatch) return isoMatch[1];
  const m = /\bby\s+(?:the\s+end\s+of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d))?(?:,?\s+(\d{4}))?/i.exec(text);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const day = m[2] ? Number(m[2]) : null;
  let year = m[3] ? Number(m[3]) : now.getFullYear();
  const make = (y: number) => new Date(y, month, day ?? new Date(y, month + 1, 0).getDate());
  if (!m[3] && make(year) <= now) year += 1;
  return iso(make(year));
}

function parseWeekday(text: string, now = new Date()): number | null {
  if (/\b(every\s*day|daily|each day)\b/i.test(text)) return 7;
  const m = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i.exec(text);
  if (m) return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(m[1].toLowerCase());
  if (/\b(every|each)\s+week\b|\bweekly\b/i.test(text)) return now.getDay();
  return null;
}

// ---------- understanding a request ----------

const QUESTION = /^\s*(what|how|why|should|could i|would|is|am|do|does|when|where|which)\b/i;
const ADD = /\b(add|put|deposit|contribute|throw|stash|save|chip in|top up)\b/i;
const WITHDRAW = /\b(take out|take|withdraw|remove|subtract|pull|minus)\b/i;
const SET = /\b(set|change|update|make|adjust|edit|raise|lower|increase|decrease|bump|cut)\b/i;
const TARGET = /\b(target|goal amount|total|cost|price)\b/i;
const WEEKLY = /\b(weekly|per week|a week|each week|every week)\b/i;
const SAVED = /\b(saved|balance|progress|have)\b/i;
const goalNone = (goals: MoneyGoal[]): Command => {
  const names = goals.filter(g => !g.boughtAt).map(g => g.name);
  return { ok: false, message: names.length ? `Which goal do you mean? Your goals are ${names.join(", ")}.` : "You don’t have any savings goals yet. Ask me to create one, like “Make a $1,500 laptop goal by June.”" };
};
const pickGoal = (text: string, goals: MoneyGoal[]): MoneyGoal | Command => {
  const goal = findGoal(text, goals);
  if (goal === "none") return goalNone(goals);
  if (goal === "ambiguous") return { ok: false, message: "A few goals match that. Say the goal’s full name and I’ll take care of it." };
  return goal;
};
const isCommand = (x: MoneyGoal | Command): x is Command => "ok" in x;

/** "Can I afford $80 shoes?" → { item: "shoes", price: 80 }. */
export function parseAffordQuestion(text: string): { item: string; price: number } | null {
  if (!/\b(can|could)\s+i\s+(afford|buy|get)\b|\bshould\s+i\s+(buy|get)\b|\bafford\b/i.test(text)) return null;
  const price = parseAmount(text);
  if (!price) return null;
  const item = text
    .replace(new RegExp(AMOUNT_SOURCE, "gi"), " ")
    .replace(/\b(can|could|should|i|afford|buy|get|to|a|an|the|some|new|for|right|now|today|this|week|month|it|is|that|ok|okay|please|polaris|hey)\b/gi, " ")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { item: item || "this", price };
}

/**
 * Reads a request to change something ("add $20 to my car goal", "make a $1,500 laptop goal by June",
 * "I bought the laptop for $1,150", "move $100 from trip to car", "raise my lifestyle budget to $400",
 * "remind me to add $20 to car every Friday"). Returns null when it isn't one, so the message goes to
 * Polaris as a normal question.
 */
export function parseCommand(text: string, world: World, now = new Date()): Command | null {
  const { goals, budget } = world;
  if (QUESTION.test(text) && !/^\s*(could|would|can)\s+you\b/i.test(text)) return null;
  const amts = amounts(text);

  // Reminders: "remind me to add $20 to car every Friday"
  if (/\bremind\b/i.test(text)) {
    const amount = amts[0]?.value;
    const weekday = parseWeekday(text, now);
    if (!amount) return { ok: false, message: "How much should I remind you to save? Try “Remind me to add $20 to Car every Friday.”" };
    if (weekday === null) return { ok: false, message: "Which day should I remind you? Try “every Friday” or “every day.”" };
    const goal = pickGoal(text, goals);
    if (isCommand(goal)) return goal;
    return check({ kind: "reminder", goalId: goal.id, amount, weekday }, world);
  }

  // New goal: "make a $1,500 laptop goal by June", "create a goal for a trip, $900, $30 a week"
  if (/\b(create|make|start|set up|open|new)\b[\s\S]*\b(goal|fund)\b|\badd\s+an?\s+(new\s+)?(\$\s*[\d,]+\s*k?\s+)?[a-z ]*\b(goal|fund)\b/i.test(text) && !/\b(to|into|towards?)\s+(my|the)\b/i.test(text)) {
    const target = amts.find(a => !a.weekly)?.value;
    const weeklyAmount = amts.find(a => a.weekly)?.value;
    const name = newGoalName(text);
    if (!name) return { ok: false, message: "What should the goal be called? Try “Make a $1,500 laptop goal by June.”" };
    if (!target) return { ok: false, message: `How much do you want to save for ${name}?` };
    const deadline = parseDeadline(text, now);
    const weekly = weeklyAmount ?? (deadline ? Math.ceil(weeklyNeededForDeadline(target, 0, deadline, iso(now)) * 100) / 100 : 0);
    return check({ kind: "create_goal", name, target, weekly, deadline }, world);
  }

  // Bought: "I bought the laptop for $1,150", "mark the laptop as bought"
  if (/\b(bought|purchased|mark(?:ed)?\b[\s\S]*\b(bought|purchased))\b/i.test(text) && !/\b(can|could|should)\s+i\b/i.test(text)) {
    const goal = pickGoal(text, goals);
    if (isCommand(goal)) return goal;
    return check({ kind: "mark_bought", goalId: goal.id, amount: amts[0]?.value ?? goal.target }, world);
  }

  if (!amts.length) return null;
  const amount = amts[0].value;

  // Budget: "raise my lifestyle budget to $400", "my income is now $2,200"
  const field: BudgetField | null = /\b(income|paycheck|salary|take[- ]home|earn|i make)\b/i.test(text) ? "income"
    : /\b(essentials?|needs|fixed costs?|bills budget)\b/i.test(text) ? "essentials"
      : /\b(lifestyle|wants|fun money|fun budget|discretionary|spending money)\b/i.test(text) ? "lifestyle" : null;
  if (field && (SET.test(text) || /\bis now\b|\bbudget\b/i.test(text)) && !/\bgoal\b/i.test(text)) {
    const by = /\bby\s+\$?\s*[\d,]/i.test(text);
    const down = /\b(lower|decrease|cut|reduce|drop)\b/i.test(text);
    const next = by ? budget[field] + (down ? -amount : amount) : amount;
    return check({ kind: "set_budget", field, amount: next }, world);
  }

  // Move between goals: "move $100 from trip to car", "transfer $50 to car from trip"
  const fromTo = /\bfrom\s+(.+?)\s+(?:to|into|towards?)\s+(.+)$/i.exec(text) ?? /\b(?:to|into|towards?)\s+(.+?)\s+from\s+(.+)$/i.exec(text);
  if (fromTo && /\b(move|transfer|shift|switch|put|take)\b/i.test(text)) {
    const reversed = !/\bfrom\s+.+?\s+(?:to|into|towards?)\s+/i.test(text);
    const fromText = reversed ? fromTo[2] : fromTo[1];
    const toText = reversed ? fromTo[1] : fromTo[2];
    const from = pickGoal(fromText, goals);
    if (isCommand(from)) return from;
    const to = pickGoal(toText, goals.filter(g => g.id !== from.id));
    if (isCommand(to)) return to;
    return check({ kind: "move", goalId: from.id, toGoalId: to.id, amount }, world);
  }

  // Goal amounts: add / withdraw / set saved / target / weekly
  if (!(ADD.test(text) || WITHDRAW.test(text) || SET.test(text) || /\b(move|transfer)\b/i.test(text))) return null;
  if (!/\b(goal|fund|toward|towards|into|to|from|for)\b/i.test(text)) return null;
  const goal = pickGoal(text, goals);
  if (isCommand(goal)) return goal;
  let kind: GoalChangeKind;
  if (SET.test(text) && WEEKLY.test(text)) kind = "set_weekly";
  else if (SET.test(text) && TARGET.test(text)) kind = "set_target";
  else if (SET.test(text) && SAVED.test(text) && !ADD.test(text.replace(SET, ""))) kind = "set_saved";
  else if (WITHDRAW.test(text) && !/\b(add|put|deposit)\b/i.test(text)) kind = "withdraw";
  else if (ADD.test(text) || /\b(move|transfer)\b/i.test(text)) kind = "add";
  else kind = "set_saved";
  return check({ kind, goalId: goal.id, amount }, world);
}

/** Older name, goals only. */
export function parseGoalCommand(text: string, goals: MoneyGoal[]): Command | null {
  return parseCommand(text, { goals, budget: { income: 0, essentials: 0, lifestyle: 0 } });
}

function newGoalName(text: string): string | null {
  const cleaned = text.replace(/[?!.]+$/, "");
  const patterns = [
    /\bgoal\s+(?:for|called|named|to buy|to get)\s+(?:a|an|my|the|some)?\s*([a-z][a-z0-9 '&-]*?)(?=\s*(?:,|\bof\b|\bfor\b|\bby\b|\bwith\b|\bat\b|\bthat\b|\$|\d|$))/i,
    /\b(?:a|an|new)\s+(?:new\s+)?(?:\$\s*[\d,.]+\s*k?\s+)?([a-z][a-z0-9 '&-]*?)\s+(?:goal|fund)\b/i,
    /\b(?:save|saving)\s+(?:up\s+)?for\s+(?:a|an|my|the)?\s*([a-z][a-z0-9 '&-]*?)(?=\s*(?:,|\bby\b|\$|\d|$))/i,
  ];
  for (const p of patterns) {
    const m = p.exec(cleaned);
    const raw = m?.[1]?.replace(/\b(new|savings?|a|an|the|my)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (raw && raw.length <= 40 && !/^(goal|fund)$/i.test(raw)) return raw.replace(/\b\w/g, c => c.toUpperCase());
  }
  return null;
}

// ---------- checking, describing and applying ----------

/** Rejects changes that don't make sense before asking the user to confirm. */
export function check(action: PolarisAction, world: World): Command {
  const goal = "goalId" in action ? world.goals.find(g => g.id === action.goalId) : undefined;
  if ("goalId" in action && !goal) return { ok: false, message: "I couldn’t find that goal anymore." };
  if (goal?.boughtAt) return { ok: false, message: `${goal.name} is already marked as bought, so it can’t be changed here.` };
  const amount = "amount" in action ? action.amount : action.target;
  if (!(amount > 0) && !(action.kind === "set_budget" && amount === 0)) return { ok: false, message: action.kind === "set_budget" ? "A budget can’t go below $0." : "Tell me an amount above $0." };
  if (action.kind === "withdraw" && goal && action.amount > goal.saved) return { ok: false, message: `${goal.name} only has ${money(goal.saved)} saved, so I can’t take out ${money(action.amount)}.` };
  if (action.kind === "move" && goal) {
    const to = world.goals.find(g => g.id === action.toGoalId);
    if (!to || to.boughtAt) return { ok: false, message: "I couldn’t find the goal to move the money into." };
    if (action.amount > goal.saved) return { ok: false, message: `${goal.name} only has ${money(goal.saved)} saved, so I can’t move ${money(action.amount)}.` };
  }
  if (action.kind === "create_goal" && world.goals.some(g => !g.boughtAt && g.name.toLowerCase() === action.name.toLowerCase())) {
    return { ok: false, message: `You already have a goal called ${action.name}. Want me to add money to it instead?` };
  }
  const rounded = { ...action, ...("amount" in action ? { amount: cents(action.amount) } : {}) } as PolarisAction;
  return { ok: true, action: rounded };
}
/** @deprecated use check */
export const checkAction = (action: PolarisAction, goal: MoneyGoal) => check(action, { goals: [goal], budget: { income: 0, essentials: 0, lifestyle: 0 } });

const progress = (g: Pick<MoneyGoal, "saved" | "target">) => `${money(g.saved)} of ${money(g.target)}`;
const linkedNote = "This goal follows an account’s balance now. Confirming switches it to a set amount.";

/** Wording for the confirmation card: a title, before → after rows, and an optional note. */
export function describe(action: PolarisAction, world: World): ActionSummary {
  const goal = "goalId" in action ? world.goals.find(g => g.id === action.goalId)! : undefined;
  switch (action.kind) {
    case "add": case "withdraw": case "set_saved": case "set_target": case "set_weekly": {
      const g = goal!;
      const next = applyGoalChange(g, action);
      const note = g.linkedAccountId && action.kind !== "set_target" && action.kind !== "set_weekly" ? linkedNote : undefined;
      const title = action.kind === "add" ? `Add ${money(action.amount)} to ${g.name}`
        : action.kind === "withdraw" ? `Take ${money(action.amount)} out of ${g.name}`
          : action.kind === "set_saved" ? `Set ${g.name}’s savings to ${money(action.amount)}`
            : action.kind === "set_target" ? `Change ${g.name}’s target to ${money(action.amount)}`
              : `Save ${money(action.amount)} a week for ${g.name}`;
      const row = action.kind === "set_weekly" ? { before: `${money(g.weekly)}/week`, after: `${money(next.weekly)}/week` } : { before: progress(g), after: progress(next) };
      return { title, rows: [row], note };
    }
    case "create_goal":
      return {
        title: `Create a ${action.name} goal`,
        rows: [
          { label: "Target", before: "", after: money(action.target) },
          { label: "Weekly", before: "", after: action.weekly > 0 ? `${money(action.weekly)}/week` : "Not set yet" },
          ...(action.deadline ? [{ label: "By", before: "", after: new Date(`${action.deadline}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) }] : []),
        ],
        note: action.deadline && action.weekly > 0 ? `${money(action.weekly)} a week gets you there by your date.` : undefined,
      };
    case "mark_bought": {
      const g = goal!;
      const leftover = cents(Math.max(0, g.saved - action.amount));
      return {
        title: `Mark ${g.name} as bought for ${money(action.amount)}`,
        rows: [{ label: g.name, before: progress(g), after: "Bought" }],
        note: leftover > 0 ? `${money(leftover)} you saved beyond the price goes back to free cash.` : g.saved < action.amount ? `You’d pay ${money(action.amount - g.saved)} more than you saved for it.` : undefined,
      };
    }
    case "move": {
      const g = goal!;
      const to = world.goals.find(x => x.id === action.toGoalId)!;
      return {
        title: `Move ${money(action.amount)} from ${g.name} to ${to.name}`,
        rows: [
          { label: g.name, before: progress(g), after: progress({ ...g, saved: g.saved - action.amount }) },
          { label: to.name, before: progress(to), after: progress({ ...to, saved: to.saved + action.amount }) },
        ],
        note: g.linkedAccountId || to.linkedAccountId ? linkedNote : undefined,
      };
    }
    case "set_budget":
      return { title: `Change your ${BUDGET_LABEL[action.field].toLowerCase()}`, rows: [{ label: BUDGET_LABEL[action.field], before: `${money(world.budget[action.field])}/mo`, after: `${money(action.amount)}/mo` }] };
    case "reminder":
      return { title: `Remind you ${dayLabel(action.weekday)}`, rows: [{ before: "", after: `Add ${money(action.amount)} to ${goal!.name}` }], note: "Polaris will bring it up when you open the app that day. You can remove it on My goals." };
  }
}

function applyGoalChange(goal: MoneyGoal, action: { kind: GoalChangeKind; amount: number }): MoneyGoal {
  switch (action.kind) {
    case "add": return { ...goal, saved: cents(goal.saved + action.amount), linkedAccountId: undefined };
    case "withdraw": return { ...goal, saved: cents(Math.max(0, goal.saved - action.amount)), linkedAccountId: undefined };
    case "set_saved": return { ...goal, saved: cents(action.amount), linkedAccountId: undefined };
    case "set_target": return { ...goal, target: cents(action.amount) };
    case "set_weekly": return { ...goal, weekly: cents(action.amount) };
  }
}
/** @deprecated goal-only helper kept for older imports. */
export const applyGoalAction = (goal: MoneyGoal, action: { kind: GoalChangeKind; amount: number }) => applyGoalChange(goal, action);

const doneGoal = (g: MoneyGoal) => g.target > 0 && g.saved >= g.target
  ? `**${g.name}** is fully funded at **${money(g.saved)}**. 🎉`
  : `**${g.name}** is now **${money(g.saved)}** of ${money(g.target)} (${g.target > 0 ? Math.min(100, Math.floor(g.saved / g.target * 100)) : 0}%).`;
export const doneMessage = (g: MoneyGoal) => `Done! ${doneGoal(g)}`;

/** Everything confirming does, computed up front so it can be undone exactly. */
export function apply(action: PolarisAction, world: World, ids: { newId: () => string; today?: string } = { newId: () => crypto.randomUUID() }): ActionResult {
  const goal = "goalId" in action ? world.goals.find(g => g.id === action.goalId)! : undefined;
  switch (action.kind) {
    case "add": case "withdraw": case "set_saved": case "set_target": case "set_weekly": {
      const next = applyGoalChange(goal!, action);
      return { updatedGoals: [next], undo: { goals: [goal!], label: `Undo: ${goal!.name} back to ${action.kind === "set_weekly" ? `${money(goal!.weekly)}/week` : action.kind === "set_target" ? `a ${money(goal!.target)} target` : money(goal!.saved)}` }, done: `Done! ${action.kind === "set_weekly" ? `**${next.name}** now saves **${money(next.weekly)}** a week.` : action.kind === "set_target" ? `**${next.name}**’s target is now **${money(next.target)}**.` : doneGoal(next)}` };
    }
    case "create_goal": {
      const newGoal: MoneyGoal = { kind: "money", id: ids.newId(), name: action.name, target: action.target, saved: 0, weekly: action.weekly, deadline: action.deadline };
      return { updatedGoals: [], newGoal, undo: { removeGoalId: newGoal.id, label: `Undo: remove ${newGoal.name}` }, done: `Done! I created **${newGoal.name}** with a **${money(newGoal.target)}** target${newGoal.weekly > 0 ? `, saving ${money(newGoal.weekly)} a week` : ""}. You’ll find it on My goals.` };
    }
    case "mark_bought": {
      const { bought, leftover } = markBought(goal!, action.amount, ids.today ?? todayISO());
      return { updatedGoals: [bought], undo: { goals: [goal!], label: `Undo: ${goal!.name} isn’t bought` }, done: `Done! **${goal!.name}** is marked as bought for **${money(action.amount)}**. Enjoy it! 🎉${leftover > 0 ? ` The extra ${money(leftover)} is free cash again.` : ""}` };
    }
    case "move": {
      const to = world.goals.find(g => g.id === action.toGoalId)!;
      const from2 = { ...goal!, saved: cents(goal!.saved - action.amount), linkedAccountId: undefined };
      const to2 = { ...to, saved: cents(to.saved + action.amount), linkedAccountId: undefined };
      return { updatedGoals: [from2, to2], undo: { goals: [goal!, to], label: "Undo the move" }, done: `Done! Moved **${money(action.amount)}** to ${to.name}. **${to2.name}** is now ${money(to2.saved)} and **${from2.name}** is ${money(from2.saved)}.` };
    }
    case "set_budget":
      return { updatedGoals: [], budget: { [action.field]: action.amount }, undo: { budget: { [action.field]: world.budget[action.field] }, label: `Undo: back to ${money(world.budget[action.field])}` }, done: `Done! Your ${BUDGET_LABEL[action.field].toLowerCase()} is now **${money(action.amount)}** a month.` };
    case "reminder": {
      const reminder: Reminder = { id: ids.newId(), goalId: action.goalId, amount: action.amount, weekday: action.weekday, lastShown: ids.today ?? todayISO() };
      return { updatedGoals: [], reminder, undo: { removeReminderId: reminder.id, label: "Undo: remove the reminder" }, done: `Done! I’ll remind you **${dayLabel(action.weekday)}** to add **${money(action.amount)}** to ${goal!.name}.` };
    }
  }
}

/** Reminders that should show today and haven't yet. */
export function dueReminders(reminders: Reminder[], today = new Date()): Reminder[] {
  const day = today.getDay();
  return reminders.filter(r => (r.weekday === 7 || r.weekday === day) && r.lastShown !== iso(today));
}
