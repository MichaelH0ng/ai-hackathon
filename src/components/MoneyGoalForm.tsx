import { useState } from "react";
import { addDays, formatDate, todayISO } from "../lib/dates";
import { type Risk, certaintyAdvice, formatMoney, goalPhrase, formatWeeks, projectedDate, weeklyNeededForDeadline, weeksToGoal } from "../lib/finance";
import type { MoneyGoal } from "../lib/types";
import { BackButton, Button, Card, Chip, DateField, NumberField, Progress, TextField } from "./ui";

function nextDate(month: number, day: number): string {
  const t = todayISO();
  const y = Number(t.slice(0, 4));
  const iso = (yr: number) => `${yr}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso(y) > t ? iso(y) : iso(y + 1);
}

const QUICK_DATES = [
  { label: "🎄 Christmas", date: () => nextDate(12, 25) },
  { label: "💝 Valentine's", date: () => nextDate(2, 14) },
  { label: "In 1 month", date: () => addDays(todayISO(), 30) },
  { label: "In 3 months", date: () => addDays(todayISO(), 91) },
];

export function MoneyGoalForm({ onCreate, onBack }: { onCreate: (g: MoneyGoal) => void; onBack: () => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState<number | "">("");
  const [saved, setSaved] = useState<number | "">("");
  const [weekly, setWeekly] = useState<number | "">("");
  const [deadline, setDeadline] = useState("");
  const [certainty, setCertainty] = useState(90);
  const [risk, setRisk] = useState<Risk>("low");

  const t = Number(target || 0);
  const s = Number(saved || 0);
  const w = Number(weekly || 0);
  const weeks = weeksToGoal(t, s, w);
  const finish = projectedDate(weeks);
  const ready = name.trim() && t > 0 && w > 0;
  const advice = certaintyAdvice(certainty);

  return (
    <div>
      <BackButton onClick={onBack} />
      <Card>
        <h2 className="text-xl font-bold text-stone-900">What are you saving for?</h2>
        <div className="mt-4 space-y-4">
          <TextField label="Goal" value={name} onChange={setName} placeholder="New hoodie" />
          <NumberField label="Total cost" value={target} onChange={setTarget} />
          <NumberField label="Current savings" value={saved} onChange={setSaved} />
          <NumberField label="How much can you save each week?" value={weekly} onChange={setWeekly} />
          <div>
            <DateField label="When do you want it? (optional)" value={deadline} onChange={setDeadline} min={todayISO()} />
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_DATES.map((q) => (
                <Chip key={q.label} active={deadline === q.date()} onClick={() => setDeadline(q.date())}>
                  {q.label}
                </Chip>
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-500">Birthday? Pick the date above.</p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-stone-700">How sure are you that you want it? {certainty}%</span>
            <input type="range" min={0} max={100} step={5} value={certainty} onChange={(e) => setCertainty(Number(e.target.value))} className="mt-1 w-full accent-brand-600" />
          </label>
          {t >= 1000 && (
            <div>
              <span className="mb-1 block text-sm font-medium text-stone-700">Comfort with ups and downs (for growth tips)</span>
              <div className="flex gap-2">
                {(["low", "medium", "high"] as Risk[]).map((r) => (
                  <Chip key={r} active={risk === r} onClick={() => setRisk(r)}>{r}</Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {t > 0 && w > 0 && (
        <Card className="mt-3 bg-emerald-50 ring-emerald-200">
          <p className="text-sm font-medium text-emerald-900">Your personalized savings plan</p>
          <p className="mt-1 text-4xl font-extrabold text-emerald-900">{formatWeeks(weeks)}</p>
          <p className="text-sm text-emerald-900">
            until your {goalPhrase(name) || "goal"}. You need {formatMoney(Math.max(0, t - s))} more at {formatMoney(w, w % 1 !== 0)}/week.
            {finish && <> You'd get there around <strong>{formatDate(finish)}</strong>.</>}
          </p>
          <div className="mt-3">
            <Progress value={s / t} />
            <p className="mt-1 text-xs text-emerald-900">{Math.round(Math.min(1, s / t) * 100)}% already saved</p>
          </div>
          {deadline && finish && finish > deadline && (
            <p className="mt-2 text-sm text-amber-900">
              That's after {formatDate(deadline)}. To make that date, save about <strong>{formatMoney(weeklyNeededForDeadline(t, s, deadline), true)}/week</strong>.
            </p>
          )}
          {advice && <p className="mt-2 text-sm text-amber-900">🤔 {advice}</p>}
        </Card>
      )}

      <Button
        className="mt-3 w-full"
        disabled={!ready}
        onClick={() =>
          onCreate({ kind: "money", id: crypto.randomUUID(), name: name.trim(), target: t, saved: s, weekly: w, deadline: deadline || undefined, risk, certainty })
        }
      >
        Create my plan
      </Button>
    </div>
  );
}
