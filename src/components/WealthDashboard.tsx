import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleCheck, CircleDollarSign, Compass, Landmark, Pencil, Plus, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2, X } from "lucide-react";
import { balancesAreFresh, type Bank } from "../lib/useBank";
import { maskedAmount, moneyHidden } from "../lib/privacy";
import type { MoneyGoal } from "../lib/types";
import { HomeOverview } from "./Landing";
import { CountUp } from "./CountUp";
import SpringCheck from "./SpringCheck";
import StarBorder from "./StarBorder";
import { ProgressRing } from "./ProgressRing";
import { SavingsPlanner } from "./SavingsPlanner";
import { GoalPathPlanner } from "./GoalPathPlanner";
import { CashSplitEditor } from "./CashSplitEditor";
import { detectTransferIds, gainText, isLiability, isTransfer, moneyKind } from "../lib/money";
import { feeAlerts, interestAndFees, investingFlow, investmentAccountsSummary, investmentsTogether, lastPayments, type InterestOrFee } from "../lib/accountInsights";
import { addDays, formatDate, todayISO } from "../lib/dates";
import { cashOnHand, envelopes } from "../lib/envelopes";
import { bankDataForPlan, includedItems } from "../lib/planningAccounts";
import { savingsCapacity } from "../lib/savingsCapacity";
import { formatExact, formatMoney, weeklyNeededForDeadline } from "../lib/finance";
import { annualSpending, budgetBalanceProgress, opportunityCost, retirementProjection, type RetirementPoint, type SpendingFrequency, type RepeatUnit } from "../lib/planning";
import { BudgetNorthStar, NorthStar } from "./NorthStar";
import { MoneyAssistant } from "./MoneyAssistant";
import { GoalReminders } from "./GoalReminders";
import type { MoneyAssistantContext } from "../lib/moneyAssistant";
import { ConnectButton, MoneyDashboard } from "./MoneyDashboard";
import { ConnectedBanks } from "./ConnectedBanks";
import { AccountDetail } from "./AccountDetail";
import { dueText } from "./DebtPanel";
import { ReconnectButton } from "./ReconnectButton";
import { PageBanner } from "./PageBanner";
import { accountIdRemapper } from "../lib/accountMatch";
import { Segmented } from "./Segmented";
import { AssetSplit } from "./AssetSplit";

export type DashboardTab = "Overview" | "Accounts" | "Plan" | "Goals" | "Activity";

const usd = (value: number) => formatExact(value);
const kinds = ["Checking", "Savings", "Roth IRA", "Traditional IRA", "401(k)", "Brokerage", "Property", "Other asset", "Credit card", "Loan"];
export interface Asset { id: string; name: string; institution: string; kind: string; balance: number; sample?: boolean; updatedAt?: string }
export interface Plan { assets: Asset[]; excludedAccountIds: string[]; /** Your nicknames for linked accounts, by account id. */ accountNames: Record<string, string>; /** Linked accounts you marked closed: listed under Closed and left out of totals. */ closedAccountIds: string[]; risk: string; horizon: string; future: string; income: number; essentials: number; lifestyle: number; currentAge: number | null; retirementAge: number | null; retirementMonthly: number; retirementReturn: number }
const initial: Plan = { assets: [], excludedAccountIds: [], accountNames: {}, closedAccountIds: [], risk: "", horizon: "", future: "", income: 0, essentials: 0, lifestyle: 0, currentAge: null, retirementAge: null, retirementMonthly: 0, retirementReturn: 5 };
const KEY = "tradeoff:wealth:v1";
export function readPlan(): Plan { try { const saved = { ...initial, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; const ids = (value: unknown) => Array.isArray(value) ? value.filter((id: unknown): id is string => typeof id === "string") : []; const names = saved.accountNames && typeof saved.accountNames === "object" ? Object.fromEntries(Object.entries(saved.accountNames as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1].trim())) : {}; return { ...saved, excludedAccountIds: ids(saved.excludedAccountIds), closedAccountIds: ids(saved.closedAccountIds), accountNames: names }; } catch { return initial; } }
const debt = (kind: string) => kind === "Credit card" || kind === "Loan";
const investment = (kind: string) => ["Roth IRA", "Traditional IRA", "401(k)", "Brokerage", "Investment"].includes(kind);
const retirementAccount = (kind: string) => ["Roth IRA", "Traditional IRA", "401(k)"].includes(kind);
const accountGroups = [
  { key: "cash", label: "Cash", match: (kind: string) => kind === "Checking" || kind === "Savings" },
  { key: "invest", label: "Investments", match: investment },
  { key: "other", label: "Property & other", match: (kind: string) => kind === "Property" || kind === "Other asset" },
  { key: "debt", label: "Credit & loans", match: debt },
] as const;
const STALE_DAYS = 30;
/** A bank's account name made readable: no broken symbols, no repeated bank name, "...2793" as "••2793", Title Case instead of ALL CAPS. */
function cleanAccountName(name: string, institution = ""): string {
  let out = name.replace(/\uFFFD+/g, "").replace(/[®™]/g, "").replace(/\s*\.{3}(\d{4})$/, " ••$1").replace(/\s+/g, " ").trim();
  const bankPrefix = institution.replace(/ \(test\)$/, "").toUpperCase();
  if (bankPrefix && out.toUpperCase().startsWith(bankPrefix + " ")) out = out.slice(bankPrefix.length + 1);
  if (out === out.toUpperCase()) out = out.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());
  return out ? out[0].toUpperCase() + out.slice(1) : name;
}
function daysSince(iso: string) { return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)); }
function updatedLabel(iso?: string) {
  if (!iso) return "Update date unknown";
  const d = daysSince(iso);
  return d === 0 ? "Updated today" : d === 1 ? "Updated yesterday" : d < 14 ? `Updated ${d} days ago` : d < 60 ? `Updated ${Math.floor(d / 7)} weeks ago` : `Updated ${Math.floor(d / 30)} months ago`;
}
const months = (n: number) => !Number.isFinite(n) ? "Not funded" : n === 0 ? "Funded" : n < 1 ? "< 1 month" : `${Math.ceil(n)} months`;

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="wealth-field"><span>{label}</span>{children}</label>; }
function Amount({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) { return <Field label={label}><div className="wealth-currency"><span>$</span><input type="number" min="0" max="1000000000000" step="0.01" required value={value || ""} placeholder="0" onChange={e => onChange(Math.max(0, Number(e.target.value)))} /></div></Field>; }
function GrowthRateField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  // Keep the draft as text: coercion while typing removes decimal points and
  // replaces an empty field with zero, moving the caret during digit edits.
  const [draft, setDraft] = useState(() => String(value));
  const [error, setError] = useState(false);
  function commit() {
    const trimmed = draft.trim();
    const rate = Number(trimmed);
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed) || !Number.isFinite(rate) || rate < 0 || rate > 20) {
      setError(true);
      return;
    }
    setError(false);
    setDraft(String(rate));
    onChange(rate);
  }
  return <Field label="Estimated annual growth"><div className="wealth-percent"><input
    type="text"
    inputMode="decimal"
    value={draft}
    aria-invalid={error}
    aria-describedby="retirement-growth-help"
    onChange={event => { setDraft(event.target.value); setError(false); }}
    onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
  /><span>%</span></div><small id="retirement-growth-help" className="wealth-note" role={error ? "status" : undefined}>{error
    ? `Enter a number from 0 to 20. The estimate still uses ${value}%.`
    : "Enter 0–20%. Applied when you leave the field or press Enter."}</small></Field>;
}
function holdingMoney(value: number, currency: string | null) {
  if (!currency) return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} (currency unavailable)`;
  try { const text = new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value); return moneyHidden() ? maskedAmount(text) : text; }
  catch { return `${value.toLocaleString()} ${currency}`; }
}

export function WealthDashboard(props: { bank: Bank; goals: MoneyGoal[]; completedGoals?: MoneyGoal[]; priceCheck: React.ReactNode; profileName?: string; hourlyWage?: number | null; onUpdateGoal: (g: MoneyGoal) => void; onAddGoal?: (g: MoneyGoal) => void; onRemoveGoal?: (id: string) => void; onOpenGoal: (id: string) => void; onNewGoal: () => void; onCheck: () => void; onSettings: () => void; selectedTab: DashboardTab; onTabChange: (tab: DashboardTab) => void }) {
  const { bank, goals, onNewGoal, onOpenGoal } = props;
  const [plan, setPlan] = useState<Plan>(readPlan);
  const tab = props.selectedTab;
  const setTab = props.onTabChange;
  const [northStarPreview, setNorthStarPreview] = useState<number | null>(null);
  const [editingSplit, setEditingSplit] = useState(false);
  /** The linked account open in its own panel, and the account Activity should filter to. */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activityAccount, setActivityAccount] = useState<string | null>(null);
  const [activityFocus, setActivityFocus] = useState<{ kind: InterestOrFee; since: string; label: string } | null>(null);
  // Filters opened from Accounts last only for that visit to Activity.
  useEffect(() => { if (tab !== "Activity") { setActivityAccount(null); setActivityFocus(null); } }, [tab]);
  const [groupBy, setGroupBy] = useState<"type" | "bank">(() => { try { return localStorage.getItem("northstar.accountsGroupBy") === "bank" ? "bank" : "type"; } catch { return "type"; } });
  const closeDetail = useCallback(() => setDetailId(null), []);
  const chooseGroupBy = (next: "type" | "bank") => { setGroupBy(next); try { localStorage.setItem("northstar.accountsGroupBy", next); } catch { /* remembered for this visit */ } };
  const [assetForm, setAssetForm] = useState<Asset | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const modalOpen = !!assetForm;
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAssetForm(null);
      if (event.key !== "Tab") return;
      const controls = modalRef.current?.querySelectorAll<HTMLElement>('button, input, select, textarea');
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [modalOpen]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(plan)); } catch { /* Storage unavailable: changes last for this session. */ } }, [plan]);
  const update = (patch: Partial<Plan>) => setPlan(p => ({ ...p, ...patch }));
  // After a bank is reconnected, keep accounts you left out of your plan left out (Plaid issues new IDs).
  useEffect(() => {
    if (!bank.data) return;
    const remap = accountIdRemapper(bank.data.accounts);
    setPlan(p => {
      const excluded = [...new Set(p.excludedAccountIds.map(remap))];
      const closedIds = [...new Set(p.closedAccountIds.map(remap))];
      const names = Object.fromEntries(Object.entries(p.accountNames).map(([id, nickname]) => [remap(id), nickname]));
      const same = excluded.join() === p.excludedAccountIds.join() && closedIds.join() === p.closedAccountIds.join() && JSON.stringify(names) === JSON.stringify(p.accountNames);
      return same ? p : { ...p, excludedAccountIds: excluded, closedAccountIds: closedIds, accountNames: names };
    });
  }, [bank.data]);
  const linked: Asset[] = (bank.data?.accounts ?? []).map(a => {
    const retirementType = a.subtype?.includes("roth")
      ? "Roth IRA"
      : a.subtype?.includes("401")
        ? "401(k)"
        : a.subtype?.includes("ira")
          ? "Traditional IRA"
          : null;
    return {
      id: a.id,
      name: plan.accountNames[a.id] || a.name,
      institution: a.institution,
      kind: isLiability(a)
        ? a.type === "credit" ? "Credit card" : "Loan"
        : a.subtype === "checking" ? "Checking"
          : a.subtype === "savings" ? "Savings"
            : retirementType ?? (a.type === "investment" || a.type === "brokerage" ? "Investment" : "Other asset"),
      balance: a.current,
    };
  });
  const assets = [...linked, ...plan.assets];
  // Closed accounts count like accounts left out of the plan: not in totals, goals, or planning.
  const outOfPlan = [...plan.excludedAccountIds, ...plan.closedAccountIds];
  const planningBankData = bankDataForPlan(bank.data, outOfPlan);
  const planningAssets = includedItems(assets, outOfPlan);
  const positive = planningAssets.filter(a => !debt(a.kind));
  const total = positive.reduce((sum, a) => sum + a.balance, 0);
  const debts = planningAssets.filter(a => debt(a.kind)).reduce((s, a) => s + a.balance, 0);
  const retirementBalance = positive.filter(a => retirementAccount(a.kind)).reduce((s, a) => s + a.balance, 0);
  const currentAge = typeof plan.currentAge === "number" && Number.isInteger(plan.currentAge) && plan.currentAge >= 1 && plan.currentAge <= 100
    ? plan.currentAge
    : null;
  const retirementAge = typeof plan.retirementAge === "number" && Number.isInteger(plan.retirementAge) && plan.retirementAge >= 1 && plan.retirementAge <= 100
    ? plan.retirementAge
    : null;
  const retirementMonthly = typeof plan.retirementMonthly === "number" && Number.isFinite(plan.retirementMonthly) && plan.retirementMonthly >= 0
    ? plan.retirementMonthly
    : 0;
  const retirementReturn = typeof plan.retirementReturn === "number" && Number.isFinite(plan.retirementReturn) && plan.retirementReturn >= 0 && plan.retirementReturn <= 20
    ? plan.retirementReturn
    : initial.retirementReturn;
  const retirementYears = currentAge !== null && retirementAge !== null && retirementAge > currentAge
    ? retirementAge - currentAge
    : null;
  const retirementPoints = retirementYears === null
    ? []
    : retirementProjection(retirementBalance, retirementMonthly, retirementReturn, retirementYears);
  const activeGoals = goals.filter((goal) => goal.saved < goal.target);
  const monthlyGoals = activeGoals.reduce((s, goal) => s + Math.max(0, goal.weekly) * 52 / 12, 0);
  // A Plan-page view includes every active goal, while the goal dial excludes the
  // one currently being adjusted. Both use the same income/spending estimator.
  const planCapacity = savingsCapacity({
    bankData: planningBankData,
    goals,
    selectedGoalId: "__monthly-plan__",
    manualMonthlyIncome: plan.income,
    manualMonthlyExpenses: plan.essentials + plan.lifestyle,
  });
  const totalGoalTarget = goals.reduce((s, g) => s + g.target, 0);
  const savedTowardGoals = goals.reduce((s, g) => s + Math.min(g.target, Math.max(0, g.saved)), 0);
  const goalProgress = totalGoalTarget > 0 ? Math.min(100, savedTowardGoals / totalGoalTarget * 100) : 0;
  const updateNorthStarPreview = useCallback((progress: number | null) => setNorthStarPreview(progress), []);
  const available = planCapacity.status === "missing-income"
    ? 0
    : planCapacity.monthlyIncome - planCapacity.monthlySpending - planCapacity.monthlyOtherGoals - planCapacity.monthlyBuffer;
  const weeklyGoalCapacity = planCapacity.status === "missing-income"
    ? 0
    : Math.max(0, (planCapacity.monthlyIncome - planCapacity.monthlySpending - planCapacity.monthlyBuffer) * 12 / 52);
  const budgetProgress = budgetBalanceProgress(planCapacity.monthlyIncome, available);
  function sample() {
    update({ assets: [...plan.assets, ...[
      { name: "Everyday checking", institution: "Chase", kind: "Checking", balance: 3250 },
      { name: "High-yield savings", institution: "Ally", kind: "Savings", balance: 8500 },
      { name: "Roth IRA", institution: "Fidelity", kind: "Roth IRA", balance: 12400 },
      { name: "Individual brokerage", institution: "Vanguard", kind: "Brokerage", balance: 6750 },
    ].map(a => ({ ...a, id: crypto.randomUUID(), sample: true, updatedAt: new Date().toISOString() }))] });
  }
  const addAsset = () => setAssetForm({ id: crypto.randomUUID(), name: "", institution: "", kind: "Checking", balance: 0 });
  // Facts for each linked account's row: interest it paid you this year, and the latest payment toward a card or loan.
  const linkedTx = bank.data?.transactions ?? [];
  const interestThisYear = new Map(interestAndFees(linkedTx, 365).byAccount.map(r => [r.accountId, r.earned]));
  const payments = bank.data ? lastPayments(linkedTx, bank.data.accounts) : new Map<string, { amount: number; date: string }>();
  const accountRow = (a: Asset, index = 0) => {
    const isLinked = linked.some(account => account.id === a.id);
    const isManual = plan.assets.some(m => m.id === a.id);
    const includedInPlan = !plan.excludedAccountIds.includes(a.id);
    const isClosed = plan.closedAccountIds.includes(a.id);
    const stale = isManual && !a.sample && (!a.updatedAt || daysSince(a.updatedAt) > STALE_DAYS);
    const holdings = isLinked ? bank.data?.holdings?.filter(holding => holding.accountId === a.id) ?? [] : [];
    // Say something only when it needs attention: a connection problem, or what's due on a card or loan.
    const institution = isLinked ? bank.data?.accounts.find(account => account.id === a.id)?.institution : undefined;
    const problem = institution ? bank.data?.status.find(st => st.problem && st.institution === institution) : undefined;
    const found = isLinked ? bank.data?.debts?.find(d => d.accountId === a.id) : undefined;
    const debtInfo = found && (found.minimumPayment != null || found.nextDueDate || found.apr != null || found.isOverdue) ? found : undefined;
    const bankAccount = isLinked ? bank.data?.accounts.find(account => account.id === a.id) : undefined;
    const brand = institution ? bank.data?.status.find(st => st.institution === institution) : undefined;
    const logo = brand?.logo;
    // No logo from Plaid (Wells Fargo, for one): the bank's initials on its brand color.
    const initials = !logo && brand?.color && /^#[0-9a-f]{6}$/i.test(brand.color) ? (institution ?? "").replace(/ \(test\)$/, "").split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(of|the|and|&)$/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("") : "";
    const isDebt = debt(a.kind);
    // Credit used: what's owed out of the card's limit. Under 30% is the usual guideline for credit scores.
    const limit = bankAccount?.type === "credit" && bankAccount.limit && bankAccount.limit > 0 ? bankAccount.limit : null;
    const used = limit ? Math.max(0, a.balance) / limit : null;
    const earned = isLinked ? interestThisYear.get(a.id) ?? 0 : 0;
    const paid = isLinked ? payments.get(a.id) : undefined;
    return <div style={{ "--i": index } as React.CSSProperties} className={`ns-enter wealth-account-block${includedInPlan && !isClosed ? "" : " is-excluded"}${isLinked ? " is-openable" : ""}`} key={a.id}>
      {/* Linked accounts: a click anywhere on the row opens the account (except its own checkbox or buttons). */}
      <div className="wealth-account" onClick={isLinked ? event => { if (!(event.target as HTMLElement).closest("button, a, label, input")) setDetailId(a.id); } : undefined}><label className={`wealth-account-plan-checkbox${includedInPlan && !isClosed ? " is-checked" : ""}`} title={isClosed ? "Closed: not counted" : includedInPlan ? "Included in your plan" : "Excluded from your plan"}><input type="checkbox" checked={includedInPlan && !isClosed} disabled={isClosed} aria-label={isClosed ? `${a.name} is closed and not counted` : `${includedInPlan ? "Exclude" : "Include"} ${a.name} in your plan`} onChange={() => update({ excludedAccountIds: includedInPlan ? [...plan.excludedAccountIds, a.id] : plan.excludedAccountIds.filter((id) => id !== a.id) })} /><span aria-hidden="true">{includedInPlan && !isClosed && <Check size={13} strokeWidth={3} />}</span></label><span className={`wealth-account-icon ${investment(a.kind) ? "invest" : ""}${logo ? " has-logo" : ""}`}>{logo ? <img src={logo} alt="" width={26} height={26} /> : initials ? <span className="wealth-account-monogram" style={{ background: brand!.color! }} aria-hidden="true">{initials}</span> : investment(a.kind) ? <ArrowUpRight size={20} /> : <Landmark size={20} />}</span><div className="wealth-account-name">{isLinked ? <button type="button" className="wealth-account-open" onClick={() => setDetailId(a.id)} aria-label={`Open ${a.name}`}><strong>{a.name}</strong></button> : <strong>{a.name}</strong>}<span>{a.institution || "Personal account"} · {a.kind}{a.sample ? " · Sample" : ""}</span>

        {isManual && !a.sample && <span className={`wealth-account-status${stale ? " stale" : ""}`}>Manual · {updatedLabel(a.updatedAt)} · <button className="wealth-inline-link" onClick={() => setAssetForm(a)}>Update</button></span>}
      </div><span className="wealth-balance-wrap"><strong className="wealth-balance">{isDebt ? "−" : ""}{usd(a.balance)}</strong></span>{isManual && <button className="wealth-icon-button" aria-label={`Edit ${a.name}`} onClick={() => setAssetForm(a)}><SlidersHorizontal size={15} /></button>}{isLinked && <ChevronRight size={16} className="wealth-account-chevron" aria-hidden="true" />}</div>
      {(problem || debtInfo || used !== null || earned >= 1 || paid) && <div className="wealth-account-extra">
        {problem && <span className="wealth-account-status stale accounts-signin">{problem.problem === "ITEM_LOGIN_REQUIRED" ? "Not updating: sign in again above" : "Couldn't refresh this account. Showing its last balance."}</span>}
        {debtInfo && <span className="wealth-account-debt">{[debtInfo.minimumPayment != null ? `${usd(debtInfo.minimumPayment)} minimum` : null, debtInfo.nextDueDate ? dueText(debtInfo.nextDueDate) : null, debtInfo.apr != null ? `${debtInfo.apr.toFixed(2)}% APR` : null].filter(Boolean).join(" · ")}{debtInfo.isOverdue && <strong> · Overdue, per your bank</strong>}</span>}
        {earned >= 1 && <span className="wealth-account-interest">Earned {usd(earned)} in interest over the past year</span>}
        {paid && <span className="wealth-account-paid">Paid {usd(paid.amount)} on {formatDate(paid.date)}</span>}
        {used !== null && <span className={`wealth-account-credit${used > 0.3 ? " is-high" : ""}`}>
          <span className="wealth-account-credit-bar" role="progressbar" aria-label={`${a.name} credit used`} aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.min(100, used * 100)}%` }} /></span>
          <span>{Math.round(used * 100)}% of {usd(limit!)} limit used{used > 0.3 ? " · aim for under 30%" : ""}</span>
        </span>}
      </div>}
      {holdings.length > 0 && <details className="wealth-account-holdings"><summary>{holdings.length} investment holding{holdings.length === 1 ? "" : "s"}</summary><ul>{holdings.map(holding => <li key={holding.id}><span><strong>{holding.ticker || holding.name}</strong><small>{holding.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} shares{gainText(holding)}</small></span><strong>{holdingMoney(holding.value, holding.currency)}</strong></li>)}</ul></details>}
    </div>;
  };
  /** Net worth beside "Edit accounts" in the Accounts banner (replaces the separate totals card). */
  const accountsNetWorth = assets.length > 0 && <div className="accounts-banner-worth" aria-label="Net worth in your plan">
    <span>Net worth</span>
    <strong className={total - debts > 0 ? "is-gain" : total - debts < 0 ? "is-debt" : ""}><CountUp value={total - debts} format={n => `${n < 0 ? "−" : ""}${usd(Math.abs(n))}`} /></strong>
  </div>;
  // Banks that stopped syncing, shown first so a stale balance isn't mistaken for a real one.
  const attention = (bank.data?.status ?? []).filter(st => st.problem);
  // Interest charged or bank fees in the last 3 months: worth a look only when there are some.
  const charges = feeAlerts(linkedTx.filter(t => !plan.closedAccountIds.includes(t.accountId)), 90);
  const accountLabel = (id: string) => { const a = bank.data?.accounts.find(x => x.id === id); return a ? `${a.institution.replace(/ \(test\)$/, "")} ${plan.accountNames[a.id] || cleanAccountName(a.name, a.institution)}` : "An account"; };
  // Banks whose permission for Plaid ends within 30 days: reconnecting renews it before the data freezes.
  const expiring = (bank.data?.status ?? []).filter(st => !st.problem && st.consentExpiresAt && Date.parse(st.consentExpiresAt) - Date.now() < 30 * 86_400_000);
  const openAssets = assets.filter(a => !plan.closedAccountIds.includes(a.id));
  const closedAssets = assets.filter(a => plan.closedAccountIds.includes(a.id));
  const groups: { key: string; label: string; icon?: React.ReactNode; list: Asset[]; owed: boolean }[] = groupBy === "type"
    ? accountGroups.map(group => ({ key: group.key, label: group.label, list: openAssets.filter(a => group.match(a.kind)), owed: group.key === "debt" }))
    : [...new Set(openAssets.map(a => (a.institution || "Manual accounts").replace(/ \(test\)$/, "")))].sort().map(name => ({ key: name, label: name, list: openAssets.filter(a => (a.institution || "Manual accounts").replace(/ \(test\)$/, "") === name), owed: false }));
  const groupTotal = (list: Asset[]) => list.reduce((sum, a) => sum + (debt(a.kind) ? -a.balance : a.balance), 0);
  const accountList = <section className="wealth-card">
    <div className="wealth-section-head accounts-list-head">
      <h2>Where your money is</h2>
      {assets.length > 1 && <Segmented label="Group accounts by" options={[{ value: "type", label: "Type" }, { value: "bank", label: "Bank" }]} value={groupBy} onChange={chooseGroupBy} />}
    </div>
    {(attention.length > 0 || expiring.length > 0 || charges.length > 0) && <div className="accounts-attention" role="status">
      <strong>Needs attention</strong>
      {charges.map(c => <div key={`${c.accountId}-${c.kind}`} className="accounts-attention-row">
        <span>{accountLabel(c.accountId)} charged you {usd(c.total)} {c.kind === "fee" ? `in ${c.count === 1 ? "a fee" : "fees"}` : "in interest"} in the last 3 months{c.count > 1 ? ` (${c.count} charges)` : ""}, most recently {formatDate(c.lastDate)}.</span>
        <button type="button" className="wealth-secondary" onClick={() => showFees(c.accountId, c.kind)}>See {c.count === 1 ? "it" : "them"}</button>
      </div>)}
      {expiring.map(st => <div key={`expiring-${st.itemId}`} className="accounts-attention-row">
        <span>{st.institution.replace(/ \(test\)$/, "")}'s permission for NorthStar {Date.parse(st.consentExpiresAt!) < Date.now() ? "has ended" : `ends ${new Date(st.consentExpiresAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}. Renew it to keep its balances and activity updating.</span>
        <ReconnectButton itemId={st.itemId} institution={st.institution} label="Renew" onDone={bank.reload} />
      </div>)}
      {attention.map(st => <div key={st.itemId} className="accounts-attention-row">
        <span>{st.institution.replace(/ \(test\)$/, "")} {st.problem === "ITEM_LOGIN_REQUIRED" ? "stopped updating. Sign in again to refresh its balances and activity." : "couldn't be refreshed. Its balances may be out of date."}</span>
        {st.problem === "ITEM_LOGIN_REQUIRED" ? <ReconnectButton itemId={st.itemId} institution={st.institution} label="Sign in again" onDone={bank.reload} /> : <button type="button" className="wealth-secondary" onClick={() => { void bank.reload(); }}>Try again</button>}
      </div>)}
    </div>}
    {!assets.length ? <div className="wealth-empty"><Landmark size={30} /><h3>Bring your money together</h3><p>Use <strong>Edit accounts</strong> above to connect your bank or enter a balance yourself.</p></div> : <div className="wealth-accounts">{groups.map(group => {
      if (!group.list.length) return null;
      const subtotal = groupTotal(group.list);
      return <div className="accounts-group" key={group.key}>
        <div className="accounts-group-head">
          <h3>{group.label}<span>{group.list.length}</span></h3>
          {group.list.length > 1 && <div className={`accounts-group-total${subtotal < 0 ? " is-debt" : subtotal > 0 ? " is-gain" : ""}`}><strong>{subtotal < 0 ? "−" : ""}{usd(Math.abs(subtotal))}</strong></div>}
        </div>
        {group.list.map(accountRow)}
      </div>;
    })}
    {closedAssets.length > 0 && <details className="accounts-group accounts-closed">
      <summary className="accounts-group-head"><h3>Closed<span>{closedAssets.length}</span></h3><small>Not counted in totals</small></summary>
      {closedAssets.map(accountRow)}
    </details>}
    </div>}
    {(bank.data?.debts?.length ?? 0) > 0 && <p className="wealth-note accounts-debt-note">Card and loan details come from your bank about once a day. Interest and fees can make the real payoff higher.</p>}
    {plan.assets.some(m => !m.sample) && <div className="wealth-card-foot"><ShieldCheck size={14} /><span>Manual accounts are saved in this browser only.</span></div>}
  </section>;
  // ---------- Right column: investments, and money you added to them ----------
  const openLinked = (bank.data?.accounts ?? []).filter(a => !plan.closedAccountIds.includes(a.id));
  // Tap an alert: Activity, filtered to that account and exactly those charges in the last 3 months.
  const showFees = (accountId: string, kind: InterestOrFee) => {
    const since = new Date(); since.setDate(since.getDate() - 89);
    setActivityAccount(accountId);
    setActivityFocus({ kind, since: `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`, label: "Last 3 months" });
    setTab("Activity");
    window.scrollTo({ top: 0 });
  };
  const investedFlow = bank.data ? investingFlow(bank.data.transactions, openLinked, 30) : { added: 0, withdrawn: 0 };
  // Totals and the retirement/taxable split come from every investment account's balance; the holdings
  // list can only show institutions that share holdings (Fidelity, through Plaid, doesn't).
  const investSummary = bank.data ? investmentAccountsSummary(openLinked, bank.data.holdings ?? []) : null;
  const together = bank.data?.holdings?.length ? investmentsTogether(bank.data.holdings, openLinked, 5) : null;
  const listNames = (list: string[]) => list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  const missingBanks = [...new Set((investSummary?.withoutHoldings ?? []).map(a => a.institution.replace(/ \(test\)$/, "")))];
  const investCount = openLinked.filter(a => a.type === "investment" || a.type === "brokerage").length;
  const investCard = investSummary && investSummary.total > 0 && <section className="wealth-card accounts-side-card" aria-labelledby="invest-title">
    <div className="accounts-side-head"><h2 id="invest-title">Investments</h2><small>{investCount} account{investCount === 1 ? "" : "s"}</small></div>
    <p className="accounts-cushion-big"><strong>{usd(investSummary.total)}</strong></p>
    {/* "Am I investing?": money you moved in from your other accounts, not market moves. */}
    {(investedFlow.added > 0 || investedFlow.withdrawn > 0) && <p className="accounts-invest-flow">
      {investedFlow.added > 0 && <span className="is-gain">You added {usd(investedFlow.added)} in the last 30 days</span>}
      {investedFlow.withdrawn > 0 && <span>{investedFlow.added > 0 ? " · " : ""}took out {usd(investedFlow.withdrawn)}</span>}
    </p>}
    {investSummary.retirement > 0 && investSummary.taxable > 0
      ? <AssetSplit title="Retirement vs. taxable" label="Investments split between retirement and taxable accounts" slices={[
        { name: "Retirement", value: investSummary.retirement, pct: investSummary.retirement / investSummary.total * 100 },
        { name: "Taxable", value: investSummary.taxable, pct: investSummary.taxable / investSummary.total * 100 },
      ]} />
      : <p className="accounts-side-note">All {investSummary.retirement > 0 ? "retirement" : "taxable"}.</p>}
    {together && together.top.length > 0 && <>
      <h3 className="accounts-side-subhead">Top holdings</h3>
      <ul className="accounts-holdings-top">{together.top.map(h => <li key={h.label}>
        <span><strong>{h.label}</strong><small>{h.accounts > 1 ? `In ${h.accounts} accounts` : h.name !== h.label ? h.name : ""}</small></span>
        <span className="accounts-holding-value"><strong>{usd(h.value)}</strong></span>
      </li>)}</ul>
    </>}
    {missingBanks.length > 0 && <p className="accounts-side-note">{listNames(missingBanks)}: balance only, no holdings.</p>}
  </section>;
  const accountsRail = investCard && <aside className="accounts-rail">{investCard}</aside>;
  const undatedGoals = goals.filter(g => g.saved < g.target && !g.deadline).length;
  // Goals as envelopes: each goal's savings are a share of your checking + savings.
  const knowsCash = (planningBankData?.accounts ?? []).some(a => a.type === "depository") || planningAssets.some(a => a.kind === "Checking" || a.kind === "Savings");
  // Linked accounts are in planningAssets too; count them once (from the bank), plus manual ones.
  const pool = envelopes(goals, cashOnHand(planningBankData?.accounts ?? [], planningAssets.filter(a => !linked.some(l => l.id === a.id))));
  const poolWidth = Math.max(pool.cash, pool.setAside) || 1;
  const cashSplit = knowsCash && goals.length > 0 && <div className="wealth-card cash-split">
    <div className="cash-split-head">
      <div><h3>Your cash</h3><p>Checking and savings, and how much of it your goals hold.</p></div>
      {!editingSplit && <button className={`${pool.over > 0 ? "wealth-primary" : "wealth-secondary"} cash-split-edit`} onClick={() => setEditingSplit(true)}><SlidersHorizontal size={15} aria-hidden="true" /> Edit split</button>}
    </div>
    <dl className="cash-split-sum">
      <div><dt>Total cash</dt><dd>{usd(pool.cash)}</dd></div>
      <span className="cash-split-op" aria-hidden="true">−</span>
      <div><dt>Set aside for goals</dt><dd>{usd(pool.setAside)}</dd></div>
      <span className="cash-split-op" aria-hidden="true">=</span>
      <div className={pool.over > 0 ? "is-over" : "is-free"}><dt>{pool.over > 0 ? "More than your cash" : "Not set aside"}</dt><dd>{usd(pool.over > 0 ? pool.over : pool.free)}</dd></div>
    </dl>
    {editingSplit ? <CashSplitEditor goals={goals} cash={pool.cash} accounts={planningBankData?.accounts ?? []} onCancel={() => setEditingSplit(false)} onSave={changed => { changed.forEach(props.onUpdateGoal); setEditingSplit(false); }} /> : <>
    <div className="cash-split-bar" role="img" aria-label={`${pool.goals.map(g => `${g.name} ${usd(g.amount)}`).join(", ")}${pool.goals.length ? ", " : ""}not set aside ${usd(pool.free)}`}>
      {pool.goals.map((g, i) => <span key={g.id} className={`cash-seg seg-${i % 5}`} style={{ width: `${g.amount / poolWidth * 100}%` }} />)}
      {pool.free > 0 && <span className="cash-seg seg-free" style={{ width: `${pool.free / poolWidth * 100}%` }} />}
    </div>
    <ul className="cash-split-legend">
      {pool.goals.map((g, i) => <li key={g.id}><i className={`seg-${i % 5}`} aria-hidden="true" />{g.name} <strong>{usd(g.amount)}</strong></li>)}
      <li><i className="seg-free" aria-hidden="true" />Not set aside <strong>{usd(pool.free)}</strong></li>
    </ul>
    {pool.goals.some(g => goals.find(x => x.id === g.id)?.linkedAccountId) && <p className="wealth-note">{goals.filter(g => g.linkedAccountId).map(g => g.name).join(", ")} {goals.filter(g => g.linkedAccountId).length === 1 ? "follows" : "follow"} a whole account's balance. Edit the split to choose an amount instead.</p>}
    </>}
  </div>;
  const completed = props.completedGoals ?? [];
  const completedList = completed.length > 0 && <div className="goals-completed">
    <h3>Completed</h3>
    <ul>{completed.map(g => <li key={g.id}><button className="overview-row" onClick={() => onOpenGoal(g.id)}>
      <CircleCheck size={18} className="goals-completed-icon" aria-hidden="true" />
      <span className="goals-completed-name">{g.name}</span>
      <span className="goals-completed-meta">Bought {g.boughtAt ? formatDate(g.boughtAt) : ""} · {usd(g.boughtFor ?? g.target)}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </button></li>)}</ul>
  </div>;
  const goalList = <section className="goals-list">
    {cashSplit}
    {goals.length ? <div className="wealth-goal-grid">{goals.map(g => {
      const reached = g.target > 0 && g.saved >= g.target;
      const needed = !reached && g.deadline && g.deadline > todayISO() ? Math.ceil(weeklyNeededForDeadline(g.target, g.saved, g.deadline) * 100) / 100 : null;
      const meta = [`${usd(g.weekly)}/week`, `${months(g.weekly > 0 ? Math.max(0, g.target - g.saved) / (g.weekly * 52 / 12) : Infinity)} to go`, g.deadline ? `by ${formatDate(g.deadline)}` : ""].filter(Boolean).join(" · ");
      return <button key={g.id} className="wealth-goal" onClick={() => onOpenGoal(g.id)}>
        <span className="wealth-goal-head"><ProgressRing value={g.target > 0 ? g.saved / g.target * 100 : 0} label={`${g.name} funded`} /><span className="wealth-goal-title"><h3>{g.name}</h3><p><strong>{usd(g.saved)}</strong> <span>of {usd(g.target)}</span></p></span><ChevronRight size={17} className="wealth-goal-arrow" aria-hidden="true" /></span>
        {reached ? <SpringCheck readOnly checked label="Goal reached" strike="none" color="#edf6ff" fillColor="#54e2c2" checkColor="#050b16" boxSize={22} boxRadius={7} fontSize={14} doneOpacity={1} className="wealth-goal-reached" /> : <span className="wealth-goal-detail">{meta}</span>}
        {needed !== null && needed > g.weekly && <span className="goal-weekly-needed">Save {formatMoney(needed, true)}/week to finish on time</span>}
        {!reached && g.deadline && g.deadline <= todayISO() && <span className="goal-weekly-needed">Target date passed. Pick a new one.</span>}
      </button>;
    })}</div> : <div className="wealth-goal-placeholder"><Target size={25} /><div><h3>What does your money make possible?</h3><p>An emergency fund, a home, a trip. Give your savings a purpose.</p></div><button className="wealth-secondary" onClick={onNewGoal}>Create a goal <ArrowRight size={15} /></button></div>}
    {undatedGoals > 0 && <p className="wealth-note goals-nudge">{undatedGoals === goals.filter(g => g.saved < g.target).length ? "Add a target date to a goal" : `Add a target date to ${undatedGoals} more goal${undatedGoals === 1 ? "" : "s"}`} to see the weekly amount needed to finish on time.</p>}
  <GoalReminders goals={goals} />
  {completedList}
  </section>;
  const assistantContext: MoneyAssistantContext = {
    accounts: planningAssets.map(account => ({ name: account.name, kind: account.kind, balance: account.balance, isDebt: debt(account.kind) })),
    assets: total,
    debt: debts,
    netWorth: total - debts,
    goals: goals.map(goal => ({ name: goal.name, target: goal.target, saved: goal.saved, weekly: goal.weekly })),
    monthlyIncome: plan.income,
    monthlyExpenses: plan.essentials + plan.lifestyle,
    monthlyGoalContributions: monthlyGoals,
    retirementBalance,
    retirementEstimate: retirementPoints.at(-1)?.balance ?? null,
    retirementAge: retirementPoints.length ? retirementAge : null,
    excludedAccountIds: plan.excludedAccountIds,
  };
  // Accounts: when balances were last checked, with a way to check again (the account list already counts accounts).
  const lastBankUpdate = (bank.data?.status ?? []).map(st => st.lastUpdatedAt).filter((stamp): stamp is string => !!stamp && !Number.isNaN(Date.parse(stamp))).sort().at(-1);
  const checkedAt = bank.data?.balancesCheckedAt ?? lastBankUpdate ?? null;
  const ago = (stamp: string) => {
    const minutes = Math.floor((Date.now() - Date.parse(stamp)) / 60_000);
    return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(stamp));
  };
  const accountsFreshness = !assets.length ? "No accounts yet" : !bank.data ? `${assets.length} account${assets.length === 1 ? "" : "s"}` : <>
    {checkedAt ? `Balances checked ${ago(checkedAt)}` : "Balances from your banks"}
    {bank.data && <button type="button" className="page-banner-link" onClick={() => { void bank.reload({ liveBalances: true }); }} disabled={bank.loading || balancesAreFresh(bank.data)} title={balancesAreFresh(bank.data) ? "Checked with your banks in the last 15 minutes" : "Ask your banks for current balances"}>
      <RefreshCw size={13} className={bank.loading ? "home-sync-spin" : ""} aria-hidden="true" />{bank.loading ? "Checking…" : balancesAreFresh(bank.data) ? "Up to date" : "Update"}
    </button>}
  </>;
  // One line of real numbers under each page title (instead of a tagline).
  const monthAgo = addDays(todayISO(), -30);
  const recent = (bank.data?.transactions ?? []).filter(t => !t.pending && t.date >= monthAgo);
  const recentTransfers = detectTransferIds(recent);
  // Purchases minus refunds and people paying you back; transfers, pay, and family support aren't spending.
  const spentThisMonth = recent.filter(t => !isTransfer(t, recentTransfers) && (moneyKind(t) === "spent" || moneyKind(t) === "offset")).reduce((sum, t) => sum + t.amount, 0);
  const activeGoalCount = goals.filter(g => g.saved < g.target).length;
  const savedForGoals = goals.reduce((sum, g) => sum + Math.min(g.saved, g.target), 0);
  const planFact = plan.income > 0 ? `${formatMoney(plan.income)} monthly income · ${available >= 0 ? `${formatMoney(available)} left to plan` : `${formatMoney(-available)} over budget`}` : `${formatMoney(retirementBalance)} in retirement accounts`;
  const pageFact =
    tab === "Accounts" ? accountsFreshness
      : tab === "Activity" ? (recent.length ? `${recent.length} transaction${recent.length === 1 ? "" : "s"} in the last 30 days · ${formatMoney(spentThisMonth)} spent` : "No recent transactions yet")
        : tab === "Goals" ? (goals.length ? `${activeGoalCount} active goal${activeGoalCount === 1 ? "" : "s"} · ${formatMoney(savedForGoals)} saved so far` : "No goals yet")
          : planFact;
  // Same banner as Home's "Welcome, Michael": a kicker, then one highlighted word.
  const banner = tab === "Accounts" ? { icon: <Landmark size={15} aria-hidden="true" />, kicker: "WHAT YOU HAVE", lead: "Your", highlight: "accounts" }
    : tab === "Activity" ? { icon: <ArrowDownLeft size={15} aria-hidden="true" />, kicker: "WHERE IT GOES", lead: "Your", highlight: "activity" }
      : tab === "Goals" ? { icon: <Target size={15} aria-hidden="true" />, kicker: "WHAT YOU'RE SAVING FOR", lead: "My", highlight: "goals" }
        : { icon: <Compass size={15} aria-hidden="true" />, kicker: "WHERE YOU'RE HEADED", lead: "Your", highlight: "plan" };
  const detail = detailId ? bank.data?.accounts.find(a => a.id === detailId) ?? null : null;
  const detailBrand = detail ? bank.data?.status.find(st => st.institution === detail.institution) : undefined;
  const detailInitials = detail && !detailBrand?.logo && detailBrand?.color && /^#[0-9a-f]{6}$/i.test(detailBrand.color) ? detail.institution.replace(/ \(test\)$/, "").split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(of|the|and|&)$/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("") : "";
  const detailIcon = detailBrand?.logo ? <img src={detailBrand.logo} alt="" /> : detailInitials ? <span className="wealth-account-monogram" style={{ background: detailBrand!.color! }}>{detailInitials}</span> : <Landmark size={22} />;
  return <main id="main" className={`wealth-dashboard${tab === "Goals" ? " goals-page" : tab === "Overview" ? " overview-page" : ""}`}>
    {tab !== "Overview" && <PageBanner {...banner} fact={pageFact} aside={tab === "Accounts" ? <div className="accounts-banner-aside">{accountsNetWorth}<StarBorder onClick={addAsset} className="wealth-add-account" backgroundColor="linear-gradient(115deg, #168e90, #4b7fe0 60%, #9e64df)" textColor="#ffffff" borderColor="rgb(223 254 255 / 22%)" color="#dffeff" trailColor="#54e2c2" radius={10} thickness={1.5} duration={5} glow={0.8} hover="none"><Pencil size={16} aria-hidden="true" /> Edit accounts</StarBorder></div> : tab === "Goals" && goals.length > 0 ? <button type="button" className="wealth-primary goals-new-button" onClick={onNewGoal}><Plus size={17} aria-hidden="true" /> New goal</button> : undefined} />}
    {tab === "Overview" && <>
      {bank.loading && !bank.data && !assets.length ? <OverviewSkeleton /> : <HomeOverview data={{
        env: bank.data?.env ?? "manual",
        accounts: [...(planningBankData?.accounts ?? []), ...planningAssets.filter((a) => !linked.some((account) => account.id === a.id)).map(a => ({
          id: a.id, name: a.name, institution: a.institution || "Manual accounts", mask: null,
          type: debt(a.kind) ? a.kind === "Credit card" ? "credit" : "loan" : ["Checking", "Savings"].includes(a.kind) ? "depository" : investment(a.kind) ? "investment" : "other",
          subtype: a.kind === "Checking" ? "checking" : a.kind === "Savings" ? "savings" : null,
          current: a.balance, available: null,
        }))],
        // Plaid's own bill detection: without it Overview fell back to a rough estimate.
        transactions: planningBankData?.transactions ?? [], recurring: planningBankData?.recurring, status: bank.data?.status ?? [],
        fetchedAt: bank.data?.fetchedAt ?? new Date().toISOString(),
        balancesCheckedAt: bank.data?.balancesCheckedAt ?? null,
      }} profileName={props.profileName} goal={goals.find(g => g.saved < g.target) ?? goals[0]} goals={goals} onCheck={props.onCheck} onMoney={() => setTab("Accounts")} onGoals={() => setTab("Goals")} onNewGoal={onNewGoal} onOpenGoal={onOpenGoal} onRefresh={() => { void bank.reload({ liveBalances: true }); }} refreshing={bank.loading} />}
      {!assets.length && <div className="wealth-sample"><Sparkles size={18} /><span>Start with your own numbers, or explore with clearly labeled sample accounts.</span><button onClick={sample}>Try sample accounts <ArrowRight size={15} /></button></div>}
      {assets.some(a => a.sample) && <div className="wealth-sample"><Sparkles size={17} /><span>Sample accounts are included in these totals.</span><button onClick={() => update({ assets: plan.assets.filter(a => !a.sample) })}>Remove sample accounts <X size={14} /></button></div>}

    </>}
    {tab === "Accounts" && <div className="accounts-layout">{accountList}{accountsRail}</div>}

    {tab === "Goals" && <div className="wealth-stack">
      {goalList}
      <section aria-label="Check a price">{props.priceCheck}</section>
      <h2 className="goals-tools-heading">Plan your next step</h2>
      {goals.length > 0 && <details className="goals-tool"><summary><span className="goals-tool-icon"><Sparkles size={23} /></span><span className="goals-tool-copy"><strong>Build my goal path</strong><small>See whether your deadlines fit, then test spending and income scenarios.</small></span><ChevronRight className="goals-tool-arrow" size={23} /></summary><div className="goals-tool-body"><GoalPathPlanner goals={goals} bankData={planningBankData} weeklyCapacity={weeklyGoalCapacity} incomeKnown={planCapacity.incomeSource !== "none"} hourlyWage={props.hourlyWage ?? null} onUpdateGoal={props.onUpdateGoal} /></div></details>}
      {goals.length > 0 && <details className="goals-tool"><summary><span className="goals-tool-icon"><SlidersHorizontal size={23} /></span><span className="goals-tool-copy"><strong>Adjust weekly savings</strong><small>Choose a sustainable amount and see your new finish date.</small></span><ChevronRight className="goals-tool-arrow" size={23} /></summary><div className="goals-tool-body"><SavingsPlanner goals={goals} financials={{ bankData: planningBankData, manualMonthlyIncome: plan.income, manualMonthlyExpenses: plan.essentials + plan.lifestyle }} onUpdate={props.onUpdateGoal} onOpen={onOpenGoal} onOpenPlan={() => setTab("Plan")} /></div></details>}
      <details className="goals-tool"><summary><span className="goals-tool-icon"><CircleDollarSign size={23} /></span><span className="goals-tool-copy"><strong>Cost of a habit</strong><small>See what a subscription or regular expense costs a goal over a year.</small></span><ChevronRight className="goals-tool-arrow" size={23} /></summary><div className="goals-tool-body"><OpportunityCalculator goals={goals} totalGoalTarget={totalGoalTarget} savedTowardGoals={savedTowardGoals} onNewGoal={onNewGoal} onPreviewProgress={updateNorthStarPreview} /></div></details>
      <details className="goals-tool"><summary><span className="goals-tool-icon"><Sparkles size={23} /></span><span className="goals-tool-copy"><strong>View my constellation</strong><small>Watch your savings milestones light up.</small></span><ChevronRight className="goals-tool-arrow" size={23} /></summary><div className="goals-tool-body"><NorthStar progress={goalProgress} previewProgress={northStarPreview} hasGoals={goals.length > 0} onNewGoal={onNewGoal} /></div></details>
      <details className="wealth-card wealth-preferences goals-tool">
        <summary><span className="goals-tool-icon"><Target size={23} /></span><span className="goals-tool-copy"><strong>Planning preferences</strong><small>Set your risk comfort, timeline, and future priorities.</small></span><ChevronRight className="goals-tool-arrow" size={23} /></summary>
        <div className="wealth-profile-grid">
          <div><h3>How do you feel about investment ups and downs?</h3><p className="wealth-note">This is your risk tolerance: how comfortable you feel when investments change in value.</p><div className="wealth-risk-options">{[["Conservative", "I value stability and smaller swings."], ["Moderate", "I’m comfortable with some ups and downs."], ["Aggressive", "I can tolerate substantial fluctuations."]].map(([name, desc]) => <button key={name} aria-pressed={plan.risk === name} onClick={() => update({ risk: plan.risk === name ? "" : name })} className={plan.risk === name ? "selected" : ""}><span><strong>{name}</strong>{plan.risk === name && <Check size={17} />}</span><small>{desc}</small></button>)}</div></div>
          <div className="wealth-stack"><Field label="When do you expect to use your invested money?"><select value={plan.horizon} onChange={e => update({ horizon: e.target.value })}><option value="">Select a time horizon</option>{["Under 3 years", "3–5 years", "5–10 years", "10+ years"].map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Future goals & priorities"><textarea rows={4} value={plan.future} onChange={e => update({ future: e.target.value })} placeholder="Buy a home, build an emergency fund, retire…" /></Field><p className="wealth-note">These preferences are saved on this device. They don’t change your investments.</p></div>
        </div>
      </details>
    </div>}
    {tab === "Plan" && <div className="wealth-plan-grid">
    <section className="wealth-card wealth-retirement wealth-accent">
      <div className="wealth-section-head"><div><h2>Invest & retirement</h2><p>Explore how a current balance and steady monthly savings could grow over time.</p></div></div>
      <div className="wealth-retirement-balance"><span>Retirement accounts you’ve added</span><strong>{usd(retirementBalance)}</strong></div>
      {!retirementBalance && <p className="wealth-note">Add a Roth IRA, traditional IRA, or 401(k) in Accounts to include its current balance.</p>}
      <div className="wealth-two-fields">
        <Field label="Your age"><input type="number" min="1" max="100" step="1" required value={currentAge ?? ""} placeholder="e.g. 30" onChange={e => update({ currentAge: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Age you want to retire"><input type="number" min="1" max="100" step="1" required value={retirementAge ?? ""} placeholder="e.g. 65" onChange={e => update({ retirementAge: e.target.value ? Number(e.target.value) : null })} /></Field>
      </div>
      <div className="wealth-two-fields">
        <Amount label="Monthly retirement savings" value={retirementMonthly} onChange={retirementMonthly => update({ retirementMonthly })} />
        <GrowthRateField value={retirementReturn} onChange={retirementReturn => update({ retirementReturn })} />
      </div>
      {currentAge !== null && retirementAge !== null && retirementAge <= currentAge
        ? <p className="wealth-retirement-warning" role="status">Choose a retirement age that is higher than your current age to see an estimate.</p>
        : retirementPoints.length > 0 && currentAge !== null && retirementAge !== null && <div className="wealth-retirement-result">
          <div><span>Estimated balance at age {retirementAge}</span><strong>{usd(retirementPoints.at(-1)?.balance ?? retirementBalance)}</strong></div>
          <RetirementChart points={retirementPoints} currentAge={currentAge} retirementAge={retirementAge} />
          <div className="wealth-chart-legend"><span><i /> Estimated balance</span><span><i /> Contributions only</span></div>
        </div>}
      <p className="wealth-note">This is an illustration, not a guarantee or investment advice. It assumes monthly contributions and a steady return, and excludes taxes, fees, inflation, and changes in investment value.</p>
    </section>
    <div className="wealth-stack">
      <BudgetNorthStar progress={budgetProgress} hasIncome={planCapacity.monthlyIncome > 0} remainder={available} incomeSource={planCapacity.incomeSource} />
      <section className="wealth-card wealth-monthly-plan"><div className="wealth-section-head"><div><h2>Your monthly plan</h2><p>Every number used in your budget is shown below.</p></div></div><div className="wealth-stack"><Amount label="Monthly income (after tax)" value={plan.income} onChange={income => update({ income })} /><Amount label="Monthly essentials · rent, groceries, bills" value={plan.essentials} onChange={essentials => update({ essentials })} /><Amount label="Monthly lifestyle · shopping, dining, fun" value={plan.lifestyle} onChange={lifestyle => update({ lifestyle })} /><div className="wealth-budget-breakdown" aria-label="Monthly plan calculation"><div className="wealth-budget-line"><span><strong>Income used</strong><small>{planCapacity.incomeSource === "detected" ? "Recurring deposits from connected accounts" : planCapacity.incomeSource === "manual" ? "Your entered monthly income" : "No income available yet"}</small></span><strong>{planCapacity.incomeSource === "none" ? "—" : `${usd(planCapacity.monthlyIncome)} / mo`}</strong></div><div className="wealth-budget-line"><span><strong>Spending used</strong><small>{planCapacity.spendingSource === "observed" ? "Observed activity is higher than your entered budget" : planCapacity.spendingSource === "manual" ? "Your entered essentials and lifestyle" : "No spending data yet"}</small></span><strong>{usd(planCapacity.monthlySpending)} / mo</strong></div><div className="wealth-budget-line wealth-budget-goal-line"><span><strong>Active goal contributions</strong><small>Weekly amount × 52 ÷ 12. Completed goals are excluded.</small></span><strong>{usd(monthlyGoals)} / mo</strong></div>{activeGoals.length > 0 && <ul className="wealth-budget-goals">{activeGoals.map((goal) => <li key={goal.id}><span>{goal.name}<small>{usd(goal.weekly)} / week</small></span><strong>{usd(goal.weekly * 52 / 12)} / mo</strong></li>)}</ul>}<div className="wealth-budget-line"><span><strong>Safety buffer</strong><small>Reserved for normal surprises before new savings are assigned.</small></span><strong>{usd(planCapacity.monthlyBuffer)} / mo</strong></div></div><div className={`wealth-budget-remainder ${available < 0 ? "over" : ""} ${planCapacity.status === "missing-income" ? "needs-income" : ""}`}><span>{planCapacity.status === "missing-income" ? "Income needed" : available < 0 ? "Over budget after buffer" : "Monthly room after buffer"}</span><strong>{planCapacity.status === "missing-income" ? "—" : usd(Math.abs(available))}</strong></div>{planCapacity.status === "missing-income" ? <p className="wealth-note">Connect the account where your pay lands, or enter monthly after-tax income above. NorthStar will not guess a positive savings amount without it.</p> : available < 0 ? <p className="wealth-note">Your income is short by {usd(Math.abs(available))} after spending, active goals, and your buffer. Lower a cost, adjust a goal, or change the timeline.</p> : <p className="wealth-note">That is about {usd(planCapacity.weeklyLimit)} per week available for a new or adjusted savings goal.</p>}</div></section>
    </div>
    </div>}
    {tab === "Activity" && <div className="wealth-stack"><MoneyDashboard {...props} accountId={activityAccount} onAccountFilterChange={setActivityAccount} focus={activityFocus} onFocusChange={setActivityFocus} /></div>}
    <MoneyAssistant context={assistantContext} goals={goals} budget={{ income: plan.income, essentials: plan.essentials, lifestyle: plan.lifestyle }} plan={{ ...plan, assets: planningAssets }} bankData={planningBankData} freshBankData={() => bank.ensureFreshBalances().then(fresh => bankDataForPlan(fresh, plan.excludedAccountIds))} onUpdateGoal={props.onUpdateGoal} onAddGoal={props.onAddGoal} onRemoveGoal={props.onRemoveGoal} onUpdateBudget={update} onOpenPriceCheck={props.onCheck} onPaymentAnswered={() => bank.reload()} />
    {detail && bank.data && <AccountDetail
      account={detail}
      name={plan.accountNames[detail.id] || detail.name}
      kind={linked.find(a => a.id === detail.id)?.kind ?? "Account"}
      icon={detailIcon}
      data={bank.data}
      debt={bank.data.debts?.find(d => d.accountId === detail.id)}
      included={!plan.excludedAccountIds.includes(detail.id)}
      closed={plan.closedAccountIds.includes(detail.id)}
      onRename={nickname => update({ accountNames: Object.fromEntries([...Object.entries(plan.accountNames).filter(([id]) => id !== detail.id), ...(nickname && nickname !== detail.name ? [[detail.id, nickname]] : [])]) })}
      onToggleIncluded={() => update({ excludedAccountIds: plan.excludedAccountIds.includes(detail.id) ? plan.excludedAccountIds.filter(id => id !== detail.id) : [...plan.excludedAccountIds, detail.id] })}
      onToggleClosed={() => update({ closedAccountIds: plan.closedAccountIds.includes(detail.id) ? plan.closedAccountIds.filter(id => id !== detail.id) : [...plan.closedAccountIds, detail.id] })}
      onSeeActivity={() => { setActivityAccount(detail.id); setDetailId(null); setTab("Activity"); }}
      onClose={closeDetail}
    />}
    {assetForm && <div className="wealth-modal-backdrop"><section ref={modalRef} className="wealth-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title"><div className="wealth-section-head"><h2 id="asset-title">{plan.assets.some(a => a.id === assetForm.id) ? "Edit account" : "Edit accounts"}</h2><button className="wealth-icon-button" aria-label="Close account form" onClick={() => setAssetForm(null)}><X size={20} /></button></div>{!plan.assets.some(a => a.id === assetForm.id) && <><ConnectedBanks bank={bank} /><div className="add-account-connect"><div><strong>Connect a bank or brokerage</strong><span>Balances and activity update automatically through Plaid.</span></div><ConnectButton label="Connect" kind="all" variant="secondary" onConnected={() => { setAssetForm(null); bank.reload(); }} /></div><p className="add-account-divider"><span>or add a balance manually</span></p></>}<p className="wealth-note">Manual accounts are saved on this device.</p><form className="wealth-stack" onSubmit={e => { e.preventDefault(); const before = plan.assets.find(a => a.id === assetForm.id); update({ assets: [...plan.assets.filter(a => a.id !== assetForm.id), { ...assetForm, name: assetForm.name.trim(), institution: assetForm.institution.trim(), updatedAt: !before || before.balance !== assetForm.balance || !before.updatedAt ? new Date().toISOString() : before.updatedAt }] }); setAssetForm(null); }}><Field label="Account name"><input autoFocus required maxLength={80} value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="My Roth IRA" pattern=".*\S.*" /></Field><Field label="Institution (optional)"><input maxLength={80} value={assetForm.institution} onChange={e => setAssetForm({ ...assetForm, institution: e.target.value })} placeholder="Fidelity" /></Field><Field label="Account type"><select value={assetForm.kind} onChange={e => setAssetForm({ ...assetForm, kind: e.target.value })}>{kinds.map(k => <option key={k}>{k}</option>)}</select></Field><Amount label={debt(assetForm.kind) ? "Amount owed" : "Current balance"} value={assetForm.balance} onChange={balance => setAssetForm({ ...assetForm, balance })} /><div className="wealth-modal-actions">{plan.assets.some(a => a.id === assetForm.id) && <button type="button" className="wealth-delete" onClick={() => { update({ assets: plan.assets.filter(a => a.id !== assetForm.id) }); setAssetForm(null); }}><Trash2 size={16} /> Remove</button>}<button type="button" className="wealth-secondary" onClick={() => setAssetForm(null)}>Cancel</button><button className="wealth-primary" type="submit">Save account <Check size={16} /></button></div></form></section></div>}
  </main>;
}

function OpportunityCalculator({ goals, totalGoalTarget, savedTowardGoals, onNewGoal, onPreviewProgress }: {
  goals: MoneyGoal[];
  totalGoalTarget: number;
  savedTowardGoals: number;
  onNewGoal: () => void;
  onPreviewProgress: (progress: number | null) => void;
}) {
  const [cost, setCost] = useState(100);
  const [frequency, setFrequency] = useState<SpendingFrequency>("once");
  const [repeatInterval, setRepeatInterval] = useState("2");
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("weeks");
  const interval = Number(repeatInterval);
  const validFrequency = frequency !== "custom" || (Number.isSafeInteger(interval) && interval > 0);
  const annualCost = validFrequency ? annualSpending(cost, frequency, interval, repeatUnit) : null;
  const [goalId, setGoalId] = useState(goals[0]?.id || "");
  const [label, setLabel] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  const goal = goals.find(g => g.id === goalId) ?? goals[0];
  const result = goal && validFrequency ? opportunityCost(cost, frequency, goal.target, goal.saved, goal.weekly, interval, repeatUnit) : null;
  const previewProgress = previewReady && goal && totalGoalTarget > 0
    ? (savedTowardGoals - Math.min(goal.target, Math.max(0, goal.saved)) + Math.max(0, Math.min(goal.target, goal.saved) - (frequency === "once" ? cost : 0))) / totalGoalTarget * 100
    : null;
  useEffect(() => {
    onPreviewProgress(previewProgress);
    return () => onPreviewProgress(null);
  }, [onPreviewProgress, previewProgress]);

  return <section className="wealth-card wealth-opportunity"><div className="wealth-section-head"><div><h2>Spend or save?</h2><p>See what a purchase means for a savings goal. This trade-off is called opportunity cost.</p></div><span className="wealth-account-icon"><ArrowDownLeft size={22} /></span></div><div className="wealth-stack"><Field label="What are you considering?"><input value={label} onChange={e => setLabel(e.target.value)} placeholder="Dinner out, a new phone, a subscription…" /></Field><div className="wealth-two-fields"><Amount label="Cost" value={cost} onChange={value => { setCost(value); setPreviewReady(true); }} /><Field label="How often?"><select value={frequency} onChange={e => { setFrequency(e.target.value as SpendingFrequency); setPreviewReady(true); }}><option value="once">One-time</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="custom">Custom interval…</option></select></Field></div>
    {frequency === "custom" && <div className="wealth-two-fields"><Field label="Repeat every"><input type="number" min="1" step="1" value={repeatInterval} aria-invalid={!validFrequency} aria-describedby={!validFrequency ? "repeat-interval-error" : undefined} onChange={e => { setRepeatInterval(e.target.value); setPreviewReady(true); }} /></Field><Field label="Time unit"><select value={repeatUnit} onChange={e => { setRepeatUnit(e.target.value as RepeatUnit); setPreviewReady(true); }}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option></select></Field></div>}
    {!validFrequency && <p id="repeat-interval-error" className="wealth-note" role="status">Enter a positive whole number for the repeat interval.</p>}
    {goal ? <Field label="Compare with this savings goal"><select value={goal.id} onChange={e => { setGoalId(e.target.value); setPreviewReady(true); }}>{goals.map(g => <option key={g.id} value={g.id}>{g.name} · {usd(g.weekly)}/week</option>)}</select></Field> : <div className="wealth-sample"><span>Add a savings goal to calculate the effect on your timeline.</span><button onClick={onNewGoal}>Create goal <Plus size={15} /></button></div>}
    <div className="wealth-opportunity-result" aria-live="polite"><span className="wealth-tag">{frequency === "once" ? "ONE PURCHASE, A REAL TRADE-OFF" : "SMALL AMOUNTS ADD UP"}</span><strong>{annualCost === null ? "—" : usd(annualCost)}</strong><p>{frequency === "once" ? `that could go toward ${goal?.name || "your future"}` : `per year spent on ${label || "this choice"}${frequency === "custom" && validFrequency ? ` · every ${interval} ${repeatUnit}` : ""}`}</p>{result && goal && <><div className="wealth-timeline-compare"><div><span>Keep your savings plan</span><strong>{months(result.baselineMonths)}</strong></div><ArrowRight size={18} /><div><span>{label ? `With ${label}` : "With this spending"}</span><strong>{months(result.afterMonths)}</strong></div></div><p className="wealth-delay">{goal.saved >= goal.target ? "This goal is already funded. Choose an unfinished goal to compare." : goal.weekly <= 0 ? "Set a weekly savings contribution to calculate a timeline." : !Number.isFinite(result.delayDays) ? "This recurring cost uses all of this goal’s contribution. The goal will not be reached on this plan." : `${Math.round(result.delayDays * 10) / 10} days later for ${goal.name}.`}</p></>}</div><p className="wealth-note">Assumes this spending comes entirely from the selected goal’s savings{frequency !== "once" ? " and continues until the goal is reached" : ""}. Uses averaged recurring costs, 52 weeks (364 days) and 12 months per year. No interest, investment growth, taxes, or inflation. Calculator scenarios do not change your budget or balances.</p></div></section>;
}

function RetirementChart({ points, currentAge, retirementAge }: { points: RetirementPoint[]; currentAge: number; retirementAge: number }) {
  const width = 720;
  const height = 250;
  const left = 78;
  const right = 18;
  const top = 14;
  const bottom = 32;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const max = Math.max(1, ...points.map(point => point.balance));
  const x = (year: number) => left + year / Math.max(1, points.at(-1)?.year ?? 1) * chartWidth;
  const y = (value: number) => top + (1 - value / max) * chartHeight;
  const path = (key: "balance" | "contributions") => points.map((point, index) => `${index ? "L" : "M"}${x(point.year).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
  const labels = [...new Set([0, Math.round((retirementAge - currentAge) / 2), retirementAge - currentAge])];
  const shortMoney = (value: number) => moneyHidden() ? maskedAmount("") : value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(1)}m`
    : value >= 10_000 ? `$${Math.round(value / 1_000)}k`
      : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}k`
        : usd(value);

  return <svg className="wealth-retirement-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Illustrative retirement savings projection from age ${currentAge} to age ${retirementAge}`}>
    <title>Illustrative retirement savings projection</title>
    {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
      const value = max * ratio;
      return <g key={ratio}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#e4eadf" strokeWidth="1" />
        <text x={left - 8} y={y(value) + 4} textAnchor="end" fill="#657360" fontSize="11">{shortMoney(value)}</text>
      </g>;
    })}
    <path className="retirement-contributions-line" d={path("contributions")} fill="none" strokeWidth="2" strokeDasharray="5 5" />
    <path className="retirement-balance-line" d={path("balance")} fill="none" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    {labels.map(year => <text key={year} x={x(year)} y={height - 8} textAnchor={year === 0 ? "start" : year === retirementAge - currentAge ? "end" : "middle"} fill="#657360" fontSize="11">{year === 0 ? `Age ${currentAge}` : `Age ${currentAge + year}`}</text>)}
  </svg>;
}

/** Gray shapes of the Overview while accounts load (announced once for screen readers). */
function OverviewSkeleton() {
  return <section role="status" aria-label="Loading your money overview" className="grid gap-5">
    <div className="skeleton h-24" />
    <div className="grid gap-5 lg:grid-cols-[1.75fr_1fr]">
      <div className="skeleton h-[28rem]" />
      <div className="grid gap-4"><div className="skeleton h-12" /><div className="skeleton h-40" /><div className="skeleton h-40" /></div>
    </div>
  </section>;
}
