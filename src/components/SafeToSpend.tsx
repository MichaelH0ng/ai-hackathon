import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleAlert, Clock, Sparkles } from "lucide-react";
import { formatMoney } from "../lib/finance";
import { evaluatePurchase, type Forecast, type OptionId, type Verdict } from "../lib/safeToSpend";
import { shortDate, templateSentence, verdictFacts } from "../lib/safeToSpendExplain";

const LOOK: Record<Verdict, { badge: string; Icon: typeof CircleCheck }> = {
  safe: { badge: "Safe to buy", Icon: CircleCheck },
  tight: { badge: "Tight", Icon: CircleAlert },
  "not-yet": { badge: "Not yet", Icon: Clock },
};

/**
 * The Safe-to-Spend verdict for one purchase. The color, numbers, and safe date are
 * computed instantly in the browser; Polaris then replaces the template sentence with
 * a plain-English explanation (or the template stays if the AI is unavailable).
 */
export function SafeToSpendCard({ item, price, forecast, goals }: { item: string; price: number; forecast: Forecast; goals: string[] }) {
  const result = useMemo(() => evaluatePurchase(forecast, price), [forecast, price]);
  // Depend on the goal names' text, not the array, so a re-render doesn't re-ask the AI.
  const goalsKey = goals.join("\n");
  const facts = useMemo(() => verdictFacts(item, forecast, result, goalsKey ? goalsKey.split("\n") : []), [item, forecast, result, goalsKey]);
  const template = useMemo(() => templateSentence(facts), [facts]);
  const [ai, setAi] = useState<{ key: string; sentence: string; recommended: OptionId } | null>(null);
  const key = `${item}|${price}|${forecast.today}|${forecast.cash}`;

  useEffect(() => {
    let alive = true;
    fetch("/api/safe-to-spend/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(facts) })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (alive && body?.source === "ai" && typeof body.sentence === "string") setAi({ key, sentence: body.sentence, recommended: body.recommended });
      })
      .catch(() => { /* the template sentence stays */ });
    return () => { alive = false; };
  }, [facts, key]);

  const fromAi = ai?.key === key ? ai : null;
  const recommendedId = fromAi?.recommended ?? result.options[0]?.id;
  const recommended = facts.options.find((o) => o.id === recommendedId);
  const { badge, Icon } = LOOK[result.verdict];
  // Round first so a few cents below zero shows "$0", not "−$0".
  const money = (n: number) => { const whole = Math.round(n); return `${whole < 0 ? "−" : ""}${formatMoney(Math.abs(whole))}`; };
  const headline =
    result.verdict === "safe" ? "You can afford this."
      : result.verdict === "tight" ? "You can cover it, but it's tight."
        : result.safeDate ? `Safe after ${shortDate(result.safeDate.date)}.` : "Not right now.";
  const basis =
    forecast.confidence === "full" ? "Projected from your paychecks, bills, and average spending over the last 60 days."
      : forecast.confidence === "limited" ? "Based on a short history, so treat this as a rough guide."
        : "No transaction history yet: based on your balance and Budget only.";

  return (
    <section className={`safe-verdict clay p-5 is-${result.verdict}`} aria-labelledby="safe-verdict-title" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="safe-verdict-badge"><Icon className="h-4 w-4" aria-hidden="true" /> {badge}</span>
        <span className="text-xs font-semibold text-stone-500">Next 30 days</span>
      </div>
      <h3 id="safe-verdict-title" className="safe-verdict-title mt-3 text-ink">{headline}</h3>
      <p className="mt-1 text-base leading-relaxed text-stone-700">
        {fromAi && <span className="safe-verdict-ai"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Polaris</span>}
        {fromAi?.sentence ?? template}
      </p>

      <dl className="safe-verdict-numbers mt-4">
        <div><dt>Cash today</dt><dd>{money(forecast.cash)}</dd>{forecast.reserved > 0 && <small className="safe-verdict-kept">{money(forecast.reserved)} kept in {forecast.reservedName ?? "emergency fund"}</small>}</div>
        <div><dt>Lowest point · {shortDate(forecast.lowPointDate)}</dt><dd>{money(forecast.lowPoint)}</dd></div>
        <div><dt>If you buy it</dt><dd className="is-after">{money(result.lowPointAfter)}</dd></div>
        <div><dt>Cushion</dt><dd>{money(forecast.cushion)}</dd></div>
      </dl>

      {recommended && result.verdict !== "safe" && (
        <p className="safe-verdict-next mt-4"><strong>Suggested:</strong> {recommended.label}</p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-stone-500">
        {basis} {forecast.goalSavingsPerDay > 0 && `Your goal savings (${formatMoney(forecast.goalSavingsPerDay * 7)}/week) are set aside first. `}
        Cash includes your checking and savings{forecast.reserved > 0 ? `, minus your ${forecast.reservedName ?? "emergency fund"} (${formatMoney(forecast.reserved)}), which is never counted as spending money` : ""}. A projection, not a guarantee.
      </p>
    </section>
  );
}
