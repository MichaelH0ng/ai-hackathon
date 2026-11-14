import { describe, expect, it } from "vitest";
import { completeMission, treeStage, weeklyMissions, weekStart } from "./missions";
describe("weekly learning", () => {
  it("uses Monday of the local week across a year boundary", () => {
    expect(weekStart(new Date(2027, 0, 3, 12))).toBe("2026-12-28");
    expect(weekStart(new Date(2027, 0, 4, 12))).toBe("2027-01-04");
  });
  it("rotates lessons on the next week", () => {
    expect(weeklyMissions("2026-11-09")).toHaveLength(3);
    expect(weeklyMissions("2026-11-09").map(m => m.id)).not.toEqual(weeklyMissions("2026-11-16").map(m => m.id));
  });
  it("rewards a mission once per week and preserves prior progress", () => {
    const week = "2026-11-09";
    const mission = weeklyMissions(week)[0].id;
    const result = completeMission([], week, mission);
    expect(completeMission(result, week, mission)).toBe(result);
    expect(completeMission(result, week, "unknown")).toBe(result);
    const future = "2026-11-23";
    expect(completeMission(result, future, mission)).toHaveLength(2);
    expect(treeStage(result.length).name).toBe("Sprout");
  });
  it("reaches each growth stage without tying growth to money", () => {
    expect([0, 1, 3, 6, 12].map(n => treeStage(n).level)).toEqual([0, 1, 2, 3, 4]);
    expect(treeStage(30).next).toBeNull();
  });
});
