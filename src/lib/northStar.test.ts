import { describe, expect, it } from "vitest";
import { northStarMilestone } from "./northStar";

describe("NorthStar milestones", () => {
  it("brings planets online as savings-goal progress reaches each 20% milestone", () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 99, 100].map(progress => northStarMilestone(progress).activePlanets))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  it("clamps progress and reports the next milestone", () => {
    expect(northStarMilestone(-10)).toEqual({ name: "Launchpad", activePlanets: 0, nextAt: 20 });
    expect(northStarMilestone(120)).toEqual({ name: "Full system", activePlanets: 5, nextAt: null });
  });
});
