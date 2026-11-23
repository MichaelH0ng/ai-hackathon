import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, RotateCcw, Send, Sparkles, Square, Undo2, Volume2, X } from "lucide-react";
import { PolarisAvatar } from "./PolarisAvatar";
import { MicLevelButton } from "./MicLevelButton";
import { PolarisText } from "./PolarisText";
import { maskMoneyText, useMoneyHidden } from "../lib/privacy";
import { polarisMood } from "../lib/polarisMood";
import { canSpeak, speak, stopPolarisSpeech } from "../lib/polarisVoice";
import { answerMoneyQuestion, type MoneyAssistantContext } from "../lib/moneyAssistant";
import { apply, check, describe, dueReminders, findGoal, money, parseAffordQuestion, parseCommand, WEEKDAYS, type ActionSummary, type Budget, type BudgetField, type Command, type PolarisAction, type Reminder, type Undo, type World } from "../lib/goalActions";
import { checkAffordability, type AffordResult } from "../lib/polarisAfford";
import { bestAlternative, fixVoiceText } from "../lib/voiceFix";
import { billHeadsUp, WHAT_CHANGED, weeklyCheckIn, whatChanged } from "../lib/polarisInsights";
import { requestPriceCheck } from "../lib/priceCheckRequest";
import { useReminders } from "../lib/polarisReminders";
import type { BankData, ReviewLabel } from "../lib/money";
import { PaymentQuestion, StoreQuestion } from "./PaymentQuestion";
import type { MoneyGoal } from "../lib/types";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  pending?: boolean;
  offline?: boolean; // answered on-device because the AI wasn't reachable
  // A change Polaris proposed. Nothing is saved until the user taps Confirm.
  action?: PolarisAction;
  actionSummary?: ActionSummary;
  actionState?: "proposed" | "done" | "cancelled" | "expired";
  // On the "Done!" message: how to reverse that change (only the latest change can be undone).
  undo?: Undo;
  undone?: boolean;
  // "Can I afford…?" answers carry the verdict for a small card.
  afford?: AffordResult;
  /** A purchase question: the item and price to open Check a purchase with. */
  checkItem?: { item: string; price: number };
  /** A planning or trade-off answer from Haiku: the question to rerun on Sonnet if the user asks. */
  deeperQuestion?: string;
  /** This answer came from Sonnet ("Get a deeper answer"). */
  deep?: boolean;
}

// Remembered per browser; storage can be unavailable (private mode), so every access is guarded.
const TUCK_KEY = "northstar:polaris-tucked";
const readTucked = () => { try { return localStorage.getItem(TUCK_KEY) === "1"; } catch { return false; } };

// Browser speech-to-text (Chrome, Edge, Safari). Not in TypeScript's DOM types, so typed minimally here.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
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
    // An unconfirmed change from an earlier visit may be out of date: ask again rather than apply it.
    // Undo only works in the visit that made the change. Older cards ({ before, after }) become one row.
    return valid.length ? valid.map(m => {
      const old = m.actionSummary as (ActionSummary & { before?: string; after?: string }) | undefined;
      const actionSummary = old && !old.rows ? { title: old.title, rows: [{ before: old.before ?? "", after: old.after ?? "" }], note: old.note } : old;
      return { ...m, actionSummary, undo: undefined, actionState: m.actionState === "proposed" ? "expired" as const : m.actionState };
    }) : [welcome];
  } catch { return [welcome]; }
}

// Starter chips: two show what Polaris can do for you, two are classic questions.
const MOOD_KEY = "northstar:polaris-mood-dismissed";

const prompts = ["Can I afford $80 shoes?", "What changed this month?", "Make a $500 trip goal by June", "How do I start investing?"];

// Weekly check-ins and bill heads-ups appear once each; these remember what was already shown.
const CHECKIN_KEY = "northstar:polaris-checkin-week";
const BILLS_SHOWN_KEY = "northstar:polaris-bills-shown";
const readShownBills = () => { try { const v = JSON.parse(localStorage.getItem(BILLS_SHOWN_KEY) ?? "[]"); return new Set<string>(Array.isArray(v) ? v : []); } catch { return new Set<string>(); } };

/** What the server's AI proposes (goal names, not ids); mapped to a PolarisAction here. */
interface AIAction {
  kind: PolarisAction["kind"];
  goalName?: string;
  /** For delete_goals: every goal to delete. */
  goalNames?: string[];
  toGoalName?: string;
  amount?: number;
  name?: string;
  target?: number;
  weekly?: number;
  deadline?: string;
  field?: BudgetField;
  weekday?: number;
}
interface AIReply {
  answer: string;
  action?: AIAction;
  /** The server suggests offering "Get a deeper answer" (planning and trade-off questions). */
  deeper?: boolean;
}

/** Asks the server's AI assistant. Throws on any failure so the caller can fall back. */
async function askAI(question: string, history: ChatMessage[], context: MoneyAssistantContext, deep = false): Promise<AIReply> {
  const res = await fetch("/api/financial-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      history: history.filter(m => m.id !== "welcome" && !m.pending && !m.offline).slice(-4).map(m => ({ role: m.role, content: m.text.slice(0, 2000) })),
      goals: context.goals.map(g => ({ kind: "money", ...g })),
      excludedAccountIds: context.excludedAccountIds ?? [],
      deep,
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
  return { answer: body.answer, action: body.action, deeper: body.deeper === true };
}

const PROPOSE_TEXT = "Here’s the change. Tap **Confirm** to save it.";

/** A chat reply proposing a change (with its card), or explaining why it can't be made. */
function proposal(world: World, command: Command, text = PROPOSE_TEXT): Pick<ChatMessage, "text" | "action" | "actionSummary" | "actionState"> {
  if (!command.ok) return { text: command.message };
  const checked = check(command.action, world);
  if (!checked.ok) return { text: checked.message };
  return { text, action: checked.action, actionSummary: describe(checked.action, world), actionState: "proposed" };
}

/** Turns the AI's proposal (which names goals) into an action on our goal ids. */
function fromAI(ai: AIAction, goals: MoneyGoal[]): Command {
  const goalNamed = (name?: string) => {
    if (!name) return null;
    const found = goals.find(g => !g.boughtAt && g.name.toLowerCase() === name.toLowerCase()) ?? findGoal(name, goals);
    return typeof found === "object" ? found : null;
  };
  const missing = (name?: string): Command => ({ ok: false, message: `I couldn’t find a goal called “${name ?? "that"}”. Which goal did you mean?` });
  const amount = ai.amount ?? 0;
  switch (ai.kind) {
    case "create_goal":
      return ai.name && (ai.target ?? amount) > 0 ? { ok: true, action: { kind: "create_goal", name: ai.name, target: ai.target ?? amount, weekly: ai.weekly ?? 0, deadline: ai.deadline } } : { ok: false, message: "What should the new goal be called, and how much is it for?" };
    case "set_budget":
      return ai.field ? { ok: true, action: { kind: "set_budget", field: ai.field, amount } } : { ok: false, message: "Which part of your budget should I change: income, essentials, or lifestyle?" };
    case "move": {
      const from = goalNamed(ai.goalName);
      const to = goalNamed(ai.toGoalName);
      if (!from) return missing(ai.goalName);
      if (!to) return missing(ai.toGoalName);
      return { ok: true, action: { kind: "move", goalId: from.id, toGoalId: to.id, amount } };
    }
    case "reminder": {
      const goal = goalNamed(ai.goalName);
      if (!goal) return missing(ai.goalName);
      return { ok: true, action: { kind: "reminder", goalId: goal.id, amount, weekday: ai.weekday ?? new Date().getDay() } };
    }
    case "delete_goals": {
      const names = ai.goalNames?.length ? ai.goalNames : ai.goalName ? [ai.goalName] : [];
      const found = names.map(goalNamed);
      const lost = names.find((_, i) => !found[i]);
      if (!names.length) return { ok: false, message: "Which goal should I delete?" };
      if (lost !== undefined) return missing(lost);
      return { ok: true, action: { kind: "delete_goals", goalIds: found.map(g => g!.id) } };
    }
    case "mark_bought": {
      const goal = goalNamed(ai.goalName);
      if (!goal) return missing(ai.goalName);
      return { ok: true, action: { kind: "mark_bought", goalId: goal.id, amount: amount || goal.target } };
    }
    default: {
      const goal = goalNamed(ai.goalName);
      if (!goal) return missing(ai.goalName);
      return { ok: true, action: { kind: ai.kind, goalId: goal.id, amount } };
    }
  }
}

const AFFORD_HEADLINE: Record<AffordResult["verdict"], string> = {
  covered: "Yes, your goal already covers it.",
  safe: "Yes, you can afford it.",
  tight: "You can, but it’ll be tight.",
  "not-yet": "Not yet.",
};

interface MoneyAssistantProps {
  context: MoneyAssistantContext;
  goals?: MoneyGoal[];
  budget?: Budget;
  /** Accounts and budget used by "Can I afford…?" (the same forecast as the Can I afford it? page). */
  plan?: { assets: { kind: string; balance: number }[]; essentials: number; lifestyle: number };
  bankData?: BankData | null;
  /** Live balances (unless checked in the last 15 minutes), for "can I afford…?" answers. */
  freshBankData?: () => Promise<BankData | null>;
  onUpdateGoal?: (goal: MoneyGoal) => void;
  onAddGoal?: (goal: MoneyGoal) => void;
  onRemoveGoal?: (id: string) => void;
  onUpdateBudget?: (patch: Partial<Budget>) => void;
  onOpenPriceCheck?: () => void;
  /** Reloads bank data after you answer a quick question about a payment, so totals use your answer. */
  onPaymentAnswered?: () => Promise<unknown>;
}

export function MoneyAssistant({ context, goals = [], budget = { income: 0, essentials: 0, lifestyle: 0 }, plan, bankData, freshBankData, onUpdateGoal, onAddGoal, onRemoveGoal, onUpdateBudget, onOpenPriceCheck, onPaymentAnswered }: MoneyAssistantProps) {
  useMoneyHidden(); // re-render when "Hide amounts" changes
  const canAct = !!(onUpdateGoal && onAddGoal && onRemoveGoal && onUpdateBudget);
  const world: World = { goals, budget };
  const [reminders, setReminders] = useReminders();
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
  // Names voice input should spell right: goals, accounts, and places you shop at often.
  const voiceNames = useMemo(() => {
    const recent = bankData?.transactions.filter(t => t.amount > 0).slice(0, 1500) ?? [];
    const counts = new Map<string, number>();
    for (const t of recent) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
    const merchants = [...counts].filter(([, count]) => count >= 2).sort(([, a], [, b]) => b - a).slice(0, 150).map(([name]) => name);
    return [...goals.map(g => g.name), ...(bankData?.accounts.map(a => a.name) ?? []), ...merchants];
  }, [goals, bankData]);
  const voiceNamesRef = useRef(voiceNames);
  useEffect(() => { voiceNamesRef.current = voiceNames; }, [voiceNames]);
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
  // The mood note can be answered or dismissed. A dismissed note stays hidden until it changes
  // (say the budget gap becomes a different amount, or another goal nears its target).
  const [dismissedNote, setDismissedNote] = useState(() => { try { return localStorage.getItem(MOOD_KEY) ?? ""; } catch { return ""; } });
  function dismissNote() {
    if (!mood) return;
    setDismissedNote(mood.text);
    try { localStorage.setItem(MOOD_KEY, mood.text); } catch { /* hidden for this visit only */ }
  }
  const showNote = !!mood && mood.text !== dismissedNote;
  // Messages already in the chat when the page loaded (saved history, the welcome) appear at once;
  // only new answers fade in word by word.
  const [shownAtOpen] = useState(() => new Set(messages.map(m => m.id)));

  // Read a reply out loud in the chosen voice (Michael's own voice, or a built-in one). Click again to stop.
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  function stopSpeaking() {
    stopPolarisSpeech();
    setSpeakingId(null);
  }
  function toggleSpeak(message: ChatMessage) {
    if (!canSpeak) return;
    if (speakingId === message.id) { stopSpeaking(); return; }
    setSpeakingId(message.id);
    setVoiceError("");
    const done = () => setSpeakingId(current => (current === message.id ? null : current));
    speak(message.text, { onEnd: done, onError: (error) => { done(); setVoiceError(error); } });
  }
  useEffect(() => () => stopPolarisSpeech(), []);

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
    if (!open) { wantVoiceRef.current = false; recognitionRef.current?.stop(); stopPolarisSpeech(); }
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
      // Several guesses per phrase: the one that mentions your own names wins.
      recognition.maxAlternatives = 3;
      const startedAt = performance.now();
      let sessionFinal = "";
      recognition.onresult = event => {
        let finals = "";
        let interim = "";
        for (const result of Array.from(event.results)) {
          if (result.isFinal) finals += bestAlternative(Array.from(result, alt => alt.transcript), voiceNamesRef.current);
          else interim += result[0].transcript;
        }
        sessionFinal = finals;
        quickEnds = 0;
        // Finished phrases are cleaned up (names, amounts); the words still coming in show as heard.
        setQuestion(join(before, fixVoiceText(join(committedVoiceRef.current, finals), voiceNamesRef.current), interim));
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
    const say = (reply: Partial<ChatMessage> & Pick<ChatMessage, "text">) =>
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", text }, { id: crypto.randomUUID(), role: "assistant", ...reply }]);
    // "Can I afford $80 shoes?": the same forecast as the Can I afford it? page, answered right here.
    const affordQ = plan ? parseAffordQuestion(text) : null;
    if (affordQ && plan) {
      // The answer depends on today's balance: check it live first (reused for 15 minutes).
      const replyId = crypto.randomUUID();
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", text }, { id: replyId, role: "assistant", text: "Checking your latest balance…", pending: true }]);
      const data = freshBankData ? await freshBankData().catch(() => bankData) : bankData;
      const result = checkAffordability(affordQ.item, affordQ.price, goals, data, plan);
      const checkItem = { item: affordQ.item, price: affordQ.price };
      const reply: Partial<ChatMessage> & Pick<ChatMessage, "text"> = result
        ? { text: `**${AFFORD_HEADLINE[result.verdict]}** ${result.sentence}`, afford: result, checkItem }
        : { text: "I can’t see a checking or savings balance yet, so I can’t say if it’s safe to spend. Check a purchase can still show what it does to your goals.", checkItem };
      setMessages(current => current.map(m => (m.id === replyId ? { ...m, ...reply, pending: false } : m)));
      return;
    }
    // "What changed this month?": computed here from your transactions, no AI needed.
    // It compares months; week questions ("more this week than last week?") go to Polaris, which compares weeks.
    if (WHAT_CHANGED.test(text) && !/\bweeks?\b/i.test(text) && bankData?.transactions.length) {
      say({ text: whatChanged(bankData) });
      return;
    }
    // "Add $20 to my car goal", "Make a laptop goal", "Move $100 from trip to car"…: understood on this
    // device, then confirmed before anything is saved.
    const command = canAct ? parseCommand(text, world) : null;
    if (command) {
      say(proposal(world, command));
      return;
    }
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
    let reply: Partial<ChatMessage> & Pick<ChatMessage, "text">;
    try {
      const ai = await askAI(text, history, context);
      if (ai.action && canAct) {
        // The AI names goals; match them to ours before showing the confirmation card.
        reply = proposal(world, fromAI(ai.action, goals), ai.answer || PROPOSE_TEXT);
      } else {
        reply = { text: ai.answer, ...(ai.deeper ? { deeperQuestion: text } : {}) };
      }
    } catch {
      // Network, key, or provider trouble: answer on-device rather than leave the user hanging.
      reply = { text: answerMoneyQuestion(text, context, history), offline: true };
    }
    setMessages(current => current.map(m => (m.id === replyId ? { ...m, ...reply, pending: false } : m)));
  }

  /** "Get a deeper answer": the same question again on Sonnet (about 2 cents), added below the first answer. */
  async function askDeeper(message: ChatMessage) {
    const question = message.deeperQuestion;
    if (!question || busy) return;
    const at = messages.findIndex(m => m.id === message.id);
    // The conversation as it was when the question was asked (before the question itself).
    const history = messages.slice(0, Math.max(0, at - 1));
    const replyId = crypto.randomUUID();
    setMessages(current => [
      ...current.map(m => (m.id === message.id ? { ...m, deeperQuestion: undefined } : m)),
      { id: replyId, role: "assistant", text: "Thinking…", pending: true },
    ]);
    let reply: Partial<ChatMessage> & Pick<ChatMessage, "text">;
    try {
      const ai = await askAI(question, history, context, true);
      reply = ai.action && canAct ? proposal(world, fromAI(ai.action, goals), ai.answer || PROPOSE_TEXT) : { text: ai.answer, deep: true };
    } catch {
      reply = { text: "I couldn’t get a deeper answer right now. Try again in a moment." };
      setMessages(current => current.map(m => (m.id === message.id ? { ...m, deeperQuestion: question } : m)));
    }
    setMessages(current => current.map(m => (m.id === replyId ? { ...m, ...reply, pending: false } : m)));
  }

  /** Saves everything a confirmed change does: goals, a new goal, budget lines, a reminder. */
  function commit(result: { updatedGoals: MoneyGoal[]; newGoal?: MoneyGoal; budget?: Partial<Budget>; reminder?: Reminder; removedGoalIds?: string[] }) {
    result.updatedGoals.forEach(g => onUpdateGoal?.(g));
    result.removedGoalIds?.forEach(id => onRemoveGoal?.(id));
    if (result.newGoal) onAddGoal?.(result.newGoal);
    if (result.budget) onUpdateBudget?.(result.budget);
    if (result.reminder) setReminders([...reminders, result.reminder]);
  }

  function confirmAction(message: ChatMessage) {
    if (!message.action || message.actionState !== "proposed" || !canAct) return;
    // Re-check against things as they are now, in case they changed since Polaris proposed this.
    const checked = check(message.action, world);
    if (!checked.ok) {
      setMessages(current => [
        ...current.map(m => (m.id === message.id ? { ...m, actionState: "expired" as const } : m)),
        { id: crypto.randomUUID(), role: "assistant", text: `${checked.message} Nothing was changed.` },
      ]);
      return;
    }
    const result = apply(checked.action, world);
    commit(result);
    // Only the newest change keeps its Undo button.
    setMessages(current => [
      ...current.map(m => (m.id === message.id ? { ...m, actionState: "done" as const } : m.undo ? { ...m, undo: undefined } : m)),
      { id: crypto.randomUUID(), role: "assistant", text: result.done, undo: result.undo },
    ]);
  }
  function cancelAction(message: ChatMessage) {
    setMessages(current => [
      ...current.map(m => (m.id === message.id ? { ...m, actionState: "cancelled" as const } : m)),
      { id: crypto.randomUUID(), role: "assistant", text: "No problem, I left it as it was." },
    ]);
  }
  function undoAction(message: ChatMessage) {
    const undo = message.undo;
    if (!undo || message.undone) return;
    undo.goals?.forEach(g => onUpdateGoal?.(g));
    if (undo.removeGoalId) onRemoveGoal?.(undo.removeGoalId);
    undo.restoreGoals?.forEach(g => onAddGoal?.(g));
    if (undo.budget) onUpdateBudget?.(undo.budget);
    if (undo.removeReminderId) setReminders(reminders.filter(r => r.id !== undo.removeReminderId));
    setMessages(current => [
      ...current.map(m => (m.id === message.id ? { ...m, undone: true, undo: undefined } : m)),
      { id: crypto.randomUUID(), role: "assistant", text: "Undone. Everything is back the way it was." },
    ]);
  }

  // Reminders due today show up once, as a ready-to-confirm card, the first time Polaris opens that day.
  const due = dueReminders(reminders).filter(r => goals.some(g => g.id === r.goalId && !g.boughtAt));
  useEffect(() => {
    if (!open || !due.length || !canAct) return;
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const cards: ChatMessage[] = due.map(r => {
      const goal = goals.find(g => g.id === r.goalId)!;
      const reply = proposal(world, { ok: true, action: { kind: "add", goalId: r.goalId, amount: r.amount } }, `It’s ${WEEKDAYS[today.getDay()]}! Here’s your reminder to add **${money(r.amount)}** to ${goal.name}. Tap **Confirm** once you’ve set it aside.`);
      return { id: crypto.randomUUID(), role: "assistant", ...reply };
    });
    setMessages(current => [...current, ...cards]);
    setReminders(reminders.map(r => (due.some(d => d.id === r.id) ? { ...r, lastShown: todayKey } : r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, due.length]);

  // A weekly check-in (once a week) and heads-ups for bills due in the next 3 days (once per bill),
  // added the first time Polaris opens. Computed on this device: no AI cost.
  const checkIn = useMemo(() => (bankData?.transactions.length ? weeklyCheckIn(bankData, goals) : null), [bankData, goals]);
  const [checkInShown, setCheckInShown] = useState(() => { try { return localStorage.getItem(CHECKIN_KEY) ?? ""; } catch { return ""; } });
  const [billsShown, setBillsShown] = useState(readShownBills);
  const heads = useMemo(() => (bankData ? billHeadsUp(bankData, billsShown) : null), [bankData, billsShown]);
  const freshCheckIn = checkIn && checkIn.key !== checkInShown ? checkIn : null;
  const hasNews = !!freshCheckIn || !!heads;
  useEffect(() => {
    if (!open || !hasNews) return;
    const cards: ChatMessage[] = [];
    if (freshCheckIn) {
      cards.push({ id: crypto.randomUUID(), role: "assistant", text: freshCheckIn.text });
      setCheckInShown(freshCheckIn.key);
      try { localStorage.setItem(CHECKIN_KEY, freshCheckIn.key); } catch { /* shown again next visit */ }
    }
    if (heads) {
      cards.push({ id: crypto.randomUUID(), role: "assistant", text: heads.text });
      const next = new Set([...billsShown, ...heads.keys]);
      setBillsShown(next);
      try { localStorage.setItem(BILLS_SHOWN_KEY, JSON.stringify([...next].slice(-60))); } catch { /* shown again next visit */ }
    }
    setMessages(current => [...current, ...cards]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasNews]);

  // Quick questions about payments with people (Venmo, Zelle, deposits with no sender), one at a time.
  // Answers save on the server; "Not sure" hides one for this visit.
  const [answeredKeys, setAnsweredKeys] = useState<Set<string>>(() => new Set());
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(() => new Set());
  const openQuestions = (bankData?.reviews ?? []).filter(q => !answeredKeys.has(q.key) && !skippedKeys.has(q.key));
  const paymentQuestion = openQuestions[0];
  // Then gas-or-snacks questions about store charges, once payments with people are answered.
  const openStoreQuestions = (bankData?.categoryQuestions ?? []).filter(q => !answeredKeys.has(q.key) && !skippedKeys.has(q.key));
  const storeQuestion = paymentQuestion ? undefined : openStoreQuestions[0];
  async function answerStore(key: string, category: string) {
    const res = await fetch("/api/plaid/categorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, category }) });
    if (!res.ok) throw new Error("save failed");
    setAnsweredKeys(current => new Set([...current, key]));
    void onPaymentAnswered?.();
  }
  async function answerPayment(key: string, label: ReviewLabel) {
    const res = await fetch("/api/plaid/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, label }) });
    if (!res.ok) throw new Error("save failed");
    setAnsweredKeys(current => new Set([...current, key]));
    void onPaymentAnswered?.();
  }

  const avatarMood = busy ? "thinking" : mood?.mood ?? "idle";
  return <>
    {open && <section id="money-assistant-panel" className="money-assistant-panel" role="dialog" aria-labelledby="money-assistant-title">
      <header className="money-assistant-header">
        <div className="money-assistant-identity"><PolarisAvatar size={40} mood={avatarMood} /><h2 id="money-assistant-title">Polaris</h2></div>
        <div className="money-assistant-header-actions">
          <button className="wealth-icon-button" aria-label="Start a new chat" title="New chat" onClick={newChat} disabled={busy || messages.length <= 1}><RotateCcw size={17} /></button>
          <button className="wealth-icon-button" aria-label="Close Polaris" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
      </header>
      {mood && showNote && <div className={`money-assistant-mood ${mood.mood}`}>
        <p>{maskMoneyText(mood.text)}</p>
        <div className="money-assistant-mood-actions">
          {mood.mood === "worried"
            ? <>
              <button type="button" className="money-assistant-mood-yes" disabled={busy} onClick={() => { dismissNote(); ask("Help me trim my monthly plan. Where could I cut back so my spending and goal savings fit my income?"); }}>Yes, help me</button>
              <button type="button" className="money-assistant-mood-no" onClick={dismissNote}>Not now</button>
            </>
            : <button type="button" className="money-assistant-mood-no" onClick={dismissNote}>Got it</button>}
        </div>
      </div>}
      <div ref={logRef} className="money-assistant-messages" role="log" aria-live="polite" aria-busy={busy}>
        {messages.map(message => {
          const bubble = message.pending
            ? <p className="money-assistant-message assistant typing" aria-label="Polaris is typing"><span className="money-assistant-dots" aria-hidden="true"><span /><span /><span /></span></p>
            : <div className={`money-assistant-message ${message.role}`}>
              {message.role === "assistant" ? <PolarisText text={message.text} animate={!shownAtOpen.has(message.id)} /> : maskMoneyText(message.text)}
              {message.actionSummary && <div className={`polaris-action ${message.actionState ?? "proposed"}`}>
                <strong className="polaris-action-title">{maskMoneyText(message.actionSummary.title)}</strong>
                {message.actionSummary.rows.map((row, i) => <span key={i} className="polaris-action-change">
                  {row.label && <span className="polaris-action-label">{row.label}</span>}
                  {row.before && <><span className="polaris-action-before">{maskMoneyText(row.before)}</span><span aria-hidden="true">→</span><span className="sr-only">becomes</span></>}
                  <strong>{maskMoneyText(row.after)}</strong>
                </span>)}
                {message.actionSummary.note && message.actionState === "proposed" && <small>{maskMoneyText(message.actionSummary.note)}</small>}
                {message.actionState === "proposed"
                  ? <span className="polaris-action-buttons">
                    <button type="button" className="wealth-primary" onClick={() => confirmAction(message)}><Check size={15} aria-hidden="true" /> Confirm</button>
                    <button type="button" className="polaris-action-cancel" onClick={() => cancelAction(message)}>Cancel</button>
                  </span>
                  : <span className="polaris-action-status">{message.actionState === "done" ? <><Check size={14} aria-hidden="true" /> Saved</> : message.actionState === "cancelled" ? "Cancelled" : "Expired. Ask again to make this change."}</span>}
              </div>}
              {message.afford && <div className={`polaris-afford ${message.afford.verdict}`}>
                <span className="polaris-afford-badge">{message.afford.verdict === "safe" || message.afford.verdict === "covered" ? "Safe" : message.afford.verdict === "tight" ? "Tight" : "Not yet"}</span>
                <span className="polaris-afford-item">{message.afford.item} · {maskMoneyText(money(message.afford.price))}</span>
                {message.afford.comfortableLimit !== undefined && message.afford.verdict !== "safe" && message.afford.comfortableLimit > 0 && <small>You could comfortably spend up to {maskMoneyText(money(Math.floor(message.afford.comfortableLimit)))} today.</small>}
              </div>}
              {message.checkItem && onOpenPriceCheck && <button type="button" className="polaris-afford-open" onClick={() => { requestPriceCheck(message.checkItem!); setOpen(false); onOpenPriceCheck(); }}>Open the full check for {message.checkItem.item} <ArrowRight size={14} aria-hidden="true" /></button>}
              {message.deep && <small className="polaris-deep-tag"><Sparkles size={12} aria-hidden="true" /> Deeper answer</small>}
              {message.deeperQuestion && aiReady && <button type="button" className="polaris-deeper" disabled={busy} onClick={() => { void askDeeper(message); }} title="Runs this question on a more capable model (about 2 cents)"><Sparkles size={14} aria-hidden="true" /> Get a deeper answer</button>}
              {message.undo && !message.undone && <button type="button" className="polaris-undo" onClick={() => undoAction(message)}><Undo2 size={14} aria-hidden="true" /> {maskMoneyText(message.undo.label)}</button>}
              {message.offline && <small className="money-assistant-offline">Answered on this device. The AI assistant was unavailable.</small>}
              {canSpeak && message.role === "assistant" && <button type="button" className={`money-assistant-speak${speakingId === message.id ? " speaking" : ""}`} aria-pressed={speakingId === message.id} aria-label={speakingId === message.id ? "Stop reading aloud" : "Read this answer aloud"} title={speakingId === message.id ? "Stop" : "Read aloud"} onClick={() => toggleSpeak(message)}>
                {speakingId === message.id ? <><Square size={11} fill="currentColor" aria-hidden="true" /> Stop</> : <><Volume2 size={14} aria-hidden="true" /> Listen</>}
              </button>}
            </div>;
          return message.role === "assistant"
            ? <div key={message.id} className="money-assistant-row"><PolarisAvatar size={28} mood={message.pending ? "thinking" : "idle"} className="money-assistant-row-avatar" />{bubble}</div>
            : <div key={message.id} className="money-assistant-row user">{bubble}</div>;
        })}
        {paymentQuestion && !busy && <div className="money-assistant-row"><PolarisAvatar size={28} mood="idle" className="money-assistant-row-avatar" /><div className="money-assistant-message assistant">
          <PaymentQuestion key={paymentQuestion.key} question={paymentQuestion} remaining={openQuestions.length}
            onAnswer={label => answerPayment(paymentQuestion.key, label)}
            onSkip={() => setSkippedKeys(current => new Set([...current, paymentQuestion.key]))} />
        </div></div>}
        {storeQuestion && !busy && <div className="money-assistant-row"><PolarisAvatar size={28} mood="idle" className="money-assistant-row-avatar" /><div className="money-assistant-message assistant">
          <StoreQuestion key={storeQuestion.key} question={storeQuestion} remaining={openStoreQuestions.length}
            onAnswer={category => answerStore(storeQuestion.key, category)}
            onSkip={() => setSkippedKeys(current => new Set([...current, storeQuestion.key]))} />
        </div></div>}
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
        {open ? <X size={20} /> : <PolarisAvatar size={28} mood={mood?.mood ?? "idle"} className="money-assistant-launch-avatar" />}<span>{open ? "Close Polaris" : "Ask Polaris"}</span>{!open && (hasNews || !!paymentQuestion || !!storeQuestion) && <span className="money-assistant-news" aria-label={hasNews ? "New check-in from Polaris" : "Polaris has a quick question about a payment"} />}
        {!open && due.length > 0 && <span className="money-assistant-dot" aria-label={`${due.length} savings reminder${due.length === 1 ? "" : "s"} today`} />}
      </button>
    </div>
  </>;
}
