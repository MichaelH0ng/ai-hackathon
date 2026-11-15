import type { BankData } from "./money";

/** Accounts stay visible in Money even when a person chooses not to use them for planning. */
export function includedItems<T extends { id: string }>(items: T[], excludedAccountIds: readonly string[] = []): T[] {
  const excluded = new Set(excludedAccountIds);
  return items.filter((item) => !excluded.has(item.id));
}

/** Removes opted-out accounts and their activity before a money calculation runs. */
export function bankDataForPlan(data: BankData | null | undefined, excludedAccountIds: readonly string[] = []): BankData | null {
  if (!data) return null;
  const excluded = new Set(excludedAccountIds);
  return {
    ...data,
    accounts: data.accounts.filter((account) => !excluded.has(account.id)),
    transactions: data.transactions.filter((transaction) => !excluded.has(transaction.accountId)),
    holdings: data.holdings?.filter((holding) => !excluded.has(holding.accountId)),
  };
}
