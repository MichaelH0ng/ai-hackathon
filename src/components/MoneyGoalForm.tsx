import { useState } from "react";
import { formatDate, todayISO } from "../lib/dates";
import { formatMoney, formatWeeks, goalPhrase, projectedDate, weeklyNeededForDeadline, weeksToGoal } from "../lib/finance";
import type { MoneyGoal } from "../lib/types";
import { BackButton, Button, Card, DateField, NumberField, TextField } from "./ui";

export function MoneyGoalForm({ onCreate, onBack }: { onCreate: (g: MoneyGoal) => void; onBack: () => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState<number | "">("");
  const [saved, setSaved] = useState<number | "">("");
  const [weekly, setWeekly] = useState<number | "">("");
  const [deadline, setDeadline] = useState("");

  const t = Number(target || 0);
  const s = Number(saved || 0);
  const w = Number(weekly || 0);
  const weeks = weeksToGoal(t, s, w);
  const finish = projectedDate(weeks);
  const ready = name.trim() && t > 0 && w > 0;

  return (
    <div>
      <BackButton onClick={onBack} />
      <Card>
        <h2 className="text-xl font-bold text-ink">Create a savings goal</h2>
        <div className="mt-4 space-y-4">
          <TextField label="What are you saving for?" value={name} onChange={setName} placeholder="Emergency fund, a trip…" />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Target amount" value={target} onChange={setTarget} />
            <NumberField label="Already saved" value={saved} onChange={setSaved} />
          </div>
          <NumberField label="Plan to save each week" value={weekly} onChange={setWeekly} suffix="/wk" />
          <details className="goal-optional">
            <summary>Add a target date (optional)</summary>
            <DateField label="Want it by (optional)" value={deadline} onChange={setDeadline} min={todayISO()} />
          </details>
        </div>
      </Card>

      {t > 0 && w > 0 && (
        <Card className="mt-3 bg-emerald-50">
          <p className="text-sm font-medium text-emerald-900">Your savings timeline</p>
          <p className="mt-1 font-display text-4xl font-bold text-emerald-900">{formatWeeks(weeks)}</p>
          <p className="text-sm text-emerald-900">
            {formatMoney(Math.max(0, t - s))} to go at {formatMoney(w, w % 1 !== 0)}/week for your {goalPhrase(name) || "goal"}
            {finish && <>, around <strong>{formatDate(finish)}</strong></>}.
          </p>
          {deadline && finish && finish > deadline && (
            <p className="mt-2 text-sm text-amber-900">
              To make {formatDate(deadline)}, save about <strong>{formatMoney(weeklyNeededForDeadline(t, s, deadline), true)}/week</strong>.
            </p>
          )}
        </Card>
      )}

      <Button
        className="mt-3 w-full"
        disabled={!ready}
        onClick={() => onCreate({ kind: "money", id: crypto.randomUUID(), name: name.trim(), target: t, saved: s, weekly: w, deadline: deadline || undefined })}
      >
        Create my plan
      </Button>
    </div>
  );
}
