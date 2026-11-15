import { BellRing, X } from "lucide-react";
import { dayLabel, money } from "../lib/goalActions";
import { useReminders } from "../lib/polarisReminders";
import type { MoneyGoal } from "../lib/types";

/** Savings reminders set up through Polaris, shown on My goals so they can be removed. */
export function GoalReminders({ goals }: { goals: MoneyGoal[] }) {
  const [reminders, setReminders] = useReminders();
  const shown = reminders.filter(r => goals.some(g => g.id === r.goalId));
  if (!shown.length) return null;
  return <section className="goal-reminders" aria-labelledby="goal-reminders-title">
    <h3 id="goal-reminders-title"><BellRing size={16} aria-hidden="true" /> Reminders from Polaris</h3>
    <ul>
      {shown.map(r => {
        const goal = goals.find(g => g.id === r.goalId)!;
        const label = `Add ${money(r.amount)} to ${goal.name} ${dayLabel(r.weekday)}`;
        return <li key={r.id}>
          <span>{label}</span>
          <button type="button" className="wealth-icon-button" aria-label={`Remove reminder: ${label}`} title="Remove reminder" onClick={() => setReminders(reminders.filter(x => x.id !== r.id))}><X size={16} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>
  </section>;
}
