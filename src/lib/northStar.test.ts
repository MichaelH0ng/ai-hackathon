import { describe, expect, it } from "vitest";
import { northStarMilestone } from "./northStar";

describe("NorthStar constellation milestones", () => {
  it("lights another star at each 20% milestone, ending at the North Star", () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 99, 100].map(progress => northStarMilestone(progress).litStars))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect(northStarMilestone(100).name).toBe("North Star reached");
    expect(northStarMilestone(45).name).toBe("Second star lit");
  });

  it("fills the line toward the next star between milestones", () => {
    expect(northStarMilestone(50).segments).toEqual([1, 1, 0.5, 0, 0]);
    expect(northStarMilestone(0).segments).toEqual([0, 0, 0, 0, 0]);
    expect(northStarMilestone(100).segments).toEqual([1, 1, 1, 1, 1]);
  });

  it("clamps progress and reports the next milestone", () => {
    expect(northStarMilestone(-10)).toMatchObject({ name: "Starting point", litStars: 0, nextAt: 20 });
    expect(northStarMilestone(120)).toMatchObject({ name: "North Star reached", litStars: 5, nextAt: null });
    expect(northStarMilestone(Number.NaN)).toMatchObject({ litStars: 0 });
  });
});
