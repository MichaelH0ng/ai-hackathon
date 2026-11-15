import { useState } from "react";
import { ArrowRight, Briefcase, Scissors, Sparkles, Wallet } from "lucide-react";
import { formatMoney } from "../lib/finance";
import type { MoneyGoal } from "../lib/types";

interface PlanMove { name: string; action: string; monthly: number }
interface Plan {
  summary: string;
  cuts: PlanMove[];
  earn: PlanMove[];
  monthlyLeftover: number;
  monthlyTotal: number;
  weekly: number;
  weeks: number | null;
  finishDate: string | null;
  source: "ai" | "template";
}

const monthYear = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
function duration(weeks: number) {
  const months = Math.round((weeks * 7) / 30.4);
  if (months < 2) return `${weeks} weeks`;
  if (months < 24) return `${months} months`;
  return `${(months / 12).toFixed(1)} years`;
}

/**
 * "Build my savings plan": Polaris reads the student's real spending and proposes cuts and
 * extra income for one purchase. The server checks every amount; the weekly figure and
 * finish date are computed, not written by the AI. One tap turns the plan into a goal.
 */
export function SavingsPlanAgent({ item, price, hourlyWage, goals, budget, onCreateGoal }: {
  item: string;
  price: number;
  hourlyWage: number | null;
  goals: MoneyGoal[];
  budget?: { monthlyIncome: number; monthlySpending: number };
  onCreateGoal: (goal: MoneyGoal) => void;
}) {
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "done"; plan: Plan }>({ status: "idle" });

  async function build() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/savings-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, price, hourlyWage, goals: goals.map(({ target, saved, weekly }) => ({ target, saved, weekly })), budget }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error ?? "Polaris couldn't build a plan right now. Try again in a moment.");
      setState({ status: "done", plan: body as Plan });
    } catch (err) {
      setState({ status: "error", error: err instanceof Error ? err.message : "Polaris couldn't build a plan right now." });
    }
  }

  if (state.status === "idle" || state.status === "error") {
    return (
      <div className="savings-plan-start">
        <div>
          <p className="font-semibold text-ink">Want a plan to get there?</p>
          <p className="text-sm text-stone-600">Polaris looks at your recent spending and finds where the money could come from.</p>
          {state.status === "error" && <p className="mt-1 text-sm font-semibold text-red-700" role="alert">{state.error}</p>}
        </div>
        <button className="wealth-primary savings-plan-button" onClick={build}>
          <Sparkles size={16} aria-hidden="true" /> {state.status === "error" ? "Try again" : "Build my savings plan"}
        </button>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="savings-plan" aria-busy="true" aria-live="polite">
        <p className="text-sm font-semibold text-stone-600"><Sparkles size={14} className="inline align-[-2px]" aria-hidden="true" /> Polaris is reading your last two months of spending…</p>
        <div className="mt-3 grid gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}
        </div>
      </div>
    );
  }

  const { plan } = state;
  const rows: (PlanMove & { kind: "left" | "cut" | "earn" })[] = [
    ...(plan.monthlyLeftover !== 0 ? [{ kind: "left" as const, name: "", action: plan.monthlyLeftover > 0 ? "Already left over after bills, spending, and other goals" : "You currently spend more than you take in", monthly: plan.monthlyLeftover }] : []),
    ...plan.cuts.map((m) => ({ ...m, kind: "cut" as const })),
    ...plan.earn.map((m) => ({ ...m, kind: "earn" as const })),
  ];
  const Icon = { left: Wallet, cut: Scissors, earn: Briefcase };

  return (
    <div className="savings-plan" aria-live="polite">
      <p className="text-base leading-relaxed text-stone-700">
        {plan.source === "ai" && <span className="safe-verdict-ai"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Polaris</span>}
        {plan.summary}
      </p>

      {plan.weekly > 0 && plan.weeks && plan.finishDate ? (
        <p className="savings-plan-headline">
          Save <strong>{formatMoney(plan.weekly)}/week</strong> and you'll have {formatMoney(price)} around <strong>{monthYear(plan.finishDate)}</strong> ({duration(plan.weeks)}).
        </p>
      ) : (
        <p className="savings-plan-headline">Even with these changes, more goes out than comes in each month. Start with the cuts below, then check again.</p>
      )}

      <ul className="savings-plan-rows">
        {rows.map((row, i) => {
          const RowIcon = Icon[row.kind];
          return (
            <li key={i}>
              <span className="category-icon" aria-hidden="true"><RowIcon size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{row.action}</span>
                {row.name && <span className="block text-sm text-stone-500">{row.kind === "cut" ? `From ${row.name}` : row.name}</span>}
              </span>
              <span className={`savings-plan-amount ${row.monthly < 0 ? "is-negative" : ""}`}>{row.monthly < 0 ? "−" : "+"}{formatMoney(Math.abs(row.monthly))}/mo</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {plan.weekly > 0 && (
          <button className="wealth-primary savings-plan-button" onClick={() => onCreateGoal({ kind: "money", id: crypto.randomUUID(), name: item.charAt(0).toUpperCase() + item.slice(1), target: price, saved: 0, weekly: plan.weekly })}>
            Save for it at {formatMoney(plan.weekly)}/week <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        <button className="wealth-text-button" onClick={build}>Make another plan</button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-stone-500">Amounts are monthly averages from your recent transactions, checked by NorthStar. You can change the weekly amount anytime.</p>
    </div>
  );
}
