import { addDays, todayISO } from "./dates";
import type { BankSnapshot, Decision, Goal, Profile } from "./types";

const KEY = "northstar:v1";
const LEGACY_KEY = "tradeoff:v1";

export interface SavedState {
  profile: Profile;
  goals: Goal[];
  history: Decision[];
  bank?: BankSnapshot;
}

export const EMPTY_STATE: SavedState = { profile: { hourlyWage: null }, goals: [], history: [] };

export function loadState(): SavedState {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return EMPTY_STATE;
    const saved = { ...EMPTY_STATE, ...JSON.parse(raw) } as SavedState;
    // Drop retired goal types when opening an older saved state.
    return { ...saved, goals: saved.goals.filter((g) => g.kind === "money") };
  } catch {
    return EMPTY_STATE;
  }
}

export function saveState(state: SavedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // private mode / storage blocked — the app still works for this session
  }
}

function nextDec(day: number): string {
  const t = todayISO();
  const year = Number(t.slice(0, 4));
  const thisYear = `${year}-12-${String(day).padStart(2, "0")}`;
  return thisYear > t ? thisYear : `${year + 1}-12-${String(day).padStart(2, "0")}`;
}

/** Safe demo goals for the NorthStar savings flow. */
export function demoState(): SavedState {
  return {
    profile: { hourlyWage: 18 },
    goals: [
      { kind: "money", id: "hoodie", name: "Hoodie", target: 150, saved: 60, weekly: 15, deadline: nextDec(25) },
      { kind: "money", id: "trip", name: "Spring break trip", target: 500, saved: 120, weekly: 25, deadline: addDays(todayISO(), 120) },
    ],
    history: [],
  };
}
