import { describe, expect, it } from "vitest";
import {
  formatWeeks,
  futureValue,
  certaintyAdvice,
  decisionScore,
  goalPhrase,
  habitImpact,
  hoursOfWork,
  monthlyNeeded,
  monthsUntil,
  projectedDate,
  projectedValue,
  recommendation,
  requiredRate,
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

describe("growth math", () => {
  it("$2000 in 12 months at 0% and 5%", () => {
    expect(monthlyNeeded(2000, 0, 12, 0)).toBeCloseTo(166.67, 2);
    expect(monthlyNeeded(2000, 0, 12, 0.05)).toBeCloseTo(162.9, 1);
  });
  it("round-trips with projectedValue", () => {
    const m = monthlyNeeded(10_000, 1_000, 36, 0.06);
    expect(projectedValue(1_000, m, 36, 0.06)).toBeCloseTo(10_000, 4);
  });
  it("requiredRate finds the rate, or null when unreachable", () => {
    expect(requiredRate(1200, 0, 100, 12)).toBe(0);
    const r = requiredRate(10_000, 1_000, 220, 36)!;
    expect(projectedValue(1_000, 220, 36, r)).toBeCloseTo(10_000, 2);
    expect(requiredRate(1_000_000, 0, 10, 12)).toBeNull();
  });
  it("futureValue and monthsUntil", () => {
    expect(futureValue(100, 10, 0.07)).toBeCloseTo(196.72, 2);
    expect(monthsUntil("2027-11-13", new Date("2026-11-13T12:00:00"))).toBeCloseTo(12, 0);
  });
});

describe("goalPhrase", () => {
  it("drops leading articles so sentences read naturally", () => {
    expect(goalPhrase("A new hoodie")).toBe("new hoodie");
    expect(goalPhrase("Hoodie")).toBe("hoodie");
  });
});

describe("positive opportunity cost", () => {
  it("cooking 2x/week instead of $20 meals ($30/week more) gets the hoodie much sooner", () => {
    const h = habitImpact(150, 60, 15, 30);
    expect(h.before).toBeCloseTo(6, 5);
    expect(h.after).toBeCloseTo(2, 5);
    expect(h.daysSooner).toBeCloseTo(28, 5);
  });
});

describe("decision score", () => {
  it("dinner with friends can still be worth it", () => {
    const s = decisionScore({ delayDays: 9.33, goalWeeks: 6, enjoyment: 5, importance: 4, urgency: 3, goalCertainty: 80 });
    expect(s.score).toBeGreaterThanOrEqual(70);
    expect(s.verdict).toBe("Worth it for you");
  });
  it("a low-value purchase scores lower", () => {
    const s = decisionScore({ delayDays: 9.33, goalWeeks: 6, enjoyment: 2, importance: 1, urgency: 1, goalCertainty: 90 });
    expect(s.score).toBeLessThan(45);
  });
  it("no delay never hurts the score", () => {
    expect(decisionScore({ delayDays: 0, goalWeeks: 6, enjoyment: 3, importance: 3, urgency: 3, goalCertainty: 100 }).score).toBe(75);
  });
});

describe("certaintyAdvice", () => {
  it("suggests waiting when unsure", () => {
    expect(certaintyAdvice(90)).toBeNull();
    expect(certaintyAdvice(50)).toMatch(/wait a week/);
    expect(certaintyAdvice(20)).toMatch(/30 days/);
  });
});
