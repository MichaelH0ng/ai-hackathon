import { useState } from "react";
import { daysBetween, formatDate, todayISO } from "../lib/dates";
import { formatMoney, formatWeeks, goalPhrase, projectedDate, weeklyNeededForDeadline, weeksToGoal } from "../lib/finance";
import type { MoneyGoal } from "../lib/types";
import { type LogDecision, MoneyWhatIf } from "./MoneyWhatIf";
import { Timeline } from "./Timeline";
import { isEmergencyFund } from "../lib/safeToSpend";
import { BackButton, Button, Card, CheckboxField, DateField, NumberField, Notice, Progress, Stat, TextField } from "./ui";
import { CircleCheck, Pencil, ShoppingBag } from "lucide-react";

export function MoneyGoalView({
  goal,
  onChange,
  onLog,
  onDelete,
  onBack,
  freeCash,
  otherGoals,
  onBuy,
  onRestore,
  linkedAccount,
}: {
  goal: MoneyGoal;
  onChange: (g: MoneyGoal) => void;
  onLog: (d: LogDecision) => void;
  onDelete: () => void;
  onBack: () => void;
  /** Cash no goal has claimed yet, or null when no accounts are known. */
  freeCash: number | null;
  /** Other active goals, for moving leftover money after a purchase. */
  otherGoals: MoneyGoal[];
  onBuy: (paid: number, leftoverToId?: string) => void;
  onRestore: () => void;
  /** The account whose whole balance this goal follows, if any. */
  linkedAccount?: { name: string; balance: number };
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(goal.name);
  const [editingSaved, setEditingSaved] = useState(false);
  const [savedDraft, setSavedDraft] = useState<number | "">(goal.saved);
  const [deposit, setDeposit] = useState<number | "">("");
  const [paid, setPaid] = useState<number | "">(goal.target);
  const [leftoverTo, setLeftoverTo] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // clears the What-If after a choice

  const weeks = weeksToGoal(goal.target, goal.saved, goal.weekly);
  const finish = projectedDate(weeks);
  const done = goal.saved >= goal.target;
  const lateBy = goal.deadline && finish ? daysBetween(goal.deadline, finish) : 0;
  const neededForDeadline = goal.deadline ? Math.ceil(weeklyNeededForDeadline(goal.target, goal.saved, goal.deadline) * 100) / 100 : 0;

  function apply(changes: Partial<MoneyGoal>, msg: string, decision?: LogDecision) {
    onChange({ ...goal, ...changes });
    if (decision) onLog(decision);
    setMessage(msg);
    setVersion((v) => v + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (goal.boughtAt) {
    return (
      <div className="goal-flow space-y-3">
        <BackButton onClick={onBack} label="My goals" />
        <Card>
          <span className="goal-bought-badge"><CircleCheck size={15} aria-hidden="true" /> Bought</span>
          <h2 className="mt-2 text-2xl font-bold text-ink">{goal.name}</h2>
          <p className="mt-1 text-stone-700">
            Bought on {formatDate(goal.boughtAt)} for <strong>{formatMoney(goal.boughtFor ?? goal.target, (goal.boughtFor ?? 0) % 1 !== 0)}</strong>, after saving {formatMoney(goal.saved, goal.saved % 1 !== 0)} toward it.
          </p>
          <p className="mt-1 text-sm text-stone-500">This goal no longer holds any of your cash.</p>
          <Button variant="secondary" className="mt-4 w-full" onClick={onRestore}>Move back to my goals</Button>
        </Card>
        <Button variant="ghost" className="w-full text-red-700" onClick={onDelete}>Delete this goal</Button>
      </div>
    );
  }

  const leftover = Math.max(0, Math.round((goal.saved - Number(paid || 0)) * 100) / 100);
  const depositHint = freeCash === null ? undefined
    : Number(deposit || 0) > freeCash ? `That's more than the ${formatMoney(freeCash, freeCash % 1 !== 0)} of your cash that isn't set aside yet, so your goals would claim more than you have.`
      : `${formatMoney(freeCash, freeCash % 1 !== 0)} of your cash isn't set aside for a goal yet.`;

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
        {renaming ? (
          <form
            className="mt-1 grid grid-cols-[1fr_auto_auto] items-end gap-2 goal-rename"
            onSubmit={(e) => {
              e.preventDefault();
              const name = nameDraft.trim();
              if (!name) return;
              // Keep emergency-fund status as it is now, even if the new name doesn't say "emergency".
              onChange({ ...goal, name, emergency: isEmergencyFund(goal) });
              setRenaming(false);
              setMessage(`Renamed to ${name}.`);
            }}
          >
            <TextField label="Goal name" value={nameDraft} onChange={setNameDraft} />
            <button type="submit" className="wealth-primary goal-rename-button" disabled={!nameDraft.trim()}>Save</button>
            <Button variant="secondary" onClick={() => { setRenaming(false); setNameDraft(goal.name); }}>Cancel</Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3">
            <h2 className="text-2xl font-bold text-ink">{goal.name}</h2>
            <button className="wealth-inline-link inline-flex items-center gap-1" onClick={() => { setNameDraft(goal.name); setRenaming(true); }}><Pencil size={14} aria-hidden="true" /> Rename</button>
          </div>
        )}
        <div className="mt-3">
          <Progress value={goal.saved / goal.target} />
          {editingSaved ? (
            <form
              className="mt-2 grid grid-cols-[1fr_auto_auto] items-start gap-2 goal-saved-edit"
              onSubmit={(e) => {
                e.preventDefault();
                const saved = Math.max(0, Math.round(Number(savedDraft || 0) * 100) / 100);
                onChange({ ...goal, saved, linkedAccountId: undefined });
                setEditingSaved(false);
                setMessage(`${goal.name} now holds ${formatMoney(saved, saved % 1 !== 0)}.`);
              }}
            >
              <NumberField label="Saved so far" value={savedDraft} onChange={setSavedDraft} hint={freeCash !== null ? `${formatMoney(freeCash + Math.max(0, goal.saved), true)} available for this goal (what it holds now plus cash not set aside).` : undefined} />
              <button type="submit" className="wealth-primary min-h-12 px-5 font-bold">Save</button>
              <Button variant="secondary" onClick={() => { setEditingSaved(false); setSavedDraft(goal.saved); }}>Cancel</Button>
            </form>
          ) : (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-stone-700">
              <span>{formatMoney(goal.saved, goal.saved % 1 !== 0)} of {formatMoney(goal.target)} · {Math.round(Math.min(1, goal.saved / goal.target) * 100)}% saved</span>
              <button className="wealth-inline-link" onClick={() => { setSavedDraft(goal.saved); setEditingSaved(true); }}>Edit amount</button>
            </p>
          )}
          {linkedAccount && !editingSaved && (
            <div className="goal-linked">
              <p>This goal follows the whole balance of <strong>{linkedAccount.name}</strong> ({formatMoney(linkedAccount.balance, true)}), so it holds everything in that account.</p>
              <button className="wealth-inline-link" onClick={() => onChange({ ...goal, linkedAccountId: undefined })}>Stop following it</button>
            </div>
          )}
        </div>

        {done ? (
          <div className="mt-3">
            <Notice tone="good">You did it! Your {goalPhrase(goal.name)} is fully funded.</Notice>
            {!isEmergencyFund(goal) && (
              <div className="goal-buy">
                <h3 className="flex items-center gap-2 text-lg font-bold text-ink"><ShoppingBag size={18} aria-hidden="true" /> Bought it?</h3>
                <p className="text-sm text-stone-600">Mark it as bought and its money stops counting as set aside.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <NumberField label="What you paid" value={paid} onChange={setPaid} />
                  {leftover > 0 && (
                    <label className="wealth-field">
                      <span>Put the {formatMoney(leftover, leftover % 1 !== 0)} left over toward</span>
                      <select value={leftoverTo} onChange={(e) => setLeftoverTo(e.target.value)}>
                        <option value="">Nothing: keep it as free cash</option>
                        {otherGoals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <Button className="mt-3 w-full" disabled={!paid} onClick={() => onBuy(Number(paid), leftoverTo || undefined)}>Mark as bought</Button>
              </div>
            )}
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
            <div className="mt-3 weekly-target" aria-live="polite">
              {goal.deadline ? goal.deadline > todayISO() ? <>
                <span>Save each week to reach your goal</span>
                <strong>{formatMoney(neededForDeadline, true)}<small> / week</small></strong>
                <p>{formatMoney(Math.max(0, goal.target - goal.saved), true)} remaining ÷ {(daysBetween(todayISO(), goal.deadline) / 7).toFixed(1)} weeks until {formatDate(goal.deadline)}. Recalculates as you add savings.</p>
                {goal.weekly !== neededForDeadline && <Button className="mt-3 w-full" onClick={() => apply({ weekly: neededForDeadline }, `Weekly plan updated to ${formatMoney(neededForDeadline, true)}.`)}>Use {formatMoney(neededForDeadline, true)}/week</Button>}
              </> : <p>{formatMoney(Math.max(0, goal.target - goal.saved), true)} remains. Your target date has arrived or passed; choose a future date to calculate a weekly plan.</p> : <p>Add a target date below to see how much to save each week.</p>}
            </div>
          </>
        )}

        <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-2 goal-deposit">
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
        {depositHint && <p className="goal-deposit-hint">{depositHint}</p>}
        <div className="mt-2">
          <DateField label="Target date" value={goal.deadline ?? ""} min={todayISO()} onChange={deadline => onChange({ ...goal, deadline: deadline || undefined })} />
          <NumberField label="Weekly savings" value={goal.weekly} onChange={(v) => onChange({ ...goal, weekly: Number(v || 0) })} suffix="/wk" />
          <CheckboxField label="This is my emergency fund" hint="For emergencies only: NorthStar never suggests spending it on a purchase." checked={isEmergencyFund(goal)} onChange={(emergency) => onChange({ ...goal, emergency })} />
        </div>
      </Card>

      {!done && <MoneyWhatIf key={`${goal.id}-${version}`} goal={goal} onApply={apply} />}

      <Button variant="ghost" className="w-full text-red-700" onClick={onDelete}>
        Delete this goal
      </Button>
    </div>
  );
}
