// Gas or a snack? Some stores sell both (7-Eleven, Circle K, Chevron's mini-mart, Costco), and Plaid's
// merchant-level category can't always tell one visit from the next. This settles each charge from the
// strongest evidence available, and asks only when nothing settles it:
//   1. your answer about that charge
//   2. the bank's own text ("FUEL", "PUMP 04")
//   3. Plaid's detailed category, when Plaid is confident
//   4. your past answers at the same store ("snacks there are under $20, fill-ups over $40")
//   5. the amount: fill-ups are big, snacks are small. In between, Polaris asks once.
import type { BankTransaction, CategoryQuestion } from "./money.js";

export type { CategoryQuestion };

const GAS = "TRANSPORTATION";
const FOOD = "FOOD_AND_DRINK";
const SHOPPING = "GENERAL_MERCHANDISE";

/** Categories offered when asking about a charge at one of these stores. */
export const STORE_CHOICES = [GAS, FOOD, SHOPPING] as const;

/** Gas stations with a store, and convenience stores with pumps. */
const PUMP_AND_STORE = /\b(7[- ]?eleven|circle ?k|am ?pm|wawa|sheetz|quik ?trip|speedway|casey'?s|kwik|chevron|shell(?! beach)|arco|exxon\w*|mobil|valero|sunoco|marathon|love'?s|pilot|flying j|76|bp|gas ?n|fuel)\b/i;
/** Warehouse stores with a gas station: Plaid usually separates these well, so they're only refined on weak evidence. */
const WAREHOUSE = /\b(costco|sam'?s club|bj'?s wholesale)\b/i;
const FUEL_TEXT = /\b(fuel|gasoline|unleaded|diesel|pump ?#?\d*|gas station)\b/i;
const CONFIDENT = /^(VERY_HIGH|HIGH)$/;
/** A restaurant that merely shares a gas brand's name ("SHELL BEACH BREWHOUSE"). */
const EATERY_TEXT = /\b(brew(house|ery|ing)|cafe|grill|pizza|restaurant|taco|burger|kitchen|bistro|diner|eatery|tavern|pub)\b/i;
/** No one buys $3 of gas: a charge this small at a pump-and-store is the store. */
const TOO_SMALL_FOR_GAS = 5;

/** Fill-ups below this are rare; snacks above the upper bound are rare. Between them, ask. */
const SURELY_SNACK = 10;
const SURELY_GAS = 45;


export const categoryKey = (t: Pick<BankTransaction, "date" | "amount" | "name">) => `${t.date}|${t.amount.toFixed(2)}|${t.name}`;
const storeKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Decision = { category: string; by: NonNullable<BankTransaction["categorized"]>["by"]; confirmed: boolean; reason: string } | null;

/** What your earlier answers at this store say about this amount, if they settle it. */
function fromYourAnswers(amount: number, answered: { amount: number; category: string }[]): Decision {
  const gas = answered.filter((a) => a.category === GAS).map((a) => a.amount);
  const other = answered.filter((a) => a.category !== GAS);
  if (gas.length && amount >= Math.min(...gas)) return { category: GAS, by: "your answers", confirmed: false, reason: `you've said charges this size there were gas` };
  if (other.length) {
    const biggest = other.reduce((a, b) => (b.amount > a.amount ? b : a));
    if (amount <= biggest.amount) {
      const nearest = other.reduce((a, b) => (Math.abs(b.amount - amount) < Math.abs(a.amount - amount) ? b : a));
      return { category: nearest.category, by: "your answers", confirmed: false, reason: `you've said charges this size there weren't gas` };
    }
  }
  return null;
}

function decide(t: BankTransaction, warehouse: boolean, answers: Record<string, string>, history: { amount: number; category: string }[]): Decision {
  const yours = answers[categoryKey(t)];
  if (yours) return { category: yours, by: "you", confirmed: true, reason: "you said so" };
  if (t.raw && EATERY_TEXT.test(t.raw)) return { category: FOOD, by: "bank text", confirmed: true, reason: "the bank's description names a restaurant" };
  if (FUEL_TEXT.test(`${t.name} ${t.raw ?? ""}`) && t.amount >= TOO_SMALL_FOR_GAS) return { category: GAS, by: "bank text", confirmed: true, reason: "the description says fuel" };
  if (!warehouse && t.amount < TOO_SMALL_FOR_GAS) return { category: FOOD, by: "amount", confirmed: false, reason: "it's too small for gas" };
  if (t.detail && t.confidence && CONFIDENT.test(t.confidence)) {
    if (/^TRANSPORTATION_GAS/.test(t.detail)) return { category: GAS, by: "Plaid", confirmed: true, reason: "Plaid is confident it was gas" };
    if (/^FOOD_AND_DRINK/.test(t.detail)) return { category: FOOD, by: "Plaid", confirmed: true, reason: "Plaid is confident it was food" };
  }
  const learned = fromYourAnswers(t.amount, history);
  if (learned) return learned;
  // Costco and the like: Plaid already splits the gas station from the warehouse; keep its call.
  if (warehouse) return null;
  if (t.amount >= SURELY_GAS) return { category: GAS, by: "amount", confirmed: false, reason: "it's about the size of a fill-up" };
  if (t.amount < SURELY_SNACK) return { category: t.category === GAS ? FOOD : t.category, by: "amount", confirmed: false, reason: "it's too small for a fill-up" };
  return { category: t.category === SHOPPING ? FOOD : t.category, by: "amount", confirmed: false, reason: "it could be a small fill-up or snacks" };
}

/**
 * Settles gas vs. food vs. shopping at stores that sell more than one, and lists the charges still worth
 * asking about (recent, posted, and in the amount range where a guess could go either way).
 */
export function refineStoreCategories(transactions: BankTransaction[], answers: Record<string, string>, today = new Date()): { transactions: BankTransaction[]; questions: CategoryQuestion[] } {
  const askSince = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 180).toISOString().slice(0, 10);
  // Your answers at each store, for learning where its snacks end and fill-ups begin.
  const history = new Map<string, { amount: number; category: string }[]>();
  for (const t of transactions) {
    const answered = answers[categoryKey(t)];
    if (!answered) continue;
    const list = history.get(storeKey(t.name)) ?? [];
    list.push({ amount: t.amount, category: answered });
    history.set(storeKey(t.name), list);
  }
  const questions: CategoryQuestion[] = [];
  const out = transactions.map((t) => {
    if (t.amount <= 0 || t.category.startsWith("TRANSFER") || t.category === "LOAN_PAYMENTS" || t.review) return t;
    const warehouse = WAREHOUSE.test(t.name);
    if (!warehouse && !PUMP_AND_STORE.test(t.name)) return t;
    const decision = decide(t, warehouse, answers, history.get(storeKey(t.name)) ?? []);
    if (!decision) return t;
    const unclear = !decision.confirmed && decision.by === "amount" && t.amount >= SURELY_SNACK && t.amount < SURELY_GAS;
    if (unclear && !t.pending && t.date >= askSince) {
      questions.push({ key: `cat:${categoryKey(t)}`, merchant: t.name, date: t.date, amount: t.amount, guess: decision.category, reason: decision.reason, choices: [...STORE_CHOICES] });
    }
    return { ...t, category: decision.category, categorized: { by: decision.by, confirmed: decision.confirmed } };
  });
  return { transactions: out, questions: questions.sort((a, b) => b.date.localeCompare(a.date)) };
}

/** Every spending category a charge can be moved to, in Plaid's words. */
export const SPENDING_CATEGORIES = [
  "FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "ENTERTAINMENT", "TRANSPORTATION", "TRAVEL", "PERSONAL_CARE", "MEDICAL",
  "GENERAL_SERVICES", "RENT_AND_UTILITIES", "HOME_IMPROVEMENT", "GOVERNMENT_AND_NON_PROFIT",
] as const;

/** Charges this big or bigger are worth a question when Plaid isn't sure; smaller ones barely move a total. */
const WORTH_ASKING = 40;
/** A payment to a person with your own note ('Joaquin Boyd "Utilities"'): Plaid filed it from your words. */
const YOUR_NOTE = /"[^"]*"\s*$/;

/**
 * Plaid marks how sure it is of each category. For the charges it's least sure of (LOW), your answer
 * replaces its guess, and the big recent ones that nothing else settled become quick questions.
 */
export function refineUncertainCategories(transactions: BankTransaction[], answers: Record<string, string>, today = new Date()): { transactions: BankTransaction[]; questions: CategoryQuestion[] } {
  const askSince = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 180).toISOString().slice(0, 10);
  const questions: CategoryQuestion[] = [];
  const out = transactions.map((t) => {
    if (t.amount <= 0 || t.review || t.categorized || /^(TRANSFER|LOAN_PAYMENTS|INCOME|BANK_FEES)/.test(t.category)) return t;
    const yours = answers[categoryKey(t)];
    if (yours) return { ...t, category: yours, categorized: { by: "you" as const, confirmed: true } };
    const obvious = t.category === FOOD && EATERY_TEXT.test(`${t.name} ${t.raw ?? ""}`);
    if (t.confidence === "LOW" && !obvious && !YOUR_NOTE.test(t.name) && t.amount >= WORTH_ASKING && !t.pending && t.date >= askSince) {
      questions.push({ key: `cat:${categoryKey(t)}`, merchant: t.name, date: t.date, amount: t.amount, guess: t.category, reason: "Plaid wasn't sure about this one", choices: [...SPENDING_CATEGORIES], kind: "uncertain" });
    }
    return t;
  });
  return { transactions: out, questions: questions.sort((a, b) => b.amount - a.amount) };
}
