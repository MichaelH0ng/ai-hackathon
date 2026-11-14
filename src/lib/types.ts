import type { Risk } from "./finance";
import type { Diet } from "./grocery";
import type { Grade, PlanDay, StudyActivity, Topic } from "./study";

export interface MoneyGoal {
  kind: "money";
  id: string;
  name: string;
  target: number;
  saved: number;
  weekly: number; // what the user can save each week
  deadline?: string; // YYYY-MM-DD, optional "I want it by"
  risk: Risk;
  certainty?: number; // 0–100: how sure they are they want it (default 100)
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

export interface FoodGoal {
  kind: "food";
  id: string;
  name: string;
  weeklyBudget: number; // grocery budget per week
  mealsPerWeek: number; // home meals to cover
  mealsOutPerWeek: number; // how often they eat out now
  costPerMealOut: number;
  swapPerWeek: number; // meals out they'd swap for cooking
  diets: Diet[];
  linkedGoalId?: string; // money goal the savings go to
  appliedPerWeek?: number; // savings already added to that goal's weekly plan
}

export type Goal = MoneyGoal | StudyGoal | FoodGoal;

export interface Profile {
  hourlyWage: number | null; // optional: lets us say "that's 48 minutes of work"
}

/** A choice the user made in a What-If — powers "Your choices" insights. */
export interface Decision {
  id: string;
  date: string; // YYYY-MM-DD
  goalId: string;
  goalName: string;
  label: string; // "Cooked at home instead of going out to eat"
  kind: "money" | "study";
  effectDays?: number; // + = goal sooner, − = goal later (money)
  amount?: number; // money kept (+) or spent (−)
  hours?: number; // study hours used (−) or added (+)
}
