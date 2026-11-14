import { ArrowRight, Check, Hand } from "lucide-react";
import { useState } from "react";
import { daysBetween, formatDate } from "../lib/dates";
import { formatMoney, projectedDate, weeklyNeededForDeadline, weeksToGoal } from "../lib/finance";
import type { MoneyGoal } from "../lib/types";
import CometDial from "./CometDial";

/** Dial range: room to dream a little past your current plan, in friendly round numbers. */
function dialMax(g: MoneyGoal): number {
  const need = g.deadline ? weeklyNeededForDeadline(g.target, g.saved, g.deadline) : 0;
  const top = Math.max(50, g.weekly * 2.5, need * 1.5);
  return Math.min(Math.ceil(top / 10) * 10, Math.max(10, Math.ceil((g.target - g.saved) / 10) * 10));
}

/**
 * "How much can you save each week?" Turn the dial and watch your finish date move.
 * Tap Save to make it your plan.
 */
export function SavingsPlanner({ goals, onUpdate, onOpen }: { goals: MoneyGoal[]; onUpdate: (g: MoneyGoal) => void; onOpen: (id: string) => void }) {
  const open = goals.filter((g) => g.saved < g.target);
  const list = open.length ? open : goals;
  const [focus, setFocus] = useState(list[0].id);
  const goal = list.find((g) => g.id === focus) ?? list[0];
  const [weekly, setWeekly] = useState(goal.weekly);
  const [saved, setSaved] = useState(false);

  const max = dialMax(goal);
  const pick = (g: MoneyGoal) => {
    setFocus(g.id);
    setWeekly(g.weekly);
    setSaved(false);
  };

  const remaining = Math.max(0, goal.target - goal.saved);
  const nowFinish = projectedDate(weeksToGoal(goal.target, goal.saved, goal.weekly));
  const newFinish = projectedDate(weeksToGoal(goal.target, goal.saved, weekly));
  const shift = nowFinish && newFinish ? daysBetween(newFinish, nowFinish) : null; // + = sooner
  const need = goal.deadline ? Math.ceil(weeklyNeededForDeadline(goal.target, goal.saved, goal.deadline)) : null;
  const onTime = goal.deadline && newFinish ? newFinish <= goal.deadline : null;
  const changed = weekly !== goal.weekly;
  const pct = Math.round(Math.min(1, goal.saved / goal.target) * 100);

  return (
    <section aria-labelledby="planner-title" className="px-4 pb-12">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-ink px-6 py-10 text-white shadow-[0_24px_60px_-24px_rgb(30_27_46/0.8)] sm:px-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-600/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

        <div className="relative grid items-center gap-10 lg:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center">
            <CometDial
              key={goal.id}
              value={weekly}
              min={0}
              max={max}
              step={1}
              unit="none"
              label={goal.name}
              accent="#f5f5f5"
              ink="#fdfdfd"
              size={250}
              sweep={320}
              thickness={5}
              speed={25}
              tapBounce={0.2}
              flickBounce={0.1}
              momentum={1}
              cometReach={180}
              cometWidth={12}
              format={(v) => `$${Math.round(v)}`}
              caption={() => "per week"}
              valueText={(v) => `${formatMoney(v)} per week`}
              onChange={(v) => {
                setWeekly(Math.round(v));
                setSaved(false);
              }}
              onChangeEnd={(v) => setWeekly(Math.round(v))}
            />
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-white/55">
              <Hand className="h-3.5 w-3.5" aria-hidden="true" /> Turn the dial to change your weekly savings
            </p>
          </div>

          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-brand-200">Plan your week</p>
            <h2 id="planner-title" className="mt-1 text-3xl font-bold sm:text-4xl">How much can you save this week?</h2>

            <p className="mt-3 text-lg text-white/80" aria-live="polite">
              {weekly <= 0 ? (
                <>At $0/week your {goal.name.toLowerCase()} never gets closer. Even $5 helps.</>
              ) : (
                <>
                  At <strong className="text-white">{formatMoney(weekly)}/week</strong>, your {goal.name.toLowerCase()} is done around{" "}
                  <strong className="text-white">{newFinish ? formatDate(newFinish) : "—"}</strong>
                  {changed && shift != null && shift !== 0 && (
                    <span className={shift > 0 ? "text-emerald-300" : "text-amber-300"}>
                      {" "}({Math.abs(shift)} day{Math.abs(shift) === 1 ? "" : "s"} {shift > 0 ? "sooner" : "later"})
                    </span>
                  )}
                  .
                </>
              )}
            </p>
            {goal.deadline && onTime != null && (
              <p className={`mt-1 text-sm font-semibold ${onTime ? "text-emerald-300" : "text-amber-300"}`}>
                {onTime ? `On time for ${formatDate(goal.deadline)}.` : `That misses ${formatDate(goal.deadline)}. You'd need about ${formatMoney(need ?? 0)}/week.`}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={() => { setWeekly(goal.weekly); setSaved(false); }} className="min-h-10 rounded-full bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">
                Current plan · {formatMoney(goal.weekly)}
              </button>
              {need != null && need > goal.weekly && need <= max && (
                <button onClick={() => { setWeekly(need); setSaved(false); }} className="min-h-10 rounded-full bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">
                  Make my date · {formatMoney(need)}
                </button>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                disabled={(!changed && !saved) || weekly <= 0}
                onClick={() => {
                  onUpdate({ ...goal, weekly });
                  setSaved(true);
                }}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white px-5 font-bold text-ink transition-colors duration-200 hover:bg-brand-50 disabled:opacity-40"
              >
                {saved ? <><Check className="h-4 w-4" aria-hidden="true" /> Saved to your plan</> : `Save ${formatMoney(weekly)}/week to my plan`}
              </button>
              <button onClick={() => onOpen(goal.id)} className="inline-flex min-h-12 items-center gap-1 px-2 text-sm font-bold text-white/80 hover:text-white">
                Open goal <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {list.length > 1 && (
              <div className="mt-6 flex flex-wrap gap-2" role="radiogroup" aria-label="Choose a goal">
                {list.map((g) => (
                  <button
                    key={g.id}
                    role="radio"
                    aria-checked={g.id === goal.id}
                    onClick={() => pick(g)}
                    className={`min-h-10 rounded-full px-4 text-sm font-bold transition-colors duration-200 ${g.id === goal.id ? "bg-white text-ink" : "bg-white/10 text-white hover:bg-white/15"}`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-white/50">
              {formatMoney(goal.saved)} of {formatMoney(goal.target)} saved ({pct}%) · {formatMoney(remaining)} to go
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
