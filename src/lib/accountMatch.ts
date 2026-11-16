// Plaid gives every account a new ID each time its bank is connected. Goals and plan
// settings point at account IDs, so after a reconnect we match old IDs to the new
// accounts by what stays the same: bank, type, last four digits, and name.
import type { BankAccount } from "./money.js";

const KEY = "northstar:account-fingerprints";

export const fingerprint = (a: Pick<BankAccount, "institution" | "type" | "subtype" | "mask" | "name">) =>
  [a.institution, a.type, a.subtype ?? "", a.mask ?? "", a.name].map((part) => part.trim().toLowerCase()).join("|");

function load(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

/**
 * Remembers the current accounts' fingerprints, then returns a function that turns an
 * account ID from an earlier connection into today's ID for the same account. IDs
 * that are current, unknown, or whose account isn't connected come back unchanged.
 */
export function accountIdRemapper(accounts: BankAccount[], known: Record<string, string> = load()): (id: string) => string {
  const current = new Map(accounts.map((a) => [a.id, a]));
  const byPrint = new Map<string, string>();
  for (const a of accounts) {
    const print = fingerprint(a);
    // Two accounts that look identical can't be told apart: leave those alone.
    byPrint.set(print, byPrint.has(print) ? "" : a.id);
    known[a.id] = print;
  }
  try { localStorage.setItem(KEY, JSON.stringify(known)); } catch { /* Storage can be blocked. */ }
  return (id) => {
    if (current.has(id)) return id;
    const print = known[id];
    return (print && byPrint.get(print)) || id;
  };
}
