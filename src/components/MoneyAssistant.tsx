import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Send, Sparkles, Square, Volume2, X } from "lucide-react";
import { PolarisAvatar } from "./PolarisAvatar";
import { MicLevelButton } from "./MicLevelButton";
import { PolarisText } from "./PolarisText";
import { polarisMood } from "../lib/polarisMood";
import { canSpeak, speakAsPolaris } from "../lib/polarisVoice";
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

// Browser speech-to-text (Chrome, Edge, Safari). Not in TypeScript's DOM types, so typed minimally here.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
const SpeechRecognitionCtor = typeof window === "undefined" ? undefined : (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;

// The conversation is remembered per browser so a refresh doesn't wipe it.
const CHAT_KEY = "northstar:polaris-chat";
const MAX_SAVED = 60;
const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "Hi, I’m Polaris. I can help with your balances, goals, budget, retirement, and investing basics—from index funds to diversification and planning contributions.",
};
function readChat(): ChatMessage[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_KEY) ?? "null");
    if (!Array.isArray(saved)) return [welcome];
    const valid = saved.filter((m): m is ChatMessage => m && typeof m.id === "string" && typeof m.text === "string" && (m.role === "assistant" || m.role === "user") && !m.pending);
    return valid.length ? valid : [welcome];
  } catch { return [welcome]; }
}

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
  const [messages, setMessages] = useState<ChatMessage[]>(readChat);
  useEffect(() => {
    const settled = messages.filter(m => !m.pending);
    try {
      if (settled.length <= 1 && settled[0]?.id === "welcome") localStorage.removeItem(CHAT_KEY);
      else localStorage.setItem(CHAT_KEY, JSON.stringify(settled.slice(-MAX_SAVED)));
    } catch { /* storage unavailable: the chat lasts for this visit */ }
  }, [messages]);
  const mood = useMemo(() => polarisMood(context), [context]);
  // Messages already in the chat when the page loaded (saved history, the welcome) appear at once;
  // only new answers fade in word by word.
  const [shownAtOpen] = useState(() => new Set(messages.map(m => m.id)));

  // Read a reply out loud with the browser's built-in voice. Click again to stop.
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  function stopSpeaking() {
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }
  function toggleSpeak(message: ChatMessage) {
    if (!canSpeak) return;
    if (speakingId === message.id) { stopSpeaking(); return; }
    const utterance = speakAsPolaris(message.text);
    utterance.onend = utterance.onerror = () => setSpeakingId(current => (current === message.id ? null : current));
    setSpeakingId(message.id);
  }
  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel(); }, []);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Keep the newest message in view: jump to the bottom when Polaris opens, glide there when
  // a question, the typing dots, or an answer arrives. The question box growing also keeps the end visible.
  const logRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) { lastCount.current = 0; return; }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const arrived = lastCount.current > 0;
    lastCount.current = messages.length;
    log.scrollTo({ top: log.scrollHeight, behavior: arrived && !reduce ? "smooth" : "auto" });
  }, [messages, open]);
  // The question box grows with what you type or say (up to a cap, then scrolls), like Claude's.
  useLayoutEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
    box.scrollTop = box.scrollHeight;
    const log = logRef.current;
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 80) log.scrollTop = log.scrollHeight;
  }, [question, open]);
  const busy = messages.some(m => m.pending);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantVoiceRef = useRef(false);

  // Stop listening when the panel closes or the component unmounts.
  useEffect(() => {
    if (!open) { wantVoiceRef.current = false; recognitionRef.current?.stop(); if (canSpeak) window.speechSynthesis.cancel(); }
  }, [open]);
  useEffect(() => () => { wantVoiceRef.current = false; recognitionRef.current?.stop(); }, []);

  // Listening keeps going until you tap the mic again (or send, or close Polaris). Browsers end a
  // recognition session on their own after pauses or about a minute, so it quietly restarts.
  const committedVoiceRef = useRef(""); // finished words from earlier sessions in this recording

  /** Stop listening for good and drop any words still being processed (sending or starting over). */
  function haltVoice() {
    wantVoiceRef.current = false;
    recognitionRef.current?.abort();
  }

  /** The Voice Pill starts this: tap to talk, tap again to stop. Words appear in the text box as you speak. */
  function startVoice() {
    if (!SpeechRecognitionCtor) return;
    setVoiceError("");
    wantVoiceRef.current = true;
    committedVoiceRef.current = "";
    const before = question.trim();
    let quickEnds = 0; // sessions that die right away in a row: give up rather than loop

    const join = (...parts: string[]) => parts.map(p => p.trim()).filter(Boolean).join(" ");
    const session = () => {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = navigator.language || "en-US";
      recognition.interimResults = true;
      recognition.continuous = true;
      const startedAt = performance.now();
      let sessionFinal = "";
      recognition.onresult = event => {
        let finals = "";
        let interim = "";
        for (const result of Array.from(event.results)) {
          if (result.isFinal) finals += result[0].transcript;
          else interim += result[0].transcript;
        }
        sessionFinal = finals;
        quickEnds = 0;
        setQuestion(join(before, committedVoiceRef.current, finals, interim));
      };
      recognition.onerror = event => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          wantVoiceRef.current = false;
          setVoiceError("Allow microphone access in your browser to talk to Polaris.");
        } else if (event.error === "audio-capture") {
          wantVoiceRef.current = false;
          setVoiceError("No microphone found. Check that one is connected.");
        }
        // "no-speech", "network" and "aborted" are passing hiccups: onend restarts if we still want to listen.
      };
      recognition.onend = () => {
        committedVoiceRef.current = join(committedVoiceRef.current, sessionFinal);
        quickEnds = performance.now() - startedAt < 1000 ? quickEnds + 1 : 0;
        if (wantVoiceRef.current && quickEnds < 3) {
          try { session(); return; } catch { /* fall through and stop */ }
        }
        if (wantVoiceRef.current) setVoiceError("Voice input stopped. Tap the mic to keep going, or type your question.");
        wantVoiceRef.current = false;
        recognitionRef.current = null;
        setListening(false);
        inputRef.current?.focus();
      };
      recognitionRef.current = recognition;
      recognition.start();
    };

    try { session(); setListening(true); } catch {
      wantVoiceRef.current = false;
      setVoiceError("Voice input couldn’t start. Try again.");
    }
  }
  /** Mic button: tap to start, tap again to stop (your words stay in the box to edit). */
  function toggleVoice() {
    if (!listening) { startVoice(); return; }
    wantVoiceRef.current = false;
    recognitionRef.current?.stop();
  }

  function newChat() {
    stopSpeaking();
    haltVoice();
    setQuestion("");
    setMessages([welcome]);
    inputRef.current?.focus();
  }

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
    haltVoice();
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

  const avatarMood = busy ? "thinking" : mood?.mood ?? "idle";
  const mode = aiReady ? "AI answers from your NorthStar data" : "Private, on-device answers";
  return <>
    {open && <section id="money-assistant-panel" className="money-assistant-panel" role="dialog" aria-labelledby="money-assistant-title">
      <header className="money-assistant-header">
        <div className="money-assistant-identity"><PolarisAvatar size={40} mood={avatarMood} /><div><h2 id="money-assistant-title">Polaris</h2><p><Sparkles size={13} /> {mode}</p></div></div>
        <div className="money-assistant-header-actions">
          <button className="wealth-icon-button" aria-label="Start a new chat" title="New chat" onClick={newChat} disabled={busy || messages.length <= 1}><RotateCcw size={17} /></button>
          <button className="wealth-icon-button" aria-label="Close Polaris" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
      </header>
      {mood && <p className={`money-assistant-mood ${mood.mood}`}>{mood.text}</p>}
      <div ref={logRef} className="money-assistant-messages" role="log" aria-live="polite" aria-busy={busy}>
        {messages.map(message => {
          const bubble = message.pending
            ? <p className="money-assistant-message assistant typing" aria-label="Polaris is typing"><span className="money-assistant-dots" aria-hidden="true"><span /><span /><span /></span></p>
            : <div className={`money-assistant-message ${message.role}`}>
              {message.role === "assistant" ? <PolarisText text={message.text} animate={!shownAtOpen.has(message.id)} /> : message.text}
              {message.offline && <small className="money-assistant-offline">Answered on this device. The AI assistant was unavailable.</small>}
              {canSpeak && message.role === "assistant" && <button type="button" className={`money-assistant-speak${speakingId === message.id ? " speaking" : ""}`} aria-pressed={speakingId === message.id} aria-label={speakingId === message.id ? "Stop reading aloud" : "Read this answer aloud"} title={speakingId === message.id ? "Stop" : "Read aloud"} onClick={() => toggleSpeak(message)}>
                {speakingId === message.id ? <><Square size={11} fill="currentColor" aria-hidden="true" /> Stop</> : <><Volume2 size={14} aria-hidden="true" /> Listen</>}
              </button>}
            </div>;
          return message.role === "assistant"
            ? <div key={message.id} className="money-assistant-row"><PolarisAvatar size={28} mood={message.pending ? "thinking" : "idle"} className="money-assistant-row-avatar" />{bubble}</div>
            : <div key={message.id} className="money-assistant-row user">{bubble}</div>;
        })}
      </div>
      {messages.length === 1 && <div className="money-assistant-prompts">{prompts.map(prompt => <button key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>}
      <form className="money-assistant-form" onSubmit={event => { event.preventDefault(); ask(); }}>
        <textarea
          ref={inputRef}
          rows={1}
          aria-label="Ask Polaris about your finances"
          maxLength={500}
          value={question}
          onChange={event => setQuestion(event.target.value)}
          // Enter sends; Shift+Enter starts a new line (ignored mid-composition for IME typing).
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); } }}
          placeholder={listening ? "Listening…" : "Ask Polaris a question…"}
        />
        {SpeechRecognitionCtor && <MicLevelButton listening={listening} disabled={busy} onClick={toggleVoice} />}
        <button className="wealth-primary" aria-label="Send question" disabled={!question.trim() || busy}><Send size={17} /></button>
      </form>
      {voiceError && <p className="money-assistant-voice-error" role="alert">{voiceError}</p>}
    </section>}
    <div className={`money-assistant-dock${tucked ? " tucked" : ""}`}>
      <button className="money-assistant-tuck" aria-label={tucked ? "Show Polaris" : "Hide Polaris"} title={tucked ? "Show Polaris" : "Hide Polaris"} onClick={toggleTucked}>
        {tucked ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
      </button>
      <button className="money-assistant-launch" inert={tucked} aria-expanded={open} aria-controls="money-assistant-panel" onClick={() => setOpen(value => !value)}>
        {open ? <X size={20} /> : <PolarisAvatar size={28} mood={mood?.mood ?? "idle"} className="money-assistant-launch-avatar" />}<span>{open ? "Close Polaris" : "Ask Polaris"}</span>
      </button>
    </div>
  </>;
}
