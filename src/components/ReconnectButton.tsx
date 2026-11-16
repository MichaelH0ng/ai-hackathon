import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { finishReconnection, rememberLinkSession } from "../lib/plaidConnect";
import { post } from "../lib/useBank";
import { Button } from "./ui";

/**
 * Fixes a connection that already exists, without removing it: signing in again when the bank
 * asks for it, or agreeing to share card and loan details (`addDebts`). Plaid Link opens in
 * "update mode", so the same connection keeps its history and is not billed a second time.
 */
export function ReconnectButton({ itemId, institution, addDebts = false, label, onDone }: { itemId: string; institution: string; addDebts?: boolean; label: string; onDone: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (_publicToken, meta) => {
      // Update mode returns no new token to save; there is nothing to exchange.
      try {
        await finishReconnection(itemId, meta.institution?.name ?? institution);
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reconnected, but NorthStar couldn't refresh. Try Refresh.");
      } finally {
        setToken(null);
      }
    },
    onExit: (err) => {
      setToken(null);
      if (err) setError(err.display_message || "The reconnection was interrupted. Please try again.");
    },
  });
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const linkToken = (await post<{ link_token: string }>("/api/plaid/link-token", { itemId, addDebts })).link_token;
      // Banks that log in on their own site send the user back; remember this is a fix, not a new connection.
      rememberLinkSession(linkToken, "bank", itemId);
      setToken(linkToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start Plaid.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start">
      <Button variant="secondary" disabled={busy || !!token} onClick={() => void start()}>
        {busy || token ? "Opening…" : label}
      </Button>
      {error && <span className="mt-1 text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}
