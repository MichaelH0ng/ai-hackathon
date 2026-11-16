import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { finishConnection, finishReconnection, isOAuthReturn, takeLinkSession } from "../lib/plaidConnect";
import { showToast } from "../lib/toast";

/** Removes ?oauth_state_id from the address bar, keeping the page (#hash) the user was on. */
const cleanUrl = () => window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);

/**
 * Finishes connecting a bank that logged the user in on its own site (Chase, Capital One…):
 * the bank sends them back here with ?oauth_state_id, and Plaid Link picks up where it left off.
 */
export function PlaidOAuthResume({ onConnected }: { onConnected: () => void }) {
  const [session] = useState(() => (isOAuthReturn() ? takeLinkSession() : null));
  const { open, ready } = usePlaidLink({
    token: session?.token ?? null,
    receivedRedirectUri: session ? window.location.href : undefined,
    onSuccess: async (publicToken, meta) => {
      cleanUrl();
      try {
        // Fixing an existing connection has no new token to save; adding a new one does.
        if (session!.itemId) await finishReconnection(session!.itemId, meta.institution?.name);
        else await finishConnection(publicToken, meta, session!.kind);
        onConnected();
      } catch {
        showToast({ title: "Couldn’t save that connection", detail: "Try connecting the bank again from Edit accounts." });
      }
    },
    onExit: () => cleanUrl(),
  });
  useEffect(() => {
    if (session && ready) open();
  }, [session, ready, open]);
  useEffect(() => {
    // Came back from a bank but the session is gone (new tab, expired): say so instead of failing silently.
    if (isOAuthReturn() && !session) {
      cleanUrl();
      showToast({ title: "Bank login finished in another tab", detail: "Start the connection again from Edit accounts to finish adding it." });
    }
  }, [session]);
  return null;
}
