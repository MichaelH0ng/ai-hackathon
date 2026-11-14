import { useCallback, useEffect, useState } from "react";
import type { BankData } from "./money";

export type PlaidStatus = { env: string; items: { itemId: string; institution: string }[] };

export interface Bank {
  status: PlaidStatus | null;
  data: BankData | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  reload: () => Promise<void>;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: "The server isn't responding. Is `npm run dev` running?" }));
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

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api<PlaidStatus>("/api/plaid/status");
      setStatus(s);
      setData(s.items.length ? await api<BankData>("/api/plaid/dashboard") : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { status, data, loading, error, connected: !!status?.items.length && !!data, reload };
}
