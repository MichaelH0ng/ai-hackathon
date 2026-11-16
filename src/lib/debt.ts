// Turns Plaid Liabilities and Recurring Transactions responses into the app's own shapes.
// Pure functions so they can be tested without calling Plaid. Nearly every Plaid field here
// can be null at some banks, so each one is optional all the way through to the screen.
import type { BankAccount, DebtAccount, RecurringStream } from "./money.js";

interface Apr {
  apr_type: string;
  apr_percentage: number;
}
interface LiabilityBase {
  account_id: string | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
  is_overdue: boolean | null;
}
export interface LiabilitiesResponse {
  liabilities: {
    credit?: (LiabilityBase & { aprs: Apr[]; last_statement_balance: number | null })[] | null;
    student?: (LiabilityBase & { interest_rate_percentage: number | null })[] | null;
    mortgage?: (Pick<LiabilityBase, "account_id" | "next_payment_due_date"> & { next_monthly_payment: number | null; interest_rate?: { percentage: number | null } | null })[] | null;
    loan?: (Partial<LiabilityBase> & { account_id?: string | null; interest_rate_percentage?: number | null })[] | null;
  };
}

/** One entry per credit card or loan the bank shared, joined to the account it belongs to. */
export function mapLiabilities(response: LiabilitiesResponse, accounts: BankAccount[]): DebtAccount[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: DebtAccount[] = [];
  const add = (accountId: string | null | undefined, kind: DebtAccount["kind"], fields: Partial<DebtAccount>) => {
    const account = accountId ? byId.get(accountId) : undefined;
    if (!accountId || !account) return; // can't show a debt we can't tie to a balance
    out.push({
      accountId,
      institution: account.institution,
      name: account.name,
      mask: account.mask,
      kind,
      balance: account.current,
      minimumPayment: null,
      nextDueDate: null,
      apr: null,
      lastStatementBalance: null,
      isOverdue: null,
      ...fields,
    });
  };
  const { credit, student, mortgage, loan } = response.liabilities;
  for (const c of credit ?? []) {
    // A card can have several APRs (purchase, cash advance, balance transfer...): use the purchase rate.
    const purchase = c.aprs?.find((a) => a.apr_type === "purchase_apr");
    add(c.account_id, "credit", {
      minimumPayment: c.minimum_payment_amount,
      nextDueDate: c.next_payment_due_date,
      apr: purchase?.apr_percentage ?? null,
      lastStatementBalance: c.last_statement_balance,
      isOverdue: c.is_overdue,
    });
  }
  for (const s of student ?? []) {
    add(s.account_id, "student", { minimumPayment: s.minimum_payment_amount, nextDueDate: s.next_payment_due_date, apr: s.interest_rate_percentage, isOverdue: s.is_overdue });
  }
  for (const m of mortgage ?? []) {
    add(m.account_id, "mortgage", { minimumPayment: m.next_monthly_payment, nextDueDate: m.next_payment_due_date, apr: m.interest_rate?.percentage ?? null });
  }
  for (const l of loan ?? []) {
    add(l.account_id, "loan", { minimumPayment: l.minimum_payment_amount ?? null, nextDueDate: l.next_payment_due_date ?? null, apr: l.interest_rate_percentage ?? null, isOverdue: l.is_overdue ?? null });
  }
  return out;
}

interface Stream {
  stream_id: string;
  account_id: string;
  description: string;
  merchant_name: string | null;
  frequency: string;
  predicted_next_date?: string | null;
  average_amount: { amount?: number | null };
  last_amount: { amount?: number | null };
  is_active: boolean;
  status?: string;
  personal_finance_category?: { primary: string } | null;
}
export interface RecurringResponse {
  inflow_streams: Stream[];
  outflow_streams: Stream[];
}

const FREQUENCIES = new Set<RecurringStream["frequency"]>(["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY", "ANNUALLY"]);

/** Bills and paychecks Plaid detected. Streams Plaid has ended ("tombstoned") are dropped. */
export function mapRecurring(response: RecurringResponse): RecurringStream[] {
  const convert = (streams: Stream[], direction: RecurringStream["direction"]): RecurringStream[] =>
    (streams ?? [])
      .filter((s) => s.status !== "TOMBSTONED")
      .map((s) => ({
        id: s.stream_id,
        accountId: s.account_id,
        name: s.merchant_name || s.description || (direction === "in" ? "Deposit" : "Repeating charge"),
        // Plaid reports inflows as negative amounts; show everything as a positive number plus a direction.
        amount: Math.abs(s.last_amount?.amount ?? s.average_amount?.amount ?? 0),
        direction,
        frequency: FREQUENCIES.has(s.frequency as RecurringStream["frequency"]) ? (s.frequency as RecurringStream["frequency"]) : "UNKNOWN",
        nextDate: s.predicted_next_date ?? null,
        category: s.personal_finance_category?.primary ?? "OTHER",
        isActive: s.is_active,
      }));
  return [...convert(response.outflow_streams, "out"), ...convert(response.inflow_streams, "in")];
}
