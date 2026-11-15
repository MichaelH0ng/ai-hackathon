import { useState } from "react";
import { formatDate } from "../lib/dates";
import { formatDelay, formatMoney, goalPhrase, projectedDate, recommendation, whatIfSpend } from "../lib/finance";
import type { Decision, MoneyGoal } from "../lib/types";
import { Button, Card, NumberField, Notice, TextField } from "./ui";

export type LogDecision = Omit<Decision, "id" | "date" | "goalId" | "goalName" | "kind">;

/** An item to test, e.g. from a photo or a typed price. */
export interface WhatIfItem {
  label: string; // "AirPods"
  price: number;
  alternative: { description: string; price: number } | null;
}

const round = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => formatMoney(n, n % 1 !== 0);
const days = (d: number) => (!isFinite(d) ? "—" : d > 0.05 ? `+${formatDelay(d)}` : "no delay");

/**
 * "What if I buy this?" — how many days a purchase pushes a savings goal back,
 * a cheaper option if there is one, and three simple choices.
 */
export function MoneyWhatIf({
  goal,
  onApply,
  initial,
  hideInputs = false,
}: {
  goal: MoneyGoal;
  onApply: (changes: Partial<MoneyGoal>, message: string, decision?: LogDecision) => void;
  initial?: WhatIfItem;
  hideInputs?: boolean; // Check a price already captured the item
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [price, setPrice] = useState<number | "">(initial ? round(initial.price) : "");
  const [altLabel, setAltLabel] = useState(initial?.alternative?.description ?? "");
  const [altPrice, setAltPrice] = useState<number | "">(initial?.alternative ? round(initial.alternative.price) : "");

  const p = Number(price || 0);
  const a = altPrice === "" ? null : Number(altPrice);
  const hasAlt = a != null && a < p;
  const name = label.trim() || "it";
  const altName = altLabel.trim() || "the cheaper option";
  const goalName = goalPhrase(goal.name);

  const buy = whatIfSpend(goal.target, goal.saved, goal.weekly, p);
  const alt = whatIfSpend(goal.target, goal.saved, goal.weekly, a ?? 0);
  const buyDate = projectedDate(buy.newWeeks);
  const fromSavings = (amount: number) => Math.max(0, round(goal.saved - amount));

  return (
    <Card>
      {hideInputs ? (
        <h3 className="text-lg font-bold text-ink">What will you do?</h3>
      ) : (
        <>
          <h3 className="text-lg font-bold text-ink">What if I buy something?</h3>
          <p className="text-sm text-stone-600">Type a price to see how it moves your {goalName}.</p>
          <div className="mt-3 grid grid-cols-[1fr_7rem] gap-2">
            <TextField label="What is it?" value={label} onChange={setLabel} placeholder="Dinner out" />
            <NumberField label="Cost" value={price} onChange={setPrice} />
            <TextField label="Cheaper option (optional)" value={altLabel} onChange={setAltLabel} placeholder="Cook at home" />
            <NumberField label="Cost" value={altPrice} onChange={setAltPrice} />
          </div>
        </>
      )}

      {p > 0 && (
        <>
          <div className={`mt-3 grid gap-2 ${hasAlt ? "grid-cols-2" : ""}`}>
            <div className="rounded-2xl bg-amber-50 p-3">
              <p className="truncate text-xs font-semibold text-amber-900">Buy {name}</p>
              <p className="font-display text-2xl font-bold text-amber-800">{days(buy.delayDays)}</p>
              {buyDate && buy.delayDays > 0.05 && <p className="text-xs text-amber-900">done ~{formatDate(buyDate)}</p>}
            </div>
            {hasAlt && (
              <div className="rounded-2xl bg-emerald-50 p-3">
                <p className="truncate text-xs font-semibold text-emerald-900">{altName}</p>
                <p className="font-display text-2xl font-bold text-emerald-800">{days(alt.delayDays)}</p>
                <p className="text-xs text-emerald-900">{money(a!)}</p>
              </div>
            )}
          </div>

          {!hideInputs && (
            <div className="mt-3">
              <Notice tone="info">
                {recommendation({
                  goalName,
                  spendLabel: label.trim() ? `buying ${label.trim()}` : "buying it",
                  spendDelayDays: buy.delayDays,
                  altLabel: hasAlt ? altName.toLowerCase() : undefined,
                  altPrice: hasAlt ? a! : undefined,
                  altDelayDays: hasAlt ? alt.delayDays : undefined,
                  choiceLabel: label.trim() || undefined,
                })}
              </Notice>
            </div>
          )}

          <div className="mt-4 grid gap-2">
            <Button
              onClick={() =>
                onApply({}, `Skipped! You kept ${money(p)} and your ${goalName} stays on track.`, { label: `Skipped ${name}`, amount: p, effectDays: buy.delayDays })
              }
            >
              Skip it and keep {money(p)}
            </Button>
            {hasAlt && (
              <Button
                variant="secondary"
                onClick={() =>
                  onApply({ saved: fromSavings(a!) }, `Nice! ${altName} kept your ${goalName} ${formatDelay(buy.delayDays - alt.delayDays)} closer.`, {
                    label: `${altName} instead of ${name}`,
                    amount: p - a!,
                    effectDays: buy.delayDays - alt.delayDays,
                  })
                }
              >
                Get {altName.toLowerCase()} instead
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() =>
                onApply({ saved: fromSavings(p) }, `Enjoy it! Your ${goalName} is now about ${formatDelay(buy.delayDays)} later.`, {
                  label: `Bought ${name}`,
                  amount: -p,
                  effectDays: -buy.delayDays,
                })
              }
            >
              Buy it (takes {money(p)} from savings)
            </Button>
          </div>
          <p className="mt-2 text-xs text-stone-500">Assumes it comes out of your savings and you keep saving {money(goal.weekly)} a week.</p>
        </>
      )}
    </Card>
  );
}
