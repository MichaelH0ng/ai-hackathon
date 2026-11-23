// What were payments to and from people really? Plaid labels nearly every Venmo, Zelle, and
// person-to-person bank transfer as a "transfer", which leaves it out of both spending and income.
// That hides real spending (gas money you sent a friend) and the roommates paying you back for
// utilities. This module gives each such payment a label: a best guess first, then your answer,
// which applies to everything from that person in that direction.
import { FAMILY_SUPPORT, namesAnotherAccount, type BankAccount, type BankTransaction, type ReviewLabel, type ReviewQuestion } from "./money.js";

/** Your answers: per sender and direction ("keaton smith|in"), and per single transaction. */
export interface ClassificationStore {
  senders: Record<string, ReviewLabel>;
  transactions: Record<string, ReviewLabel>;
  /** Your category for one store charge (gas vs. food at 7-Eleven), keyed by categoryKey. */
  categories?: Record<string, string>;
}
export const emptyStore = (): ClassificationStore => ({ senders: {}, transactions: {} });

export const IN_LABELS: ReviewLabel[] = ["payback", "earned", "family", "own"];
export const OUT_LABELS: ReviewLabel[] = ["spending", "lent", "own"];

interface Counterparty {
  kind: "person" | "deposit" | "cash" | "other";
  person: string | null;
  note: string;
  via: string;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "ANDRE DULDULAO" and "DULDULAO ANDRE" (Zelle prints both orders) are the same person. */
export const personKey = (name: string) =>
  name.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");

/** Who a payment was with, and the note on it, from the description each service prints. */
export function counterparty(t: Pick<BankTransaction, "name">, institution: string): Counterparty {
  const name = t.name;
  if (/venmo/i.test(institution)) {
    const m = /^(.+?)\s+"([\s\S]*)"\s*$/.exec(name);
    if (m) return { kind: "person", person: clean(m[1]), note: clean(m[2]), via: "Venmo" };
    return { kind: "other", person: null, note: "", via: "Venmo" };
  }
  const zelle = /\bZELLE (?:PAYMENT )?(FROM|TO)\s+(.+?)\s+ON \d{1,2}\/\d{1,2}\b(?:.*?\bREF\s*#\s*\S+)?\s*(.*)$/i.exec(name);
  if (zelle) return { kind: "person", person: titleCase(clean(zelle[2])), note: clean(zelle[3]), via: "Zelle" };
  const online = /\bONLINE TRANSFER (FROM|TO)\s+(.+?)\s+REF\s*#\s*\S+\s*(.*)$/i.exec(name);
  if (online) {
    const note = clean(online[3].replace(/\b(WELLS FARGO|EVERYDAY|PRIME|CLEAR ACCESS( BA(NKING)?)?|WAY2SAVE|PLATINUM|CHECKING|SAVINGS)\b/gi, " ").replace(/\bON \d{1,2}\/\d{1,2}\/\d{2,4}\b|X{3,}\d+/gi, " "));
    // "FROM HONG M PRIME CHECKING XXXXXX2777 REF #…": the account's name can sit between the person and the reference.
    const person = online[2].split(/\s+(?=(?:WELLS FARGO|EVERYDAY|PRIME|PLATINUM|WAY2SAVE|CLEAR ACCESS|CHECKING|SAVINGS|X{3,}\d+)\b)/i)[0];
    return { kind: "person", person: titleCase(clean(person)), note, via: institution || "Bank transfer" };
  }
  if (/\b(mobile deposit|e-?deposit|deposit in branch|branch deposit|check deposit|remote deposit)\b/i.test(name)) {
    return { kind: "deposit", person: null, note: "", via: /mobile/i.test(name) ? "Mobile check deposit" : "Deposit at a branch" };
  }
  if (/\bATM\b[\s\S]*\bwithdraw|\bcash withdrawal\b/i.test(name)) return { kind: "cash", person: null, note: "", via: "ATM cash" };
  return { kind: "other", person: null, note: "", via: institution || "Bank" };
}

/** A category from the note people type ("Electric", "🍕", "⛽"), for spending and paybacks. */
export function hintCategory(note: string): string | null {
  const n = note.toLowerCase();
  if (/\b(rent|utilit\w*|elect\w*|elec|ekectric|pg&?e|water|wifi|internet|gas bill|bills?|billz|trash)\b|🏠|💡/.test(n)) return "RENT_AND_UTILITIES";
  if (/⛽|🚗|\b(gas|uber|lyft|parking|ride|toll|train|bart|caltrain)\b/.test(n)) return "TRANSPORTATION";
  if (/[🍕🍔🌮🍣🍜🍱🍝🥡🍺🍻🍷☕🧋🍩🥯🍗🌯🍟]|\b(food|pizza+|pho|bbq|dinner|lunch|breakfast|brunch|boba|tea|coffee|drinks?|beer|groceries|grocery|costco|chipotle|in ?n ?out|sushi|ramen|tacos?|burgers?|wings|snacks?)\b/u.test(n)) return "FOOD_AND_DRINK";
  if (/\b(poker|buy ?in|tickets?|concert|movie|music|game|show|cover)\b|🎵|🎟|🎉/u.test(n)) return "ENTERTAINMENT";
  if (/\b(trip|hotel|airbnb|flight|yosemite|tahoe|vegas)\b|🌴|✈/u.test(n)) return "TRAVEL";
  return null;
}

const EARN_NOTE = /\b(pay|paycheck|salary|wages?|work|shift|tutor\w*|invoice|gig|job|commission|tips?)\b/i;
const LEND_NOTE = /\b(loan|lend|lent|borrow\w*|owe me|front(ed|ing)?)\b/i;

/** NorthStar's guess, before you answer, and the reason it shows you. */
export function guessLabel(t: Pick<BankTransaction, "amount">, c: Counterparty): { label: ReviewLabel; reason: string } {
  const into = t.amount < 0;
  const note = c.note ? `the note says “${c.note}”` : "";
  if (c.kind === "deposit") return { label: "own", reason: "a deposit with no sender, so it isn't counted until you say what it was" };
  if (c.kind === "cash") return { label: "spending", reason: "cash from an ATM usually gets spent" };
  if (c.kind === "other") return { label: "own", reason: `no ${into ? "sender" : "recipient"} named, so it isn't counted until you say what it was` };
  if (into) {
    if (EARN_NOTE.test(c.note)) return { label: "earned", reason: note };
    // A large payment from a person with no telling note is too big to guess at: leave it out until asked.
    if (Math.abs(t.amount) >= 300 && !hintCategory(c.note)) return { label: "own", reason: "a large payment with no note, so it isn't counted until you say what it was" };
    return { label: "payback", reason: note || "most money from friends is paying you back for something" };
  }
  if (LEND_NOTE.test(c.note)) return { label: "lent", reason: note };
  if (Math.abs(t.amount) >= 300 && !hintCategory(c.note)) return { label: "own", reason: "a large payment with no telling note, so it isn't counted until you say what it was" };
  return { label: "spending", reason: note || "money you send people usually pays for something" };
}

/** Where a label puts the transaction in the totals. */
function categoryFor(t: BankTransaction, label: ReviewLabel, c: Counterparty): string {
  const into = t.amount < 0;
  if (label === "earned") return "INCOME";
  if (label === "family") return FAMILY_SUPPORT;
  if (label === "own" || label === "lent") return into ? "TRANSFER_IN" : "TRANSFER_OUT";
  // Spending, or a payback that offsets spending: the note's category, then Plaid's, then shared costs.
  const plaid = /^(TRANSFER|INCOME|LOAN_PAYMENTS|FAMILY_SUPPORT)/.test(t.category) ? null : t.category;
  return hintCategory(c.note) ?? plaid ?? "SHARED_COSTS";
}

/** A transaction's identity across reconnects (Plaid issues new ids when a bank is linked again). */
export const fingerprint = (t: Pick<BankTransaction, "date" | "amount" | "name">, institution: string) =>
  `${institution}|${t.date}|${t.amount.toFixed(2)}|${t.name}`;

/**
 * Money between two of your own connected accounts: the description names your other account or
 * institution, or the matching opposite payment (same amount, other account, within 3 days) names this one.
 * Requiring a name keeps a $20 Venmo to a friend from pairing with an unrelated $20 Zelle you received.
 */
function ownMoves(transactions: BankTransaction[], accounts: BankAccount[]): Set<string> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const own = new Set<string>();
  const byAmount = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    if (t.pending || !byId.has(t.accountId)) continue;
    if (namesAnotherAccount(t, accounts)) own.add(t.id);
    const k = Math.abs(t.amount).toFixed(2);
    byAmount.set(k, [...(byAmount.get(k) ?? []), t]);
  }
  for (const group of byAmount.values()) {
    for (const a of group) {
      if (own.has(a.id)) continue;
      const mine = byId.get(a.accountId)!;
      const partner = group.find((b) => b.accountId !== a.accountId && Math.sign(b.amount) !== Math.sign(a.amount)
        && Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 3 * 86_400_000 && namesAnotherAccount(b, accounts, mine));
      if (partner) own.add(a.id);
    }
  }
  return own;
}

/**
 * Labels payments to and from people, deposits with no sender, and ATM cash: your answer if you
 * gave one (a single transaction first, then the sender), otherwise NorthStar's guess. Returns the
 * relabeled transactions and the questions still worth asking (last 180 days, most money first).
 */
export function classifyPayments(transactions: BankTransaction[], accounts: BankAccount[], store: ClassificationStore, today = new Date()): { transactions: BankTransaction[]; reviews: ReviewQuestion[] } {
  const institution = new Map(accounts.map((a) => [a.id, a.institution]));
  const own = ownMoves(transactions, accounts);
  const askSince = new Date(today.getTime() - 180 * 86_400_000).toISOString().slice(0, 10);
  // Your own name, learned from moves between your own accounts ("ONLINE TRANSFER TO HONG M … XXXXXX5881"):
  // money to or from it is your own, even to an account you haven't connected.
  const selfNames = new Set<string>();
  for (const t of transactions) {
    if (!own.has(t.id) || !institution.has(t.accountId)) continue;
    const c = counterparty(t, institution.get(t.accountId)!);
    if (c.person) selfNames.add(personKey(c.person));
  }
  // Round trips: the same person, the same amount out and back within 30 days (a mistake reversed,
  // money held for someone). Neither side is spending or income.
  const roundTrip = new Set<string>();
  const people = transactions.filter((t) => !own.has(t.id) && institution.has(t.accountId) && /^TRANSFER_(IN|OUT)$/.test(t.category))
    .map((t) => ({ t, person: counterparty(t, institution.get(t.accountId)!).person }))
    .filter((x): x is { t: BankTransaction; person: string } => !!x.person);
  for (const a of people) {
    if (roundTrip.has(a.t.id) || a.t.amount <= 0) continue;
    const back = people.find((b) => !roundTrip.has(b.t.id) && b.t.amount < 0 && Math.abs(b.t.amount + a.t.amount) < 0.005
      && personKey(b.person) === personKey(a.person) && Math.abs(Date.parse(b.t.date) - Date.parse(a.t.date)) <= 30 * 86_400_000);
    if (back) { roundTrip.add(a.t.id); roundTrip.add(back.t.id); }
  }
  const groups = new Map<string, { q: ReviewQuestion; guesses: Map<ReviewLabel, number> }>();
  const out = transactions.map((t) => {
    if (t.amount === 0 || own.has(t.id) || !institution.has(t.accountId)) return t;
    const c = counterparty(t, institution.get(t.accountId)!);
    // Plaid's transfer label on a person or unknown source; or "income" from a person, which is usually not pay.
    const reviewable = /^TRANSFER_(IN|OUT)$/.test(t.category) || (t.category === "INCOME" && c.kind === "person");
    if (!reviewable) return t;
    const direction = t.amount < 0 ? "in" : "out";
    const key = c.person ? `${personKey(c.person)}|${direction}` : `tx:${fingerprint(t, institution.get(t.accountId)!)}`;
    // A reversed payment cancels out whatever you usually say about that person
    // ("Dennis pays me back" shouldn't make a returned mistake count as a payback).
    // Only an answer about this exact payment overrides that.
    const answered = store.transactions[fingerprint(t, institution.get(t.accountId)!)] ?? (roundTrip.has(t.id) ? undefined : store.senders[key]);
    const guess = c.person && selfNames.has(personKey(c.person))
      ? { label: "own" as const, reason: "it's to or from your own name" }
      : roundTrip.has(t.id) ? { label: "own" as const, reason: "the same amount went back the other way, so it cancels out" } : guessLabel(t, c);
    // Your own name is never a question: it's your money either way. Nor is a round trip: the two sides
    // cancel out whatever they're called, so no answer could change a total (asking only repeated forever).
    const settled = guess.reason === "it's to or from your own name" || roundTrip.has(t.id);
    const label = answered ?? guess.label;
    if (!answered && !settled && !t.pending && t.date >= askSince) {
      const g = groups.get(key) ?? { q: { key, direction, person: c.person, via: c.via, guess: guess.label, reason: guess.reason, count: 0, total: 0, lastDate: t.date, examples: [] } as ReviewQuestion, guesses: new Map<ReviewLabel, number>() };
      g.q.count += 1;
      g.q.total = Math.round((g.q.total + Math.abs(t.amount)) * 100) / 100;
      if (t.date >= g.q.lastDate) { g.q.lastDate = t.date; }
      g.q.examples.push({ date: t.date, amount: Math.abs(t.amount), note: c.note });
      g.guesses.set(guess.label, (g.guesses.get(guess.label) ?? 0) + Math.abs(t.amount));
      groups.set(key, g);
    }
    return { ...t, category: categoryFor(t, label, c), review: { key, label, confirmed: !!answered || settled } };
  });
  const reviews = [...groups.values()].map(({ q, guesses }) => {
    // The guess shown is the one covering the most money; examples are the most recent three.
    const top = [...guesses].sort((a, b) => b[1] - a[1])[0][0];
    const notes = [...new Set(q.examples.map((e) => e.note).filter(Boolean))].slice(0, 3);
    const reason = top === q.guess ? q.reason : notes.length ? `the notes say ${notes.map((n) => `“${n}”`).join(", ")}` : q.reason;
    return { ...q, guess: top, reason, examples: q.examples.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3) };
  }).filter((q) => q.total >= 5).sort((a, b) => b.total - a.total);
  return { transactions: out, reviews };
}

/** Records an answer: for a sender it covers all their payments in that direction; a tx: key covers one transaction. */
export function recordAnswer(store: ClassificationStore, key: string, label: ReviewLabel): ClassificationStore {
  const direction = key.endsWith("|in") ? "in" : key.endsWith("|out") ? "out" : null;
  if (direction && !(direction === "in" ? IN_LABELS : OUT_LABELS).includes(label)) throw new Error("That answer doesn't fit this direction.");
  if (key.startsWith("tx:")) return { ...store, transactions: { ...store.transactions, [key.slice(3)]: label } };
  if (!direction) throw new Error("Unknown question.");
  return { ...store, senders: { ...store.senders, [key]: label } };
}
