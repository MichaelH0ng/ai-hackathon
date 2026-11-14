import { useState } from "react";
import { daysBetween, formatDate } from "../lib/dates";
import {
  certaintyAdvice,
  formatMoney,
  formatWeeks,
  goalPhrase,
  horizonGuidance,
  monthlyNeeded,
  monthsUntil,
  projectedDate,
  weeklyNeededForDeadline,
  weeksToGoal,
  weeksToMonths,
} from "../lib/finance";
import type { MoneyGoal, Profile } from "../lib/types";
import { type LogDecision, MoneyWhatIf } from "./MoneyWhatIf";
import { Timeline } from "./Timeline";
import { BackButton, Button, Card, NumberField, Notice, Progress, Stat } from "./ui";

export function MoneyGoalView({
  goal,
  profile,
  onChange,
  onLog,
  onDelete,
  onBack,
}: {
  goal: MoneyGoal;
  profile: Profile;
  onChange: (g: MoneyGoal) => void;
  onLog: (d: LogDecision) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [deposit, setDeposit] = useState<number | "">("");
  const [message, setMessage] = useState<string | null>(null);
  const [showGrowth, setShowGrowth] = useState(false);

  const weeks = weeksToGoal(goal.target, goal.saved, goal.weekly);
  const finish = projectedDate(weeks);
  const done = goal.saved >= goal.target;
  const lateBy = goal.deadline && finish ? daysBetween(goal.deadline, finish) : 0;
  const neededForDeadline = goal.deadline ? weeklyNeededForDeadline(goal.target, goal.saved, goal.deadline) : 0;
  const certainty = goal.certainty ?? 100;
  const advice = certaintyAdvice(certainty);

  const months = goal.deadline ? monthsUntil(goal.deadline) : weeksToMonths(weeks);
  const guide = horizonGuidance(months, goal.risk);
  const flat = monthlyNeeded(goal.target, goal.saved, months, 0);
  const grown = monthlyNeeded(goal.target, goal.saved, months, guide.assumedReturn);

  function apply(changes: Partial<MoneyGoal>, msg: string, decision?: LogDecision) {
    onChange({ ...goal, ...changes });
    if (decision) onLog(decision);
    setMessage(msg);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-3">
      <BackButton onClick={onBack} label="All goals" />

      {message && (
        <Notice tone="good">
          <div className="flex items-start justify-between gap-2">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
          </div>
        </Notice>
      )}

      <Card>
        <p className="text-sm text-stone-500">💰 Saving for</p>
        <h2 className="text-2xl font-bold text-stone-900">{goal.name}</h2>
        <div className="mt-3">
          <Progress value={goal.saved / goal.target} />
          <p className="mt-1 text-sm text-stone-700">
            {formatMoney(goal.saved, goal.saved % 1 !== 0)} of {formatMoney(goal.target)} · {Math.round((goal.saved / goal.target) * 100)}% saved
          </p>
        </div>

        {done ? (
          <div className="mt-3">
            <Notice tone="good">You did it! 🎉 Your {goalPhrase(goal.name)} is fully funded.</Notice>
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

            {/* Adaptive recommendation when behind schedule */}
            {goal.deadline && finish && lateBy > 0 && (
              <div className="mt-3">
                <Notice tone="warn">
                  You're about {lateBy} days behind your date. Saving{" "}
                  <strong>{formatMoney(neededForDeadline, true)}/week</strong> ({formatMoney(neededForDeadline - goal.weekly, true)} more) gets you back on track.
                  <Button
                    className="mt-2 w-full"
                    onClick={() =>
                      apply({ weekly: Math.round(neededForDeadline * 100) / 100 }, `Plan updated: ${formatMoney(neededForDeadline, true)}/week puts you back on track for ${formatDate(goal.deadline!)}.`)
                    }
                  >
                    Update my plan to {formatMoney(neededForDeadline, true)}/week
                  </Button>
                </Notice>
              </div>
            )}
            {goal.deadline && finish && lateBy <= 0 && (
              <p className="mt-2 text-sm text-emerald-800">{lateBy < 0 ? `On track, about ${-lateBy} days early.` : "Right on schedule."}</p>
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

      {/* Confidence-based planning for purchases */}
      <Card>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">How sure are you that you want this? {certainty}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={certainty}
            onChange={(e) => onChange({ ...goal, certainty: Number(e.target.value) })}
            className="mt-1 w-full accent-brand-600"
          />
        </label>
        {advice ? <div className="mt-2"><Notice tone="warn">🤔 {advice}</Notice></div> : <p className="mt-1 text-xs text-stone-500">Sure enough to commit. Go for it.</p>}
      </Card>

      {!done && <MoneyWhatIf key={goal.id} goal={goal} profile={profile} onApply={apply} />}

      {!done && (
        <Card>
          <button onClick={() => setShowGrowth((s) => !s)} className="w-full text-left text-sm font-semibold text-brand-700">
            {showGrowth ? "▲" : "▼"} Where could this money grow?
          </button>
          {showGrowth && (
            <div className="mt-3 space-y-3 text-sm text-stone-800">
              <p className="font-semibold">{guide.horizon}</p>
              {months >= 12 && (
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Monthly, just saving" value={formatMoney(flat)} />
                  <Stat label={`With ~${(guide.assumedReturn * 100).toFixed(1)}% growth`} value={formatMoney(grown)} tone="good" />
                </div>
              )}
              <p>{guide.why}</p>
              <ul className="list-disc pl-5">
                {guide.options.map((o) => <li key={o}>{o}</li>)}
              </ul>
              <p className="text-xs text-stone-500">Educational only, not financial advice. Returns aren't guaranteed. Consider talking to a licensed advisor.</p>
            </div>
          )}
        </Card>
      )}

      <Button variant="ghost" className="w-full text-red-700" onClick={onDelete}>
        Delete this goal
      </Button>
    </div>
  );
}
