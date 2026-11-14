import { useState } from "react";
import { daysBetween, formatDate } from "../lib/dates";
import { formatMoney, formatWeeks, goalPhrase, projectedDate, weeklyNeededForDeadline, weeksToGoal } from "../lib/finance";
import type { MoneyGoal } from "../lib/types";
import { type LogDecision, MoneyWhatIf } from "./MoneyWhatIf";
import { Timeline } from "./Timeline";
import { BackButton, Button, Card, NumberField, Notice, Progress, Stat } from "./ui";

export function MoneyGoalView({
  goal,
  onChange,
  onLog,
  onDelete,
  onBack,
}: {
  goal: MoneyGoal;
  onChange: (g: MoneyGoal) => void;
  onLog: (d: LogDecision) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [deposit, setDeposit] = useState<number | "">("");
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // clears the What-If after a choice

  const weeks = weeksToGoal(goal.target, goal.saved, goal.weekly);
  const finish = projectedDate(weeks);
  const done = goal.saved >= goal.target;
  const lateBy = goal.deadline && finish ? daysBetween(goal.deadline, finish) : 0;
  const neededForDeadline = goal.deadline ? weeklyNeededForDeadline(goal.target, goal.saved, goal.deadline) : 0;

  function apply(changes: Partial<MoneyGoal>, msg: string, decision?: LogDecision) {
    onChange({ ...goal, ...changes });
    if (decision) onLog(decision);
    setMessage(msg);
    setVersion((v) => v + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="goal-flow space-y-3">
      <BackButton onClick={onBack} label="My goals" />

      {message && (
        <Notice tone="good">
          <div className="flex items-start justify-between gap-2">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
          </div>
        </Notice>
      )}

      <Card>
        <p className="text-sm text-stone-500">Saving for</p>
        <h2 className="text-2xl font-bold text-ink">{goal.name}</h2>
        <div className="mt-3">
          <Progress value={goal.saved / goal.target} />
          <p className="mt-1 text-sm text-stone-700">
            {formatMoney(goal.saved, goal.saved % 1 !== 0)} of {formatMoney(goal.target)} · {Math.round(Math.min(1, goal.saved / goal.target) * 100)}% saved
          </p>
        </div>

        {done ? (
          <div className="mt-3">
            <Notice tone="good">You did it! Your {goalPhrase(goal.name)} is fully funded.</Notice>
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Time to goal" value={formatWeeks(weeks)} sub={`saving ${formatMoney(goal.weekly, goal.weekly % 1 !== 0)}/week`} />
              <Stat label="Projected finish" value={finish ? formatDate(finish) : "—"} sub={goal.deadline ? `goal: ${formatDate(goal.deadline)}` : undefined} tone={lateBy > 0 ? "warn" : "good"} />
            </div>
            <div className="mt-3">
              <Timeline deadline={goal.deadline} rows={[{ label: "Your plan", end: finish, tone: lateBy > 0 ? "warn" : "good" }]} />
            </div>
            {goal.deadline && finish && lateBy > 0 && (
              <div className="mt-3">
                <Notice tone="warn">
                  You're about {lateBy} day{lateBy === 1 ? "" : "s"} behind your date. Saving <strong>{formatMoney(neededForDeadline, true)}/week</strong> gets you back on track.
                  <Button
                    className="mt-2 w-full"
                    onClick={() => apply({ weekly: Math.round(neededForDeadline * 100) / 100 }, `Plan updated: ${formatMoney(neededForDeadline, true)}/week puts you back on track.`)}
                  >
                    Update my plan
                  </Button>
                </Notice>
              </div>
            )}
          </>
        )}

        <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-2">
          <NumberField label="Add to savings" value={deposit} onChange={setDeposit} />
          <Button
            disabled={!deposit}
            onClick={() => {
              apply({ saved: Math.round((goal.saved + Number(deposit)) * 100) / 100 }, `Added ${formatMoney(Number(deposit), true)}. Keep going!`);
              setDeposit("");
            }}
          >
            Add
          </Button>
        </div>
        <div className="mt-2">
          <NumberField label="Weekly savings" value={goal.weekly} onChange={(v) => onChange({ ...goal, weekly: Number(v || 0) })} suffix="/wk" />
        </div>
      </Card>

      {!done && <MoneyWhatIf key={`${goal.id}-${version}`} goal={goal} onApply={apply} />}

      <Button variant="ghost" className="w-full text-red-700" onClick={onDelete}>
        Delete this goal
      </Button>
    </div>
  );
}
