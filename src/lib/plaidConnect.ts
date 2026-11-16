// Shared pieces of connecting a bank through Plaid Link: saving the connection,
// announcing it, and resuming after a bank that logs in on its own site (OAuth).
import type { PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { post } from "./useBank";
import { showToast } from "./toast";

export type ConnectKind = "bank" | "investments" | "all";

/** Saves a new connection on the server and confirms it with a toast. */
export async function finishConnection(publicToken: string | null, meta: PlaidLinkOnSuccessMetadata, kind: ConnectKind) {
  if (!publicToken) throw new Error("Plaid didn’t return a connection. Please try again.");
  await post("/api/plaid/exchange", { public_token: publicToken, institution: meta.institution?.name, kind });
  const count = meta.accounts?.length ?? 0;
  showToast({
    title: `${meta.institution?.name ?? "Your bank"} connected`,
    detail: `${count ? `${count} account${count === 1 ? "" : "s"} added. ` : ""}Transaction history can take a minute to finish syncing.`,
  });
}

// Banks like Chase send you to their own site and back. The page reloads in between,
// so the link token is kept for the trip (this tab only; it expires on its own).
const SESSION_KEY = "northstar:plaid-link-session";

/** `itemId` is set when the trip is to fix an existing connection (update mode) rather than add a new one. */
export function rememberLinkSession(token: string, kind: ConnectKind, itemId?: string) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, kind, itemId })); } catch { /* Storage can be blocked. */ }
}

export function takeLinkSession(): { token: string; kind: ConnectKind; itemId?: string } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
    sessionStorage.removeItem(SESSION_KEY);
    return saved && typeof saved.token === "string" ? { token: saved.token, kind: saved.kind === "investments" || saved.kind === "all" ? saved.kind : "bank", ...(typeof saved.itemId === "string" ? { itemId: saved.itemId } : {}) } : null;
  } catch {
    return null;
  }
}

/** After Link fixes an existing connection there is nothing to save: just tell the server to forget what it cached about it. */
export async function finishReconnection(itemId: string, institution?: string) {
  await post(`/api/plaid/items/${encodeURIComponent(itemId)}/reconnected`);
  showToast({ title: `${institution ?? "Your bank"} reconnected`, detail: "NorthStar will pick up new activity on the next refresh." });
}

/** True when the bank just sent the user back here to finish connecting. */
export const isOAuthReturn = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("oauth_state_id");

// The "how connecting works" intro shows the first time; after that the button goes straight to Plaid.
const INTRO_KEY = "northstar:plaid-intro-seen";
export const introSeen = () => { try { return localStorage.getItem(INTRO_KEY) === "1"; } catch { return false; } };
export const markIntroSeen = () => { try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* Storage can be blocked. */ } };
