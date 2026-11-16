import { describe, expect, it } from "vitest";
import type { BankTransaction } from "../src/lib/money.js";
import { applyPage, emptySyncState } from "./syncStore.js";

const tx = (id: string, over: Partial<BankTransaction> = {}): BankTransaction => ({ id, accountId: "chk", date: "2026-11-10", name: "Coffee", amount: 5, category: "FOOD_AND_DRINK", pending: false, ...over });

describe("applyPage", () => {
  it("adds new transactions and moves the cursor", () => {
    const next = applyPage(emptySyncState(), { added: [tx("a"), tx("b")], modified: [], removed: [] }, "cursor-1");
    expect(Object.keys(next.transactions)).toEqual(["a", "b"]);
    expect(next.cursor).toBe("cursor-1");
  });
  it("replaces a modified transaction instead of counting it twice", () => {
    const first = applyPage(emptySyncState(), { added: [tx("a", { amount: 5, pending: true })], modified: [], removed: [] }, "c1");
    const next = applyPage(first, { added: [], modified: [tx("a", { amount: 5.5, pending: false })], removed: [] }, "c2");
    expect(Object.values(next.transactions)).toEqual([tx("a", { amount: 5.5, pending: false })]);
  });
  it("drops removed transactions, such as a pending charge that posted under a new id", () => {
    const first = applyPage(emptySyncState(), { added: [tx("pending-1", { pending: true })], modified: [], removed: [] }, "c1");
    const next = applyPage(first, { added: [tx("posted-1")], modified: [], removed: ["pending-1"] }, "c2");
    expect(Object.keys(next.transactions)).toEqual(["posted-1"]);
  });
  it("ignores a removal of something we never saw", () => {
    expect(Object.keys(applyPage(emptySyncState(), { added: [], modified: [], removed: ["ghost"] }, "c").transactions)).toEqual([]);
  });
  it("does not change the state it was given", () => {
    const start = applyPage(emptySyncState(), { added: [tx("a")], modified: [], removed: [] }, "c1");
    applyPage(start, { added: [tx("b")], modified: [], removed: ["a"] }, "c2");
    expect(Object.keys(start.transactions)).toEqual(["a"]);
    expect(start.cursor).toBe("c1");
  });
});
