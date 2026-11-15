import { describe, expect, it } from "vitest";
import {
  formatWeeks,
  goalPhrase,
  hoursOfWork,
  priceInContext,
  formatDelay,
  projectedDate,
  recommendation,
  weeklyNeededForDeadline,
  weeklyToKeepDate,
  weeksToGoal,
  whatIfSpend,
} from "./finance";

// The hoodie example from the brainstorm: $150 goal, $60 saved, $15/week.
describe("hoodie example", () => {
  it("takes 6.0 weeks", () => {
    expect(formatWeeks(weeksToGoal(150, 60, 15))).toBe("6.0 weeks");
  });
  it("$20 dinner → 7.3 weeks, 9.3 days later", () => {
    const w = whatIfSpend(150, 60, 15, 20);
    expect(formatWeeks(w.originalWeeks)).toBe("6.0 weeks");
    expect(formatWeeks(w.newWeeks)).toBe("7.3 weeks");
    expect(w.delayDays).toBeCloseTo(9.33, 2);
  });
  it("cooking for $5 → about 2 days", () => {
    expect(whatIfSpend(150, 60, 15, 5).delayDays).toBeCloseTo(2.33, 2);
  });
  it("skipping → no delay", () => {
    expect(whatIfSpend(150, 60, 15, 0).delayDays).toBe(0);
  });
  it("keeping the date after dinner needs $18.33/week", () => {
    expect(weeklyToKeepDate(150, 60, 15, 20)).toBeCloseTo(18.33, 2);
  });
  it("recommendation is a decision assistant, not a scold", () => {
    const text = recommendation({
      goalName: "hoodie",
      spendLabel: "going out to eat",
      spendDelayDays: 9.33,
      altLabel: "cooking at home",
      altPrice: 5,
      altDelayDays: 2.33,
      value: "spending time with friends",
      choiceLabel: "dinner out",
    });
    expect(text).toBe(
      "Going out to eat will delay your hoodie goal by about 9 days. Cooking at home for $5 instead would reduce that delay to about 2 days. However, if spending time with friends is important to you, you can still choose dinner out and adjust your savings plan.",
    );
  });
});

describe("weekly plan edge cases", () => {
  it("already funded → 0 weeks", () => {
    expect(weeksToGoal(150, 200, 15)).toBe(0);
  });
  it("no weekly savings → never", () => {
    expect(weeksToGoal(150, 60, 0)).toBe(Infinity);
    expect(projectedDate(Infinity)).toBeNull();
  });
  it("projected date rounds up to whole days", () => {
    expect(projectedDate(6, "2026-11-13")).toBe("2026-12-25");
  });
  it("subtracts existing savings and recalculates after deposits", () => {
    expect(weeklyNeededForDeadline(1000, 200, "2026-12-12", "2026-11-14")).toBe(200);
    expect(weeklyNeededForDeadline(1000, 400, "2026-12-12", "2026-11-14")).toBe(150);
  });
  it("needs no weekly contribution once fully funded", () => {
    expect(weeklyNeededForDeadline(1000, 1200, "2026-12-12", "2026-11-14")).toBe(0);
  });
  it("prorates a timeline shorter than one week", () => {
    expect(weeklyNeededForDeadline(100, 40, "2026-11-17", "2026-11-14")).toBe(140);
  });
  it("weekly needed for a deadline", () => {
    expect(weeklyNeededForDeadline(150, 60, "2026-12-25", "2026-11-13")).toBeCloseTo(15, 5);
  });
});

describe("hours of work", () => {
  it("divides price by wage", () => {
    expect(hoursOfWork(112.5, 25)).toBe(4.5);
    expect(hoursOfWork(100, 0)).toBe(0);
  });
});

describe("goalPhrase", () => {
  it("drops leading articles so sentences read naturally", () => {
    expect(goalPhrase("A new hoodie")).toBe("new hoodie");
    expect(goalPhrase("Emergency Fund")).toBe("Emergency Fund");
    expect(goalPhrase("New AirPods")).toBe("New AirPods");
  });
});

describe("priceInContext", () => {
  it("uses hours of work for everyday buys", () => {
    expect(priceInContext(75, { hourlyWage: 18, monthlyIncome: 1788 })).toEqual({ before: "That's ", strong: "4h 10m of work", after: " at $18/hr." });
  });
  it("switches to take-home pay for big purchases", () => {
    expect(priceInContext(20000, { hourlyWage: 18, monthlyIncome: 893.75 })?.strong).toBe("22 months of your take-home pay");
    expect(priceInContext(1200, { hourlyWage: 18, monthlyIncome: 893.75 })?.strong).toBe("1 month of your take-home pay");
    expect(priceInContext(800, { hourlyWage: 10, monthlyIncome: 1000 })?.strong).toBe("3 weeks of your take-home pay");
  });
  it("falls back to full-time work, then to nothing", () => {
    expect(priceInContext(20000, { hourlyWage: 18 })?.strong).toBe("28 weeks of full-time work");
    expect(priceInContext(50000, { hourlyWage: 18 })?.strong).toBe("1.3 years of full-time work");
    expect(priceInContext(20000, {})).toBeNull();
  });
});

describe("formatDelay", () => {
  it("picks days, weeks, months, or years", () => {
    expect(formatDelay(0.5)).toBe("0.5 days");
    expect(formatDelay(1)).toBe("1 day");
    expect(formatDelay(9.6)).toBe("10 days");
    expect(formatDelay(35)).toBe("5 weeks");
    expect(formatDelay(639.9)).toBe("21 months");
    expect(formatDelay(1813.5)).toBe("5 years");
    expect(formatDelay(1100)).toBe("3 years");
    expect(formatDelay(130)).toBe("4 months, 1 week");
    expect(formatDelay(2812)).toBe("7 years, 8 months");
  });
});

