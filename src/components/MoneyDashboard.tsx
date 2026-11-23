import { CategoryIcon } from "./CategoryIcon";
import { ArrowDownLeft, ArrowUpRight, Eye, Landmark, Lock, RefreshCw, Search, ShieldCheck, Unplug, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { formatDate } from "../lib/dates";
import { formatExact } from "../lib/finance";
import {
  type FlowPeriod,
  categoryLabel,
  detectTransferIds,
  isTransfer,
  periodFlow,
  billsFor,
  monthlyBillTotal,
  topCategories,
} from "../lib/money";
import type { MoneyGoal } from "../lib/types";
import { interestOrFee, type InterestOrFee } from "../lib/accountInsights";
import { type Bank, post } from "../lib/useBank";
import { type ConnectKind, finishConnection, introSeen, markIntroSeen, rememberLinkSession } from "../lib/plaidConnect";
import { ReconnectButton } from "./ReconnectButton";
import { Button, Card, Notice } from "./ui";
import { Segmented } from "./Segmented";

const money = (n: number) => formatExact(n);
/** Transactions shown at a time; "Show more" adds this many. */
const PAGE = 30;
/** Upcoming bills shown before "Show all". */
const BILLS_SHOWN = 5;

/** Money dashboard: your real balances and spending from Plaid. */
export function MoneyDashboard({
  bank,
  accountId,
  onAccountFilterChange,
  focus,
  onFocusChange,
}: {
  /** From Accounts' Interest & fees: only interest earned, interest charged, or fees, since a date. */
  focus?: { kind: InterestOrFee; since: string; label: string } | null;
  onFocusChange?: (focus: null) => void;
  /** Opens Activity filtered to one account (from an account's "See all"). */
  accountId?: string | null;
  onAccountFilterChange?: (id: string | null) => void;
  bank: Bank;
  goals: MoneyGoal[];
  onUpdateGoal: (g: MoneyGoal) => void;
  onOpenGoal: (id: string) => void;
  onNewGoal: () => void;
}) {
  const { status, data, loading, error, reload: load } = bank;
  const [flow, setFlow] = useState<FlowPeriod>("month");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [accountFilter, setAccountFilterState] = useState(accountId ?? "");
  const setAccountFilter = (id: string) => { setAccountFilterState(id); onAccountFilterChange?.(id || null); };
  useEffect(() => { setAccountFilterState(accountId ?? ""); }, [accountId]);
  const [category, setCategory] = useState<string | null>(null);
  const clearFocus = () => onFocusChange?.(null);
  const [shown, setShown] = useState(PAGE);
  const [showAllBills, setShowAllBills] = useState(false);
  const listTop = useRef<HTMLDivElement>(null);
  const retries = useRef(0);

  // A just-connected sandbox bank needs a few seconds before transactions are ready.
  const waiting = !!data && data.transactions.length === 0 && data.status.some((s) => !s.ready);
  useEffect(() => {
    if (!waiting || retries.current >= 6) return;
    const t = setTimeout(() => {
      retries.current += 1;
      load();
    }, 4000);
    return () => clearTimeout(t);
  }, [waiting, load]);

  const transferIds = useMemo(() => detectTransferIds(data?.transactions ?? []), [data]);

  if (loading && !data) {
    return (
      <Shell>
        <div role="status" aria-label="Loading your accounts" className="grid gap-4 lg:grid-cols-3"><div className="skeleton h-40 lg:col-span-2" /><div className="skeleton h-40" /><div className="skeleton h-72 lg:col-span-2" /><div className="skeleton h-72" /></div>
      </Shell>
    );
  }

  if (error && !data) {
    return (
      <Shell>
        <Notice tone="warn">{error}</Notice>
        <Button className="mt-3" onClick={() => { void load(); }}>Try again</Button>
      </Shell>
    );
  }

  if (!status?.items.length || !data) {
    return (
      <Shell>
        <ConnectCard sandbox={status?.env === "sandbox"} onConnected={load} />
      </Shell>
    );
  }

  const f = periodFlow(data.transactions, transferIds, flow);
  const net = f.current.in - f.current.out;
  const cats = topCategories(data.transactions, transferIds, 30);
  const maxCat = cats[0]?.value ?? 1;
  const allBills = billsFor(data, transferIds);
  const bills = showAllBills ? allBills : allBills.slice(0, BILLS_SHOWN);
  const billsPerMonth = monthlyBillTotal(allBills);
  const billsFromPlaid = bills.some((b) => b.source === "plaid");
  const needLogin = data.status.filter((s) => s.problem === "ITEM_LOGIN_REQUIRED");
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  // The transaction list: newest first, narrowed by search, direction, account, and category.
  const needle = query.trim().toLowerCase();
  const filtered = [...data.transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((t) =>
      (!needle || t.name.toLowerCase().includes(needle) || categoryLabel(t.category).toLowerCase().includes(needle))
      && (direction === "all" || (direction === "out" ? t.amount > 0 : t.amount < 0))
      && (!accountFilter || t.accountId === accountFilter)
      && (!category || (t.category === category && !isTransfer(t, transferIds)))
      && (!focus || (!t.pending && t.date >= focus.since && interestOrFee(t) === focus.kind)));
  // Each row's place in the list, for the staggered entrance (later rows wait a little longer, capped).
  const rowOrder = new Map(filtered.slice(0, shown).map((t, i) => [t.id, i]));
  const byDay: [string, typeof filtered][] = [];
  for (const t of filtered.slice(0, shown)) {
    const last = byDay.at(-1);
    if (last && last[0] === t.date) last[1].push(t);
    else byDay.push([t.date, [t]]);
  }
  /** "Where it went" → the matching transactions, last 30 days' spending in that category. */
  const showCategory = (key: string) => {
    setCategory((current) => (current === key ? null : key));
    setShown(PAGE);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const problems = data.status.filter((s) => s.problem);
  const latestActivityUpdate = data.status
    .map((status) => status.lastUpdatedAt)
    .filter((stamp): stamp is string => !!stamp && !Number.isNaN(Date.parse(stamp)))
    .sort()
    .at(-1);
  const freshness = latestActivityUpdate
    ? `most recent bank activity update ${new Date(latestActivityUpdate).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : `NorthStar checked ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return (
    <Shell
      actions={
        <button onClick={() => { void load({ liveBalances: true }); }} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Update balances
        </button>
      }
      sub={`${data.status.map((s) => s.institution).join(" · ")} · ${freshness}${data.env === "sandbox" ? " · sandbox test data" : ""}`}
    >
      {needLogin.map((s) => (
        <Notice key={s.itemId} tone="warn">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{s.institution.replace(/ \(test\)$/, "")} needs you to sign in again before NorthStar can refresh it. Your saved history stays.</span>
            <ReconnectButton itemId={s.itemId} institution={s.institution} label="Sign in again" onDone={load} />
          </span>
        </Notice>
      ))}
      {problems.filter((p) => p.problem !== "ITEM_LOGIN_REQUIRED").length > 0 && (
        <Notice tone="warn">Couldn't fully refresh {problems.filter((p) => p.problem !== "ITEM_LOGIN_REQUIRED").map((p) => p.institution).join(", ")} ({problems.find((p) => p.problem !== "ITEM_LOGIN_REQUIRED")?.problem}).</Notice>
      )}
      {waiting && <Notice tone="info">Your bank is still sending transactions. This page refreshes on its own in a few seconds.</Notice>}

      {/* What came in and went out, and what's coming next. */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">Cash flow</h2>
            <Segmented label="Cash flow period" options={[{ value: "week", label: "This week" }, { value: "month", label: "This month" }]} value={flow} onChange={setFlow} />
          </div>
          <p className={`mt-3 font-display text-3xl font-bold ${net >= 0 ? "text-emerald-700" : "text-amber-700"}`}>
            {net >= 0 ? "+" : "−"}{money(Math.abs(net))} <span className="font-sans text-sm font-semibold text-stone-500">net this {flow}</span>
          </p>
          <div className="mt-3 space-y-2 text-sm">
            <FlowRow icon={<ArrowDownLeft className="h-4 w-4 text-emerald-600" />} label="Money in" value={money(f.current.in)} prev={money(f.previous.in)} period={flow} />
            <FlowRow icon={<ArrowUpRight className="h-4 w-4 text-amber-600" />} label="Money out" value={money(f.current.out)} prev={money(f.previous.out)} period={flow} />
          </div>
          <p className="mt-3 text-xs text-stone-500">Posted activity only. Transfers between your own accounts aren't counted.</p>
        </Card>

        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-lg font-bold text-ink">Upcoming bills</h2>
            {allBills.length > 0 && <p className="text-sm text-stone-500" title="Weekly, every-2-weeks, and yearly bills converted to a monthly amount">About <strong className="tabular-nums text-ink">{money(Math.round(billsPerMonth))}</strong>/month</p>}
          </div>
          {bills.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No repeating charges found yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-stone-100">
              {bills.map((b, i) => (
                <li key={b.name} style={{ "--i": i } as React.CSSProperties} className="ns-enter flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-stone-800">{b.name}</span>
                    <span className="text-xs text-stone-500">{b.cadence} · {b.daysUntil === 0 ? "due today" : b.daysUntil === 1 ? "due tomorrow" : `due ${formatDate(b.nextDue)}`}</span>
                  </span>
                  <strong className="shrink-0 tabular-nums text-ink">{money(b.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
          {allBills.length > BILLS_SHOWN && (
            <button type="button" onClick={() => setShowAllBills((v) => !v)} aria-expanded={showAllBills} className="mt-1 min-h-11 text-sm font-bold text-brand-700 hover:underline">
              {showAllBills ? "Show fewer" : `Show all ${allBills.length} bills`}
            </button>
          )}
          {bills.length > 0 && (
            <p className="mt-2 text-xs text-stone-500">
              {billsFromPlaid ? "Detected by Plaid from your bank history." : "Estimated from your past transactions, so dates and amounts can be off."}
            </p>
          )}
        </Card>
      </div>

      {/* Where it went: tap a category to see those transactions below. */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-ink">Where it went, last 30 days</h2>
          {cats.length > 0 && <p className="text-xs text-stone-500">Tap a category to see its transactions.</p>}
        </div>
        {cats.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">No spending yet.</p>
        ) : (
          <ul className="mt-2 grid gap-x-8 sm:grid-cols-2">
            {cats.map((c) => (
              <li key={c.key}>
                <button type="button" onClick={() => showCategory(c.key)} aria-pressed={category === c.key} className={`block w-full rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-stone-50 ${category === c.key ? "bg-stone-50 ring-1 ring-[var(--aurora-teal)]" : ""}`}>
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold text-stone-800"><CategoryIcon category={c.key} inline /> {c.label}</span>
                    <strong className="shrink-0 tabular-nums text-ink">{money(c.value)}</strong>
                  </span>
                  <span className="mt-1 block h-2 rounded-full bg-stone-100">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(c.value / maxCat) * 100}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Every transaction NorthStar has, searchable. */}
      <Card>
        <div ref={listTop} className="flex flex-wrap items-baseline justify-between gap-2 scroll-mt-36">
          <h2 className="text-lg font-bold text-ink">Transactions</h2>
          <p className="text-sm text-stone-500">{filtered.length === data.transactions.length ? `${filtered.length} total` : `${filtered.length} of ${data.transactions.length}`}</p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative block">
            <span className="sr-only">Search transactions</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} placeholder="Search by name, like Trader Joe's" className="min-h-11 w-full rounded-xl bg-stone-50 pl-9 pr-3 text-sm text-stone-800 ring-1 ring-stone-300" />
          </label>
          <Segmented label="Show" size="md" className="w-full sm:w-auto" options={[{ value: "all", label: "All" }, { value: "out", label: "Money out" }, { value: "in", label: "Money in" }]} value={direction} onChange={(next) => { setDirection(next); setShown(PAGE); }} />
          {data.accounts.length > 1 && (
            <label className="block">
              <span className="sr-only">Account</span>
              <select value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setShown(PAGE); }} className="min-h-11 w-full rounded-xl bg-stone-50 px-3 text-sm font-medium text-stone-800 ring-1 ring-stone-300">
                <option value="">All accounts</option>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.mask ? ` ••${a.mask}` : ""}</option>)}
              </select>
            </label>
          )}
        </div>
        {focus && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-600">
            Showing <strong className="text-ink">{focus.kind === "earned" ? "interest earned" : focus.kind === "charged" ? "interest charged" : "bank fees"}</strong> · {focus.label.toLowerCase()}
            <button type="button" onClick={clearFocus} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-bold text-brand-700 hover:bg-brand-50"><X className="h-4 w-4" aria-hidden="true" /> Clear</button>
          </p>
        )}
        {category && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-600">
            Showing <strong className="text-ink">{categoryLabel(category)}</strong>
            <button type="button" onClick={() => setCategory(null)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-bold text-brand-700 hover:bg-brand-50"><X className="h-4 w-4" aria-hidden="true" /> Clear</button>
          </p>
        )}
        {filtered.length === 0 ? (
          <p className="mt-6 pb-2 text-center text-sm text-stone-500">No transactions match. Try a different search or filter.</p>
        ) : (
          <div className="mt-2">
            {byDay.map(([day, list]) => (
              <section key={day} aria-label={formatDate(day)}>
                <h3 className="sticky top-0 z-[1] mt-3 bg-[var(--night-surface,transparent)] py-1 text-xs font-bold uppercase tracking-wider text-stone-500">{formatDate(day)}</h3>
                <ul className="divide-y divide-stone-100">
                  {list.map((t) => {
                    const order = rowOrder.get(t.id) ?? 0;
                    const out = t.amount > 0;
                    const transfer = isTransfer(t, transferIds);
                    return (
                      <li key={t.id} style={{ "--i": order } as React.CSSProperties} className="ns-enter flex items-center gap-3 py-2.5 text-sm">
                        <CategoryIcon category={transfer ? (t.amount < 0 ? "TRANSFER_IN" : "TRANSFER_OUT") : t.category} logo={transfer ? undefined : t.logo} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-stone-800">{t.name}</span>
                          <span className="block truncate text-xs text-stone-500">
                            {transfer ? "Transfer" : categoryLabel(t.category)} · {accountName.get(t.accountId) ?? "Account"}{t.pending ? " · pending" : ""}
                          </span>
                        </span>
                        <span className={`shrink-0 font-bold tabular-nums ${out ? "text-ink" : "text-[var(--color-gain)]"}`}>{out ? "−" : "+"}{money(Math.abs(t.amount))}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {filtered.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-3 min-h-11 w-full rounded-xl text-sm font-bold text-brand-700 ring-1 ring-stone-200 hover:bg-brand-50">
                Show {Math.min(PAGE, filtered.length - shown)} more
              </button>
            )}
          </div>
        )}
      </Card>
    </Shell>
  );
}

function Shell({ children, actions, sub }: { children: React.ReactNode; actions?: React.ReactNode; sub?: string }) {
  return (
    <div className="space-y-4">
      {(sub || actions) && <div className="flex flex-wrap items-center justify-between gap-2">
        {sub && <p className="text-sm text-stone-500">{sub}</p>}
        {actions}
      </div>}
      {children}
    </div>
  );
}

function FlowRow({ icon, label, value, prev, period }: { icon: React.ReactNode; label: string; value: string; prev: string; period: FlowPeriod }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-stone-700">{icon} {label}</span>
      <span className="text-right">
        <strong className="text-ink">{value}</strong>
        <span className="block text-xs text-stone-500">last {period}: {prev}</span>
      </span>
    </div>
  );
}

/** Opens Plaid Link. The link token is fetched only when you click. */
export function ConnectButton({ label, variant = "primary", kind = "bank", className, onConnected }: { label: string; variant?: "primary" | "secondary"; kind?: ConnectKind; className?: string; onConnected: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // First connection: a short NorthStar explanation before Plaid's window opens.
  const [intro, setIntro] = useState(false);
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, meta) => {
      setBusy(true);
      try {
        // A unified Link session can include both a bank and a brokerage. Keep
        // it as "all" so the server loads transactions *and* holdings instead
        // of silently discarding one side of the connection.
        await finishConnection(publicToken, meta, kind);
        onConnected();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save that connection.");
      } finally {
        setBusy(false);
        setToken(null);
      }
    },
    onExit: (error) => { setToken(null); if (error) setError(error.display_message || "The connection was interrupted. Please try again."); },
  });
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  const start = async () => {
    setIntro(false);
    markIntroSeen();
    setError(null);
    setBusy(true);
    try {
      const linkToken = (await post<{ link_token: string }>("/api/plaid/link-token", { kind })).link_token;
      // Kept for banks that log in on their own site and send the user back (see PlaidOAuthResume).
      rememberLinkSession(linkToken, kind);
      setToken(linkToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start Plaid.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col">
      {!intro && <Button
        variant={variant}
        className={className}
        disabled={busy || !!token}
        onClick={() => { if (introSeen()) void start(); else setIntro(true); }}
      >
        <span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4" aria-hidden="true" /> {busy || token ? "Opening…" : label}</span>
      </Button>}
      {intro && <PlaidIntro onContinue={() => { void start(); }} onCancel={() => setIntro(false)} />}
      {error && <span className="mt-1 text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}

/** What happens when you connect, in NorthStar's voice, before Plaid's own window opens. */
function PlaidIntro({ onContinue, onCancel }: { onContinue: () => void; onCancel: () => void }) {
  return (
    <div className="plaid-intro" role="group" aria-labelledby="plaid-intro-title">
      <strong id="plaid-intro-title"><ShieldCheck size={18} aria-hidden="true" /> Connect securely with Plaid</strong>
      <ul>
        <li><Lock size={15} aria-hidden="true" /><span>You sign in on Plaid’s or your bank’s own screen. NorthStar never sees your password.</span></li>
        <li><Eye size={15} aria-hidden="true" /><span>NorthStar can read balances, transactions, and holdings. It can’t move money.</span></li>
        <li><Unplug size={15} aria-hidden="true" /><span>Disconnect anytime from <b>Edit accounts</b>.</span></li>
      </ul>
      <div className="plaid-intro-actions">
        <button type="button" className="wealth-secondary" onClick={onCancel}>Not now</button>
        <button type="button" className="wealth-primary" onClick={onContinue}>Continue to Plaid</button>
      </div>
    </div>
  );
}

export function ConnectCard({ sandbox, configured = true, onConnected }: { sandbox: boolean; configured?: boolean; onConnected: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testConnect = async (profile: string) => {
    setBusy(true); setError(null);
    try { await post("/api/plaid/sandbox-connect", { profile }); await onConnected(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn’t connect. Please try again."); }
    finally { setBusy(false); }
  };
  return <section className="connection-card" aria-labelledby="connection-title">
    <span className="connection-badge"><Landmark size={22} /></span>
    <h2 id="connection-title">Connect your accounts</h2>
    <p>Bring bank balances and investment holdings into one place. Choose what you want to connect.</p>
    <div className="connection-mode">{sandbox ? "Sandbox · test accounts only" : "Production · your real accounts"}</div>
    {!configured ? <div className="connection-setup" role="status"><strong>Connection setup is almost ready.</strong><p>The app owner needs to finish setting up the connection. You can keep using manual accounts in the meantime.</p></div> : <>
      <div className="connection-options"><div><h3>Bank accounts</h3><p>Checking, savings, and everyday spending.</p><ConnectButton label="Connect a bank" onConnected={onConnected} /></div><div><h3>Investment accounts</h3><p>Brokerage, IRA, and retirement holdings.</p><ConnectButton label="Connect a portfolio" kind="investments" onConnected={onConnected} /></div></div>
      {sandbox && <div className="connection-tests"><span>Try student sandbox data: checking, savings, a credit card, and investment balances.</span><button disabled={busy} onClick={() => testConnect("student")}>Use a test student bank</button><button disabled={busy} onClick={() => testConnect("investments")}>{busy ? "Connecting…" : "Test portfolio"}</button></div>}
    </>}
    {error && <p className="connection-error" role="alert">{error}</p>}
    <p className="connection-note">{sandbox ? "Sandbox uses made-up accounts and holdings. It cannot connect your real portfolio." : "You choose which accounts to share through Plaid. Investment values refresh periodically; they are not real-time market quotes."} Connecting an account does not enable trading.</p>
  </section>;
}
