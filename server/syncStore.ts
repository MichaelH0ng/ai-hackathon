// Plaid's /transactions/sync hands out changes since a bookmark ("cursor"), not the whole list.
// To use it properly we keep, per connection, the cursor and every transaction it has described so far,
// then apply each batch of added, modified and removed transactions to that saved list.
//
// Nothing is saved until Plaid says there are no more pages: a cursor saved halfway through would
// skip the rest of the batch after a crash (Plaid's docs: "retrieve all available updates before persisting").
import fs from "node:fs";
import path from "node:path";
import type { BankTransaction } from "../src/lib/money.js";

/**
 * Bumped when the saved transactions gain fields. Version 2 adds Plaid's detailed category, its
 * confidence, and the bank's original description; version 3 adds merchant logos, websites and
 * counterparties. An older save is re-downloaded once from the start (free: it's the same sync call).
 */
export const SYNC_VERSION = 3;

export interface SyncState {
  version: typeof SYNC_VERSION;
  /** Empty means "start from the beginning". */
  cursor: string;
  transactions: Record<string, BankTransaction>;
}

export interface SyncPage {
  added: BankTransaction[];
  modified: BankTransaction[];
  /** transaction_ids Plaid has taken back (including a pending charge that has now posted under a new id). */
  removed: string[];
}

export const emptySyncState = (): SyncState => ({ version: SYNC_VERSION, cursor: "", transactions: {} });

/** Applies one page of changes. Pure: returns a new state and leaves the old one untouched. */
export function applyPage(state: SyncState, page: SyncPage, nextCursor: string): SyncState {
  const transactions = { ...state.transactions };
  for (const t of page.added) transactions[t.id] = t;
  for (const t of page.modified) transactions[t.id] = t; // replace, never append: appending is how edits get double-counted
  for (const id of page.removed) delete transactions[id];
  return { version: SYNC_VERSION, cursor: nextCursor, transactions };
}

export function readSyncState(file: string): SyncState {
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved?.version === SYNC_VERSION && typeof saved.cursor === "string" && saved.transactions && typeof saved.transactions === "object" && !Array.isArray(saved.transactions)) return saved as SyncState;
  } catch {
    // no saved state yet, or it can't be read: start over from the beginning
  }
  return emptySyncState();
}

export function writeSyncState(file: string, state: SyncState) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write then rename, so a crash mid-write can't leave a half-written file that looks valid.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function deleteSyncState(file: string) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // already gone
  }
}
