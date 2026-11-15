import { describe, expect, it } from "vitest";
import { buildGoalPath, cutOpportunities } from "./goalPath";
import type { BankData } from "./money";

describe("buildGoalPath", () => {
  it("adds each selected deadline-based goal into one weekly requirement", () => {
    const path = buildGoalPath([
      { kind: "money", id: "car", name: "Car", target: 10_000, saved: 0, weekly: 0, deadline: "2028-01-31" },
      { kind: "money", id: "study", name: "Study abroad", target: 8_000, saved: 0, weekly: 0, deadline: "2027-08-01" },
    ], 200, "2026-11-15");
    expect(path.goals).toHaveLength(2);
    expect(path.weeklyRequired).toBeCloseTo(374.59, 1);
    expect(path.weeklyGap).toBeCloseTo(174.59, 1);
  });

  it("does not include completed or undated goals", () => {
    const path = buildGoalPath([
      { kind: "money", id: "done", name: "Done", target: 100, saved: 100, weekly: 20, deadline: "2027-01-01" },
      { kind: "money", id: "open", name: "Open", target: 100, saved: 0, weekly: 20 },
    ], 100, "2026-11-15");
    expect(path.goals).toHaveLength(0);
  });
});

describe("cutOpportunities", () => {
  it("offers only recent, non-fixed spending as a cut idea", () => {
    const data: BankData = { env: "sandbox", fetchedAt: "2026-11-15T12:00:00Z", status: [], accounts: [], transactions: [
      { id: "food", accountId: "checking", date: "2026-11-10", name: "Cafe", amount: 50, category: "FOOD_AND_DRINK", pending: false },
      { id: "rent", accountId: "checking", date: "2026-11-10", name: "Rent", amount: 500, category: "RENT_AND_UTILITIES", pending: false },
    ] };
    expect(cutOpportunities(data, "2026-11-15").map((item) => item.name)).toEqual(["Food & drink"]);
  });
});
