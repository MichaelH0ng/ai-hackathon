import { describe, expect, it } from "vitest";
import { budgetBalanceProgress, opportunityCost, retirementProjection } from "./planning";
describe("budget opportunity cost", () => {
  it("translates a one-time purchase to savings days", () => {
    expect(opportunityCost(100, "once", 1000, 0, 100).delayDays).toBeCloseTo(7);
  });
  it("detects recurring spending that consumes the contribution", () => {
    expect(opportunityCost(100, "weekly", 1000, 0, 100).afterMonths).toBe(Infinity);
  });
  it("compares recurring contributions with the baseline", () => {
    const result = opportunityCost(100, "monthly", 1200, 0, 1200 / 52);
    expect(result.baselineMonths).toBe(12);
    expect(result.afterMonths).toBe(Infinity);
    expect(result.annualCost).toBe(1200);
  });
  it("does not delay an already funded goal or divide by zero", () => {
    expect(opportunityCost(100, "once", 500, 500, 0).delayDays).toBe(0);
    expect(opportunityCost(100, "once", 500, 0, 0).afterMonths).toBe(Infinity);
  });
});

describe("budget balance progress", () => {
  it("rewards plans that approach zero remaining income", () => {
    expect(budgetBalanceProgress(5000, 1000)).toBe(80);
    expect(budgetBalanceProgress(5000, 0)).toBe(100);
  });

  it("handles over-budget plans and missing income", () => {
    expect(budgetBalanceProgress(5000, -500)).toBe(90);
    expect(budgetBalanceProgress(0, 0)).toBe(0);
  });
});

describe("retirement projection", () => {
  it("calculates contributions without growth when the return assumption is zero", () => {
    expect(retirementProjection(1000, 100, 0, 2)).toEqual([
      { year: 0, balance: 1000, contributions: 1000 },
      { year: 1, balance: 2200, contributions: 2200 },
      { year: 2, balance: 3400, contributions: 3400 },
    ]);
  });

  it("compounds monthly and keeps a separate contributions-only comparison", () => {
    const points = retirementProjection(1000, 100, 5, 1);
    expect(points[1].balance).toBeGreaterThan(points[1].contributions);
    expect(points[1].contributions).toBe(2200);
  });

  it("rejects invalid ages and assumptions", () => {
    expect(() => retirementProjection(1000, 100, 5, 1.5)).toThrow(RangeError);
    expect(() => retirementProjection(1000, 100, 101, 1)).toThrow(RangeError);
  });
});
