// Money dashboard math, ported from the money-dashboard project so the numbers agree.
// Plaid convention: amount > 0 is money going out, amount < 0 is money coming in.

export interface BankAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string; // depository | credit | loan | investment | other
  subtype: string | null;
  current: number;
  available: number | null;
  institution: string;
  /** Credit limit, for cards, when the bank shares it. */
  limit?: number | null;
}

export interface BankTransaction {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  name: string;
  amount: number;
  category: string; // Plaid personal_finance_category.primary
  pending: boolean;
  /** Set when NorthStar classified a payment to or from a person or an unknown source (see classify.ts). */
  review?: TransactionReview;
  /** Plaid's detailed category ("TRANSPORTATION_GAS") and how sure Plaid is ("VERY_HIGH" … "LOW"). */
  detail?: string;
  confidence?: string;
  /** The bank's own description when it differs from the merchant name (may say "FUEL" or a pump number). */
  raw?: string;
  /** The merchant's logo (an https URL from Plaid) and website, when Plaid knows the merchant. */
  logo?: string;
  website?: string;
  /** Everyone Plaid saw in the charge: e.g. a marketplace ("DoorDash") and the merchant behind it. */
  counterparties?: { name: string; type: string }[];
  /** How NorthStar settled this category when Plaid's alone wasn't enough (see categorize.ts). */
  categorized?: { by: "you" | "bank text" | "Plaid" | "your answers" | "amount"; confirmed: boolean };
}

/** What a person-to-person or unknown-source payment really was. */
export type ReviewLabel = "earned" | "payback" | "family" | "own" | "spending" | "lent";
export interface TransactionReview {
  /** One question covers this key: a sender and direction ("keaton smith|in"), or a single transaction. */
  key: string;
  label: ReviewLabel;
  /** You answered; otherwise this is NorthStar's best guess. */
  confirmed: boolean;
}

export interface PortfolioHolding {
  id: string;
  accountId: string;
  name: string;
  ticker: string | null;
  quantity: number;
  price: number;
  value: number;
  currency: string | null;
  priceAsOf: string | null;
  institution: string;
  /** What was paid for the whole position, when the brokerage shares it. value − costBasis is the gain. */
  costBasis?: number | null;
  /** Cash sitting in the account (a money-market sweep), which has no gain or loss. */
  cash?: boolean;
}

/** A credit card or loan from Plaid Liabilities. Every field except the balance can be missing at a given bank. */
export interface DebtAccount {
  accountId: string;
  institution: string;
  name: string;
  mask: string | null;
  kind: "credit" | "student" | "mortgage" | "loan";
  balance: number;
  minimumPayment: number | null;
  nextDueDate: string | null; // YYYY-MM-DD
  /** Purchase APR for cards, the stated interest rate for loans. */
  apr: number | null;
  lastStatementBalance: number | null;
  isOverdue: boolean | null;
}

/** A repeating bill or paycheck that Plaid detected (Recurring Transactions). */
export interface RecurringStream {
  id: string;
  accountId: string;
  name: string;
  amount: number; // positive; use `direction` for which way the money moves
  direction: "out" | "in";
  frequency: "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "ANNUALLY" | "UNKNOWN";
  nextDate: string | null; // YYYY-MM-DD
  category: string;
  isActive: boolean;
}

export interface BankData {
  holdings?: PortfolioHolding[];
  /** Cards and loans with minimums, due dates and APRs. Empty when no connected bank has shared them. */
  debts?: DebtAccount[];
  /** Bills and paychecks Plaid detected. Empty until Plaid has enough history; the app then estimates bills itself. */
  recurring?: RecurringStream[];
  env: string;
  accounts: BankAccount[];
  transactions: BankTransaction[];
  /** Each connection's latest successful Plaid Transactions update, when available. */
  status: {
    itemId: string;
    institution: string;
    problem?: string;
    ready: boolean;
    lastUpdatedAt?: string | null;
    /** When the bank's permission for Plaid runs out (banks that sign you in on their own site); reconnect before then. */
    consentExpiresAt?: string | null;
    /** This connection was made before card and loan details were requested; reconnecting adds them. */
    needsDebtConsent?: boolean;
    /** The bank's logo (a PNG data URL) and brand color from Plaid, when Plaid has them. */
    logo?: string | null;
    color?: string | null;
  }[];
  fetchedAt: string;
  /** Payments NorthStar guessed at and wants you to confirm, most money first. */
  reviews?: ReviewQuestion[];
  /** Store charges that could be gas or food and nothing settled (see categorize.ts). */
  categoryQuestions?: CategoryQuestion[];
  /** When balances were last checked live with the banks (within 15 minutes), or null for Plaid's saved balances. */
  balancesCheckedAt?: string | null;
  /** One recorded whole-net-worth value per day, captured after a complete account load. */
  netWorthSnapshots?: NetWorthSnapshot[];
}

const LIABILITY = new Set(["credit", "loan"]);
export const isLiability = (a: BankAccount) => LIABILITY.has(a.type);

/** Assets minus what you owe. */
export function netWorth(accounts: BankAccount[]) {
  let assets = 0;
  let debts = 0;
  for (const a of accounts) {
    if (isLiability(a)) debts += a.current;
    else assets += a.current;
  }
  return { assets, debts, net: assets - debts };
}

/** Cash you could spend today: checking + savings (available balance when Plaid has it). */
export function spendableCash(accounts: BankAccount[]): number {
  return accounts
    .filter((a) => a.type === "depository" && (a.subtype === "checking" || a.subtype === "savings"))
    .reduce((s, a) => s + (a.available ?? a.current), 0);
}

export const ACCOUNT_GROUPS: { key: string; label: string; match: (a: BankAccount) => boolean }[] = [
  { key: "cash", label: "Cash", match: (a) => a.type === "depository" },
  { key: "invest", label: "Investments", match: (a) => a.type === "investment" || a.type === "brokerage" },
  { key: "credit", label: "Credit cards", match: (a) => a.type === "credit" },
  { key: "loan", label: "Loans", match: (a) => a.type === "loan" },
  { key: "other", label: "Other", match: (a) => !["depository", "investment", "brokerage", "credit", "loan"].includes(a.type) },
];

/**
 * Pairs of transactions on different accounts, opposite sign, same amount, within 3 days:
 * money moving between your own accounts, even when Plaid's category misses it.
 */
export function detectTransferIds(transactions: BankTransaction[]): Set<string> {
  // Only look at transactions Plaid hasn't already labeled as transfers or loan payments:
  // those are excluded anyway, and letting them pair could hide a real purchase of the same
  // amount nearby (e.g. a $50 grocery run two days after a $50 savings transfer).
  // Pending transactions can disappear or be replaced when they post. They do
  // not belong in historical transfer detection or spending calculations.
  const candidates = transactions.filter((t) => !t.pending && !t.category.startsWith("TRANSFER") && t.category !== "LOAN_PAYMENTS");
  const ids = new Set<string>();
  const buckets = new Map<string, BankTransaction[]>();
  for (const t of candidates) {
    const key = Math.abs(t.amount).toFixed(2);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }
  const daysApart = (a: BankTransaction, b: BankTransaction) => Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) / 86400000;
  for (const group of buckets.values()) {
    for (const a of group) {
      if (ids.has(a.id)) continue;
      // Pair with the closest-dated opposite transaction on another account, not just the first one found.
      let best: BankTransaction | null = null;
      for (const b of group) {
        if (b === a || ids.has(b.id) || a.accountId === b.accountId || Math.sign(a.amount) === Math.sign(b.amount)) continue;
        if (daysApart(a, b) > 3) continue;
        if (!best || daysApart(a, b) < daysApart(a, best)) best = b;
      }
      if (best) {
        ids.add(a.id);
        ids.add(best.id);
      }
    }
  }
  return ids;
}

const GENERIC_INSTITUTION_WORDS = new Set(["bank", "financial", "credit", "union", "trust", "national", "federal", "savings", "investments", "securities", "brokerage", "group", "company", "the", "of", "and"]);
/** Words in an institution's name that identify it in a transaction ("Charles Schwab" → schwab, charles). */
export const institutionWords = (institution: string) =>
  institution.replace(/ \(test\)$/, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC_INSTITUTION_WORDS.has(w));

const isLabeledTransfer = (t: BankTransaction) => t.category.startsWith("TRANSFER") || t.category === "LOAN_PAYMENTS";
const MOVE_WORDS = /\b(transfer|xfer|deposit|withdrawal|withdraw)\b/i;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a transaction's description names one of your other linked accounts: its last digits
 * ("XXXXXX2793", "Account ****2793") or another bank or brokerage you connected ("Wealthfront").
 * Your own institution's name doesn't count: banks print it on everything.
 */
export function namesAnotherAccount(t: BankTransaction, accounts: BankAccount[], only?: BankAccount): boolean {
  const own = accounts.find((a) => a.id === t.accountId);
  const text = t.name.toLowerCase();
  return (only ? [only] : accounts).some((a) => {
    if (a.id === t.accountId) return false;
    if (a.mask && /^\d{3,}$/.test(a.mask) && new RegExp(`(?:[x*•#.]{2,}\\s*|ending(?: in)?\\s+)${escapeRegExp(a.mask)}\\b`, "i").test(text)) return true;
    if (own && a.institution === own.institution) return false;
    return institutionWords(a.institution).some((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(text));
  });
}

/**
 * Relabels money moving between your own linked accounts as TRANSFER_IN / TRANSFER_OUT, so it never
 * counts as income or spending. Plaid often labels only one side as a transfer: a $300 move from
 * Wealthfront to Wells Fargo arrives at Wells as "Wealthfront", labeled INCOME, while Wealthfront
 * calls its side a transfer. Two rules, both limited to accounts you've connected:
 * 1. Paired: the same amount left one of your accounts (labeled as a transfer) and arrived in another
 *    within 3 days, and the description shows it's a move (transfer wording, or one side names the other account).
 * 2. One-sided: the description names another of your accounts (its last digits, or that bank or
 *    brokerage), and it's a deposit Plaid called income or reads as a transfer. Covers brokerages
 *    that don't report their side.
 * Everything else keeps Plaid's category; detectTransferIds still pairs unlabeled moves.
 */
export function markOwnTransfers(transactions: BankTransaction[], accounts: BankAccount[]): BankTransaction[] {
  if (accounts.length < 2) return transactions;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const relabel = new Set<string>();
  const used = new Set<string>();
  const posted = transactions.filter((t) => !t.pending && t.amount !== 0 && accountById.has(t.accountId));
  const buckets = new Map<string, BankTransaction[]>();
  for (const t of posted) {
    const key = Math.abs(t.amount).toFixed(2);
    buckets.set(key, [...(buckets.get(key) ?? []), t]);
  }
  const daysApart = (a: BankTransaction, b: BankTransaction) => Math.abs(Date.parse(a.date) - Date.parse(b.date)) / 86_400_000;
  const closest = (a: BankTransaction, group: BankTransaction[], ok: (b: BankTransaction) => boolean) => {
    let best: BankTransaction | null = null;
    for (const b of group) {
      if (b === a || used.has(b.id) || b.accountId === a.accountId || Math.sign(b.amount) === Math.sign(a.amount) || daysApart(a, b) > 3 || !ok(b)) continue;
      if (!best || daysApart(a, b) < daysApart(a, best)) best = b;
    }
    return best;
  };
  for (const group of buckets.values()) {
    // Transfers Plaid labeled on both sides pair with each other first, so they can't claim a
    // same-sized paycheck or refund on another account.
    for (const a of group) {
      if (used.has(a.id) || !isLabeledTransfer(a)) continue;
      const b = closest(a, group, isLabeledTransfer);
      if (b) { used.add(a.id); used.add(b.id); }
    }
    for (const a of group) {
      if (used.has(a.id) || isLabeledTransfer(a)) continue;
      const cardPayment = a.amount < 0 && ["credit", "loan"].includes(accountById.get(a.accountId)!.type) && /\bpayment\b/i.test(a.name);
      const b = closest(a, group, (b) =>
        isLabeledTransfer(b) &&
        (MOVE_WORDS.test(a.name) || cardPayment || namesAnotherAccount(a, accounts, accountById.get(b.accountId)) || namesAnotherAccount(b, accounts, accountById.get(a.accountId))));
      if (b) { used.add(a.id); used.add(b.id); relabel.add(a.id); }
    }
  }
  for (const t of transactions) {
    if (relabel.has(t.id) || isLabeledTransfer(t) || !accountById.has(t.accountId)) continue;
    const looksLikeMove = (t.amount < 0 && t.category === "INCOME") || MOVE_WORDS.test(t.name);
    if (looksLikeMove && namesAnotherAccount(t, accounts)) relabel.add(t.id);
  }
  if (!relabel.size) return transactions;
  return transactions.map((t) => (relabel.has(t.id) ? { ...t, category: t.amount > 0 ? "TRANSFER_OUT" : "TRANSFER_IN" } : t));
}

/** 529 college savings plans, by plan name or the number itself ("ScholarShare ACH DEPOSIT", "MY529", "NY 529 DIRECT"). */
const COLLEGE_SAVINGS = /\bscholar ?share\b|\bmy ?529\b|\b529\b|\bcollege ?(savings|advantage|invest|bound|choice|america)\b|\bbright ?start\b|\bnest ?529\b|\bunique ?college\b|\bpath2college\b/i;

/** Money from family (today: 529 college savings withdrawals). Counts as money in for cash flow, never as earned income. */
export const FAMILY_SUPPORT = "FAMILY_SUPPORT";
export const isFamilySupport = (t: Pick<BankTransaction, "category">) => t.category === FAMILY_SUPPORT;

/**
 * Money to or from a 529 college savings plan. A withdrawal (Plaid usually calls it INCOME) becomes
 * FAMILY_SUPPORT: it pays real bills like rent, so it counts toward cash flow, but it isn't pay, so
 * "how much did I make" and paycheck projections leave it out. A contribution is saving, not
 * spending, so it becomes a transfer. Card payments and transfers Plaid already labeled are left alone.
 */
export function markCollegeSavings(transactions: BankTransaction[]): BankTransaction[] {
  let changed = false;
  const result = transactions.map((t) => {
    if (isLabeledTransfer(t) || t.amount === 0 || !COLLEGE_SAVINGS.test(t.name)) return t;
    changed = true;
    return { ...t, category: t.amount > 0 ? "TRANSFER_OUT" : FAMILY_SUPPORT };
  });
  return changed ? result : transactions;
}

/** One question Polaris asks about a store charge that could be gas or food (see categorize.ts). */
export interface CategoryQuestion {
  /** "cat:<date>|<amount>|<merchant>": answers are saved per charge. */
  key: string;
  merchant: string;
  date: string;
  amount: number;
  guess: string;
  reason: string;
  choices: string[];
  /** "store": gas or food at a store that sells both. "uncertain": Plaid marked its category low-confidence. */
  kind?: "store" | "uncertain";
}

/** One question Polaris asks: what were these payments? */
export interface ReviewQuestion {
  key: string;
  direction: "in" | "out";
  /** Who sent or received it ("Keaton Smith"), or null for a deposit with no sender (mobile check). */
  person: string | null;
  /** Where it happened ("Venmo", "Zelle", "Mobile deposit", "Wells Fargo"). */
  via: string;
  guess: ReviewLabel;
  /** Why NorthStar guessed that ("the note says “Electric”"). */
  reason: string;
  count: number;
  total: number;
  lastDate: string;
  examples: { date: string; amount: number; note: string }[];
}

/**
 * What a non-transfer transaction does to your totals: money out is spending; money in is earned (Plaid's
 * INCOME: pay, interest), family support, or otherwise a refund or payback that reduces spending.
 */
export function moneyKind(t: Pick<BankTransaction, "amount" | "category">): "spent" | "earned" | "family" | "offset" {
  if (t.amount > 0) return "spent";
  if (t.category === "INCOME") return "earned";
  if (t.category === FAMILY_SUPPORT) return "family";
  return "offset";
}

export function isTransfer(t: BankTransaction, transferIds: Set<string>): boolean {
  return transferIds.has(t.id) || t.category.startsWith("TRANSFER") || t.category === "LOAN_PAYMENTS";
}

const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type FlowPeriod = "week" | "month";

/** Money in vs out for this week (Sunday start) or this month, plus the period before it. */
export function periodFlow(transactions: BankTransaction[], transferIds: Set<string>, period: FlowPeriod, now = new Date()) {
  const start =
    period === "week" ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()) : new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = period === "week" ? new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const s = localISO(start);
  const p = localISO(prevStart);
  const current = { in: 0, out: 0 };
  const previous = { in: 0, out: 0 };
  for (const t of transactions) {
    if (t.pending || t.date < p || isTransfer(t, transferIds)) continue;
    const bucket = t.date >= s ? current : previous;
    if (t.amount > 0) bucket.out += t.amount;
    else bucket.in += -t.amount;
  }
  return { current, previous };
}

/** Spending by category over the last `days` days, biggest first. */
export function topCategories(transactions: BankTransaction[], transferIds: Set<string>, days = 30, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const c = localISO(cutoff);
  const totals = new Map<string, number>();
  for (const t of transactions) {
    // Refunds and paybacks come off their category; earned money and family support aren't spending.
    if (t.pending || t.date < c || isTransfer(t, transferIds)) continue;
    const kind = moneyKind(t);
    if (kind !== "spent" && kind !== "offset") continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
  }
  const total = [...totals.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0) || 1;
  return [...totals.entries()]
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ key, label: categoryLabel(key), emoji: categoryEmoji(key), value, pct: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

export interface Bill {
  name: string;
  amount: number;
  cadence: string;
  nextDue: string; // YYYY-MM-DD
  daysUntil: number;
  /** "plaid" = detected by Plaid; "estimated" = this app's guess from past transactions. */
  source?: "plaid" | "estimated";
}

const FREQUENCY_LABEL: Record<RecurringStream["frequency"], string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  ANNUALLY: "Yearly",
  UNKNOWN: "Repeats",
};
export const frequencyLabel = (f: RecurringStream["frequency"]) => FREQUENCY_LABEL[f] ?? "Repeats";

/** How many times a month each cadence happens. An unknown "Repeats" counts as monthly. */
const PER_MONTH: Record<string, number> = { "Weekly": 52 / 12, "Every 2 weeks": 26 / 12, "Twice a month": 2, "Monthly": 1, "Yearly": 1 / 12, "Repeats": 1 };

/** What a set of bills costs per month, with weekly, every-2-weeks, and yearly bills converted to a monthly amount. */
export function monthlyBillTotal(bills: Pick<Bill, "amount" | "cadence">[]): number {
  return bills.reduce((sum, b) => sum + b.amount * (PER_MONTH[b.cadence] ?? 1), 0);
}

/** Active repeating charges from Plaid's detection, soonest first. Skips income and transfers between your accounts. */
export function billsFromStreams(streams: RecurringStream[], now = new Date()): Bill[] {
  const today = new Date(localISO(now)).getTime();
  const bills: Bill[] = [];
  for (const s of streams) {
    if (s.direction !== "out" || !s.isActive || !s.nextDate || s.category.startsWith("TRANSFER")) continue;
    const daysUntil = Math.round((new Date(s.nextDate).getTime() - today) / 86400000);
    if (Number.isNaN(daysUntil) || daysUntil < 0) continue;
    bills.push({ name: s.name, amount: s.amount, cadence: frequencyLabel(s.frequency), nextDue: s.nextDate, daysUntil, source: "plaid" });
  }
  return bills.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Plaid-detected bills when there are any, otherwise the app's own estimate from past transactions. */
export function billsFor(data: Pick<BankData, "transactions" | "recurring">, transferIds: Set<string>, now = new Date()): Bill[] {
  const detected = billsFromStreams(data.recurring ?? [], now);
  return detected.length ? detected : upcomingBills(data.transactions, transferIds, now);
}

// ---------- repeating charges and deposits ----------

export type Cadence = "Weekly" | "Every 2 weeks" | "Monthly";
/**
 * What counts as a schedule. Each needs several charges in a row at that spacing, so two lunches
 * a week apart or two moving-truck rentals months apart never look like a bill.
 * (Twice-a-month paychecks land 13 to 17 days apart, so they read as every 2 weeks.)
 */
const CADENCES: { cadence: Cadence; days: number; minGap: number; maxGap: number; minCount: number }[] = [
  { cadence: "Weekly", days: 7, minGap: 5, maxGap: 9, minCount: 4 },
  { cadence: "Every 2 weeks", days: 14, minGap: 11, maxGap: 17, minCount: 3 },
  { cadence: "Monthly", days: 30, minGap: 26, maxGap: 35, minCount: 3 },
];
/**
 * Everyday spending (restaurants, shopping, rides, travel, fun, personal care) only counts as a
 * bill when the price never changes, like a meal-plan or gym membership. A favorite taco spot doesn't.
 */
const EVERYDAY_CATEGORIES = new Set(["FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "TRANSPORTATION", "TRAVEL", "ENTERTAINMENT", "PERSONAL_CARE"]);
/** Rent, utilities and loan payments are bills by nature: two months in a row is enough. */
const BILL_CATEGORIES = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS"]);

export interface Repeating {
  name: string;
  amount: number;
  cadence: Cadence;
  everyDays: number;
  nextDate: string; // YYYY-MM-DD
  lastDate: string;
}

const dayMs = 86_400_000;
const isoDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const gapDays = (a: string, b: string) => Math.round((isoDay(b) - isoDay(a)) / dayMs);
const plusDays = (iso: string, days: number) => new Date(isoDay(iso) + days * dayMs).toISOString().slice(0, 10);
/** Same day next month, clamped to the month's last day (Jan 31 → Feb 28). */
function plusMonth(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * Charges (or deposits) from one merchant that are still happening on a steady schedule.
 * Rules, all required:
 *  - the latest run of charges is evenly spaced: at least 3 in a row monthly or every 2 weeks, 4 weekly
 *    (2 months in a row for rent, utilities and loan payments);
 *  - those charges cost about the same (within 20%), or exactly the same for everyday spending;
 *  - it's still active: the last one was no more than half a cycle overdue (Acorns stopping in June
 *    means no Acorns bill in November).
 */
export function findRepeating(transactions: BankTransaction[], direction: "out" | "in", today: string): Repeating[] {
  const byName = new Map<string, BankTransaction[]>();
  for (const t of transactions) {
    if (t.pending || (direction === "out" ? t.amount <= 0 : t.amount >= 0)) continue;
    // Family support (529 withdrawals) arrives when needed, not on a payday schedule.
    if (direction === "in" && isFamilySupport(t)) continue;
    byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
  }
  const found: Repeating[] = [];
  for (const [name, all] of byName) {
    const list = [...all].sort((a, b) => a.date.localeCompare(b.date));
    const last = list[list.length - 1];
    for (const rule of CADENCES) {
      // Walk back from the newest charge while the spacing fits this schedule.
      const run = [last];
      for (let i = list.length - 2; i >= 0; i--) {
        const gap = gapDays(list[i].date, run[0].date);
        if (gap < rule.minGap || gap > rule.maxGap) break;
        run.unshift(list[i]);
      }
      const needed = rule.cadence === "Monthly" && BILL_CATEGORIES.has(last.category) ? 2 : rule.minCount;
      if (run.length < needed) continue;
      const amounts = run.map((t) => Math.abs(t.amount));
      const avg = amounts.reduce((sum, v) => sum + v, 0) / amounts.length;
      const spread = Math.max(...amounts) - Math.min(...amounts);
      const fixedPrice = spread <= 0.02;
      if (EVERYDAY_CATEGORIES.has(last.category) ? !fixedPrice : spread / avg >= 0.2) continue;
      const overdue = gapDays(last.date, today) - rule.days;
      if (overdue > rule.days / 2) continue; // stopped
      const projected = rule.cadence === "Monthly" ? plusMonth(last.date) : plusDays(last.date, rule.days);
      // A little late (within the grace above): expect it any day now rather than skipping a cycle.
      const nextDate = projected < today ? today : projected;
      const recent = amounts.slice(-3);
      found.push({ name, amount: Math.round((recent.reduce((s, v) => s + v, 0) / recent.length) * 100) / 100, cadence: rule.cadence, everyDays: rule.days, nextDate, lastDate: last.date });
      break;
    }
  }
  return found.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

/** This app's estimate of upcoming bills from past transactions (used when Plaid hasn't detected any). */
export function upcomingBills(transactions: BankTransaction[], transferIds: Set<string>, now = new Date()): Bill[] {
  const today = localISO(now);
  const charges = transactions.filter((t) => !isTransfer(t, transferIds));
  return findRepeating(charges, "out", today).map((r) => ({
    name: r.name,
    amount: r.amount,
    cadence: r.cadence,
    nextDue: r.nextDate,
    daysUntil: gapDays(today, r.nextDate),
    source: "estimated" as const,
  }));
}

const CATEGORIES: Record<string, [string, string]> = {
  INCOME: ["Income", "💰"],
  FAMILY_SUPPORT: ["Family support", "🎓"],
  SHARED_COSTS: ["Shared costs", "🤝"],
  RENT_AND_UTILITIES: ["Rent & utilities", "🏠"],
  FOOD_AND_DRINK: ["Food & drink", "🍽️"],
  TRANSPORTATION: ["Transportation", "🚗"],
  TRAVEL: ["Travel", "✈️"],
  GENERAL_MERCHANDISE: ["Shopping", "🛍️"],
  PERSONAL_CARE: ["Personal care", "💆"],
  ENTERTAINMENT: ["Entertainment", "🎬"],
  MEDICAL: ["Health", "🩺"],
  GENERAL_SERVICES: ["Services", "🧾"],
  HOME_IMPROVEMENT: ["Home", "🔨"],
  GOVERNMENT_AND_NON_PROFIT: ["Gov & charity", "🏛️"],
  BANK_FEES: ["Bank fees", "🏦"],
  LOAN_PAYMENTS: ["Loan payments", "💳"],
  TRANSFER_IN: ["Transfer in", "↘️"],
  TRANSFER_OUT: ["Transfer out", "↗️"],
};

export function categoryLabel(key: string): string {
  return CATEGORIES[key]?.[0] ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ");
}
export function categoryEmoji(key: string): string {
  return CATEGORIES[key]?.[1] ?? "•";
}

export interface NetWorthPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** A point NorthStar recorded on the day, not a value reconstructed from transactions. */
export interface NetWorthSnapshot extends NetWorthPoint {
  capturedAt: string;
}

/**
 * Daily net worth for the last `days` days. Plaid only gives today's balances, so (like
 * money-dashboard) we walk backward from today, undoing each day's spending and income.
 * Transfers between your own accounts don't change net worth, so they're skipped.
 */
export function netWorthSeries(accounts: BankAccount[], transactions: BankTransaction[], days = 90, now = new Date()): NetWorthPoint[] {
  const transferIds = detectTransferIds(transactions);
  const dailyNet = new Map<string, number>();
  for (const t of transactions) {
    if (t.pending || isTransfer(t, transferIds)) continue;
    dailyNet.set(t.date, (dailyNet.get(t.date) ?? 0) - t.amount); // money in raises net worth
  }
  const points: NetWorthPoint[] = [];
  let running = netWorth(accounts).net;
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const date = localISO(d);
    points.push({ date, value: Math.round(running * 100) / 100 });
    running -= dailyNet.get(date) ?? 0;
  }
  return points.reverse();
}

/**
 * The chart's history: days NorthStar actually recorded win; before the first recorded day,
 * the estimate worked back from transactions fills in. (Using only recorded days would shrink
 * every period, from 1W to All, to however long NorthStar has been open.)
 */
export function mergeNetWorthHistory(estimated: NetWorthPoint[], recorded: NetWorthPoint[]): NetWorthPoint[] {
  const firstRecorded = recorded.reduce<string | null>((first, p) => (!first || p.date < first ? p.date : first), null);
  if (!firstRecorded) return estimated;
  const merged = [...estimated.filter((p) => p.date < firstRecorded), ...recorded.map(({ date, value }) => ({ date, value }))];
  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * One account's balance for each of the last `days` days, worked backward from today's balance
 * through its posted transactions. Transfers count here (they do move this account's balance).
 * Cards and loans give what's owed, which spending raises. Not for investments: their value
 * also moves with the market, which transactions don't show.
 */
export function accountBalanceSeries(account: BankAccount, transactions: BankTransaction[], days = 90, now = new Date()): NetWorthPoint[] {
  const owed = isLiability(account);
  const daily = new Map<string, number>();
  for (const t of transactions) {
    if (t.accountId !== account.id || t.pending) continue;
    daily.set(t.date, (daily.get(t.date) ?? 0) + t.amount);
  }
  const points: NetWorthPoint[] = [];
  let running = account.current;
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const date = localISO(d);
    points.push({ date, value: Math.round(running * 100) / 100 });
    const flow = daily.get(date) ?? 0; // > 0 is money out
    running = owed ? running - flow : running + flow; // undo this day's activity
  }
  return points.reverse();
}

export interface InstitutionSlice {
  name: string;
  kind: "Bank" | "Brokerage" | "Bank + investing";
  value: number;
  pct: number;
  accounts: number;
}

/** Your assets (not debts) split by bank or brokerage, biggest first. */
export function assetsByInstitution(accounts: BankAccount[]): InstitutionSlice[] {
  const map = new Map<string, { value: number; invest: boolean; bank: boolean; accounts: number }>();
  for (const a of accounts) {
    if (isLiability(a) || a.current <= 0) continue;
    const name = a.institution.replace(/ \(test\)$/, "");
    const e = map.get(name) ?? { value: 0, invest: false, bank: false, accounts: 0 };
    e.value += a.current;
    e.accounts += 1;
    if (a.type === "investment" || a.type === "brokerage") e.invest = true;
    else e.bank = true;
    map.set(name, e);
  }
  const total = [...map.values()].reduce((s, e) => s + e.value, 0) || 1;
  return [...map.entries()]
    .map(([name, e]) => ({
      name,
      kind: (e.invest && e.bank ? "Bank + investing" : e.invest ? "Brokerage" : "Bank") as InstitutionSlice["kind"],
      value: e.value,
      pct: (e.value / total) * 100,
      accounts: e.accounts,
    }))
    .sort((a, b) => b.value - a.value);
}

/** " · +$120 (+8.4%)" since bought, when the brokerage shares what was paid; "" otherwise (and for cash). */
export function gainText(h: Pick<PortfolioHolding, "value" | "costBasis" | "cash">): string {
  if (h.cash || typeof h.costBasis !== "number" || h.costBasis <= 0) return "";
  const gain = h.value - h.costBasis;
  const dollars = Math.abs(gain).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return ` · ${gain < 0 ? "−" : "+"}${dollars} (${gain < 0 ? "−" : "+"}${Math.abs((gain / h.costBasis) * 100).toFixed(1)}%)`;
}
