export interface AssistantTurn { role: "assistant" | "user"; text: string }

const horizonPrompt = "When will you need this money?";
const riskPrompt = "How would you react to a substantial drop?";
const clarification = "Could you describe when you need the money or how you would handle a loss?";

/** Continue only a question we actually asked, rather than treating every reply as investing. */
export function answerInvestingFollowUp(question: string, history: AssistantTurn[]): string | null {
  const last = history.at(-1);
  if (last?.role !== "assistant" || ![
    horizonPrompt, riskPrompt, clarification,
    "What is your time horizon?", "What are you investing for, and when will you need the money?",
    "When will you need this money, and how would you react to a substantial drop?",
  ].some(prompt => last.text.includes(prompt))) return null;

  // An explicit new request belongs to the normal question router.
  if (/\?|\b(what is|what's|explain|compare|how much|net worth|balance|instead|new topic)\b/i.test(question)) return null;
  let start = history.length - 1;
  while (start > 0) {
    const turn = history[start - 1];
    if (turn?.role === "user" && /\b(invest\w*|diversif\w*|stocks?|bonds?)\b/i.test(turn.text)) { start--; break; }
    start--;
  }
  const replies = [...history.slice(start).filter(turn => turn.role === "user").map(turn => turn.text), question];
  let months: number | undefined;
  let horizon: string | undefined;
  let risk: "sell" | "hold" | undefined;
  for (const reply of replies) {
    const duration = reply.match(/\b(\d+(?:\.\d+)?)\s*(years?|months?)\b/i);
    if (duration) {
      months = Number(duration[1]) * (/year/i.test(duration[2]!) ? 12 : 1);
      horizon = duration[0];
    }
    if (/\b(can't|cannot|couldn't|wouldn't|would not) (?:afford|tolerate|handle)\b|\b(panic|sell|low risk)\b/i.test(reply)) risk = "sell";
    if (/\b(hold|stay invested|ride it out|comfortable with losses)\b/i.test(reply) && !/\b(not|won't|wouldn't|can't|cannot)\b/i.test(reply)) risk = "hold";
  }
  const currentRecognized = /\b\d+(?:\.\d+)?\s*(years?|months?)\b|\b(panic|sell|hold|stay invested|ride it out|low risk|comfortable with losses)\b/i.test(question);
  if (!currentRecognized) return `I’m not sure how that answers the investing question, and I don’t want to assume. ${clarification}`;
  const parts: string[] = [];
  if (horizon !== undefined && months !== undefined) {
    parts.push(`You said you need the money in ${horizon}.`);
    parts.push(months <= 36
      ? "For that near-term goal, prioritize access and preserving principal; stock-market losses might not recover before you need the money."
      : "That gives you a longer planning horizon, but market losses are still possible. Compare diversified funds, fees, and a stock/bond mix you could keep through downturns.");
  }
  if (risk) parts.push(risk === "sell"
    ? "You described discomfort with losses. Consider less volatility rather than a mix that could push you to sell in a downturn."
    : "You said you would stay invested through a drop. That describes your stated tolerance, but does not establish how much loss you can afford.");
  if (!horizon) parts.push(horizonPrompt);
  else if (!risk) parts.push(riskPrompt);
  else parts.push("Before choosing contributions or an allocation, review your emergency reserves, debt rates, and any employer match. Those details are still unknown; this conversation does not change your dashboard settings.");
  return parts.join(" ");
}
