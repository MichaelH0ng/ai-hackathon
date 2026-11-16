import { AlertTriangle } from "lucide-react";
import { formatDate } from "../lib/dates";
import { formatExact } from "../lib/finance";
import type { DebtAccount } from "../lib/money";
import { ReconnectButton } from "./ReconnectButton";
import { Card } from "./ui";

const KIND_LABEL: Record<DebtAccount["kind"], string> = { credit: "Credit card", student: "Student loan", mortgage: "Mortgage", loan: "Loan" };

function daysUntil(iso: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(iso).getTime() - today) / 86400000);
}

function dueText(iso: string): string {
  const d = daysUntil(iso);
  if (Number.isNaN(d)) return "";
  if (d < 0) return `was due ${formatDate(iso)}`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due ${formatDate(iso)} (in ${d} days)`;
}

/**
 * Cards and loans with what the bank says is due. Every figure can be missing at a given bank, so
 * each line only appears when Plaid sent it. APR is shown as reported, never estimated.
 */
export function DebtPanel({ debts, reconnect, onReconnected }: { debts: DebtAccount[]; reconnect: { itemId: string; institution: string }[]; onReconnected: () => void }) {
  if (!debts.length && !reconnect.length) return null;
  const sorted = [...debts].sort((a, b) => (a.nextDueDate ?? "9999").localeCompare(b.nextDueDate ?? "9999"));
  const minimums = debts.reduce((sum, d) => sum + (d.minimumPayment ?? 0), 0);
  const owed = debts.reduce((sum, d) => sum + d.balance, 0);
  return (
    <Card className="lg:col-span-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Debt and payments</h2>
        {debts.length > 0 && (
          <p className="text-sm text-stone-500">
            <strong className="text-ink">{formatExact(owed)}</strong> owed
            {minimums > 0 && <> · <strong className="text-ink">{formatExact(minimums)}</strong> in minimum payments</>}
          </p>
        )}
      </div>
      {reconnect.map((r) => (
        <div key={r.itemId} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
          <span>Card and loan details aren't shared for {r.institution} yet. Allow them once; your existing history stays.</span>
          <ReconnectButton itemId={r.itemId} institution={r.institution} addDebts label="Add card and loan details" onDone={onReconnected} />
        </div>
      ))}
      {sorted.length > 0 && (
        <ul className="mt-3 divide-y divide-stone-100">
          {sorted.map((d) => (
            <li key={d.accountId} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-stone-800">
                  {d.name}
                  {d.mask ? ` ···${d.mask}` : ""}
                </span>
                <span className="block text-xs text-stone-500">
                  {KIND_LABEL[d.kind]} · {d.institution.replace(/ \(test\)$/, "")}
                  {d.apr != null ? ` · ${d.apr.toFixed(2)}% APR` : ""}
                </span>
                {d.isOverdue && (
                  <span className="mt-1 flex items-center gap-1 text-xs font-bold text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Your bank marks this as overdue
                  </span>
                )}
              </span>
              <span className="sm:text-right">
                <span className="block font-bold text-ink">{formatExact(d.balance)} owed</span>
                <span className="block text-xs text-stone-500">
                  {d.minimumPayment != null ? `${formatExact(d.minimumPayment)} minimum` : "Minimum payment not shared"}
                  {d.nextDueDate ? ` · ${dueText(d.nextDueDate)}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {sorted.length > 0 && <p className="mt-2 text-xs text-stone-500">From your bank, about once a day. Interest and fees can make your real payoff amount higher; check your card or loan for the exact figure.</p>}
    </Card>
  );
}
