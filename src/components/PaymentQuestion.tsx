import { useState } from "react";
import { Check } from "lucide-react";
import { categoryEmoji, categoryLabel, type CategoryQuestion, type ReviewLabel, type ReviewQuestion } from "../lib/money";
import { maskMoneyText } from "../lib/privacy";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** The answers that fit each direction, in plain words. */
const OPTIONS: Record<"in" | "out", { label: ReviewLabel; text: string }[]> = {
  in: [
    { label: "payback", text: "Paying me back" },
    { label: "earned", text: "Money I made" },
    { label: "family", text: "From family" },
    { label: "own", text: "My own money" },
  ],
  out: [
    { label: "spending", text: "My spending" },
    { label: "lent", text: "I lent it" },
    { label: "own", text: "To my own account" },
  ],
};
const GUESS_WORDS: Record<ReviewLabel, string> = {
  payback: "paying you back", earned: "money you made", family: "from family", own: "your own money (not counted)",
  spending: "your spending", lent: "a loan (not counted)",
};

/**
 * One of Polaris's quick questions: what was this payment (or everything from this person)?
 * One tap answers it; the answer covers every payment from that person in that direction.
 */
export function PaymentQuestion({ question, remaining, onAnswer, onSkip }: {
  question: ReviewQuestion;
  /** Questions still open, this one included. */
  remaining: number;
  onAnswer: (label: ReviewLabel) => Promise<void>;
  onSkip: () => void;
}) {
  const [saving, setSaving] = useState<ReviewLabel | null>(null);
  const [error, setError] = useState("");
  const who = question.person ?? question.via;
  const many = question.count > 1;
  const headline = question.direction === "in"
    ? question.person ? `${who} sent you ${money(question.total)}${many ? ` over ${question.count} payments` : ""} on ${question.via}.` : `You got ${money(question.total)} by ${question.via.toLowerCase()} on ${day(question.lastDate)}.`
    : question.person ? `You sent ${who} ${money(question.total)}${many ? ` over ${question.count} payments` : ""} on ${question.via}.` : `${money(question.total)} went out (${question.via}) on ${day(question.lastDate)}.`;
  const options = [...OPTIONS[question.direction]].sort((a, b) => Number(b.label === question.guess) - Number(a.label === question.guess));
  const answer = async (label: ReviewLabel) => {
    setSaving(label);
    setError("");
    try {
      await onAnswer(label);
    } catch {
      setError("Couldn't save that. Try again.");
      setSaving(null);
    }
  };
  return <div className="polaris-action proposed polaris-question" role="group" aria-label="Quick question about a payment">
    <strong className="polaris-action-title">Quick question{remaining > 1 ? ` · ${remaining} left` : ""}</strong>
    <p className="polaris-question-text">{maskMoneyText(headline)} What {many ? "were these" : "was this"}?</p>
    {(many || question.examples[0]?.note) && <ul className="polaris-question-examples">
      {question.examples.map((e, i) => <li key={i}>{day(e.date)} · {maskMoneyText(money(e.amount))}{e.note ? ` · “${e.note}”` : ""}</li>)}
      {question.count > question.examples.length && <li>and {question.count - question.examples.length} more</li>}
    </ul>}
    <small className="polaris-question-guess">For now NorthStar counts {many ? "them" : "it"} as {GUESS_WORDS[question.guess]}: {question.reason}.</small>
    <span className="polaris-question-options">
      {options.map((o) => <button key={o.label} type="button" className={o.label === question.guess ? "wealth-primary" : "polaris-action-cancel"} disabled={!!saving} onClick={() => { void answer(o.label); }}>
        {saving === o.label ? "Saving…" : <>{o.label === question.guess && <Check size={14} aria-hidden="true" />} {o.text}</>}
      </button>)}
      <button type="button" className="polaris-question-skip" disabled={!!saving} onClick={onSkip}>Not sure</button>
    </span>
    {many && <small className="polaris-question-guess">Your answer covers every payment {question.direction === "in" ? "from" : "to"} {who}, including future ones.</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}

/** "Gas" reads better than "Transportation" when the question is gas vs. snacks. */
const STORE_WORDS: Record<string, string> = { TRANSPORTATION: "Gas", FOOD_AND_DRINK: "Food or snacks", GENERAL_MERCHANDISE: "Shopping" };

/**
 * A charge at a store that sells both gas and food (7-Eleven, Circle K), where nothing settled which.
 * One tap answers it, and later charges there of about the same size follow the answer.
 */
export function StoreQuestion({ question, remaining, onAnswer, onSkip }: {
  question: CategoryQuestion;
  remaining: number;
  onAnswer: (category: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const options = [...question.choices].sort((a, b) => Number(b === question.guess) - Number(a === question.guess));
  const answer = async (category: string) => {
    setSaving(category);
    setError("");
    try {
      await onAnswer(category);
    } catch {
      setError("Couldn't save that. Try again.");
      setSaving(null);
    }
  };
  if (question.kind === "uncertain") return <UncertainQuestion question={question} remaining={remaining} saving={saving} error={error} answer={answer} onSkip={onSkip} />;
  return <div className="polaris-action proposed polaris-question" role="group" aria-label="Quick question about a store charge">
    <strong className="polaris-action-title">Quick question{remaining > 1 ? ` · ${remaining} left` : ""}</strong>
    <p className="polaris-question-text">{maskMoneyText(`${question.merchant}, ${money(question.amount)} on ${day(question.date)}.`)} Was it gas or something else?</p>
    <small className="polaris-question-guess">For now it's counted as {(STORE_WORDS[question.guess] ?? categoryLabel(question.guess)).toLowerCase()}: {question.reason}.</small>
    <span className="polaris-question-options">
      {options.map((c) => <button key={c} type="button" className={c === question.guess ? "wealth-primary" : "polaris-action-cancel"} disabled={!!saving} onClick={() => { void answer(c); }}>
        {saving === c ? "Saving…" : <>{categoryEmoji(c)} {STORE_WORDS[c] ?? categoryLabel(c)}</>}
      </button>)}
      <button type="button" className="polaris-question-skip" disabled={!!saving} onClick={onSkip}>Not sure</button>
    </span>
    <small className="polaris-question-guess">NorthStar learns from this, so similar charges there won't need asking.</small>
    {error && <small role="alert">{error}</small>}
  </div>;
}

/**
 * A charge Plaid filed with low confidence ("Alpha Kappa Psi" as government and non-profit). One tap
 * keeps Plaid's category; the list moves it anywhere else.
 */
function UncertainQuestion({ question, remaining, saving, error, answer, onSkip }: {
  question: CategoryQuestion;
  remaining: number;
  saving: string | null;
  error: string;
  answer: (category: string) => Promise<void>;
  onSkip: () => void;
}) {
  const others = question.choices.filter((c) => c !== question.guess);
  return <div className="polaris-action proposed polaris-question" role="group" aria-label="Quick question about a charge's category">
    <strong className="polaris-action-title">Quick question{remaining > 1 ? ` · ${remaining} left` : ""}</strong>
    <p className="polaris-question-text">{maskMoneyText(`${question.merchant}, ${money(question.amount)} on ${day(question.date)}.`)} Is {categoryLabel(question.guess).toLowerCase()} the right category?</p>
    <small className="polaris-question-guess">{question.reason}, so your totals may be off until you check it.</small>
    <span className="polaris-question-options">
      <button type="button" className="wealth-primary" disabled={!!saving} onClick={() => { void answer(question.guess); }}>
        {saving === question.guess ? "Saving…" : <><Check size={14} aria-hidden="true" /> Yes, {categoryEmoji(question.guess)} {categoryLabel(question.guess)}</>}
      </button>
      <select className="polaris-question-select" aria-label="Pick a different category" value="" disabled={!!saving} onChange={(event) => { if (event.target.value) void answer(event.target.value); }}>
        <option value="">{saving && saving !== question.guess ? "Saving…" : "No, it was…"}</option>
        {others.map((c) => <option key={c} value={c}>{categoryEmoji(c)} {categoryLabel(c)}</option>)}
      </select>
      <button type="button" className="polaris-question-skip" disabled={!!saving} onClick={onSkip}>Not sure</button>
    </span>
    {error && <small role="alert">{error}</small>}
  </div>;
}
