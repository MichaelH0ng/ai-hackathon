import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { answerMoneyQuestion, type MoneyAssistantContext } from "../lib/moneyAssistant";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  pending?: boolean;
  offline?: boolean; // answered on-device because the AI wasn't reachable
}

// Remembered per browser; storage can be unavailable (private mode), so every access is guarded.
const TUCK_KEY = "northstar:polaris-tucked";
const readTucked = () => { try { return localStorage.getItem(TUCK_KEY) === "1"; } catch { return false; } };

const prompts = ["Compare retirement accounts", "Roth IRA vs traditional IRA", "What is an HSA?", "How do I start investing?"];

/** Asks the server's AI assistant. Throws on any failure so the caller can fall back. */
async function askAI(question: string, history: ChatMessage[], context: MoneyAssistantContext): Promise<string> {
  const res = await fetch("/api/financial-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      history: history.filter(m => m.id !== "welcome" && !m.pending && !m.offline).slice(-4).map(m => ({ role: m.role, content: m.text.slice(0, 2000) })),
      goals: context.goals.map(g => ({ kind: "money", ...g })),
      planning: {
        accounts: context.accounts,
        netWorth: context.netWorth,
        monthlyIncome: context.monthlyIncome,
        monthlyExpenses: context.monthlyExpenses,
        monthlyGoalContributions: context.monthlyGoalContributions,
        retirementBalance: context.retirementBalance,
        retirementEstimate: context.retirementEstimate,
        retirementAge: context.retirementAge,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.answer !== "string") throw new Error(body.error ?? "Assistant unavailable");
  return body.answer;
}

export function MoneyAssistant({ context }: { context: MoneyAssistantContext }) {
  const [open, setOpen] = useState(false);
  // Tucked: Polaris slides off the right edge, leaving a small tab to bring it back.
  const [tucked, setTucked] = useState(readTucked);
  function toggleTucked() {
    const next = !tucked;
    setTucked(next);
    if (next) setOpen(false);
    try { localStorage.setItem(TUCK_KEY, next ? "1" : "0"); } catch { /* keep the choice for this visit only */ }
  }
  const [question, setQuestion] = useState("");
  // null while checking; true when this machine's server has an API key.
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome",
    role: "assistant",
    text: "Hi, I’m Polaris. I can help with your balances, goals, budget, retirement, and investing basics—from index funds to diversification and planning contributions.",
  }]);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = messages.some(m => m.pending);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    let alive = true;
    fetch("/api/assistant/status")
      .then(res => (res.ok ? res.json() : { ai: false }))
      .then(body => { if (alive) setAiReady(!!body.ai); })
      .catch(() => { if (alive) setAiReady(false); });
    return () => { alive = false; };
  }, []);

  async function ask(rawQuestion = question) {
    const text = rawQuestion.trim();
    if (!text || busy) return;
    setQuestion("");
    const history = messages;
    if (!aiReady) {
      setMessages(current => [
        ...current,
        { id: crypto.randomUUID(), role: "user", text },
        { id: crypto.randomUUID(), role: "assistant", text: answerMoneyQuestion(text, context, current) },
      ]);
      return;
    }
    const replyId = crypto.randomUUID();
    setMessages(current => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text },
      { id: replyId, role: "assistant", text: "Thinking…", pending: true },
    ]);
    let reply: Pick<ChatMessage, "text" | "offline">;
    try {
      reply = { text: await askAI(text, history, context) };
    } catch {
      // Network, key, or provider trouble: answer on-device rather than leave the user hanging.
      reply = { text: answerMoneyQuestion(text, context, history), offline: true };
    }
    setMessages(current => current.map(m => (m.id === replyId ? { ...m, ...reply, pending: false } : m)));
  }

  const mode = aiReady ? "AI answers from your NorthStar data" : "Private, on-device answers";
  return <>
    {open && <section id="money-assistant-panel" className="money-assistant-panel" role="dialog" aria-labelledby="money-assistant-title">
      <header className="money-assistant-header">
        <div><h2 id="money-assistant-title">Polaris</h2><p><Sparkles size={13} /> {mode}</p></div>
        <button className="wealth-icon-button" aria-label="Close Polaris" onClick={() => setOpen(false)}><X size={18} /></button>
      </header>
      <div className="money-assistant-messages" role="log" aria-live="polite" aria-busy={busy}>
        {messages.map(message => <p key={message.id} className={`money-assistant-message ${message.role}${message.pending ? " pending" : ""}`}>
          {message.text}
          {message.offline && <small className="money-assistant-offline">Answered on this device. The AI assistant was unavailable.</small>}
        </p>)}
      </div>
      {messages.length === 1 && <div className="money-assistant-prompts">{prompts.map(prompt => <button key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>}
      <form className="money-assistant-form" onSubmit={event => { event.preventDefault(); ask(); }}>
        <input ref={inputRef} aria-label="Ask Polaris about your finances" maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask Polaris a question…" />
        <button className="wealth-primary" aria-label="Send question" disabled={!question.trim() || busy}><Send size={17} /></button>
      </form>
      <p className="money-assistant-privacy">{aiReady ? "Your question and a summary of your dashboard are sent to an AI service to answer. Not financial advice." : "Uses dashboard numbers on this device. Not financial advice."}</p>
    </section>}
    <div className={`money-assistant-dock${tucked ? " tucked" : ""}`}>
      <button className="money-assistant-tuck" aria-label={tucked ? "Show Polaris" : "Hide Polaris"} title={tucked ? "Show Polaris" : "Hide Polaris"} onClick={toggleTucked}>
        {tucked ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
      </button>
      <button className="money-assistant-launch" inert={tucked} aria-expanded={open} aria-controls="money-assistant-panel" onClick={() => setOpen(value => !value)}>
        {open ? <X size={20} /> : <MessageCircle size={20} />}<span>{open ? "Close Polaris" : "Ask Polaris"}</span>
      </button>
    </div>
  </>;
}
