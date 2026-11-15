export interface MoneyGoal {
  kind: "money";
  id: string;
  name: string;
  target: number;
  saved: number;
  weekly: number; // what the user can save each week
  deadline?: string; // YYYY-MM-DD, optional "I want it by"
  linkedAccountId?: string; // Plaid account whose balance counts as "saved"
  emergency?: boolean; // an emergency fund: for emergencies only, never offered as a way to pay for a purchase
  boughtAt?: string; // YYYY-MM-DD the goal was marked as bought: it no longer holds any of your cash
  boughtFor?: number; // what the purchase actually cost
}

export type Goal = MoneyGoal;

/** Last numbers pulled from the connected bank, so other screens can use them. */
export interface BankSnapshot {
  cash: number; // checking + savings you could spend
  fetchedAt: string;
}

export interface Profile {
  hourlyWage: number | null; // optional: lets us say "that's 48 minutes of work"
  // Optional profile details, shown on the Profile page. Older saved data won't have them.
  name?: string;
  email?: string;
  phone?: string;
  avatarColor?: string;
  avatarImage?: string;
}

/** A choice the user made in a What-If — powers "Your choices" insights. */
export interface Decision {
  id: string;
  date: string; // YYYY-MM-DD
  goalId: string;
  goalName: string;
  label: string; // "Skipped AirPods"
  kind: "money";
  effectDays?: number; // + = goal sooner, − = goal later (money)
  amount?: number; // money kept (+) or spent (−)
}
