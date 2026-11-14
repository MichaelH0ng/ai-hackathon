import { ArrowDownLeft, ArrowUpRight, CalendarClock, Landmark, Link2, RefreshCw, Unplug, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { formatDate } from "../lib/dates";
import { formatMoney } from "../lib/finance";
import {
  ACCOUNT_GROUPS,
  type FlowPeriod,
  categoryEmoji,
  categoryLabel,
  detectTransferIds,
  isLiability,
  isTransfer,
  netWorth,
  periodFlow,
  spendableCash,
  topCategories,
  upcomingBills,
} from "../lib/money";
import type { MoneyGoal } from "../lib/types";
import { type Bank, api, post } from "../lib/useBank";
import { Button, Card, Notice } from "./ui";

const money = (n: number) => formatMoney(n, Math.abs(n) < 1000 && n % 1 !== 0);
const days = (amount: number, g: MoneyGoal) => (g.weekly > 0 ? (amount / g.weekly) * 7 : Infinity);
const daysLabel = (d: number) => (!isFinite(d) ? "" : d < 1 ? "<1 day" : `${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"}`);

/** Money dashboard: your real balances and spending from Plaid, shown in days of your goals. */
export function MoneyDashboard({
  bank,
  goals,
  onUpdateGoal,
  onOpenGoal,
  onNewGoal,
}: {
  bank: Bank;
  goals: MoneyGoal[];
  onUpdateGoal: (g: MoneyGoal) => void;
  onOpenGoal: (id: string) => void;
  onNewGoal: () => void;
}) {
  const { status, data, loading, error, reload: load } = bank;
  const [flow, setFlow] = useState<FlowPeriod>("month");
  const [focusId, setFocusId] = useState(goals[0]?.id ?? "");
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
  const focus = goals.find((g) => g.id === focusId) ?? goals[0];

  if (loading && !data) {
    return (
      <Shell>
        <Card><p className="animate-pulse text-stone-600">Loading your accounts…</p></Card>
      </Shell>
    );
  }

  if (error && !data) {
    return (
      <Shell>
        <Notice tone="warn">{error}</Notice>
        <Button className="mt-3" onClick={load}>Try again</Button>
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

  const nw = netWorth(data.accounts);
  const cash = spendableCash(data.accounts);
  const f = periodFlow(data.transactions, transferIds, flow);
  const net = f.current.in - f.current.out;
  const cats = topCategories(data.transactions, transferIds, 30);
  const maxCat = cats[0]?.value ?? 1;
  const bills = upcomingBills(data.transactions, transferIds).slice(0, 5);
  const recent = data.transactions.slice(0, 10);
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const problems = data.status.filter((s) => s.problem);

  return (
    <Shell
      actions={
        <button onClick={load} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
        </button>
      }
      sub={`${data.status.map((s) => s.institution).join(" · ")} · updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${data.env === "sandbox" ? " · sandbox test data" : ""}`}
    >
      {problems.length > 0 && <Notice tone="warn">Couldn't fully refresh {problems.map((p) => p.institution).join(", ")} ({problems[0].problem}).</Notice>}
      {waiting && <Notice tone="info">Your bank is still sending transactions. This page refreshes on its own in a few seconds.</Notice>}

      {/* goal lens */}
      {goals.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-stone-600">Show spending in days of:</span>
          {goals.map((g) => (
            <button
              key={g.id}
              onClick={() => setFocusId(g.id)}
              aria-pressed={g.id === focus?.id}
              className={`min-h-9 rounded-full px-3 font-bold transition-colors duration-200 ${g.id === focus?.id ? "bg-brand-600 text-white" : "bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-brand-50"}`}
            >
              {g.name}
            </button>
          ))}
        </div>
      ) : (
        <Notice tone="info">
          <button onClick={onNewGoal} className="font-bold underline">Add a savings goal</button> to see what your spending costs it, in days.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Net worth */}
        <Card className="lg:col-span-2">
          <p className="text-sm font-semibold text-stone-500">Net worth</p>
          <p className="font-display text-4xl font-bold text-ink sm:text-5xl">{formatMoney(nw.net)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Mini label="Assets" value={formatMoney(nw.assets)} tone="text-emerald-700" />
            <Mini label="Debts" value={formatMoney(nw.debts)} tone="text-amber-700" />
            <Mini label="Spendable cash" value={formatMoney(cash)} tone="text-brand-700" />
          </div>
        </Card>

        {/* Cash flow */}
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">Cash flow</h2>
            <div className="flex rounded-full bg-stone-100 p-1 text-xs font-bold" role="tablist" aria-label="Cash flow period">
              {(["week", "month"] as FlowPeriod[]).map((p) => (
                <button key={p} role="tab" aria-selected={flow === p} onClick={() => setFlow(p)} className={`min-h-8 rounded-full px-3 ${flow === p ? "bg-white text-ink shadow-sm" : "text-stone-500"}`}>
                  This {p}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <FlowRow icon={<ArrowDownLeft className="h-4 w-4 text-emerald-600" />} label="Money in" value={money(f.current.in)} prev={money(f.previous.in)} />
            <FlowRow icon={<ArrowUpRight className="h-4 w-4 text-amber-600" />} label="Money out" value={money(f.current.out)} prev={money(f.previous.out)} />
          </div>
          <p className={`mt-3 font-display text-2xl font-bold ${net >= 0 ? "text-emerald-700" : "text-amber-700"}`}>
            {net >= 0 ? "+" : "−"}{money(Math.abs(net))} <span className="font-sans text-sm font-semibold text-stone-500">net this {flow}</span>
          </p>
        </Card>

        {/* Top categories */}
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-bold text-ink">Top spending, last 30 days</h2>
          {cats.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No spending yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {cats.map((c) => (
                <li key={c.key}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold text-stone-800"><span aria-hidden="true">{c.emoji}</span> {c.label}</span>
                    <span className="shrink-0">
                      <strong className="text-ink">{money(c.value)}</strong>
                      {focus && isFinite(days(c.value, focus)) && <span className="ml-2 text-xs font-bold text-amber-700">= {daysLabel(days(c.value, focus))} of {focus.name}</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-stone-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(c.value / maxCat) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Upcoming bills */}
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><CalendarClock className="h-5 w-5 text-brand-600" aria-hidden="true" /> Upcoming bills</h2>
          {bills.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No repeating charges found yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-100">
              {bills.map((b) => (
                <li key={b.name} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-stone-800">{b.name}</span>
                    <span className="text-xs text-stone-500">{b.cadence} · {b.daysUntil === 0 ? "today" : `in ${b.daysUntil}d (${formatDate(b.nextDue)})`}</span>
                  </span>
                  <strong className="shrink-0 text-ink">{money(b.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent transactions */}
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-bold text-ink">Recent transactions</h2>
          <ul className="mt-2 divide-y divide-stone-100">
            {recent.map((t) => {
              const out = t.amount > 0;
              const transfer = isTransfer(t, transferIds);
              const d = focus && out && !transfer ? days(t.amount, focus) : null;
              return (
                <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100" aria-hidden="true">{categoryEmoji(t.category)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-stone-800">{t.name}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {formatDate(t.date)} · {transfer ? "Transfer" : categoryLabel(t.category)} · {accountName.get(t.accountId) ?? "Account"}{t.pending ? " · pending" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block font-bold ${out ? "text-ink" : "text-emerald-700"}`}>{out ? "−" : "+"}{money(Math.abs(t.amount))}</span>
                    {d != null && isFinite(d) && <span className="block text-xs font-bold text-amber-700">+{daysLabel(d)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {focus && <p className="mt-2 text-xs text-stone-500">"+N days" is how much later {focus.name} would arrive at {formatMoney(focus.weekly)}/week.</p>}
        </Card>

        {/* Goals linked to accounts */}
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Link2 className="h-5 w-5 text-brand-600" aria-hidden="true" /> Your goals</h2>
          {goals.length === 0 ? (
            <Button className="mt-3 w-full" onClick={onNewGoal}>Start a savings goal</Button>
          ) : (
            <ul className="mt-3 space-y-4">
              {goals.map((g) => {
                const pct = Math.round(Math.min(1, g.saved / g.target) * 100);
                return (
                  <li key={g.id}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <button onClick={() => onOpenGoal(g.id)} className="truncate font-bold text-ink hover:underline">{g.name}</button>
                      <span className="shrink-0 text-stone-600">{formatMoney(g.saved)} / {formatMoney(g.target)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                    <label className="mt-2 block text-xs font-semibold text-stone-600">
                      Savings come from
                      <select
                        value={g.linkedAccountId ?? ""}
                        onChange={(e) => {
                          const a = data.accounts.find((x) => x.id === e.target.value);
                          onUpdateGoal({ ...g, linkedAccountId: a?.id, saved: a ? Math.round(a.current * 100) / 100 : g.saved });
                        }}
                        className="mt-1 block min-h-10 w-full rounded-xl bg-stone-50 px-2 text-sm font-medium text-stone-800 ring-1 ring-stone-300"
                      >
                        <option value="">Tracked by hand</option>
                        {data.accounts.filter((a) => a.type === "depository").map((a) => (
                          <option key={a.id} value={a.id}>{a.name}{a.mask ? ` ••${a.mask}` : ""} ({formatMoney(a.current)})</option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Accounts */}
        <Card className="lg:col-span-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Landmark className="h-5 w-5 text-brand-600" aria-hidden="true" /> Accounts</h2>
          <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ACCOUNT_GROUPS.map((grp) => {
              const list = data.accounts.filter(grp.match);
              if (!list.length) return null;
              const total = list.reduce((s, a) => s + a.current, 0);
              return (
                <div key={grp.key}>
                  <p className="flex justify-between text-xs font-bold uppercase tracking-wider text-stone-500">
                    <span>{grp.label}</span>
                    <span className={isLiability(list[0]) ? "text-amber-700" : "text-stone-700"}>{formatMoney(total)}</span>
                  </p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {list.map((a) => (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span className="truncate text-stone-700">{a.name}{a.mask ? <span className="text-stone-400"> ••{a.mask}</span> : null}</span>
                        <span className="shrink-0 font-semibold text-ink">{formatMoney(a.current)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-stone-100 pt-4">
            <ConnectButton label="Connect another bank" variant="secondary" onConnected={load} />
            {data.status.map((s) => (
              <button
                key={s.itemId}
                onClick={async () => {
                  await api(`/api/plaid/items/${s.itemId}`, { method: "DELETE" });
                  load();
                }}
                className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-stone-500 hover:bg-stone-100"
              >
                <Unplug className="h-4 w-4" aria-hidden="true" /> Disconnect {s.institution}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children, actions, sub }: { children: React.ReactNode; actions?: React.ReactNode; sub?: string }) {
  return (
    <main id="main" className="mx-auto max-w-6xl space-y-4 px-4 pb-16 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold text-ink">Money</h1>
          {sub && <p className="text-sm text-stone-500">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </main>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-stone-50 p-3">
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className={`truncate font-display text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function FlowRow({ icon, label, value, prev }: { icon: React.ReactNode; label: string; value: string; prev: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-stone-700">{icon} {label}</span>
      <span className="text-right">
        <strong className="text-ink">{value}</strong>
        <span className="block text-xs text-stone-400">last: {prev}</span>
      </span>
    </div>
  );
}

/** Opens Plaid Link. The link token is fetched only when you click. */
export function ConnectButton({ label, variant = "primary", kind = "bank", className, onConnected }: { label: string; variant?: "primary" | "secondary"; kind?: "bank" | "investments" | "all"; className?: string; onConnected: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, meta) => {
      setBusy(true);
      try {
        // With the unified connector, persist the product that matches the
        // selected account type so the server fetches transactions or holdings.
        const selectedKind = kind === "all" && meta.accounts.some((account) => account.type === "investment") ? "investments" : kind === "all" ? "bank" : kind;
        await post("/api/plaid/exchange", { public_token: publicToken, institution: meta.institution?.name, kind: selectedKind });
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

  return (
    <span className="inline-flex flex-col">
      <Button
        variant={variant}
        className={className}
        disabled={busy || !!token}
        onClick={async () => {
          setError(null);
          setBusy(true);
          try {
            setToken((await post<{ link_token: string }>("/api/plaid/link-token", { kind })).link_token);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't start Plaid.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4" aria-hidden="true" /> {busy || token ? "Opening…" : label}</span>
      </Button>
      {error && <span className="mt-1 text-xs text-red-700" role="alert">{error}</span>}
    </span>
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
