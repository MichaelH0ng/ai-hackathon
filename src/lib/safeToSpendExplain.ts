// The facts behind a Safe-to-Spend verdict, the plain-template explanation, and the
// check that keeps an AI-written explanation honest. Shared by the browser (template,
// no-AI fallback) and the server (AI prompt + validation).
import type { Forecast, OptionId, PurchaseVerdict, Verdict } from "./safeToSpend.ts";

export interface VerdictFacts {
  item: string;
  price: number;
  verdict: Verdict;
  cash: number;
  /** Emergency-fund money kept aside (not spendable). */
  reserved: number;
  reservedName: string | null;
  savings: number;
  cushion: number;
  lowPointBefore: number;
  lowPointAfter: number;
  lowPointDate: string; // "Dec 12"
  driver: { name: string; amount: number; date: string } | null;
  nextIncome: { name: string; amount: number; date: string } | null;
  safeDate: { date: string; after: string } | null;
  comfortableLimit: number;
  safeLimit: number;
  coveredBySavings: boolean;
  goalSavingsPerWeek: number;
  goals: string[];
  confidence: Forecast["confidence"];
  options: { id: OptionId; label: string }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-12-12" → "Dec 12" */
export const shortDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
/** Bank descriptions are often shouty ("CAMPUS BOOKSTORE PAYROLL"); soften them for sentences. */
export const friendlyName = (name: string) => (name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name);

export function verdictFacts(item: string, forecast: Forecast, result: PurchaseVerdict, goals: string[]): VerdictFacts {
  return {
    item,
    price: result.price,
    verdict: result.verdict,
    cash: forecast.cash,
    reserved: forecast.reserved,
    reservedName: forecast.reservedName,
    savings: forecast.savings,
    cushion: forecast.cushion,
    lowPointBefore: forecast.lowPoint,
    lowPointAfter: result.lowPointAfter,
    lowPointDate: shortDate(forecast.lowPointDate),
    driver: forecast.driver ? { name: friendlyName(forecast.driver.name), amount: Math.abs(forecast.driver.amount), date: shortDate(forecast.driver.date) } : null,
    nextIncome: forecast.nextIncome ? { name: friendlyName(forecast.nextIncome.name), amount: forecast.nextIncome.amount, date: shortDate(forecast.nextIncome.date) } : null,
    safeDate: result.safeDate ? { date: shortDate(result.safeDate.date), after: friendlyName(result.safeDate.after) } : null,
    comfortableLimit: result.comfortableLimit,
    safeLimit: result.safeLimit,
    coveredBySavings: result.coveredBySavings,
    goalSavingsPerWeek: Math.round(forecast.goalSavingsPerDay * 7 * 100) / 100,
    goals,
    confidence: forecast.confidence,
    options: result.options.map(({ id, label }) => ({ id, label: label.replace(/\d{4}-\d{2}-\d{2}/, (d) => shortDate(d)) })),
  };
}

/** The no-AI explanation: always available, built only from the facts. */
export function templateSentence(f: VerdictFacts): string {
  const when = `around ${f.lowPointDate}`;
  const after = f.driver ? `, after ${f.driver.name}` : "";
  const kept = f.reserved > 0 ? `, and your ${usd(f.reserved)} ${f.reservedName ?? "emergency fund"} stays untouched` : "";
  if (f.verdict === "safe") {
    return `After your bills and goal savings, you'd still have about ${usd(f.lowPointAfter)} at your lowest point (${when})${kept}.`;
  }
  if (f.verdict === "tight") {
    return `You can cover it, but your balance would dip to about ${usd(f.lowPointAfter)} ${when}${after}, close to your ${usd(f.cushion)} cushion.`;
  }
  const dip = f.lowPointAfter < 0 ? `leave you about ${usd(f.lowPointAfter)} short ${when}` : `leave only about ${usd(f.lowPointAfter)} ${when}`;
  const next = f.safeDate
    ? ` It's safe after your ${f.safeDate.after} deposit on ${f.safeDate.date}.`
    : f.coveredBySavings
      ? " Savings could cover the gap, but that shrinks your backup."
      : " Saving up for it is the safer path.";
  return `Buying it now would ${dip}${after}.${next}`;
}

/** Every dollar amount and date a sentence may mention. */
function allowed(f: VerdictFacts) {
  const amounts = [f.price, f.cash, f.reserved, f.cash - f.reserved, f.savings, f.cushion, f.lowPointBefore, f.lowPointAfter, f.comfortableLimit, f.safeLimit, f.goalSavingsPerWeek, f.driver?.amount, f.nextIncome?.amount, f.price - Math.max(0, f.safeLimit)]
    .filter((n): n is number => typeof n === "number")
    .map(Math.abs);
  const dates = [f.lowPointDate, f.driver?.date, f.nextIncome?.date, f.safeDate?.date].filter(Boolean) as string[];
  return { amounts, dates };
}

/**
 * True when every "$" amount (within $1) and every "Mon D" date in the sentence comes
 * from the facts. Anything else means the model made a number up: use the template.
 */
export function sentenceMatchesFacts(sentence: string, f: VerdictFacts): boolean {
  const { amounts, dates } = allowed(f);
  const money = [...sentence.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!money.every((value) => amounts.some((a) => Math.abs(a - value) <= 1))) return false;
  const mentioned = [...sentence.matchAll(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})\\b`, "g"))].map((m) => `${m[1]} ${Number(m[2])}`);
  return mentioned.every((d) => dates.includes(d));
}
