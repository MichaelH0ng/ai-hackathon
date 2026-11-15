import { useState } from "react";
import { formatExact } from "../lib/finance";
import type { BankAccount } from "../lib/money";
import type { MoneyGoal } from "../lib/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Change how much of your cash each goal holds, all at once: the "not set aside" total
 * updates as you type. Editing a goal that follows an account's balance stops that sync,
 * so the amount you choose sticks.
 */
export function CashSplitEditor({ goals, cash, accounts, onSave, onCancel }: {
  goals: MoneyGoal[];
  cash: number;
  accounts: BankAccount[];
  onSave: (changed: MoneyGoal[]) => void;
  onCancel: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, number | "">>(() => Object.fromEntries(goals.map((g) => [g.id, round2(Math.max(0, g.saved))])));
  const value = (id: string) => Number(amounts[id] || 0);
  const total = round2(goals.reduce((s, g) => s + value(g.id), 0));
  const left = round2(cash - total);
  const changed = goals.filter((g) => value(g.id) !== round2(Math.max(0, g.saved)));

  return (
    <form
      className="cash-split-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(changed.map((g) => ({ ...g, saved: value(g.id), linkedAccountId: undefined })));
      }}
    >
      <ul>
        {goals.map((g) => {
          const account = g.linkedAccountId ? accounts.find((a) => a.id === g.linkedAccountId) : undefined;
          const extra = round2(value(g.id) - g.target);
          return (
            <li key={g.id}>
              <label htmlFor={`split-${g.id}`} className="cash-split-editor-name">
                <strong>{g.name}</strong>
                <small>Goal: {formatExact(g.target)}</small>
              </label>
              <div className="cash-split-editor-input">
                <span aria-hidden="true">$</span>
                <input
                  id={`split-${g.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={amounts[g.id]}
                  onChange={(e) => setAmounts((a) => ({ ...a, [g.id]: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) }))}
                />
              </div>
              {(account || extra > 0) && (
                <p className="cash-split-editor-note">
                  {account && <>Follows the whole {account.name} balance. Changing it stops that. </>}
                  {extra > 0 && <>That's {formatExact(extra)} more than this goal needs. <button type="button" className="wealth-inline-link" onClick={() => setAmounts((a) => ({ ...a, [g.id]: g.target }))}>Set to {formatExact(g.target)}</button></>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className={`cash-split-editor-total${left < 0 ? " is-over" : ""}`} aria-live="polite">
        {left >= 0 ? <>Not set aside: <strong>{formatExact(left)}</strong> of {formatExact(cash)}</> : <>Goals claim <strong>{formatExact(-left)}</strong> more than your {formatExact(cash)} in cash</>}
      </p>
      <div className="cash-split-editor-actions">
        <button type="submit" className="wealth-primary" disabled={!changed.length}>Save changes</button>
        <button type="button" className="wealth-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
