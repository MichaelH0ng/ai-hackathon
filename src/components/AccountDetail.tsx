import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Pencil, X } from "lucide-react";
import { formatDate } from "../lib/dates";
import { formatExact } from "../lib/finance";
import { accountBalanceSeries, categoryLabel, isLiability, type BankAccount, type BankData, type DebtAccount } from "../lib/money";
import { CategoryIcon } from "./CategoryIcon";
import { dueText } from "./DebtPanel";
import { Segmented } from "./Segmented";

const RANGES = [
  { key: "30", label: "1M", days: 30 },
  { key: "90", label: "3M", days: 90 },
  { key: "365", label: "1Y", days: 365 },
] as const;

/**
 * One account up close: its balance over time, details from the bank, its recent transactions,
 * and the per-account choices (nickname, count it in your plan, mark it closed).
 */
export function AccountDetail({ account, name, kind, icon, data, debt, included, closed, onRename, onToggleIncluded, onToggleClosed, onSeeActivity, onClose }: {
  account: BankAccount;
  /** Your nickname, or the bank's name for it. */
  name: string;
  kind: string;
  icon: React.ReactNode;
  data: BankData;
  debt?: DebtAccount;
  included: boolean;
  closed: boolean;
  onRename: (name: string) => void;
  onToggleIncluded: () => void;
  onToggleClosed: () => void;
  onSeeActivity: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("90");
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const owed = isLiability(account);
  const investing = account.type === "investment" || account.type === "brokerage";
  const status = data.status.find((s) => s.institution === account.institution);
  const transactions = data.transactions.filter((t) => t.accountId === account.id).sort((a, b) => b.date.localeCompare(a.date));
  const holdings = (data.holdings ?? []).filter((h) => h.accountId === account.id).sort((a, b) => b.value - a.value);
  const limit = account.type === "credit" && account.limit && account.limit > 0 ? account.limit : null;

  // Escape closes; focus moves into the panel and back to the account row afterward.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [onClose]);

  const saveName = () => {
    onRename(draft.trim());
    setRenaming(false);
  };

  const facts: [string, string][] = [
    ["Type", kind],
    ["Bank", account.institution.replace(/ \(test\)$/, "")],
    ...(account.mask ? [["Account", `••${account.mask}`] as [string, string]] : []),
    ...(account.available != null && !owed ? [["Available", formatExact(account.available)] as [string, string]] : []),
    ...(limit ? [["Credit limit", formatExact(limit)] as [string, string], ["Credit used", `${Math.round((Math.max(0, account.current) / limit) * 100)}%`] as [string, string]] : []),
    ...(debt?.minimumPayment != null ? [["Minimum payment", formatExact(debt.minimumPayment)] as [string, string]] : []),
    ...(debt?.nextDueDate ? [["Due", dueText(debt.nextDueDate)] as [string, string]] : []),
    ...(debt?.apr != null ? [["APR", `${debt.apr.toFixed(2)}%`] as [string, string]] : []),
    ...(debt?.lastStatementBalance != null ? [["Last statement", formatExact(debt.lastStatementBalance)] as [string, string]] : []),
    ["Last synced", status?.lastUpdatedAt ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(status.lastUpdatedAt)) : "Not reported"],
  ];

  return (
    <div className="wealth-modal-backdrop account-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panel} className="wealth-modal account-detail" role="dialog" aria-modal="true" aria-labelledby="account-detail-title">
        <header className="account-detail-head">
          <span className="account-detail-icon">{icon}</span>
          <div className="account-detail-title">
            {renaming ? (
              <form className="account-detail-rename" onSubmit={(event) => { event.preventDefault(); saveName(); }}>
                <label className="sr-only" htmlFor="account-nickname">Nickname</label>
                <input id="account-nickname" autoFocus maxLength={40} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={account.name} />
                <button type="submit" className="wealth-icon-button" aria-label="Save nickname"><Check size={16} /></button>
              </form>
            ) : (
              <h2 id="account-detail-title">{name}<button type="button" className="account-detail-rename-button" onClick={() => { setDraft(name); setRenaming(true); }} aria-label="Rename this account" title="Rename"><Pencil size={14} /></button></h2>
            )}
            <p>{account.institution.replace(/ \(test\)$/, "")} · {kind}{name !== account.name ? ` · ${account.name}` : ""}{closed ? " · Closed" : ""}</p>
          </div>
          <button type="button" className="wealth-icon-button" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="account-detail-balance">
          <small>{owed ? "Owed" : "Balance"}</small>
          <strong className={owed && account.current > 0 ? "is-debt" : ""}>{owed && account.current > 0 ? "−" : ""}{formatExact(Math.abs(account.current))}</strong>
        </div>

        {!investing ? transactions.some((t) => !t.pending) && <BalanceChart account={account} transactions={data.transactions} days={RANGES.find((r) => r.key === range)!.days} owed={owed} range={range} setRange={setRange} /> : holdings.length > 0 && (
          <div className="account-detail-section">
            <h3>Holdings</h3>
            <ul className="account-detail-list">
              {holdings.map((h) => <li key={h.id}><span><strong>{h.ticker || h.name}</strong><small>{h.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares{h.ticker ? ` · ${h.name}` : ""}</small></span><strong>{formatExact(h.value)}</strong></li>)}
            </ul>
          </div>
        )}

        <dl className="account-detail-facts">
          {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>

        {!investing && (
          <div className="account-detail-section">
            <div className="account-detail-section-head">
              <h3>Recent activity</h3>
              {transactions.length > 0 && <button type="button" className="wealth-inline-link" onClick={onSeeActivity}>See all {transactions.length} <ArrowRight size={14} aria-hidden="true" /></button>}
            </div>
            {transactions.length ? (
              <ul className="account-detail-list">
                {transactions.slice(0, 8).map((t) => (
                  <li key={t.id}>
                    <span className="account-detail-tx"><CategoryIcon category={t.category} /><span><strong>{t.name}</strong><small>{formatDate(t.date)} · {categoryLabel(t.category)}{t.pending ? " · pending" : ""}</small></span></span>
                    <strong className={t.amount < 0 ? "is-gain" : ""}>{t.amount < 0 ? "+" : "−"}{formatExact(Math.abs(t.amount))}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="wealth-note">No transactions from this account yet.</p>}
          </div>
        )}

        <div className="account-detail-actions">
          <label className="account-detail-toggle">
            <input type="checkbox" checked={included && !closed} disabled={closed} onChange={onToggleIncluded} />
            <span><strong>Count in my plan</strong><small>{closed ? "Closed accounts aren't counted." : "Used for goals, purchase checks, and planning."}</small></span>
          </label>
          <button type="button" className="wealth-secondary" onClick={onToggleClosed}>{closed ? "Reopen account" : "Mark as closed"}</button>
        </div>
      </section>
    </div>
  );
}

/** The account's balance over the chosen range, as a small area chart with start and end values. */
function BalanceChart({ account, transactions, days, owed, range, setRange }: {
  account: BankAccount;
  transactions: BankData["transactions"];
  days: number;
  owed: boolean;
  range: string;
  setRange: (key: (typeof RANGES)[number]["key"]) => void;
}) {
  const points = accountBalanceSeries(account, transactions, days);
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 600;
  const h = 140;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * w;
  const y = (v: number) => max === min ? h / 2 : 8 + (1 - (v - min) / span) * (h - 16);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const change = values.at(-1)! - values[0];
  const better = owed ? change < 0 : change > 0;
  return (
    <div className="account-detail-chart">
      <div className="account-detail-chart-head">
        <p className={change === 0 ? "" : better ? "is-gain" : "is-down"}>
          {change === 0 ? "No change" : `${change > 0 ? "↑" : "↓"} ${formatExact(Math.abs(change))}${owed ? " owed" : ""}`} <span>since {formatDate(points[0].date)}</span>
        </p>
        <Segmented label="Time range" options={RANGES.map((r) => ({ value: r.key, label: r.label }))} value={range as (typeof RANGES)[number]["key"]} onChange={setRange} />
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${owed ? "Amount owed" : "Balance"} over the last ${days} days, from ${formatExact(values[0])} to ${formatExact(values.at(-1)!)}`}>
        <defs><linearGradient id="account-detail-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--aurora-teal)" stopOpacity=".28" /><stop offset="1" stopColor="var(--aurora-teal)" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#account-detail-fill)" />
        <path d={line} fill="none" stroke="var(--aurora-teal)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="account-detail-chart-note">Worked out from this account's posted transactions, so it can drift if a transaction is missing.</p>
    </div>
  );
}
