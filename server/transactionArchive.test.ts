import { describe, expect, it } from "vitest";
import type { BankAccount, BankTransaction } from "../src/lib/money.ts";
import { forgetAccounts, mergeWithArchive, type Archive } from "./transactionArchive.ts";

const account = (id: string, mask = "1234"): BankAccount => ({ id, name: "Total Checking", mask, type: "depository", subtype: "checking", current: 0, available: null, institution: "Chase" });
const tx = (id: string, accountId: string, date: string, amount: number, pending = false): BankTransaction => ({ id, accountId, date, name: "Cafe", amount, category: "FOOD_AND_DRINK", pending });
const empty: Archive = { version: 1, accounts: {} };

describe("transaction archive", () => {
  it("keeps history Plaid no longer returns", () => {
    const first = mergeWithArchive([tx("a", "chk", "2024-01-05", 5), tx("b", "chk", "2026-11-01", 7)], [account("chk")], empty);
    // Later Plaid's window has moved on: only November is returned.
    const later = mergeWithArchive([tx("b", "chk", "2026-11-01", 7)], [account("chk")], first.archive);
    expect(later.transactions.map((t) => t.date)).toEqual(["2026-11-01", "2024-01-05"]);
    expect(later.transactions[1]).toMatchObject({ accountId: "chk", amount: 5, pending: false });
  });

  it("re-attaches history to a re-linked account's new ID", () => {
    const first = mergeWithArchive([tx("a", "old-id", "2024-01-05", 5)], [account("old-id")], empty);
    const relinked = mergeWithArchive([tx("z", "new-id", "2026-11-01", 9)], [account("new-id")], first.archive);
    expect(relinked.transactions.find((t) => t.date === "2024-01-05")?.accountId).toBe("new-id");
  });

  it("lets Plaid win inside its own window, so nothing counts twice", () => {
    const first = mergeWithArchive([tx("a", "chk", "2026-10-01", 5), tx("b", "chk", "2026-10-02", 6)], [account("chk")], empty);
    // Plaid removed the Oct 2 charge: it must not come back from the archive.
    const later = mergeWithArchive([tx("a", "chk", "2026-10-01", 5)], [account("chk")], first.archive);
    expect(later.transactions).toHaveLength(1);
  });

  it("serves the archive while a re-linked bank is still syncing, and never saves pending charges", () => {
    const first = mergeWithArchive([tx("a", "chk", "2025-03-01", 5), tx("p", "chk", "2026-11-14", 3, true)], [account("chk")], empty);
    expect(first.archive.accounts[Object.keys(first.archive.accounts)[0]].transactions).toHaveLength(1);
    const syncing = mergeWithArchive([], [account("chk")], first.archive);
    expect(syncing.transactions.map((t) => t.date)).toEqual(["2025-03-01"]);
  });

  it("keeps a disconnected bank's history until it's deleted", () => {
    const first = mergeWithArchive([tx("a", "chk", "2025-03-01", 5)], [account("chk")], empty);
    const gone = mergeWithArchive([], [], first.archive);
    expect(gone.transactions).toEqual([]);
    expect(Object.keys(gone.archive.accounts)).toHaveLength(1);
    expect(forgetAccounts(gone.archive, [account("whatever-id")]).accounts).toEqual({});
  });
});
