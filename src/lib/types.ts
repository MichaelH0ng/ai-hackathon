import type { Grade, PlanDay, StudyActivity, Topic } from "./study";

export interface MoneyGoal {
  kind: "money";
  id: string;
  name: string;
  target: number;
  saved: number;
  weekly: number; // what the user can save each week
  deadline?: string; // YYYY-MM-DD, optional "I want it by"
  linkedAccountId?: string; // Plaid account whose balance counts as "saved"
}

export interface StudyGoal {
  kind: "study";
  id: string;
  name: string; // e.g. "Statistics exam"
  examDate: string; // YYYY-MM-DD
  confidence: number; // 0–100, self-rated
  targetGrade: Grade;
  hoursAvailable: number; // total free hours before the exam
  quizScores: number[]; // practice quiz results, 0–100
  activities: StudyActivity[]; // things the user chose to do instead (movie, party…)
  plan: PlanDay[];
  topics?: Topic[];
}

export type Goal = MoneyGoal | StudyGoal;

/** Last numbers pulled from the connected bank, so other screens can use them. */
export interface BankSnapshot {
  cash: number; // checking + savings you could spend
  fetchedAt: string;
}

export interface Profile {
  hourlyWage: number | null; // optional: lets us say "that's 48 minutes of work"
}

/** A choice the user made in a What-If — powers "Your choices" insights. */
export interface Decision {
  id: string;
  date: string; // YYYY-MM-DD
  goalId: string;
  goalName: string;
  label: string; // "Skipped AirPods"
  kind: "money" | "study";
  effectDays?: number; // + = goal sooner, − = goal later (money)
  amount?: number; // money kept (+) or spent (−)
  hours?: number; // study hours used (−) or added (+)
}
