import { useEffect, useState } from "react";
import type { Reminder } from "./goalActions";

/** Savings reminders Polaris set up ("every Friday, add $20 to Car"). Saved per browser. */
const KEY = "northstar:polaris-reminders";
const EVENT = "northstar:reminders-changed";

export function readReminders(): Reminder[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((r): r is Reminder => r && typeof r.id === "string" && typeof r.goalId === "string" && typeof r.amount === "number" && typeof r.weekday === "number") : [];
  } catch { return []; }
}

export function saveReminders(next: Reminder[]) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: lasts for this visit */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/** Reminders shared between Polaris and the My goals page; both stay in sync. */
export function useReminders(): [Reminder[], (next: Reminder[]) => void] {
  const [reminders, setReminders] = useState<Reminder[]>(readReminders);
  useEffect(() => {
    const sync = (event: Event) => setReminders((event as CustomEvent<Reminder[]>).detail ?? readReminders());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [reminders, saveReminders];
}
