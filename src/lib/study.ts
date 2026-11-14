// Study planner math. Deliberately makes no claims about grades —
// it only reasons about time: recommended hours, schedule, and what moves.

import { addDays, daysBetween, todayISO } from "./dates";

export type Grade = "A" | "B" | "C";

export const GRADE_TARGET: Record<Grade, number> = { A: 90, B: 80, C: 70 };
const BASE_HOURS: Record<Grade, number> = { A: 12, B: 9, C: 6 };

export interface PlanDay {
  date: string; // YYYY-MM-DD
  hours: number;
  done: boolean;
  topic?: string; // what to focus on that day
}

export type Difficulty = "easy" | "medium" | "hard";

export interface Topic {
  name: string;
  difficulty: Difficulty;
}

const WEIGHT: Record<Difficulty, number> = { hard: 3, medium: 2, easy: 1 };

/**
 * Give each study day a focus. Harder topics come up first and more often
 * (smooth weighted round-robin). With 3+ sessions, the last one is a review.
 */
export function assignTopics(days: PlanDay[], topics: Topic[]): PlanDay[] {
  const sessions = days.filter((d) => d.hours > 0 && !d.done);
  if (!topics.length || !sessions.length) return days;
  const sorted = [...topics].sort((a, b) => WEIGHT[b.difficulty] - WEIGHT[a.difficulty]);
  const total = sorted.reduce((s, t) => s + WEIGHT[t.difficulty], 0);
  const current = sorted.map(() => 0);
  const labels = new Map<string, string>();
  const reviewLast = sessions.length >= 3;
  sessions.forEach((d, i) => {
    if (reviewLast && i === sessions.length - 1) {
      labels.set(d.date, "Review everything + practice problems");
      return;
    }
    sorted.forEach((t, k) => (current[k] += WEIGHT[t.difficulty]));
    let best = 0;
    current.forEach((c, k) => {
      if (c > current[best]) best = k;
    });
    current[best] -= total;
    labels.set(d.date, sorted[best].name);
  });
  return days.map((d) => (labels.has(d.date) ? { ...d, topic: labels.get(d.date) } : d));
}

export interface StudyActivity {
  label: string;
  hours: number;
  date: string;
}

const roundHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * Rough starting estimate of total study hours: bigger gap between where you are
 * (confidence or latest quiz score) and the grade you want → more hours.
 * Example: want a B, 60% ready → 7 hours.
 */
export function recommendedHours(grade: Grade, readiness: number): number {
  const factor = Math.min(2, Math.max(0.3, (GRADE_TARGET[grade] + 10 - readiness) / 40));
  return roundHalf(BASE_HOURS[grade] * factor);
}

/** Latest quiz score if there is one, otherwise self-rated confidence. */
export function readiness(confidence: number, quizScores: number[]): number {
  return quizScores.length ? quizScores[quizScores.length - 1] : confidence;
}

/** Study days from today up to (not including) exam day. At least today. */
export function studyDays(examDate: string, from: string = todayISO()): string[] {
  const n = Math.max(1, daysBetween(from, examDate));
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

/**
 * Spread `totalHours` across `days` in half-hour blocks. Days with an activity
 * lose that many hours, and the freed time moves to the other days.
 */
export function distribute(totalHours: number, days: string[], activities: StudyActivity[] = []): PlanDay[] {
  if (days.length === 0) return [];
  const units = Math.round(totalHours * 2);
  const base = Math.floor(units / days.length);
  let extra = units % days.length;
  const plan = days.map((date) => {
    const u = base + (extra-- > 0 ? 1 : 0);
    return { date, units: u };
  });

  // Take time away from activity days
  const busyUnits = new Map<string, number>();
  for (const a of activities) busyUnits.set(a.date, (busyUnits.get(a.date) ?? 0) + Math.round(a.hours * 2));
  let freed = 0;
  for (const d of plan) {
    const cut = Math.min(d.units, busyUnits.get(d.date) ?? 0);
    d.units -= cut;
    freed += cut;
  }
  // Give it to the free days, round-robin
  const free = plan.filter((d) => !busyUnits.has(d.date));
  const targets = free.length ? free : plan;
  for (let i = 0; freed > 0; i++, freed--) targets[i % targets.length].units++;

  return plan.map((d) => ({ date: d.date, hours: d.units / 2, done: false }));
}

export interface PlanInput {
  examDate: string;
  confidence: number;
  targetGrade: Grade;
  hoursAvailable: number;
  quizScores: number[];
  activities: StudyActivity[];
  plan: PlanDay[];
  topics?: Topic[];
}

export function recommendedFor(g: Pick<PlanInput, "targetGrade" | "confidence" | "quizScores">): number {
  return recommendedHours(g.targetGrade, readiness(g.confidence, g.quizScores));
}

/** Free hours left for studying after the activities the user chose (an "extra study hour" adds time). */
export function freeHours(g: Pick<PlanInput, "hoursAvailable" | "activities">): number {
  return Math.max(0, g.hoursAvailable - g.activities.reduce((s, a) => s + a.hours, 0));
}

/**
 * Rebuild the schedule. Completed and past days are kept; the remaining hours
 * (recommended, capped by free time) are spread over the days still ahead.
 */
export function replan(g: PlanInput, from: string = todayISO()): PlanDay[] {
  const kept = g.plan.filter((d) => d.done || d.date < from);
  const doneHours = kept.filter((d) => d.done).reduce((s, d) => s + d.hours, 0);
  const total = Math.min(recommendedFor(g), freeHours(g));
  const remaining = Math.max(0, total - doneHours);
  const keptDates = new Set(kept.map((d) => d.date));
  const ahead = studyDays(g.examDate, from).filter((d) => !keptDates.has(d));
  const upcoming = g.activities.filter((a) => a.date >= from);
  const fresh = assignTopics(distribute(remaining, ahead, upcoming), g.topics ?? []);
  return [...kept, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
}

export interface StudyWhatIf {
  freeBefore: number;
  freeAfter: number;
  recommended: number;
  shortBy: number; // hours the recommended plan no longer fits
  before: PlanDay[];
  after: PlanDay[];
  moved: { date: string; from: number; to: number }[];
}

/** What changes if the user spends `activity.hours` on something else. */
export function whatIfActivity(g: PlanInput, activity: StudyActivity, from: string = todayISO()): StudyWhatIf {
  const before = replan(g, from);
  const next = { ...g, activities: [...g.activities, activity] };
  const after = replan(next, from);
  const recommended = recommendedFor(g);
  const freeAfter = freeHours(next);
  const moved = after
    .map((d) => ({ date: d.date, from: before.find((b) => b.date === d.date)?.hours ?? 0, to: d.hours }))
    .filter((m) => m.from !== m.to);
  return {
    freeBefore: freeHours(g),
    freeAfter,
    recommended,
    shortBy: Math.max(0, recommended - freeAfter),
    before,
    after,
    moved,
  };
}
