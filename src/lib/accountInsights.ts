import { institutionWords, type BankAccount, type BankTransaction, type PortfolioHolding } from "./money";

const DAY = 86_400_000;
const isoDaysAgo = (days: number, now: Date) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export interface AccountMove {
  fromId: string;
  toId: string;
  total: number;
  count: number;
  lastDate: string;
  /** "both": both sides seen. "name": one side only, named after the other institution (brokerages don't report deposits as transactions). */
  matchedBy: "both" | "name";
}

/** The account money most likely went to at an institution: its brokerage/investment account first. */
const mainAccount = (accounts: BankAccount[]) =>
  accounts.find((a) => a.type === "investment" && /brokerage|individual/i.test(`${a.subtype ?? ""} ${a.name}`)) ?? accounts.find((a) => a.type === "investment") ?? accounts[0];

/**
 * Money moved between your own connected accounts: a payment out of one account matched with the
 * same amount arriving in another within 3 days (checking → savings, checking → brokerage,
 * checking → card payment). Grouped by route, biggest first.
 */
export function movesBetweenAccounts(transactions: BankTransaction[], accounts: BankAccount[], days = 30, now = new Date()): AccountMove[] {
  const since = isoDaysAgo(days - 1, now);
  const known = new Set(accounts.map((a) => a.id));
  // Look a few days before the window too, so a transfer that posted on both sides near the start still pairs.
  const pool = transactions.filter((t) => !t.pending && known.has(t.accountId) && t.date >= isoDaysAgo(days + 3, now));
  const used = new Set<string>();
  const routes = new Map<string, AccountMove>();
  const outs = pool.filter((t) => t.amount > 0 && t.date >= since).sort((a, b) => b.date.localeCompare(a.date));
  for (const out of outs) {
    let best: BankTransaction | null = null;
    let bestGap = Infinity;
    for (const into of pool) {
      if (into.amount >= 0 || used.has(into.id) || into.accountId === out.accountId) continue;
      if (Math.abs(into.amount + out.amount) > 0.005) continue;
      const gap = Math.abs(Date.parse(into.date) - Date.parse(out.date)) / DAY;
      if (gap <= 3 && gap < bestGap) { best = into; bestGap = gap; }
    }
    if (!best) continue;
    used.add(best.id);
    used.add(out.id);
    const key = `${out.accountId}>${best.accountId}`;
    const route = routes.get(key) ?? { fromId: out.accountId, toId: best.accountId, total: 0, count: 0, lastDate: out.date, matchedBy: "both" as const };
    route.total = Math.round((route.total + out.amount) * 100) / 100;
    route.count += 1;
    if (out.date > route.lastDate) route.lastDate = out.date;
    routes.set(key, route);
  }
  // One-sided transfers: a brokerage like Robinhood or Fidelity sends balances but no transactions, so a
  // deposit only shows on the bank side, named after the brokerage ("Robinhood"). Count those too.
  const byInstitution = new Map<string, BankAccount[]>();
  for (const a of accounts) byInstitution.set(a.institution, [...(byInstitution.get(a.institution) ?? []), a]);
  const named = (t: BankTransaction, own: string) => {
    const text = t.name.toLowerCase();
    for (const [institution, list] of byInstitution) {
      if (institution === own) continue;
      if (institutionWords(institution).some((w) => new RegExp(`\\b${w}\\b`).test(text))) return mainAccount(list);
    }
    return null;
  };
  const ownInstitution = new Map(accounts.map((a) => [a.id, a.institution]));
  for (const t of pool) {
    if (used.has(t.id) || t.date < since || t.amount === 0) continue;
    // Must look like money moving (a transfer category, or deposit/withdrawal wording), not a purchase.
    const looksLikeTransfer = /^TRANSFER/.test(t.category) || t.category === "INCOME" || /transfer|deposit|withdraw/i.test(t.name);
    if (!looksLikeTransfer) continue;
    const other = named(t, ownInstitution.get(t.accountId) ?? "");
    if (!other) continue;
    const out = t.amount > 0;
    const fromId = out ? t.accountId : other.id;
    const toId = out ? other.id : t.accountId;
    const key = `${fromId}>${toId}`;
    const route = routes.get(key) ?? { fromId, toId, total: 0, count: 0, lastDate: t.date, matchedBy: "name" as const };
    route.total = Math.round((route.total + Math.abs(t.amount)) * 100) / 100;
    route.count += 1;
    if (t.date > route.lastDate) route.lastDate = t.date;
    routes.set(key, route);
  }
  return [...routes.values()].sort((a, b) => b.total - a.total);
}

export interface InterestAndFees {
  earned: number;
  interestPaid: number;
  fees: number;
  /** Per account, for the breakdown line. */
  byAccount: { accountId: string; earned: number; interestPaid: number; fees: number }[];
}

const INTEREST = /\binterest\b|\bint (?:pymt|payment|paid|earned)\b/i;
const FEE_NAME = /\bfees?\b|\boverdraft\b|\bnsf\b|\bservice charge\b|\bmaintenance charge\b/i;

export type InterestOrFee = "earned" | "charged" | "fee";

/** Whether a transaction is interest paid to you, interest charged to you, or a bank fee (Accounts' Interest & fees uses this). */
export function interestOrFee(t: Pick<BankTransaction, "name" | "amount" | "category">): InterestOrFee | null {
  const interest = INTEREST.test(t.name);
  if (interest && t.amount < 0) return "earned";
  if (interest && t.amount > 0) return "charged";
  if (t.amount > 0 && (t.category === "BANK_FEES" || FEE_NAME.test(t.name))) return "fee";
  return null;
}

/**
 * Interest your accounts paid you, interest you paid on cards and loans, and bank fees, over the
 * last `days` days. Found from transaction names and Plaid's BANK_FEES category, so it only
 * covers what the banks report as separate transactions.
 */
export function interestAndFees(transactions: BankTransaction[], days = 365, now = new Date()): InterestAndFees {
  const since = isoDaysAgo(days - 1, now);
  const per = new Map<string, { accountId: string; earned: number; interestPaid: number; fees: number }>();
  const row = (id: string) => per.get(id) ?? per.set(id, { accountId: id, earned: 0, interestPaid: 0, fees: 0 }).get(id)!;
  for (const t of transactions) {
    if (t.pending || t.date < since) continue;
    const kind = interestOrFee(t);
    if (kind === "earned") row(t.accountId).earned += -t.amount;
    else if (kind === "charged") row(t.accountId).interestPaid += t.amount;
    else if (kind === "fee") row(t.accountId).fees += t.amount;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const byAccount = [...per.values()].map((r) => ({ ...r, earned: round(r.earned), interestPaid: round(r.interestPaid), fees: round(r.fees) }))
    .filter((r) => r.earned || r.interestPaid || r.fees);
  const sum = (key: "earned" | "interestPaid" | "fees") => round(byAccount.reduce((s, r) => s + r[key], 0));
  return { earned: sum("earned"), interestPaid: sum("interestPaid"), fees: sum("fees"), byAccount };
}

export interface CombinedHolding {
  label: string;
  name: string;
  value: number;
  /** How many of your accounts hold it. */
  accounts: number;
}

export interface InvestmentsTogether {
  total: number;
  retirement: number;
  taxable: number;
  top: CombinedHolding[];
  /** Holdings beyond the top ones, combined. */
  otherValue: number;
  otherCount: number;
}

const RETIREMENT = /roth|ira|401|403|457|retirement|sep|simple/i;

/**
 * Your holdings across every connected brokerage, with the same fund in two accounts added together,
 * plus the split between retirement and taxable accounts. Values only; not advice.
 */
export function investmentsTogether(holdings: PortfolioHolding[], accounts: BankAccount[], top = 5): InvestmentsTogether {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const combined = new Map<string, { label: string; name: string; value: number; accounts: Set<string> }>();
  let retirement = 0;
  let taxable = 0;
  for (const h of holdings) {
    if (!accountById.has(h.accountId) || !(h.value > 0)) continue;
    const account = accountById.get(h.accountId)!;
    if (isRetirementAccount(account)) retirement += h.value;
    else taxable += h.value;
    const key = (h.ticker || h.name).trim().toUpperCase();
    const entry = combined.get(key) ?? { label: h.ticker || h.name, name: h.name, value: 0, accounts: new Set<string>() };
    entry.value += h.value;
    entry.accounts.add(h.accountId);
    combined.set(key, entry);
  }
  const all = [...combined.values()].sort((a, b) => b.value - a.value);
  const round = (n: number) => Math.round(n * 100) / 100;
  const rest = all.slice(top);
  return {
    total: round(retirement + taxable),
    retirement: round(retirement),
    taxable: round(taxable),
    top: all.slice(0, top).map((h) => ({ label: h.label, name: h.name, value: round(h.value), accounts: h.accounts.size })),
    otherValue: round(rest.reduce((s, h) => s + h.value, 0)),
    otherCount: rest.length,
  };
}

export const isRetirementAccount = (account: Pick<BankAccount, "subtype" | "name">) => RETIREMENT.test(`${account.subtype ?? ""} ${account.name}`);

export interface InvestmentAccountsSummary {
  /** Every investment account's balance, whether or not it shares holdings. */
  total: number;
  retirement: number;
  taxable: number;
  /** Investment accounts with a balance but no holdings from their institution (e.g. Fidelity through Plaid). */
  withoutHoldings: { id: string; name: string; institution: string; balance: number }[];
}

/** Totals from account balances, so accounts that don't share holdings still count. */
export function investmentAccountsSummary(accounts: BankAccount[], holdings: PortfolioHolding[]): InvestmentAccountsSummary {
  const investing = accounts.filter((a) => a.type === "investment" || a.type === "brokerage");
  const withHoldings = new Set(holdings.filter((h) => h.value > 0).map((h) => h.accountId));
  const round = (n: number) => Math.round(n * 100) / 100;
  let retirement = 0;
  let taxable = 0;
  for (const a of investing) {
    if (isRetirementAccount(a)) retirement += a.current;
    else taxable += a.current;
  }
  return {
    total: round(retirement + taxable),
    retirement: round(retirement),
    taxable: round(taxable),
    withoutHoldings: investing.filter((a) => a.current > 0 && !withHoldings.has(a.id)).map((a) => ({ id: a.id, name: a.name, institution: a.institution, balance: round(a.current) })),
  };
}

/** Money added to your investment accounts from your other accounts (and taken back out) over the last `days` days. */
export function investingFlow(transactions: BankTransaction[], accounts: BankAccount[], days = 30, now = new Date()): { added: number; withdrawn: number } {
  const invest = new Set(accounts.filter((a) => a.type === "investment" || a.type === "brokerage").map((a) => a.id));
  let added = 0, withdrawn = 0;
  for (const m of movesBetweenAccounts(transactions, accounts, days, now)) {
    if (invest.has(m.toId) && !invest.has(m.fromId)) added += m.total;
    else if (invest.has(m.fromId) && !invest.has(m.toId)) withdrawn += m.total;
  }
  return { added: Math.round(added * 100) / 100, withdrawn: Math.round(withdrawn * 100) / 100 };
}

/** The latest payment toward each card or loan in the last `days` days, from your other accounts: "Paid $1,993 on Oct 30". */
export function lastPayments(transactions: BankTransaction[], accounts: BankAccount[], days = 45, now = new Date()): Map<string, { amount: number; date: string }> {
  const owed = new Set(accounts.filter((a) => a.type === "credit" || a.type === "loan").map((a) => a.id));
  const since = isoDaysAgo(days - 1, now);
  const out = new Map<string, { amount: number; date: string }>();
  for (const t of transactions) {
    // A payment shows on the card as money in, labeled a payment or transfer (not a refund from a store).
    if (!owed.has(t.accountId) || t.pending || t.amount >= 0 || t.date < since) continue;
    if (!/^(TRANSFER_IN|LOAN_PAYMENTS)/.test(t.category) && !/\bpayment\b/i.test(t.name)) continue;
    const seen = out.get(t.accountId);
    if (!seen || t.date > seen.date) out.set(t.accountId, { amount: -t.amount, date: t.date });
  }
  return out;
}

export interface FeeAlert {
  accountId: string;
  kind: "charged" | "fee";
  total: number;
  count: number;
  lastDate: string;
}

/** Interest charged and bank fees in the last `days` days, one alert per account and kind. Empty when there were none. */
export function feeAlerts(transactions: BankTransaction[], days = 90, now = new Date()): FeeAlert[] {
  const since = isoDaysAgo(days - 1, now);
  const alerts = new Map<string, FeeAlert>();
  for (const t of transactions) {
    if (t.pending || t.date < since) continue;
    const kind = interestOrFee(t);
    if (kind !== "charged" && kind !== "fee") continue;
    const key = `${t.accountId}|${kind}`;
    const a = alerts.get(key) ?? { accountId: t.accountId, kind, total: 0, count: 0, lastDate: t.date };
    a.total = Math.round((a.total + t.amount) * 100) / 100;
    a.count += 1;
    if (t.date > a.lastDate) a.lastDate = t.date;
    alerts.set(key, a);
  }
  return [...alerts.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}
