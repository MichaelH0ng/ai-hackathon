export interface MoneyMission {
  id: string;
  title: string;
  lesson: string;
  question: string;
  answers: string[];
  correct: number;
  explanation: string;
  action: string;
  destination: "Accounts" | "Goals" | "Budget";
}
export const MISSION_KEY = "tradeoff:learning:v1";
export const LESSONS: MoneyMission[] = [
  { id: "picture", title: "Understand what you own", lesson: "An asset is something you own that has value, like cash in checking or money in a retirement account. Net worth is the value of your assets minus your debts.", question: "You own $1,000 and owe $200. What is your net worth?", answers: ["$1,200", "$800", "$200"], correct: 1, explanation: "$1,000 in assets − $200 in debt = $800 in net worth.", action: "Review your accounts", destination: "Accounts" },
  { id: "buffer", title: "Give your savings a purpose", lesson: "An emergency fund is money set aside for unexpected costs, such as a repair. A savings goal helps you choose an amount and set a pace that works for you.", question: "What is an emergency fund for?", answers: ["Unexpected costs", "Everyday shopping", "Money you must invest"], correct: 0, explanation: "A separate buffer can help cover an unexpected cost. You can choose a savings amount that fits your situation.", action: "Plan a savings goal", destination: "Goals" },
  { id: "choice", title: "See the trade-off", lesson: "Opportunity cost means what you give up when you choose something else. Spending $20 means that same $20 cannot also go toward a savings goal.", question: "If you spend $20 from your savings money, what changes?", answers: ["Your goal is automatically canceled", "Nothing changes", "You have $20 less for the goal"], correct: 2, explanation: "The same dollars cannot be spent and saved. The calculator shows how that choice could affect your timeline.", action: "Try a spending what-if", destination: "Budget" },
  { id: "recurring", title: "Spot a repeating cost", lesson: "A recurring cost repeats, like a monthly subscription. A $10 monthly subscription costs $120 over a full year if its price stays the same.", question: "What does $10 a month add up to over 12 months?", answers: ["$10", "$120", "$1,200"], correct: 1, explanation: "$10 × 12 months = $120. Small repeating costs can be easier to understand when you see the yearly total.", action: "Try a monthly cost", destination: "Budget" },
  { id: "budget", title: "Make a little room", lesson: "A budget is a plan for your income. It helps you see what goes to needs, everyday choices, and savings. You can change the plan as life changes.", question: "You earn $500 and plan $350 for spending and saving. What is left to assign?", answers: ["$150", "$350", "$850"], correct: 0, explanation: "$500 − $350 = $150 left to assign. A budget helps you decide where it goes.", action: "Review your budget", destination: "Budget" },
  { id: "risk", title: "Get to know investment risk", lesson: "An investment can rise or fall in value. Risk tolerance describes how comfortable you feel with those changes. Your timeline and situation also matter.", question: "Does a higher-risk investment guarantee a higher return?", answers: ["Yes, always", "No, it can lose value", "Only in a retirement account"], correct: 1, explanation: "Higher risk does not guarantee a higher return. Recording your preferences can help you think about what feels comfortable.", action: "Explore your preferences", destination: "Goals" },
];
/** Monday's date, using the person's local calendar, including across DST. */
export function weekStart(date = new Date()): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  local.setDate(local.getDate() - (local.getDay() + 6) % 7);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}
export function weeklyMissions(week: string): MoneyMission[] {
  const [year, month, day] = week.split("-").map(Number);
  const index = Math.floor(Date.UTC(year, month - 1, day) / (7 * 86400000));
  const start = ((index % 2) + 2) % 2 * 3;
  return LESSONS.slice(start, start + 3);
}
export type Completion = { week: string; mission: string };
export function completeMission(records: Completion[], week: string, mission: string): Completion[] {
  if (!weeklyMissions(week).some(m => m.id === mission) || records.some(r => r.week === week && r.mission === mission)) return records;
  return [...records, { week, mission }];
}
export function treeStage(count: number) {
  if (count >= 12) return { name: "Growing tree", level: 4, next: null };
  if (count >= 6) return { name: "Young tree", level: 3, next: 12 };
  if (count >= 3) return { name: "Sapling", level: 2, next: 6 };
  if (count >= 1) return { name: "Sprout", level: 1, next: 3 };
  return { name: "Seed", level: 0, next: 1 };
}
