import { useCallback, useEffect, useRef, useState } from "react";
import type { BankData } from "./money";

export type PlaidStatus = { env: string; configured?: boolean; missing?: string[]; items: { itemId: string; institution: string; kind?: "bank" | "investments" | "all" }[] };

export interface Bank {
  status: PlaidStatus | null;
  data: BankData | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  /** A live refresh asks Plaid for current balances; normal reloads use cached balances. */
  reload: (options?: { liveBalances?: boolean }) => Promise<BankData | null>;
  /**
   * Before a spending decision: live balances, unless they were checked in the last 15 minutes.
   * Resolves to the data to decide with (the current data if the check fails).
   */
  ensureFreshBalances: () => Promise<BankData | null>;
}

/** How long a live balance check counts as current (matches the server's reuse window). */
export const LIVE_BALANCE_FRESH_MS = 15 * 60 * 1000;
export const balancesAreFresh = (data: BankData | null | undefined, now = Date.now()) =>
  !!data?.balancesCheckedAt && now - Date.parse(data.balancesCheckedAt) < LIVE_BALANCE_FRESH_MS;

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => {
    throw new Error("The API isn't responding. Start the app with `npm run dev` so both the website and API are running.");
  });
  if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
  return body as T;
}

export const post = <T,>(url: string, body?: unknown) =>
  api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

/** Connected-bank data from the server (Plaid). Loaded once in App and shared by Home and Money. */
export function useBank(): Bank {
  const [status, setStatus] = useState<PlaidStatus | null>(null);
  const [data, setData] = useState<BankData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dataRef = useRef<BankData | null>(null);
  const reload = useCallback(async (options: { liveBalances?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const s = await api<PlaidStatus>("/api/plaid/status");
      setStatus(s);
      const next = s.configured !== false && s.items.length ? await api<BankData>(`/api/plaid/dashboard${options.liveBalances ? "?live=1" : ""}`) : null;
      dataRef.current = next;
      setData(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your accounts.");
      return dataRef.current;
    } finally {
      setLoading(false);
    }
  }, []);
  const ensureFreshBalances = useCallback(async () => {
    const current = dataRef.current;
    if (!current || balancesAreFresh(current)) return current;
    return reload({ liveBalances: true });
  }, [reload]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { status, data, loading, error, connected: !!status?.items.length && !!data, reload, ensureFreshBalances };
}
