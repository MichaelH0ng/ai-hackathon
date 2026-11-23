import { describe, expect, it } from "vitest";
import { classifyPayments, counterparty, emptyStore, fingerprint, guessLabel, hintCategory, personKey, recordAnswer } from "./classify";
import { type BankAccount, type BankTransaction } from "./money";

const acct = (p: Partial<BankAccount>): BankAccount => ({ id: "a", name: "A", mask: null, type: "depository", subtype: "checking", current: 0, available: null, institution: "Bank", ...p });
const wells = acct({ id: "wf", name: "Everyday Checking", mask: "2793", institution: "Wells Fargo" });
const wells2 = acct({ id: "wf2", name: "Everyday Checking", mask: "5881", institution: "Wells Fargo" });
const venmo = acct({ id: "vm", name: "Personal Profile", mask: null, institution: "Venmo - Personal" });
const wealthfront = acct({ id: "wfc", name: "Cash", mask: "4410", subtype: "savings", institution: "Wealthfront" });
const accounts = [wells, wells2, venmo, wealthfront];
let n = 0;
const tx = (p: Partial<BankTransaction>): BankTransaction => ({ id: `t${n++}`, accountId: "vm", date: "2026-10-12", name: "X", amount: 10, category: "TRANSFER_OUT", pending: false, ...p });
const NOW = new Date(2026, 10, 15);
const run = (list: BankTransaction[], store = emptyStore()) => classifyPayments(list, accounts, store, NOW);
const byId = (list: BankTransaction[], id: string) => list.find((t) => t.id === id)!;

describe("reading who a payment was with", () => {
  it("parses Venmo, Zelle (either name order), bank transfers, deposits, and ATM cash", () => {
    expect(counterparty({ name: 'Joaquin Boyd "Ekectric"' }, "Venmo - Personal")).toMatchObject({ kind: "person", person: "Joaquin Boyd", note: "Ekectric", via: "Venmo" });
    expect(counterparty({ name: "ZELLE FROM ANDRE DULDULAO ON 10/10 REF # JPM99CZHHTQE ELECT" }, "Wells Fargo")).toMatchObject({ person: "Andre Duldulao", note: "ELECT", via: "Zelle" });
    expect(personKey("Duldulao Andre")).toBe(personKey("Andre Duldulao"));
    expect(counterparty({ name: "ONLINE TRANSFER FROM CABALLERO C REF #IB0RKJPC2P EVERYDAY CHECKING MICHAEL SPRING QTR PAYMENT" }, "Wells Fargo")).toMatchObject({ person: "Caballero C", note: "MICHAEL SPRING QTR PAYMENT" });
    expect(counterparty({ name: "MOBILE DEPOSIT : REF NUMBER :912140003761" }, "Wells Fargo")).toMatchObject({ kind: "deposit", person: null });
    expect(counterparty({ name: "eDeposit in Branch 09/15/26 03:48:36 PM 665 MARSH ST" }, "Wells Fargo").kind).toBe("deposit");
    expect(counterparty({ name: "ATM WITHDRAWAL AUTHORIZED ON 09/15 665 Marsh St" }, "Wells Fargo").kind).toBe("cash");
  });
  it("reads a category from the note", () => {
    expect(hintCategory("Electric")).toBe("RENT_AND_UTILITIES");
    expect(hintCategory("Billz")).toBe("RENT_AND_UTILITIES");
    expect(hintCategory("ELECT")).toBe("RENT_AND_UTILITIES");
    expect(hintCategory("🏠")).toBe("RENT_AND_UTILITIES");
    expect(hintCategory("⛽ both ways")).toBe("TRANSPORTATION");
    expect(hintCategory("PIZZAAAAAA")).toBe("FOOD_AND_DRINK");
    expect(hintCategory("🍕")).toBe("FOOD_AND_DRINK");
    expect(hintCategory("Dayge")).toBeNull();
  });
});

describe("guesses before you answer", () => {
  const person = (note: string) => ({ kind: "person" as const, person: "Keaton Smith", note, via: "Venmo" });
  it("money from friends is a payback; money to them is spending; pay is earned", () => {
    expect(guessLabel({ amount: -15.1 }, person("Rent")).label).toBe("payback");
    expect(guessLabel({ amount: 22 }, person("Cash")).label).toBe("spending");
    expect(guessLabel({ amount: -60 }, person("tutoring")).label).toBe("earned");
    expect(guessLabel({ amount: 50 }, person("loan till friday")).label).toBe("lent");
  });
  it("won't guess at big unexplained amounts or deposits with no sender: left out until answered", () => {
    expect(guessLabel({ amount: -4360 }, person("")).label).toBe("own");
    expect(guessLabel({ amount: 4360 }, person("DENNIS SPEND JULY")).label).toBe("own");
    expect(guessLabel({ amount: -325.45 }, { kind: "deposit", person: null, note: "", via: "Mobile check deposit" }).label).toBe("own");
  });
});

describe("classifyPayments", () => {
  it("labels roommates' paybacks so they reduce that category, and asks once per person", () => {
    const a = tx({ amount: -45.45, category: "TRANSFER_IN", name: 'Joaquin Boyd "Electric"', date: "2026-09-20" });
    const b = tx({ amount: -38.2, category: "TRANSFER_IN", name: 'Joaquin Boyd "Ekectric"' });
    const { transactions, reviews } = run([a, b]);
    expect(byId(transactions, a.id)).toMatchObject({ category: "RENT_AND_UTILITIES", review: { label: "payback", confirmed: false } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ key: "boyd joaquin|in", count: 2, total: 83.65, guess: "payback", person: "Joaquin Boyd" });
  });
  it("never asks about moves between your own accounts (Wells ↔ Venmo cash-outs, Wealthfront)", () => {
    const cashOut = tx({ accountId: "wf", amount: -2409.23, category: "TRANSFER_IN", name: "Venmo" });
    const venmoSide = tx({ accountId: "vm", amount: 2409.23, category: "TRANSFER_OUT", name: "Standard transfer" });
    const wealth = tx({ accountId: "wfc", amount: 300, category: "TRANSFER_OUT", name: "Wells Fargo (Account ****2793) Withdrawal" });
    const { transactions, reviews } = run([cashOut, venmoSide, wealth]);
    expect(transactions.every((t) => !t.review)).toBe(true);
    expect(reviews).toHaveLength(0);
  });
  it("doesn't mistake a friend's $20 for an own-account move just because the amounts match", () => {
    const toFriend = tx({ amount: 20, category: "TRANSFER_OUT", name: 'Jose Quinteros "Pizza"' });
    const zelleIn = tx({ accountId: "wf", amount: -20, category: "TRANSFER_IN", name: "ZELLE FROM CHUNG TYLER ON 09/27 REF # WFCT22PT8HHC" });
    const { transactions } = run([toFriend, zelleIn]);
    expect(byId(transactions, toFriend.id).review?.label).toBe("spending");
    expect(byId(transactions, zelleIn.id).review?.label).toBe("payback");
  });
  it("learns your own name from own-account moves and never asks about it", () => {
    const own = tx({ accountId: "wf", amount: 500, category: "TRANSFER_OUT", name: "ONLINE TRANSFER TO HONG M EVERYDAY CHECKING XXXXXX5881 REF #IB03GBP8J7 ON 09/30/26" });
    const unlinked = tx({ accountId: "wf", amount: -250, category: "TRANSFER_IN", name: "ONLINE TRANSFER FROM HONG M PRIME CHECKING XXXXXX2777 REF #IB0XL3ZYT4 ON 04/07/26" });
    const { transactions, reviews } = run([own, unlinked]);
    expect(byId(transactions, unlinked.id)).toMatchObject({ category: "TRANSFER_IN", review: { label: "own" } });
    expect(reviews).toHaveLength(0);
  });
  it("treats a reversed transfer as a wash on both sides", () => {
    const out = tx({ accountId: "wf2", date: "2026-08-10", amount: 4360, category: "TRANSFER_OUT", name: "ONLINE TRANSFER TO HONG D REF #IB0Z99HD3V EVERYDAY CHECKING DENNIS SPEND JULY 2026" });
    const back = tx({ accountId: "wf2", date: "2026-08-17", amount: -4360, category: "TRANSFER_IN", name: "ONLINE TRANSFER FROM HONG D REF #IB0ZDSCNR3 EVERYDAY CHECKING REVERSING AUG 10 TRANSFER MISTAKE" });
    const { transactions } = run([out, back]);
    expect([byId(transactions, out.id).category, byId(transactions, back.id).category]).toEqual(["TRANSFER_OUT", "TRANSFER_IN"]);
    // even after you've said this person usually pays you back
    let store = recordAnswer(emptyStore(), "d hong|in", "payback");
    store = recordAnswer(store, "d hong|out", "own");
    const answered = run([out, back], store).transactions;
    expect(byId(answered, back.id).category).toBe("TRANSFER_IN");
  });
  it("never asks about a round trip: the two sides cancel out whatever they're called", () => {
    const out = tx({ accountId: "vm", date: "2026-06-13", amount: 15, category: "TRANSFER_OUT", name: 'tyler chung "♠️"' });
    const back = tx({ accountId: "wf", date: "2026-07-10", amount: -15, category: "TRANSFER_IN", name: "ZELLE FROM CHUNG TYLER ON 07/10 REF # ABC" });
    const gas = tx({ accountId: "vm", date: "2026-09-04", amount: 70, category: "TRANSFER_OUT", name: 'tyler chung "gas"' });
    const { transactions, reviews } = run([out, back, gas]);
    expect(reviews.map((q) => [q.key, q.total])).toEqual([["chung tyler|out", 70]]);
    // Settled, not a guess: Polaris won't call it an estimate.
    expect(byId(transactions, back.id).review).toMatchObject({ label: "own", confirmed: true });
  });
  it("uses your answer for everything from that person, and a single-transaction answer over that", () => {
    const a = tx({ amount: -16, category: "TRANSFER_IN", name: 'Keaton Smith "Rent"' });
    const b = tx({ amount: -40, category: "TRANSFER_IN", name: 'Keaton Smith "bday"', date: "2026-11-01" });
    let store = recordAnswer(emptyStore(), "keaton smith|in", "family");
    store = recordAnswer(store, `tx:${fingerprint(b, "Venmo - Personal")}`, "earned");
    const { transactions, reviews } = run([a, b], store);
    expect(byId(transactions, a.id)).toMatchObject({ category: "FAMILY_SUPPORT", review: { confirmed: true } });
    expect(byId(transactions, b.id)).toMatchObject({ category: "INCOME", review: { label: "earned", confirmed: true } });
    expect(reviews).toHaveLength(0);
  });
  it("rejects an answer that doesn't fit the direction", () => {
    expect(() => recordAnswer(emptyStore(), "keaton smith|in", "spending")).toThrow();
    expect(() => recordAnswer(emptyStore(), "keaton smith|out", "earned")).toThrow();
  });
  it("only asks about the last 180 days, and leaves pending payments alone", () => {
    const old = tx({ amount: -30, category: "TRANSFER_IN", name: 'Old Friend "pizza"', date: "2025-01-05" });
    const pending = tx({ amount: -30, category: "TRANSFER_IN", name: 'New Friend "pizza"', pending: true });
    const { transactions, reviews } = run([old, pending]);
    expect(reviews).toHaveLength(0);
    expect(byId(transactions, old.id).review?.label).toBe("payback"); // still counted by the guess
  });
});
