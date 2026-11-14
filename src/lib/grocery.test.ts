import { describe, expect, it } from "vitest";
import { CATALOG, planGroceries, weeklySavings } from "./grocery";

describe("planGroceries", () => {
  it("a $40 budget stays under budget and makes many balanced meals", () => {
    const p = planGroceries(40);
    expect(p.total).toBeLessThanOrEqual(40);
    expect(p.meals).toBeGreaterThanOrEqual(20);
    expect(p.costPerMeal).toBeLessThan(2);
  });
  it("respects dietary filters", () => {
    const p = planGroceries(40, ["vegan"]);
    expect(p.items.every(({ item }) => item.diets.includes("vegan"))).toBe(true);
    expect(p.meals).toBeGreaterThan(0);
  });
  it("tiny budget → no meals rather than overspending", () => {
    const p = planGroceries(1);
    expect(p.total).toBeLessThanOrEqual(1);
  });
  it("buys at most 2 of an item", () => {
    expect(planGroceries(200, [], Infinity).items.every((i) => i.qty <= 2)).toBe(true);
  });
  it("stops once the week's meals are covered, leaving money over", () => {
    const p = planGroceries(40, [], 14);
    expect(p.meals).toBeGreaterThanOrEqual(14);
    expect(p.total).toBeLessThan(40);
  });
  it("catalog entries are sane", () => {
    expect(CATALOG.every((i) => i.price > 0 && i.servings > 0)).toBe(true);
  });
});

describe("weeklySavings", () => {
  it("swapping 3 $15 meals for $2 home meals saves $39", () => {
    expect(weeklySavings(3, 15, 2)).toBe(39);
  });
});
