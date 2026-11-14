import { useState } from "react";
import { formatDate } from "../lib/dates";
import {
  decisionScore,
  formatMoney,
  formatWeeks,
  goalPhrase,
  habitImpact,
  hoursOfWork,
  projectedDate,
  recommendation,
  weeklyToKeepDate,
  whatIfSpend,
} from "../lib/finance";
import type { Decision, MoneyGoal, Profile } from "../lib/types";
import { PriceScanner } from "./PriceScanner";
import { Timeline } from "./Timeline";
import { Button, Card, Chip, NumberField, Notice, Stat, TextField } from "./ui";

interface Scenario {
  chip: string;
  spendLabel: string; // used in sentences: "going out to eat"
  spendShort: string; // used on buttons: "Go out to eat"
  price: number | "";
  altLabel: string;
  altShort: string;
  altPrice: number | "";
  value?: string; // what the spend is really about
  choice?: string; // short name for "you can still choose ___"
  ratings?: [number, number, number]; // starting enjoyment, importance, urgency
}

const PRESETS: Scenario[] = [
  { chip: "🍔 Eat out", spendLabel: "going out to eat", choice: "dinner out", spendShort: "Go out to eat", price: 20, altLabel: "cooking at home", altShort: "Cook at home", altPrice: 5, value: "spending time with friends", ratings: [4, 4, 3] },
  { chip: "☕ Coffee", spendLabel: "a $10 coffee", spendShort: "Buy a coffee", price: 10, altLabel: "making coffee at home", altShort: "Make coffee at home", altPrice: 1, value: "the coffee shop break", ratings: [3, 2, 2] },
  { chip: "🚗 Rideshare", spendLabel: "a rideshare", spendShort: "Take a rideshare", price: 18, altLabel: "taking the bus", altShort: "Take the bus", altPrice: 0, value: "getting there fast", ratings: [2, 3, 4] },
  { chip: "🎟️ Concert", spendLabel: "the concert", spendShort: "Go to the concert", price: 60, altLabel: "going to a free campus event", altShort: "Free campus event", altPrice: 0, value: "the concert", ratings: [5, 4, 5] },
];

const CUSTOM: Scenario = { chip: "✏️ Something else", spendLabel: "buying it", spendShort: "Buy it", price: "", altLabel: "a cheaper option", altShort: "Cheaper option", altPrice: "" };

type Option = "spend" | "alt" | "skip";
export type LogDecision = Omit<Decision, "id" | "date" | "goalId" | "goalName" | "kind">;

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-stone-700">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${label} ${n} of 5`}
            className={`h-7 w-7 rounded-full text-xs font-semibold ring-1 ${
              n <= value ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-stone-500 ring-stone-300"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Start the What-If from a specific item (from a photo or typed price). */
export interface WhatIfItem {
  label: string; // "AirPods"
  price: number;
  alternative: { description: string; price: number } | null;
}

function fromItem(item: WhatIfItem): Scenario {
  return {
    chip: CUSTOM.chip,
    spendLabel: `buying ${item.label}`,
    choice: item.label,
    spendShort: `Buy ${item.label}`,
    price: Math.round(item.price * 100) / 100,
    altLabel: item.alternative?.description.toLowerCase() ?? CUSTOM.altLabel,
    altShort: item.alternative?.description ?? CUSTOM.altShort,
    altPrice: item.alternative ? Math.round(item.alternative.price * 100) / 100 : "",
    ratings: [3, 3, 2],
  };
}

export function MoneyWhatIf({
  goal,
  profile,
  onApply,
  initial,
  hidePresets = false,
}: {
  goal: MoneyGoal;
  profile: Profile;
  onApply: (changes: Partial<MoneyGoal>, message: string, decision?: LogDecision) => void;
  initial?: WhatIfItem;
  hidePresets?: boolean; // the Check-a-price screen already captured the item
}) {
  const [sc, setSc] = useState<Scenario>(() => (initial ? fromItem(initial) : PRESETS[0]));
  const [option, setOption] = useState<Option>("spend");
  const [enjoyment, setEnjoyment] = useState(initial ? 3 : PRESETS[0].ratings![0]);
  const [importance, setImportance] = useState(initial ? 3 : PRESETS[0].ratings![1]);
  const [urgency, setUrgency] = useState(initial ? 2 : PRESETS[0].ratings![2]);
  const [timesPerWeek, setTimesPerWeek] = useState(1);

  const price = Number(sc.price || 0);
  const altPrice = sc.altPrice === "" ? null : Number(sc.altPrice);
  const hasAlt = altPrice != null && altPrice < price;
  const goalName = goalPhrase(goal.name);
  const money = (n: number) => formatMoney(n, n % 1 !== 0);

  const spendResult = whatIfSpend(goal.target, goal.saved, goal.weekly, price);
  const altResult = whatIfSpend(goal.target, goal.saved, goal.weekly, altPrice ?? 0);
  const skipResult = whatIfSpend(goal.target, goal.saved, goal.weekly, 0);
  const current = option === "spend" ? spendResult : option === "alt" ? altResult : skipResult;
  const newDate = projectedDate(current.newWeeks);
  const keepWeekly = weeklyToKeepDate(goal.target, goal.saved, goal.weekly, price);
  const score = decisionScore({
    delayDays: spendResult.delayDays,
    goalWeeks: spendResult.originalWeeks,
    enjoyment,
    importance,
    urgency,
    goalCertainty: goal.certainty ?? 100,
  });
  const perSwap = hasAlt ? price - altPrice! : price;
  const habit = habitImpact(goal.target, goal.saved, goal.weekly, perSwap * timesPerWeek);

  const update = (patch: Partial<Scenario>) => setSc((s) => ({ ...s, ...patch }));
  const choose = (p: Scenario) => {
    setSc(p);
    setOption("spend");
    const [e, i, u] = p.ratings ?? [3, 3, 3];
    setEnjoyment(e);
    setImportance(i);
    setUrgency(u);
  };
  const fromSavings = (amount: number) => Math.max(0, Math.round((goal.saved - amount) * 100) / 100);
  const optionLabel = { spend: `A: ${sc.spendShort}`, alt: hasAlt ? `B: ${sc.altShort}${altPrice ? ` for ${money(altPrice)}` : ""}` : null, skip: "C: Avoid spending" };

  return (
    <Card>
      <h3 className="text-lg font-bold text-stone-900">{hidePresets ? `What it does to your ${goalPhrase(goal.name)}` : "What if I…"}</h3>
      <p className="text-sm text-stone-600">{hidePresets ? "Compare buying it, a cheaper option, or skipping it." : "Test a choice before you make it."}</p>

      {!hidePresets && (<>
      <div className="mt-3 flex flex-wrap gap-2">
        {[...PRESETS, CUSTOM].map((p) => (
          <Chip key={p.chip} active={sc.chip === p.chip} onClick={() => choose(p)}>
            {p.chip}
          </Chip>
        ))}
      </div>

      <div className="mt-3">
        <PriceScanner
          onResult={(r) => {
            setSc({
              chip: CUSTOM.chip,
              spendLabel: r.label.replace(/^buying /, ""),
              spendShort: "Buy it",
              price: Math.round(r.price * 100) / 100,
              altLabel: r.alternative?.description.toLowerCase() ?? CUSTOM.altLabel,
              altShort: r.alternative?.description ?? CUSTOM.altShort,
              altPrice: r.alternative ? Math.round(r.alternative.price * 100) / 100 : "",
            });
            setOption("spend");
          }}
        />
      </div>
      </>)}

      <div className="mt-4 grid grid-cols-[1fr_7rem] gap-2">
        <TextField label="The choice" value={sc.spendShort} onChange={(v) => update({ spendShort: v, spendLabel: v.toLowerCase() })} />
        <NumberField label="Estimated cost" value={sc.price} onChange={(v) => update({ price: v })} />
        <TextField label="Cheaper option" value={sc.altShort} onChange={(v) => update({ altShort: v, altLabel: v.toLowerCase() })} />
        <NumberField label="Cost" value={sc.altPrice} onChange={(v) => update({ altPrice: v })} />
      </div>

      {price > 0 && (
        <>
          {/* Compare alternatives: one timeline per option */}
          <div className="mt-5 rounded-xl bg-stone-50 p-3">
            <Timeline
              title="Compare your options"
              deadline={goal.deadline}
              rows={[
                { label: "Original plan", end: projectedDate(spendResult.originalWeeks), tone: "neutral" },
                { label: optionLabel.spend, end: projectedDate(spendResult.newWeeks), tone: "warn", note: `+${spendResult.delayDays.toFixed(1)} days` },
                ...(hasAlt ? [{ label: optionLabel.alt!, end: projectedDate(altResult.newWeeks), tone: "good" as const, note: altResult.delayDays > 0 ? `+${altResult.delayDays.toFixed(1)} days` : "no delay" }] : []),
                { label: optionLabel.skip, end: projectedDate(skipResult.newWeeks), tone: "good", note: "no delay" },
              ]}
            />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {(["spend", "alt", "skip"] as const).map((id) =>
              optionLabel[id] ? (
                <button
                  key={id}
                  onClick={() => setOption(id)}
                  className={`rounded-xl px-2 py-2 text-xs font-semibold ring-1 ${option === id ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-800 ring-stone-300"}`}
                >
                  {optionLabel[id]}
                </button>
              ) : (
                <div key={id} />
              ),
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Original timeline" value={formatWeeks(current.originalWeeks)} />
            <Stat label="New timeline" value={formatWeeks(current.newWeeks)} sub={newDate ? `around ${formatDate(newDate)}` : undefined} tone={current.delayDays > 0 ? "warn" : "good"} />
          </div>
          <div className="mt-2">
            <Stat
              label="Estimated delay to your goal"
              value={current.delayDays > 0 ? `${current.delayDays.toFixed(1)} days` : "No delay 🎉"}
              tone={current.delayDays > 0 ? "warn" : "good"}
              sub={option === "spend" && profile.hourlyWage ? `${money(price)} is ${workTime(hoursOfWork(price, profile.hourlyWage))} of work at your pay` : undefined}
            />
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Assumes the expense comes from your savings and you keep saving {money(goal.weekly)} a week.
          </p>

          <div className="mt-4">
            <Notice tone="info">
              💬{" "}
              {recommendation({
                goalName,
                spendLabel: sc.spendLabel,
                spendDelayDays: spendResult.delayDays,
                altLabel: hasAlt ? sc.altLabel : undefined,
                altPrice: hasAlt ? altPrice! : undefined,
                altDelayDays: hasAlt ? altResult.delayDays : undefined,
                value: sc.value,
                choiceLabel: sc.choice,
              })}
            </Notice>
          </div>

          {/* Decision score: not every decision is purely financial */}
          <div className="mt-4 rounded-xl ring-1 ring-stone-200 p-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-stone-900">Is "{sc.spendShort}" worth it to you?</p>
              <span
                className={`rounded-full px-2.5 py-1 text-sm font-bold ${score.score >= 70 ? "bg-emerald-100 text-emerald-900" : score.score >= 45 ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900"}`}
              >
                {score.score}/100
              </span>
            </div>
            <div className="mt-3 space-y-2">
              <Rating label="Enjoyment" value={enjoyment} onChange={setEnjoyment} />
              <Rating label="Importance" value={importance} onChange={setImportance} />
              <Rating label="Urgency" value={urgency} onChange={setUrgency} />
            </div>
            <p className="mt-3 text-sm font-semibold text-stone-900">{score.verdict}</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-stone-600">
              {score.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-stone-500">Uses your money cost, enjoyment, importance, urgency, and how sure you are about this goal ({goal.certainty ?? 100}%).</p>
          </div>

          <div className="mt-4 grid gap-2">
            <p className="text-sm font-medium text-stone-700">What will you do?</p>
            <Button
              variant="secondary"
              onClick={() =>
                onApply(
                  { saved: fromSavings(price), weekly: Math.round(keepWeekly * 100) / 100 },
                  `Enjoy it! To keep your ${goalName} on the same date, your plan is now ${formatMoney(keepWeekly, true)}/week.`,
                  { label: `${sc.spendShort} (kept my date)`, amount: -price, effectDays: 0 },
                )
              }
            >
              {sc.spendShort}, and save {formatMoney(keepWeekly - goal.weekly, true)} more/week to keep my date
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                onApply({ saved: fromSavings(price) }, `Enjoy it! Your ${goalName} is now about ${Math.round(spendResult.delayDays)} days later.`, {
                  label: sc.spendShort,
                  amount: -price,
                  effectDays: -spendResult.delayDays,
                })
              }
            >
              {sc.spendShort}, and accept the new date
            </Button>
            {hasAlt && (
              <Button
                onClick={() =>
                  onApply(
                    { saved: fromSavings(altPrice!) },
                    `Nice! ${sc.altShort} instead kept your ${goalName} ${Math.round(spendResult.delayDays - altResult.delayDays)} days closer than ${sc.spendLabel}.`,
                    { label: `${sc.altShort} instead of ${sc.spendLabel}`, amount: price - altPrice!, effectDays: spendResult.delayDays - altResult.delayDays },
                  )
                }
              >
                {sc.altShort} instead
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() =>
                onApply({}, `Skipped. Your ${goalName} stays right on track.`, { label: `Skipped ${sc.spendLabel}`, amount: price, effectDays: spendResult.delayDays })
              }
            >
              Skip it
            </Button>
          </div>

          {/* Positive opportunity cost: the cumulative benefit of repeating a good choice */}
          {!hidePresets && perSwap > 0 && isFinite(habit.before) && (
            <div className="mt-5 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
              <p className="font-semibold text-emerald-950">🌱 Make it a habit</p>
              <div className="mt-2 flex items-center gap-2 text-sm text-emerald-950">
                <span>{hasAlt ? sc.altShort : `Skip ${sc.spendLabel}`}</span>
                <select
                  value={timesPerWeek}
                  onChange={(e) => setTimesPerWeek(Number(e.target.value))}
                  className="rounded-lg bg-white px-2 py-1 ring-1 ring-emerald-300"
                >
                  {[1, 2, 3, 4, 5, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
                <span>a week</span>
              </div>
              <p className="mt-2 text-sm text-emerald-950">
                Saves <strong>{formatMoney(perSwap * timesPerWeek, true)}/week</strong> ({formatMoney(perSwap * timesPerWeek * 4.345)}/month). Your {goalName} arrives{" "}
                <strong>{Math.round(habit.daysSooner)} days sooner</strong>: {formatWeeks(habit.before)} → {formatWeeks(habit.after)}.
              </p>
              <Button
                className="mt-2 w-full"
                onClick={() =>
                  onApply(
                    { weekly: Math.round((goal.weekly + perSwap * timesPerWeek) * 100) / 100 },
                    `Habit added! You're now saving ${formatMoney(goal.weekly + perSwap * timesPerWeek, true)}/week. Your ${goalName} is ${Math.round(habit.daysSooner)} days closer.`,
                    { label: `New habit: ${hasAlt ? sc.altShort.toLowerCase() : `skip ${sc.spendLabel}`} ${timesPerWeek}×/week`, effectDays: habit.daysSooner },
                  )
                }
              >
                Add {formatMoney(perSwap * timesPerWeek, true)}/week to my plan
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function workTime(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole} hour${whole === 1 ? "" : "s"}`;
}
