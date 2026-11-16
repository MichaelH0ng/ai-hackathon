// A permanent, local copy of every posted transaction NorthStar has seen, so history
// keeps growing past Plaid's ~2-year window and survives disconnecting and re-linking a bank.
//
// Plaid issues new account and transaction IDs on every link, so history is filed under
// each account's fingerprint (bank, type, last four digits, name) and re-attached to
// whichever connected account has that fingerprint today.
//
// Plaid stays the source of truth for the dates it still covers: for each account, archived
// transactions are only used for dates before the oldest one Plaid returns. That way edits and
// removals Plaid makes inside its window are respected, and nothing is counted twice.
import fs from "node:fs";
import path from "node:path";
import type { BankAccount, BankTransaction } from "../src/lib/money.js";
import { fingerprint } from "../src/lib/accountMatch.js";

type Saved = Pick<BankTransaction, "date" | "name" | "amount" | "category">;
export interface Archive {
  version: 1;
  accounts: Record<string, { institution: string; name: string; transactions: Saved[] }>;
}

const empty = (): Archive => ({ version: 1, accounts: {} });

/** Current accounts by fingerprint. Two accounts that look identical can't be told apart, so neither is archived. */
function byFingerprint(accounts: BankAccount[]) {
  const map = new Map<string, BankAccount | null>();
  for (const a of accounts) {
    const print = fingerprint(a);
    map.set(print, map.has(print) ? null : a);
  }
  return map;
}

/**
 * Merges Plaid's live transactions with the archive. Returns every transaction to show
 * (live plus older archived ones, re-attached to today's account IDs) and the updated archive.
 */
export function mergeWithArchive(live: BankTransaction[], accounts: BankAccount[], archive: Archive): { transactions: BankTransaction[]; archive: Archive } {
  const next: Archive = { version: 1, accounts: { ...archive.accounts } };
  const older: BankTransaction[] = [];
  for (const [print, account] of byFingerprint(accounts)) {
    if (!account) continue;
    const posted = live.filter((t) => t.accountId === account.id && !t.pending);
    // Plaid covers everything from its oldest transaction on; the archive fills in before that.
    const liveStart = posted.reduce((min, t) => (t.date < min ? t.date : min), "9999-12-31");
    const kept = (archive.accounts[print]?.transactions ?? []).filter((t) => t.date < liveStart);
    kept.forEach((t, i) => older.push({ ...t, id: `archived:${account.id}:${t.date}:${i}`, accountId: account.id, pending: false }));
    const saved = [...kept, ...posted.map(({ date, name, amount, category }) => ({ date, name, amount, category }))].sort((a, b) => a.date.localeCompare(b.date));
    if (saved.length) next.accounts[print] = { institution: account.institution, name: account.name, transactions: saved };
  }
  return { transactions: [...live, ...older].sort((a, b) => b.date.localeCompare(a.date)), archive: next };
}

/** Removes the saved history for these accounts (when the user disconnects a bank and asks to delete it). */
export function forgetAccounts(archive: Archive, accounts: BankAccount[]): Archive {
  const drop = new Set(accounts.map(fingerprint));
  return { version: 1, accounts: Object.fromEntries(Object.entries(archive.accounts).filter(([print]) => !drop.has(print))) };
}

export function readArchive(file: string): Archive {
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return saved?.version === 1 && saved.accounts && typeof saved.accounts === "object" ? saved : empty();
  } catch {
    return empty();
  }
}

export function writeArchive(file: string, archive: Archive) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write then rename, so a crash mid-write can't leave a half-written archive.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(archive), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
