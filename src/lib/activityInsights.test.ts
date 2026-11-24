import { describe, expect, it } from "vitest";
import type { BankTransaction } from "./money";
import type { MoneyGoal } from "./types";
import {
  budgetPace, categoryChanges, changeText, dailySpending, goalImpact, heatLevel, monthGrid, monthSpending, outByDay,
  priceChanges, rangeStart, sortTransactions, summarize, toCsv, unusualCharges,
} from "./activityInsights";

let n = 0;
const tx = (p: Partial<BankTransaction>): BankTransaction => ({ id: `t${n++}`, accountId: "chk", date: "2026-11-10", name: "X", amount: 10, category: "FOOD_AND_DRINK", pending: false, ...p });
const NOW = new Date(2026, 10, 14); // Nov 14, 2026
const none = new Set<string>();

describe("range and sort", () => {
  it("finds where each range starts", () => {
    expect(rangeStart("7d", NOW)).toBe("2026-11-07");
    expect(rangeStart("30d", NOW)).toBe("2026-10-15");
    expect(rangeStart("all", NOW)).toBeNull();
  });
  it("sorts newest, oldest, and biggest", () => {
    const a = tx({ date: "2026-11-01", amount: 5 });
    const b = tx({ date: "2026-11-03", amount: -200 });
    const c = tx({ date: "2026-11-02", amount: 50 });
    expect(sortTransactions([a, b, c], "newest").map((t) => t.id)).toEqual([b.id, c.id, a.id]);
    expect(sortTransactions([a, b, c], "oldest").map((t) => t.id)).toEqual([a.id, c.id, b.id]);
    expect(sortTransactions([a, b, c], "biggest").map((t) => t.id)).toEqual([b.id, c.id, a.id]);
  });
});

describe("totals", () => {
  it("adds posted money out and in, skipping transfers and counting pending separately", () => {
    const list = [
      tx({ amount: 40 }),
      tx({ amount: -100, category: "INCOME" }),
      tx({ amount: 25, pending: true }),
      tx({ amount: 500, category: "TRANSFER_OUT" }),
    ];
    expect(summarize(list, none)).toEqual({ out: 40, in: 100, pending: 1, count: 4 });
  });
  it("totals money out by day", () => {
    const m = outByDay([tx({ date: "2026-11-02", amount: 10 }), tx({ date: "2026-11-02", amount: 5 }), tx({ date: "2026-11-03", amount: -9 })], none);
    expect(m.get("2026-11-02")).toBe(15);
    expect(m.has("2026-11-03")).toBe(false);
  });
});

describe("month and budget", () => {
  it("adds this month's spending and lets a refund come off", () => {
    const list = [tx({ date: "2026-11-02", amount: 100 }), tx({ date: "2026-11-05", amount: -30 }), tx({ date: "2026-10-30", amount: 999 })];
    expect(monthSpending(list, none, NOW)).toBe(70);
  });
  it("reports pace against a budget", () => {
    expect(budgetPace(200, 1000, NOW).status).toBe("on-track"); // 20% spent, 47% through the month
    expect(budgetPace(700, 1000, NOW).status).toBe("ahead");
    expect(budgetPace(1200, 1000, NOW).status).toBe("over");
    expect(budgetPace(0, 0, NOW).spentPct).toBe(0);
  });
});

describe("trend and calendar", () => {
  it("gives one entry per day, today last, zeros included", () => {
    const days = dailySpending([tx({ date: "2026-11-14", amount: 12 }), tx({ date: "2026-11-12", amount: 8 })], none, 5, NOW);
    expect(days.map((d) => d.date)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(days.map((d) => d.spent)).toEqual([0, 0, 8, 0, 12]);
  });
  it("lays a month out in whole weeks starting Sunday", () => {
    const weeks = monthGrid([tx({ date: "2026-11-03", amount: 20 })], none, 2026, 10);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]?.date).toBe("2026-11-01"); // Nov 1, 2026 is a Sunday
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.flat().find((c) => c?.date === "2026-11-03")?.spent).toBe(20);
  });
  it("scales heat levels to the biggest day", () => {
    expect([0, 10, 30, 60, 100].map((v) => heatLevel(v, 100))).toEqual([0, 1, 2, 3, 4]);
    expect(heatLevel(5, 0)).toBe(0);
  });
});

describe("category change", () => {
  it("compares the last 30 days to the 30 before", () => {
    const list = [
      tx({ date: "2026-11-10", amount: 130, category: "FOOD_AND_DRINK" }),
      tx({ date: "2026-10-05", amount: 100, category: "FOOD_AND_DRINK" }),
      tx({ date: "2026-11-11", amount: 40, category: "ENTERTAINMENT" }),
    ];
    const rows = categoryChanges(list, none, 30, NOW);
    const food = rows.find((r) => r.key === "FOOD_AND_DRINK")!;
    expect(food.current).toBe(130);
    expect(food.previous).toBe(100);
    expect(changeText(food)).toBe("up 30%");
    expect(changeText(rows.find((r) => r.key === "ENTERTAINMENT")!)).toBeNull();
  });
  it("calls small moves the same", () => {
    expect(changeText({ pct: 0.03 })).toBe("about the same");
    expect(changeText({ pct: -0.2 })).toBe("down 20%");
  });
});

describe("unusual charges", () => {
  const usual = (date: string, amount: number) => tx({ name: "Safeway", date, amount });
  it("flags a charge far above a merchant's usual", () => {
    const history = [usual("2026-08-01", 40), usual("2026-08-15", 50), usual("2026-09-01", 45), usual("2026-10-01", 42)];
    const big = usual("2026-11-10", 160);
    const found = unusualCharges([...history, big], none, NOW);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(big.id);
    expect(found[0]!.typical).toBe(43.5);
  });
  it("needs three earlier charges and a real jump", () => {
    expect(unusualCharges([usual("2026-10-01", 40), usual("2026-10-10", 40), usual("2026-11-10", 200)], none, NOW)).toHaveLength(0);
    const history = [usual("2026-08-01", 5), usual("2026-08-15", 5), usual("2026-09-01", 5)];
    expect(unusualCharges([...history, usual("2026-11-10", 12)], none, NOW)).toHaveLength(0); // double, but only $7 more
  });
});

describe("price changes", () => {
  const sub = (date: string, amount: number) => tx({ name: "Streamflix", date, amount, category: "ENTERTAINMENT" });
  it("catches a subscription that went up", () => {
    const found = priceChanges([sub("2026-09-12", 15.49), sub("2026-10-12", 15.49), sub("2026-11-12", 17.99)], none, NOW);
    expect(found).toEqual([{ name: "Streamflix", from: 15.49, to: 17.99, date: "2026-11-12" }]);
  });
  it("ignores charges that always vary and ones that stayed the same", () => {
    expect(priceChanges([sub("2026-09-12", 20), sub("2026-10-12", 31), sub("2026-11-12", 25)], none, NOW)).toHaveLength(0);
    expect(priceChanges([sub("2026-09-12", 15), sub("2026-10-12", 15), sub("2026-11-12", 15)], none, NOW)).toHaveLength(0);
  });
});

describe("goal impact", () => {
  const goal = (p: Partial<MoneyGoal>): MoneyGoal => ({ kind: "money", id: "g", name: "Japan trip", target: 3000, saved: 500, weekly: 70, ...p });
  it("turns a purchase into days of saving", () => {
    expect(goalImpact(30, [goal({})])).toEqual({ goalName: "Japan trip", days: 3 }); // $10 a day
  });
  it("skips finished goals and tiny amounts", () => {
    expect(goalImpact(30, [goal({ saved: 3000 })])).toBeNull();
    expect(goalImpact(2, [goal({})])).toBeNull();
    expect(goalImpact(30, [])).toBeNull();
    expect(goalImpact(30, [goal({ weekly: 0 })])).toBeNull();
  });
});

describe("csv export", () => {
  it("writes signed amounts and quotes text", () => {
    const rows = [tx({ name: 'Joe\'s "Pizza", Inc', amount: 12.5, date: "2026-11-01" }), tx({ name: "Paycheck", amount: -1000, category: "INCOME", date: "2026-11-02" })];
    const csv = toCsv(rows, () => "Checking", none).split("\n");
    expect(csv[0]).toBe("Date,Description,Category,Account,Amount,Status");
    expect(csv[1]).toBe('2026-11-01,"Joe\'s ""Pizza"", Inc","Food & drink","Checking",-12.50,Posted');
    expect(csv[2]?.endsWith(",1000.00,Posted")).toBe(true);
  });
  it("defuses names that start like spreadsheet formulas", () => {
    const csv = toCsv([tx({ name: "=HYPERLINK(\"http://x\")" })], () => "Checking", none);
    expect(csv.split("\n")[1]).toContain("\"'=HYPERLINK(");
  });
});
