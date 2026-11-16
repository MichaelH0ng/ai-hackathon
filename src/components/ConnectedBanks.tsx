import { useState } from "react";
import { Landmark, Unplug } from "lucide-react";
import { type Bank, api } from "../lib/useBank";

/**
 * Banks connected through Plaid, each with a Disconnect that asks first.
 * Disconnecting removes the connection at Plaid; its saved transaction history stays unless the user deletes it too.
 */
export function ConnectedBanks({ bank }: { bank: Bank }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Saved transaction history is kept by default, so reconnecting later picks it back up.
  const [deleteHistory, setDeleteHistory] = useState(false);
  const items = bank.status?.items ?? [];
  if (!items.length) return null;

  const disconnect = async (itemId: string) => {
    setRemoving(itemId);
    setError(null);
    try {
      await api(`/api/plaid/items/${encodeURIComponent(itemId)}${deleteHistory ? "?deleteHistory=true" : ""}`, { method: "DELETE" });
      setConfirming(null);
      await bank.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't disconnect that bank. Please try again.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="connected-banks" aria-labelledby="connected-banks-title">
      <h3 id="connected-banks-title">Connected banks</h3>
      {error && <p className="connected-banks-error" role="alert">{error}</p>}
      <ul>
        {items.map((item) => {
          const accounts = bank.data?.accounts.filter((a) => a.institution === item.institution) ?? [];
          const asking = confirming === item.itemId;
          return (
            <li key={item.itemId} className={asking ? "is-confirming" : undefined}>
              <div className="connected-bank-row">
                <span className="goals-tool-icon"><Landmark size={18} aria-hidden="true" /></span>
                <div className="connected-bank-name">
                  <strong>{item.institution}</strong>
                  <span>{accounts.length ? accounts.map((a) => `${a.name}${a.mask ? ` ••${a.mask}` : ""}`).join(", ") : item.kind === "investments" ? "Investments" : "Bank"}</span>
                </div>
                {!asking && (
                  <button type="button" className="connected-bank-disconnect" disabled={removing !== null} onClick={() => { setDeleteHistory(false); setConfirming(item.itemId); }}>
                    <Unplug size={15} aria-hidden="true" /> Disconnect
                  </button>
                )}
              </div>
              {asking && (
                <div className="connected-bank-confirm">
                  <p>Disconnect {item.institution}? Its accounts leave NorthStar and Plaid stops access. Its saved transaction history stays on this computer, so reconnecting picks it back up.</p>
                  <label className="connected-bank-history">
                    <input type="checkbox" checked={deleteHistory} onChange={(e) => setDeleteHistory(e.target.checked)} disabled={removing !== null} />
                    <span>Also delete its saved history (can’t be undone)</span>
                  </label>
                  <div>
                    <button type="button" className="wealth-secondary" disabled={removing !== null} onClick={() => setConfirming(null)}>Keep it</button>
                    <button type="button" className="connected-bank-confirm-button" disabled={removing !== null} onClick={() => { void disconnect(item.itemId); }}>
                      {removing === item.itemId ? "Disconnecting…" : deleteHistory ? "Disconnect and delete" : "Disconnect"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
