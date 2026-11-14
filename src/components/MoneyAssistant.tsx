import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import { answerMoneyQuestion, type MoneyAssistantContext } from "../lib/moneyAssistant";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

const prompts = ["What is my net worth?", "How are my goals doing?", "How much is in checking?"];

export function MoneyAssistant({ context }: { context: MoneyAssistantContext }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome",
    role: "assistant",
    text: "Hi, I’m Polaris. I can help explain your balances, goals, budget, or retirement estimate. Your dashboard data stays on this device.",
  }]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function ask(rawQuestion = question) {
    const text = rawQuestion.trim();
    if (!text) return;
    setMessages(current => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text },
      { id: crypto.randomUUID(), role: "assistant", text: answerMoneyQuestion(text, context) },
    ]);
    setQuestion("");
  }

  return <>
    {open && <section id="money-assistant-panel" className="money-assistant-panel" role="dialog" aria-labelledby="money-assistant-title">
      <header className="money-assistant-header">
        <div><h2 id="money-assistant-title">Polaris</h2><p><Sparkles size={13} /> Private, on-device answers</p></div>
        <button className="wealth-icon-button" aria-label="Close Polaris" onClick={() => setOpen(false)}><X size={18} /></button>
      </header>
      <div className="money-assistant-messages" role="log" aria-live="polite">
        {messages.map(message => <p key={message.id} className={`money-assistant-message ${message.role}`}>{message.text}</p>)}
      </div>
      {messages.length === 1 && <div className="money-assistant-prompts">{prompts.map(prompt => <button key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>}
      <form className="money-assistant-form" onSubmit={event => { event.preventDefault(); ask(); }}>
        <input ref={inputRef} aria-label="Ask Polaris about your finances" maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask Polaris a question…" />
        <button className="wealth-primary" aria-label="Send question" disabled={!question.trim()}><Send size={17} /></button>
      </form>
      <p className="money-assistant-privacy">Uses dashboard numbers on this device. Not financial advice.</p>
    </section>}
    <button className="money-assistant-launch" aria-expanded={open} aria-controls="money-assistant-panel" onClick={() => setOpen(value => !value)}>
      {open ? <X size={20} /> : <MessageCircle size={20} />}<span>{open ? "Close Polaris" : "Ask Polaris"}</span>
    </button>
  </>;
}
