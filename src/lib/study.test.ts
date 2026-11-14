import { describe, expect, it } from "vitest";
import { assignTopics, distribute, recommendedHours, replan, studyDays, whatIfActivity, type PlanInput } from "./study";

const TODAY = "2026-11-13"; // a Friday

// The stats example from the brainstorm: exam in 5 days, 60% confident, want a B, 8 hours free.
const stats = (): PlanInput => ({
  examDate: "2026-11-18",
  confidence: 60,
  targetGrade: "B",
  hoursAvailable: 8,
  quizScores: [],
  activities: [],
  plan: [],
});

describe("recommendedHours", () => {
  it("B at 60% → 7 hours (fits in 8 available)", () => {
    expect(recommendedHours("B", 60)).toBe(7);
  });
  it("lower quiz score → more hours, higher → fewer", () => {
    expect(recommendedHours("B", 50)).toBeGreaterThan(7);
    expect(recommendedHours("B", 85)).toBeLessThan(7);
  });
});

describe("schedule", () => {
  it("study days run up to the day before the exam", () => {
    expect(studyDays("2026-11-18", TODAY)).toEqual(["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]);
  });
  it("distribute spreads hours in half-hour blocks and keeps the total", () => {
    const plan = distribute(7, studyDays("2026-11-18", TODAY));
    expect(plan.reduce((s, d) => s + d.hours, 0)).toBe(7);
    expect(plan.every((d) => d.hours * 2 === Math.round(d.hours * 2))).toBe(true);
  });
  it("initial plan uses the recommended 7 hours", () => {
    const plan = replan(stats(), TODAY);
    expect(plan).toHaveLength(5);
    expect(plan.reduce((s, d) => s + d.hours, 0)).toBe(7);
  });
  it("a practice quiz below the target adds hours (capped by free time)", () => {
    const g = { ...stats(), quizScores: [50] };
    const total = replan(g, TODAY).reduce((s, d) => s + d.hours, 0);
    expect(total).toBeGreaterThan(7);
    expect(total).toBeLessThanOrEqual(8);
  });
  it("completed days are kept when replanning", () => {
    const g = stats();
    g.plan = replan(g, TODAY);
    g.plan[0] = { ...g.plan[0], done: true };
    const next = replan({ ...g, quizScores: [85] }, TODAY);
    expect(next[0]).toEqual(g.plan[0]);
  });
});

describe("what-if: 2-hour movie on Friday", () => {
  it("shows time left and moves Friday's study to other days", () => {
    const g = stats();
    g.plan = replan(g, TODAY);
    const w = whatIfActivity(g, { label: "Movie", hours: 2, date: TODAY }, TODAY);
    expect(w.freeBefore).toBe(8);
    expect(w.freeAfter).toBe(6);
    expect(w.recommended).toBe(7);
    expect(w.shortBy).toBe(1); // 7 recommended, only 6 free
    expect(w.after.find((d) => d.date === TODAY)!.hours).toBe(0);
    expect(w.after.reduce((s, d) => s + d.hours, 0)).toBe(6);
    expect(w.moved.length).toBeGreaterThan(0);
  });
});

describe("topics", () => {
  it("hard topics come first and more often; last session is review", () => {
    const g = { ...stats(), topics: [
      { name: "Descriptive stats", difficulty: "easy" as const },
      { name: "Hypothesis tests", difficulty: "hard" as const },
    ] };
    const plan = replan(g, TODAY);
    expect(plan[0].topic).toBe("Hypothesis tests");
    expect(plan.at(-1)!.topic).toMatch(/Review/);
    const hard = plan.filter((d) => d.topic === "Hypothesis tests").length;
    const easy = plan.filter((d) => d.topic === "Descriptive stats").length;
    expect(hard).toBeGreaterThan(easy);
  });
  it("no topics → plan unchanged", () => {
    const days = [{ date: TODAY, hours: 1, done: false }];
    expect(assignTopics(days, [])).toEqual(days);
  });
});
