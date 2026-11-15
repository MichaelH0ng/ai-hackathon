import { describe, expect, it } from "vitest";
import { polarisMood } from "./polarisMood";

const base = { goals: [], monthlyIncome: 0, monthlyExpenses: 0, monthlyGoalContributions: 0 };

describe("polarisMood", () => {
  it("has no mood with nothing to react to", () => {
    expect(polarisMood(base)).toBeNull();
    expect(polarisMood({ ...base, goals: [{ name: "Trip", target: 1000, saved: 500, weekly: 20 }] })).toBeNull();
  });

  it("celebrates a funded goal", () => {
    expect(polarisMood({ ...base, goals: [{ name: "Laptop", target: 800, saved: 800, weekly: 0 }] })).toMatchObject({ mood: "happy", text: expect.stringContaining("Laptop") });
  });

  it("cheers a goal that is at least 90% funded", () => {
    const note = polarisMood({ ...base, goals: [{ name: "Trip", target: 1000, saved: 950, weekly: 20 }] });
    expect(note).toMatchObject({ mood: "happy" });
    expect(note?.text).toContain("95%");
  });

  it("worries when the monthly plan is over income, even with a funded goal", () => {
    const note = polarisMood({
      goals: [{ name: "Laptop", target: 800, saved: 800, weekly: 0 }],
      monthlyIncome: 2000, monthlyExpenses: 1900, monthlyGoalContributions: 300,
    });
    expect(note?.mood).toBe("worried");
  });

  it("ignores spending when no income is entered", () => {
    expect(polarisMood({ ...base, monthlyExpenses: 500 })).toBeNull();
  });
});
