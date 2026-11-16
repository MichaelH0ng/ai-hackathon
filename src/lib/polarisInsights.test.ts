import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import type { BankAccount, BankTransaction } from "./money";
import { billHeadsUp, WHAT_CHANGED, weekStart, weeklyCheckIn, whatChanged } from "./polarisInsights";

let n = 0;
const tx = (date: string, name: string, amount: number, category = "FOOD_AND_DRINK"): BankTransaction => ({ id: `t${++n}`, accountId: "chk", date, name, amount, category, pending: false });
const checking: BankAccount = { id: "chk", name: "Checking", mask: "1234", type: "depository", subtype: "checking", current: 500, available: 500, institution: "Bank" };

// Sunday Nov 15, 2026. Last week = Sun Nov 8 to Sat Nov 14.
const today = "2026-11-15";
const usualWeeks = Array.from({ length: 8 }, (_, i) => {
  const sunday = addDays("2026-11-01", -7 * i);
  return [tx(sunday, "Cafe", 50), tx(sunday, "Target", 30, "GENERAL_MERCHANDISE")];
}).flat();

describe("weeklyCheckIn", () => {
  it("summarizes last week against a usual week", () => {
    const transactions = [...usualWeeks, tx("2026-11-09", "Cafe", 90), tx("2026-11-12", "Sushi Place", 60), tx("2026-11-10", "Target", 30, "GENERAL_MERCHANDISE")];
    const result = weeklyCheckIn({ transactions }, [{ id: "g", kind: "money", name: "Car fund", target: 1000, saved: 600, weekly: 40, createdAt: "2026-01-01" } as never], today)!;
    expect(result.key).toBe("2026-11-08");
    expect(result.text).toContain("Nov 8–Nov 14");
    expect(result.text).toContain("**$180**");
    expect(result.text).toContain("**$100 more** than your usual week ($80)");
    expect(result.text).toContain("Food & drink");
    expect(result.text).toContain("Car fund is **60%** funded");
  });
  it("waits for a full week of history", () => {
    expect(weeklyCheckIn({ transactions: [tx("2026-11-12", "Cafe", 5)] }, [], today)).toBeNull();
  });
  it("finds the Sunday a week starts on", () => {
    expect(weekStart("2026-11-18")).toBe("2026-11-15");
    expect(weekStart("2026-11-15")).toBe("2026-11-15");
  });
});

describe("billHeadsUp", () => {
  const rent = ["2026-09-17", "2026-10-17"].map((date) => tx(date, "Mustang Village", 400, "RENT_AND_UTILITIES"));
  const now = new Date(2026, 10, 15);
  it("warns about a bill due within 3 days and what's left after it", () => {
    const result = billHeadsUp({ transactions: rent, accounts: [checking] }, new Set(), 3, now)!;
    expect(result.keys).toEqual(["Mustang Village|2026-11-17"]);
    expect(result.text).toContain("**Mustang Village**: about $400, due in 2 days");
    expect(result.text).toContain("about **$100** after it");
  });
  it("mentions each bill once", () => {
    expect(billHeadsUp({ transactions: rent, accounts: [checking] }, new Set(["Mustang Village|2026-11-17"]), 3, now)).toBeNull();
  });
});

describe("whatChanged", () => {
  it("compares this month so far with the same days last month", () => {
    const transactions = [
      tx("2026-09-20", "Cafe", 10),
      tx("2026-10-05", "Cafe", 100), tx("2026-10-08", "Target", 50, "GENERAL_MERCHANDISE"),
      tx("2026-11-04", "Cafe", 180), tx("2026-11-10", "Target", 45, "GENERAL_MERCHANDISE"), tx("2026-11-12", "Delta", 240, "TRAVEL"),
    ];
    const text = whatChanged({ transactions }, today);
    expect(text).toContain("**This month so far: $465**, **$315 more** than the same point last month ($150)");
    expect(text).toContain("- Travel: +$240");
    expect(text).toContain("- Food & drink: +$80");
    expect(text).toContain("New this period: Delta ($240)");
  });
  it("recognizes the question", () => {
    for (const q of ["What changed this month?", "why am I spending more", "what's different", "is my spending higher than last month"]) expect(WHAT_CHANGED.test(q)).toBe(true);
    expect(WHAT_CHANGED.test("how much did I spend on food")).toBe(false);
  });
});
