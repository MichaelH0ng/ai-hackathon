import { describe, expect, it } from "vitest";
import { apply, describe as describeAction, dueReminders, findGoal, parseAffordQuestion, parseAmount, parseCommand, parseDeadline, type PolarisAction, type World } from "./goalActions";
import type { MoneyGoal } from "./types";

const goal = (g: Partial<MoneyGoal> & Pick<MoneyGoal, "id" | "name" | "target" | "saved">): MoneyGoal => ({ kind: "money", weekly: 0, ...g });
const goals = [
  goal({ id: "car", name: "Car", target: 20000, saved: 2000, weekly: 50 }),
  goal({ id: "trip", name: "Spring break trip", target: 900, saved: 300, weekly: 25 }),
  goal({ id: "laptop", name: "Laptop", target: 1200, saved: 1200, boughtAt: "2026-10-01" }),
  goal({ id: "phone", name: "Phone", target: 800, saved: 850 }),
];
const world: World = { goals, budget: { income: 2000, essentials: 900, lifestyle: 300 } };
const now = new Date(2026, 10, 15); // Sun Nov 15 2026
const parse = (text: string) => parseCommand(text, world, now);
const action = (text: string) => { const c = parse(text); if (!c?.ok) throw new Error(`no action for: ${text} (${JSON.stringify(c)})`); return c.action; };
const ids = { newId: () => "new-id", today: "2026-11-15" };

describe("parsing helpers", () => {
  it("reads amounts", () => {
    expect(parseAmount("add $20 to cars")).toBe(20);
    expect(parseAmount("put $1,250.50 in")).toBe(1250.5);
    expect(parseAmount("add 20 bucks")).toBe(20);
    expect(parseAmount("set target to $25k")).toBe(25000);
    expect(parseAmount("add some money")).toBeNull();
  });
  it("matches goals loosely and skips bought ones", () => {
    expect(findGoal("my save goal for cars", goals)).toMatchObject({ id: "car" });
    expect(findGoal("the trip fund", goals)).toMatchObject({ id: "trip" });
    expect(findGoal("my laptop goal", goals)).toBe("none");
  });
  it("reads deadlines", () => {
    expect(parseDeadline("by June", now)).toBe("2027-06-30");
    expect(parseDeadline("by Dec 15", now)).toBe("2026-12-15");
    expect(parseDeadline("by March 2028", now)).toBe("2028-03-31");
    expect(parseDeadline("soon", now)).toBeUndefined();
  });
});

describe("goal amounts", () => {
  it("adds money (the car example)", () => {
    const a = action("Hey, can you add an extra $20 to my save goal for cars?");
    expect(a).toEqual({ kind: "add", goalId: "car", amount: 20 });
    expect(apply(a, world, ids).updatedGoals[0].saved).toBe(2020);
  });
  it("understands withdrawals, targets and weekly amounts", () => {
    expect(action("take $50 out of my trip fund")).toMatchObject({ kind: "withdraw", amount: 50 });
    expect(action("set my car goal target to $25,000")).toMatchObject({ kind: "set_target", amount: 25000 });
    expect(action("change the trip weekly amount to $40")).toMatchObject({ kind: "set_weekly", amount: 40 });
    expect(action("update car saved to $2,500")).toMatchObject({ kind: "set_saved", amount: 2500 });
  });
  it("refuses impossible changes and asks which goal", () => {
    expect(parse("withdraw $500 from the trip goal")).toMatchObject({ ok: false });
    expect(parse("add $20 to my boat goal")).toMatchObject({ ok: false, message: expect.stringContaining("Car") });
  });
  it("leaves questions alone", () => {
    expect(parse("How long until my car goal is done?")).toBeNull();
    expect(parse("What if I add $20 a week to my car goal?")).toBeNull();
    expect(parse("What's my balance?")).toBeNull();
  });
});

describe("1. creating a goal", () => {
  it("makes a goal with a deadline and works out the weekly amount", () => {
    const a = action("Make a $1,500 laptop goal by June");
    expect(a).toMatchObject({ kind: "create_goal", name: "Laptop", target: 1500, deadline: "2027-06-30" });
    expect((a as { weekly: number }).weekly).toBeGreaterThan(0);
  });
  it("accepts other phrasings and a stated weekly amount", () => {
    expect(action("create a goal for a new bike, $600, $25 a week")).toMatchObject({ kind: "create_goal", name: "Bike", target: 600, weekly: 25 });
    expect(action("start a concert tickets fund for $200")).toMatchObject({ kind: "create_goal", name: "Concert Tickets", target: 200 });
  });
  it("won't duplicate an existing goal", () => {
    expect(parse("make a new car goal for $5,000")).toMatchObject({ ok: false });
  });
  it("creates the goal and can undo it", () => {
    const r = apply(action("Make a $1,500 laptop goal by June"), world, ids);
    expect(r.newGoal).toMatchObject({ id: "new-id", name: "Laptop", saved: 0 });
    expect(r.undo.removeGoalId).toBe("new-id");
  });
});

describe("2. marking a goal bought", () => {
  it("marks it bought for the price paid", () => {
    const a = action("I bought the phone for $780");
    expect(a).toEqual({ kind: "mark_bought", goalId: "phone", amount: 780 });
    const r = apply(a, world, ids);
    expect(r.updatedGoals[0]).toMatchObject({ boughtAt: "2026-11-15", boughtFor: 780 });
    expect(r.done).toContain("$70"); // leftover
    expect(r.undo.goals?.[0].boughtAt).toBeUndefined();
  });
  it("uses the target when no price is given", () => {
    expect(action("mark my trip as bought")).toMatchObject({ kind: "mark_bought", amount: 900 });
  });
});

describe("3. budget", () => {
  it("sets and nudges budget lines", () => {
    expect(action("Raise my lifestyle budget to $400")).toEqual({ kind: "set_budget", field: "lifestyle", amount: 400 });
    expect(action("my income is now $2,200")).toEqual({ kind: "set_budget", field: "income", amount: 2200 });
    expect(action("lower my essentials budget by $50")).toEqual({ kind: "set_budget", field: "essentials", amount: 850 });
  });
  it("undoes back to the old value", () => {
    const r = apply(action("Raise my lifestyle budget to $400"), world, ids);
    expect(r.budget).toEqual({ lifestyle: 400 });
    expect(r.undo.budget).toEqual({ lifestyle: 300 });
  });
});

describe("4. moving money between goals", () => {
  it("moves in either word order", () => {
    expect(action("Move $100 from trip to car")).toEqual({ kind: "move", goalId: "trip", toGoalId: "car", amount: 100 });
    expect(action("transfer $50 to car from my trip fund")).toEqual({ kind: "move", goalId: "trip", toGoalId: "car", amount: 50 });
  });
  it("won't move more than is saved", () => {
    expect(parse("move $400 from trip to car")).toMatchObject({ ok: false });
  });
  it("shows both goals and undoes both", () => {
    const a = action("Move $100 from trip to car");
    expect(describeAction(a, world).rows).toHaveLength(2);
    const r = apply(a, world, ids);
    expect(r.updatedGoals.map(g => g.saved)).toEqual([200, 2100]);
    expect(r.undo.goals?.map(g => g.saved)).toEqual([300, 2000]);
  });
});

describe("6. reminders", () => {
  it("sets a weekly reminder", () => {
    expect(action("Remind me to add $20 to car every Friday")).toEqual({ kind: "reminder", goalId: "car", amount: 20, weekday: 5 });
    expect(action("remind me every day to put $5 in my trip fund")).toMatchObject({ weekday: 7 });
  });
  it("asks for a missing day or amount", () => {
    expect(parse("remind me to save for my car")).toMatchObject({ ok: false });
  });
  it("finds reminders due today, once", () => {
    const friday = new Date(2026, 10, 20);
    const reminders = [{ id: "a", goalId: "car", amount: 20, weekday: 5 }, { id: "b", goalId: "car", amount: 5, weekday: 7, lastShown: "2026-11-20" }, { id: "c", goalId: "car", amount: 5, weekday: 1 }];
    expect(dueReminders(reminders, friday).map(r => r.id)).toEqual(["a"]);
  });
});

describe("7. affordability questions", () => {
  it("pulls out the item and price", () => {
    expect(parseAffordQuestion("Can I afford $80 shoes?")).toEqual({ item: "shoes", price: 80 });
    expect(parseAffordQuestion("should I buy a jacket for $120")).toEqual({ item: "jacket", price: 120 });
    expect(parseAffordQuestion("Can I afford a car?")).toBeNull();
    expect(parseAffordQuestion("add $20 to car")).toBeNull();
  });
});

it("every action has a card description", () => {
  const all: PolarisAction[] = [
    { kind: "add", goalId: "car", amount: 1 }, { kind: "create_goal", name: "X", target: 5, weekly: 0 }, { kind: "mark_bought", goalId: "car", amount: 5 },
    { kind: "move", goalId: "car", toGoalId: "trip", amount: 1 }, { kind: "set_budget", field: "income", amount: 1 }, { kind: "reminder", goalId: "car", amount: 1, weekday: 2 },
  ];
  for (const a of all) expect(describeAction(a, world).title.length).toBeGreaterThan(0);
});

describe("deleting goals", () => {
  it("deletes one goal by name", () => {
    expect(action("delete my car goal")).toEqual({ kind: "delete_goals", goalIds: ["car"] });
    expect(action("can you remove the spring break trip goal?")).toEqual({ kind: "delete_goals", goalIds: ["trip"] });
  });
  it("deletes several named goals", () => {
    expect(action("delete the car and phone goals")).toEqual({ kind: "delete_goals", goalIds: ["car", "phone"] });
  });
  it("deletes every current goal, but never bought ones", () => {
    const all = { kind: "delete_goals", goalIds: ["car", "trip", "phone"] };
    expect(action("delete all my goals")).toEqual(all);
    expect(action("delete the current goals that I have")).toEqual(all);
  });
  it("treats a dollar amount as a withdrawal, not a delete", () => {
    expect(action("remove $20 from car")).toMatchObject({ kind: "withdraw", goalId: "car", amount: 20 });
  });
  it("asks which goal when none matches", () => {
    const c = parse("delete my boat goal");
    expect(c?.ok).toBe(false);
  });
  it("describes, applies, and can be undone", () => {
    const a: PolarisAction = { kind: "delete_goals", goalIds: ["car", "trip"] };
    const summary = describeAction(a, world);
    expect(summary.title).toBe("Delete 2 goals");
    expect(summary.rows.map(r => r.after)).toEqual(["Deleted", "Deleted"]);
    expect(summary.note).toContain("$2,300 set aside becomes free cash");
    const result = apply(a, world, ids);
    expect(result.removedGoalIds).toEqual(["car", "trip"]);
    expect(result.undo.restoreGoals?.map(g => g.id)).toEqual(["car", "trip"]);
  });
});

describe("purchase questions", () => {
  it("understands the ways people ask about buying something", () => {
    expect(parseAffordQuestion("can I order $80 shoes")).toEqual({ item: "shoes", price: 80 });
    expect(parseAffordQuestion("Can I afford $80 shoes?")).toEqual({ item: "shoes", price: 80 });
    expect(parseAffordQuestion("should I purchase a $1,200 laptop?")).toEqual({ item: "laptop", price: 1200 });
    expect(parseAffordQuestion("is it ok to buy $45 concert tickets")).toEqual({ item: "concert tickets", price: 45 });
    expect(parseAffordQuestion("I want to get $30 headphones")).toEqual({ item: "headphones", price: 30 });
    expect(parseAffordQuestion("can I spend $60 on dinner")).toEqual({ item: "dinner", price: 60 });
  });
  it("leaves other questions alone", () => {
    expect(parseAffordQuestion("how do I start investing $500")).toBeNull();
    expect(parseAffordQuestion("can I order shoes")).toBeNull(); // no price
    expect(parseAffordQuestion("add $20 to my car goal")).toBeNull();
  });
});
