import { useMemo, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Check, Scissors, Sparkles } from "lucide-react";
import { formatDate, formatLongDate } from "../lib/dates";
import { formatMoney } from "../lib/finance";
import { buildGoalPath, cutOpportunities } from "../lib/goalPath";
import type { BankData } from "../lib/money";
import type { MoneyGoal } from "../lib/types";

/** A multi-goal, evidence-based plan. It models choices; applying only updates goal schedules. */
export function GoalPathPlanner({ goals, bankData, weeklyCapacity, incomeKnown, hourlyWage, onUpdateGoal }: {
  goals: MoneyGoal[];
  bankData: BankData | null;
  weeklyCapacity: number;
  incomeKnown: boolean;
  hourlyWage: number | null;
  onUpdateGoal: (goal: MoneyGoal) => void;
}) {
  const eligible = goals.filter((goal) => goal.saved < goal.target && !!goal.deadline);
  const undated = goals.filter((goal) => goal.saved < goal.target && !goal.deadline);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => eligible.map((goal) => goal.id));
  const [cutIds, setCutIds] = useState<string[]>([]);
  const [hours, setHours] = useState(0);
  const [wage, setWage] = useState(hourlyWage ?? 0);
  const [applied, setApplied] = useState(false);
  const selected = eligible.filter((goal) => selectedIds.includes(goal.id));
  const path = useMemo(() => buildGoalPath(selected, weeklyCapacity), [selected, weeklyCapacity]);
  const cuts = useMemo(() => cutOpportunities(bankData), [bankData]);
  const cutWeekly = cuts.filter((cut) => cutIds.includes(cut.id)).reduce((sum, cut) => sum + cut.suggestedWeeklyCut, 0);
  const earnedWeekly = Math.max(0, hours) * Math.max(0, wage);
  const scenarioWeekly = path.weeklyAvailable + cutWeekly + earnedWeekly;
  const scenarioGap = Math.max(0, path.weeklyRequired - scenarioWeekly);
  const ready = incomeKnown && selected.length > 0 && scenarioGap < 0.01;
  const toggle = (id: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => setter((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

  return <section className="goal-path-planner" aria-labelledby="goal-path-title">
    <div className="goal-path-head"><span className="goals-tool-icon"><Sparkles size={23} /></span><div><p className="goal-path-kicker">POLARIS GOAL PATH</p><h2 id="goal-path-title">Build a path to multiple goals</h2><p>NorthStar checks the math first, then lets you test spending and income assumptions.</p></div></div>

    {!eligible.length ? <p className="goal-path-empty">Add a target date to at least one active goal before NorthStar can build a timeline.</p> : <>
      <fieldset className="goal-path-section"><legend>Goals to include</legend><div className="goal-path-goals">{eligible.map((goal) => <label key={goal.id}><input type="checkbox" checked={selectedIds.includes(goal.id)} onChange={() => { toggle(goal.id, setSelectedIds); setApplied(false); }} /><span><strong>{goal.name}</strong><small>{formatMoney(Math.max(0, goal.target - goal.saved))} left · by {formatLongDate(goal.deadline!)}</small></span></label>)}</div></fieldset>
      {undated.length > 0 && <p className="goal-path-note">{undated.length} active goal{undated.length === 1 ? "" : "s"} without a target date {undated.length === 1 ? "is" : "are"} not included.</p>}

      {selected.length > 0 && <div className="goal-path-result" aria-live="polite"><div><span>Required for these dates</span><strong>{formatMoney(path.weeklyRequired)}<small> / week</small></strong></div><div><span>Verified room today</span><strong>{incomeKnown ? `${formatMoney(path.weeklyAvailable)} / week` : "Income needed"}</strong></div><p>{incomeKnown ? path.weeklyGap > 0 ? `You are ${formatMoney(path.weeklyGap)}/week short before any changes.` : "These goals fit within your current verified capacity." : "Connect the account where pay lands or enter monthly income before NorthStar models a path."}</p></div>}

      {selected.length > 0 && incomeKnown && path.weeklyGap > 0 && <div className="goal-path-options"><div className="goal-path-option"><div className="goal-path-option-head"><span className="goals-tool-icon"><Scissors size={20} aria-hidden="true" /></span><strong>Test spending cuts</strong></div>{cuts.length ? <>{cuts.map((cut) => <label key={cut.id}><input type="checkbox" checked={cutIds.includes(cut.id)} onChange={() => { toggle(cut.id, setCutIds); setApplied(false); }} /><span>Reduce {cut.name} by 20% <small>Up to {formatMoney(cut.suggestedWeeklyCut)}/week from {formatMoney(cut.monthlySpend)}/month of recent spending</small></span></label>)}</> : <p>No non-essential spending pattern is strong enough yet. Connect more transaction history or use the income scenario.</p>}</div><div className="goal-path-option"><div className="goal-path-option-head"><span className="goals-tool-icon"><BriefcaseBusiness size={20} aria-hidden="true" /></span><strong>Test extra income</strong></div><p>NorthStar cannot promise future income—enter a scenario you believe you can do.</p><div className="goal-path-income-fields"><label>Hourly pay<input type="number" min="0" step="0.25" value={wage || ""} placeholder="0" onChange={(event) => { setWage(Math.max(0, Number(event.target.value))); setApplied(false); }} /></label><label>Extra hours / week<input type="number" min="0" max="40" step="1" value={hours || ""} placeholder="0" onChange={(event) => { setHours(Math.max(0, Number(event.target.value))); setApplied(false); }} /></label></div>{earnedWeekly > 0 && <p className="goal-path-note">This models +{formatMoney(earnedWeekly)}/week. It does not change your income automatically.</p>}</div></div>}

      {selected.length > 0 && incomeKnown && (cutWeekly > 0 || earnedWeekly > 0) && <p className={`goal-path-scenario${scenarioGap > 0 ? " is-short" : ""}`}>{scenarioGap > 0 ? `With these assumptions, you would still be ${formatMoney(scenarioGap)}/week short.` : `With these assumptions, your path has ${formatMoney(scenarioWeekly - path.weeklyRequired)}/week of room.`}</p>}
      {selected.length > 0 && <div className="goal-path-steps"><h3>Proposed weekly schedule</h3><ul>{path.goals.map((goal) => <li key={goal.id}><span>{goal.name}<small>{formatMoney(goal.remaining)} left · {formatDate(goal.deadline)}</small></span><strong>{formatMoney(goal.weekly)} / week</strong></li>)}</ul></div>}
      <div className="goal-path-actions"><button type="button" className="wealth-primary" disabled={!ready} onClick={() => { path.goals.forEach((item) => { const goal = goals.find((candidate) => candidate.id === item.id); if (goal) onUpdateGoal({ ...goal, weekly: item.weekly }); }); setApplied(true); }}>{applied ? <><Check size={16} /> Weekly schedule applied</> : <>Use this weekly schedule <ArrowRight size={16} /></>}</button>{!ready && selected.length > 0 && <p>{!incomeKnown ? "Income is required before applying a plan." : "Choose realistic cuts, income, or later dates until this schedule fits."}</p>}</div>
      <p className="goal-path-disclaimer">This is a planning scenario, not a guarantee. Applying it only updates the selected goals’ weekly contributions; it never changes spending or income automatically.</p>
    </>}
  </section>;
}
