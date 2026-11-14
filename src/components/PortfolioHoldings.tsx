import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { Bank } from "../lib/useBank";

function currency(value: number, code: string | null) {
  if (!code) return value.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " (currency unavailable)";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(value); }
  catch { return `${value.toLocaleString()} ${code}`; }
}
export function PortfolioHoldings({ bank, onConnect }: { bank: Bank; onConnect: () => void }) {
  const holdings = bank.data?.holdings ?? [];
  const connections = bank.status?.items.filter(i => i.kind === "investments") ?? [];
  const accountNames = new Map(bank.data?.accounts.map(a => [a.id, a.name]));
  const problems = bank.data?.status.filter(s => connections.some(i => i.itemId === s.itemId) && (s.problem || !s.ready)) ?? [];
  return <section className="wealth-card portfolio-card"><div className="wealth-section-head"><div><h2>Your portfolio</h2><p>See the investments inside your connected accounts.</p></div>{connections.length > 0 ? <button className="wealth-text-button" disabled={bank.loading} onClick={bank.reload}><RefreshCw size={15} className={bank.loading ? "animate-spin" : ""} />{bank.loading ? "Loading…" : "Refresh"}</button> : <button className="wealth-text-button" onClick={onConnect}>Connect portfolio <ArrowUpRight size={16} /></button>}</div>
    {bank.error && <p className="connection-error" role="alert">{bank.error}</p>}
    {problems.length > 0 && <p className="portfolio-status" role="status">{problems.some(p => p.problem) ? "Some holdings could not be loaded. Your account balances may still be available. Try refreshing or reconnecting the portfolio." : "Your provider is still preparing the holdings. Try refreshing in a moment."}</p>}
    {holdings.length ? <><div className="portfolio-table-wrap"><table className="portfolio-table"><caption className="sr-only">Connected investment holdings, reported by the account provider</caption><thead><tr><th scope="col">Investment</th><th scope="col">Shares</th><th scope="col">Value</th></tr></thead><tbody>{holdings.map(h => <tr key={h.id}><th scope="row"><strong>{h.ticker || h.name}</strong>{h.ticker && <span>{h.name}</span>}<small>{accountNames.get(h.accountId) || h.institution}{h.priceAsOf ? ` · Price as of ${h.priceAsOf}` : " · Price date unavailable"}</small></th><td>{h.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td><td>{currency(h.value, h.currency)}</td></tr>)}</tbody></table></div><p className="wealth-note">Holdings are part of your investment account balances. They are not added to your net worth a second time.</p></> : <div className="portfolio-empty"><p>{connections.length ? "No holdings are available yet. Refresh to check for updates." : "Connect a brokerage or retirement account to see your holdings here."}</p>{!connections.length && <p className="wealth-note">You can also track the total balance of an investment account manually.</p>}</div>}
    {(connections.length > 0 || holdings.length > 0) && <div className="portfolio-source"><span>{bank.data?.env === "sandbox" ? "Sandbox · test holdings" : "Reported by your institution"}</span><span>{bank.data?.fetchedAt ? `Last checked ${new Date(bank.data.fetchedAt).toLocaleString()}` : ""}</span></div>}
    <details className="portfolio-help"><summary>Can I connect my real portfolio?</summary><p>Yes, through supported institutions using Plaid Production. Sandbox credentials only connect test accounts. Once Production is configured, use “Connect a portfolio” and choose the accounts you want to share. Holdings update periodically rather than live with every market price change.</p></details>
  </section>;
}
