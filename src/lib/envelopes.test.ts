import { describe, expect, it } from "vitest";
import { activeGoals, boughtGoals, envelopes, goalForItem, markBought, unmarkBought } from "./envelopes";
import type { MoneyGoal } from "./types";

const goal = (name: string, target: number, saved: number, extra: Partial<MoneyGoal> = {}): MoneyGoal => ({ kind: "money", id: name, name, target, saved, weekly: 10, ...extra });
const car = goal("Car", 20000, 600);
const japan = goal("Japan trip", 1500, 700);
const airpods = goal("AirPods", 100, 170);

describe("envelopes", () => {
  it("splits cash into each goal's share and what's left", () => {
    const e = envelopes([car, japan, airpods], 1500);
    expect(e.goals.map((g) => g.amount)).toEqual([600, 700, 170]);
    expect(e.setAside).toBe(1470);
    expect(e.free).toBe(30);
    expect(e.over).toBe(0);
  });
  it("flags goals that claim more cash than you have", () => {
    const e = envelopes([goal("Car", 20000, 1000), goal("Japan trip", 1500, 800), airpods], 1500);
    expect(e.free).toBe(0);
    expect(e.over).toBe(470);
  });
  it("stops counting a goal once it's bought", () => {
    const { bought } = markBought(airpods, 100, "2026-11-14");
    expect(envelopes([car, japan, bought], 1400).free).toBe(100);
    expect(activeGoals([car, bought])).toEqual([car]);
    expect(boughtGoals([car, bought])).toEqual([bought]);
  });
});

describe("markBought", () => {
  it("records the purchase and returns the leftover", () => {
    const { bought, leftover, receiver } = markBought(airpods, 100, "2026-11-14");
    expect(bought).toMatchObject({ boughtAt: "2026-11-14", boughtFor: 100 });
    expect(leftover).toBe(70);
    expect(receiver).toBeNull();
  });
  it("can move the leftover into another goal", () => {
    expect(markBought(airpods, 100, "2026-11-14", japan).receiver?.saved).toBe(770);
  });
  it("can be undone", () => {
    expect(unmarkBought(markBought(airpods, 100, "2026-11-14").bought)).toEqual(airpods);
  });
});

describe("goalForItem", () => {
  it("finds the goal a purchase is for", () => {
    expect(goalForItem("airpods", [car, japan, airpods])?.name).toBe("AirPods");
    expect(goalForItem("Japan flights", [car, japan, airpods])?.name).toBe("Japan trip");
    expect(goalForItem("headphones", [car, japan, airpods])).toBeNull();
  });
  it("never offers the emergency fund", () => {
    expect(goalForItem("emergency car repair", [goal("Emergency fund", 1000, 400)])).toBeNull();
  });
});
