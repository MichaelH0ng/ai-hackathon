import { useEffect, useRef, useState } from "react";
import { MessageCircleMore, Send, Sparkles, X } from "lucide-react";
import { post } from "../lib/useBank";
import type { Goal, MoneyGoal } from "../lib/types";

type ChatRole = "user" | "assistant";
type ChatMessage = { id: string; role: ChatRole; content: string };

interface FinancialChatProps {
  goals: Goal[];
}

interface ChatResponse {
  answer: string;
  fetchedAt: string;
}

const STARTERS = [
  "How much money came in last week?",
  "How close am I to my savings goals?",
  "Did I receive any interest last month?",
];

function moneyGoals(goals: Goal[]) {
  return goals.filter((goal): goal is MoneyGoal => goal.kind === "money").map(({ kind, name, target, saved, weekly, deadline }) => ({ kind, name, target, saved, weekly, deadline }));
}

/** Floating, keyboard-accessible drawer for questions about the user's connected financial data. */
export function FinancialChat({ goals }: FinancialChatProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const ask = async (question = draft) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    const history = messages.slice(-4).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError(null);
    setLoading(true);
    try {
      const result = await post<ChatResponse>("/api/financial-chat", {
        question: trimmed,
        history,
        goals: moneyGoals(goals),
      });
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: result.answer }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't get an answer. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 sm:bottom-7 sm:right-7">
      {open && (
        <aside
          aria-label="Financial assistant"
          aria-modal="true"
          className="absolute bottom-16 right-0 flex h-[min(42rem,calc(100dvh-7rem))] w-[calc(100vw-2.5rem)] max-w-md flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-[0_24px_65px_-20px_rgb(30_27_46/0.45)] ring-1 ring-emerald-200 sm:bottom-18"
          role="dialog"
        >
          <header className="flex items-start justify-between gap-3 bg-ink px-5 py-4 text-white">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
              <div>
                <h2 className="font-display text-xl font-bold">Money questions</h2>
                <p className="mt-0.5 text-xs text-stone-300">Fresh data from your connected accounts</p>
              </div>
            </div>
            <button aria-label="Close financial assistant" className="rounded-xl p-2 text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-white" onClick={() => setOpen(false)} type="button">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto bg-emerald-50/70 px-4 py-4">
            {!messages.length && !loading && (
              <div className="rise rounded-2xl bg-white p-4 text-sm text-stone-700 shadow-sm ring-1 ring-emerald-100">
                <p className="font-semibold text-ink">Ask about what your data actually shows.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {STARTERS.map((starter) => (
                    <button className="rounded-xl bg-emerald-100 px-3 py-2 text-left text-xs font-bold text-emerald-900 transition-colors hover:bg-emerald-200 focus-visible:outline-emerald-700" key={starter} onClick={() => ask(starter)} type="button">
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <div className={message.role === "user" ? "ml-10 rounded-2xl rounded-br-md bg-ink px-4 py-3 text-sm text-white" : "mr-4 whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm leading-6 text-stone-800 shadow-sm ring-1 ring-emerald-100"} key={message.id}>
                {message.content}
              </div>
            ))}
            {loading && <div className="mr-16 flex items-center gap-2 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-stone-600 shadow-sm ring-1 ring-emerald-100"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" />Checking your latest account data…</div>}
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200" role="alert">{error}</p>}
            <div ref={endRef} />
          </div>

          <form className="border-t border-emerald-100 bg-white p-3" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
            <label className="sr-only" htmlFor="financial-question">Ask a question about your money</label>
            <div className="flex items-center gap-2 rounded-2xl bg-stone-50 p-1.5 ring-1 ring-stone-300 focus-within:ring-2 focus-within:ring-emerald-600">
              <input className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-stone-400" disabled={loading} id="financial-question" maxLength={1200} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about your money…" ref={inputRef} value={draft} />
              <button aria-label="Send question" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300 focus-visible:outline-emerald-700" disabled={!draft.trim() || loading} type="submit">
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="px-1 pt-2 text-[11px] leading-4 text-stone-500">Common totals are calculated instantly. Other questions send only the relevant account context to Claude. Informational only—not financial, tax, or investment advice.</p>
          </form>
        </aside>
      )}
      <button aria-expanded={open} aria-haspopup="dialog" aria-label={open ? "Close financial assistant" : "Ask a money question"} className="group flex min-h-14 items-center gap-2 rounded-2xl bg-emerald-600 px-4 font-display font-bold text-white shadow-[0_6px_0_0_rgb(4_120_87/0.35)] transition-all duration-200 hover:bg-emerald-700 hover:shadow-[0_4px_0_0_rgb(4_120_87/0.35)] active:translate-y-0.5 active:shadow-[0_2px_0_0_rgb(4_120_87/0.35)] focus-visible:outline-emerald-900" onClick={() => setOpen((current) => !current)} type="button">
        <MessageCircleMore className="h-5 w-5" aria-hidden="true" />
        <span className="hidden sm:inline">Ask about money</span>
      </button>
    </div>
  );
}

export default FinancialChat;
