import { describe, expect, it } from "vitest";
import { mapLiabilities, mapRecurring } from "./debt";
import { type BankAccount, type RecurringStream, billsFor, billsFromStreams } from "./money";

const NOW = new Date(2026, 10, 15);
const card: BankAccount = { id: "card", name: "Student Visa", mask: "1177", type: "credit", subtype: "credit card", current: 184.62, available: null, institution: "Campus Bank (test)" };

describe("mapLiabilities", () => {
  it("uses the purchase APR when a card has several", () => {
    const [debt] = mapLiabilities(
      { liabilities: { credit: [{ account_id: "card", minimum_payment_amount: 35, next_payment_due_date: "2026-11-28", is_overdue: false, last_statement_balance: 150, aprs: [{ apr_type: "cash_apr", apr_percentage: 29.9 }, { apr_type: "purchase_apr", apr_percentage: 21.5 }] }] } },
      [card],
    );
    expect(debt).toMatchObject({ kind: "credit", balance: 184.62, minimumPayment: 35, nextDueDate: "2026-11-28", apr: 21.5, name: "Student Visa", mask: "1177" });
  });
  it("keeps a card whose bank shared no APR, minimum, or due date", () => {
    const [debt] = mapLiabilities({ liabilities: { credit: [{ account_id: "card", minimum_payment_amount: null, next_payment_due_date: null, is_overdue: null, last_statement_balance: null, aprs: [] }] } }, [card]);
    expect(debt).toMatchObject({ apr: null, minimumPayment: null, nextDueDate: null, balance: 184.62 });
  });
  it("drops a liability that does not match any connected account", () => {
    expect(mapLiabilities({ liabilities: { student: [{ account_id: "gone", minimum_payment_amount: 50, next_payment_due_date: null, is_overdue: null, interest_rate_percentage: 5 }] } }, [card])).toEqual([]);
  });
});

const stream = (over: Record<string, unknown> = {}) => ({
  stream_id: "s1",
  account_id: "chk",
  description: "VERIZON WIRELESS",
  merchant_name: "Verizon",
  frequency: "MONTHLY",
  predicted_next_date: "2026-11-20",
  average_amount: { amount: 45 },
  last_amount: { amount: 45 },
  is_active: true,
  status: "MATURE",
  personal_finance_category: { primary: "RENT_AND_UTILITIES" },
  ...over,
});

describe("mapRecurring and bills from Plaid", () => {
  it("separates bills from paychecks and drops ended streams", () => {
    const streams = mapRecurring({
      outflow_streams: [stream(), stream({ stream_id: "old", status: "TOMBSTONED" })],
      inflow_streams: [stream({ stream_id: "pay", merchant_name: null, description: "PAYROLL", last_amount: { amount: -412.5 }, frequency: "BIWEEKLY" })],
    });
    expect(streams.map((s) => [s.id, s.direction, s.amount])).toEqual([["s1", "out", 45], ["pay", "in", 412.5]]);
  });
  it("shows only active, upcoming, non-transfer charges, soonest first", () => {
    const base: RecurringStream = { id: "a", accountId: "chk", name: "Spotify", amount: 6, direction: "out", frequency: "MONTHLY", nextDate: "2026-11-25", category: "ENTERTAINMENT", isActive: true };
    const bills = billsFromStreams(
      [
        base,
        { ...base, id: "b", name: "Verizon", nextDate: "2026-11-17" },
        { ...base, id: "c", name: "Paycheck", direction: "in" },
        { ...base, id: "d", name: "To savings", category: "TRANSFER_OUT" },
        { ...base, id: "e", name: "Cancelled", isActive: false },
        { ...base, id: "f", name: "Already passed", nextDate: "2026-11-01" },
      ],
      NOW,
    );
    expect(bills.map((b) => [b.name, b.daysUntil, b.source])).toEqual([["Verizon", 2, "plaid"], ["Spotify", 10, "plaid"]]);
  });
  it("falls back to the app's own estimate when Plaid has detected nothing yet", () => {
    const tx = [10, 40, 70].map((ago, i) => ({ id: `t${i}`, accountId: "chk", date: new Date(2026, 10, 15 - ago).toISOString().slice(0, 10), name: "Netflix", amount: 15.49, category: "ENTERTAINMENT", pending: false }));
    const [bill] = billsFor({ transactions: tx, recurring: [] }, new Set(), NOW);
    expect(bill).toMatchObject({ name: "Netflix", source: "estimated" });
  });
});
