import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleDollarSign, Landmark, Plus, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2, X } from "lucide-react";
import type { Bank } from "../lib/useBank";
import type { MoneyGoal } from "../lib/types";
import { HomeOverview } from "./Landing";
import { SavingsPlanner } from "./SavingsPlanner";
import { isLiability } from "../lib/money";
import { formatMoney } from "../lib/finance";
import { budgetBalanceProgress, opportunityCost, retirementProjection, type RetirementPoint, type SpendingFrequency } from "../lib/planning";
import { BudgetNorthStar, NorthStar } from "./NorthStar";
import { MoneyAssistant } from "./MoneyAssistant";
import type { MoneyAssistantContext } from "../lib/moneyAssistant";
import { ConnectButton, MoneyDashboard } from "./MoneyDashboard";

export type DashboardTab = "Overview" | "Accounts" | "Goals" | "Retirement" | "Budget" | "Activity";

const usd = (value: number) => formatMoney(value, true);
const kinds = ["Checking", "Savings", "Roth IRA", "Traditional IRA", "401(k)", "Brokerage", "Property", "Other asset", "Credit card", "Loan"];
interface Asset { id: string; name: string; institution: string; kind: string; balance: number; sample?: boolean }
interface Plan { assets: Asset[]; risk: string; horizon: string; future: string; income: number; essentials: number; lifestyle: number; currentAge: number | null; retirementAge: number | null; retirementMonthly: number; retirementReturn: number }
const initial: Plan = { assets: [], risk: "", horizon: "", future: "", income: 0, essentials: 0, lifestyle: 0, currentAge: null, retirementAge: null, retirementMonthly: 0, retirementReturn: 5 };
const KEY = "tradeoff:wealth:v1";
function readPlan(): Plan { try { return { ...initial, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return initial; } }
const debt = (kind: string) => kind === "Credit card" || kind === "Loan";
const investment = (kind: string) => ["Roth IRA", "Traditional IRA", "401(k)", "Brokerage", "Investment"].includes(kind);
const retirementAccount = (kind: string) => ["Roth IRA", "Traditional IRA", "401(k)"].includes(kind);
const months = (n: number) => !Number.isFinite(n) ? "Not funded" : n === 0 ? "Funded" : n < 1 ? "< 1 month" : `${Math.ceil(n)} months`;

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="wealth-field"><span>{label}</span>{children}</label>; }
function Amount({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) { return <Field label={label}><div className="wealth-currency"><span>$</span><input type="number" min="0" max="1000000000000" step="0.01" required value={value || ""} placeholder="0" onChange={e => onChange(Math.max(0, Number(e.target.value)))} /></div></Field>; }
function holdingMoney(value: number, currency: string | null) {
  if (!currency) return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} (currency unavailable)`;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value); }
  catch { return `${value.toLocaleString()} ${currency}`; }
}

export function WealthDashboard(props: { bank: Bank; goals: MoneyGoal[]; onUpdateGoal: (g: MoneyGoal) => void; onOpenGoal: (id: string) => void; onNewGoal: () => void; onCheck: () => void; onSettings: () => void; selectedTab: DashboardTab; onTabChange: (tab: DashboardTab) => void }) {
  const { bank, goals, onNewGoal, onOpenGoal } = props;
  const [plan, setPlan] = useState<Plan>(readPlan);
  const tab = props.selectedTab;
  const setTab = props.onTabChange;
  const [northStarPreview, setNorthStarPreview] = useState<number | null>(null);
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
  const [saved, setSaved] = useState("");
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(plan)); setSaved("Changes saved on this device"); } catch { setSaved("Storage unavailable. Changes last for this session."); } }, [plan]);
  const update = (patch: Partial<Plan>) => setPlan(p => ({ ...p, ...patch }));
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
      name: a.name,
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
  const positive = assets.filter(a => !debt(a.kind));
  const total = positive.reduce((sum, a) => sum + a.balance, 0);
  const debts = assets.filter(a => debt(a.kind)).reduce((s, a) => s + a.balance, 0);
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
  const monthlyGoals = goals.reduce((s, g) => s + g.weekly * 52 / 12, 0);
  const totalGoalTarget = goals.reduce((s, g) => s + g.target, 0);
  const savedTowardGoals = goals.reduce((s, g) => s + Math.min(g.target, Math.max(0, g.saved)), 0);
  const goalProgress = totalGoalTarget > 0 ? Math.min(100, savedTowardGoals / totalGoalTarget * 100) : 0;
  const updateNorthStarPreview = useCallback((progress: number | null) => setNorthStarPreview(progress), []);
  const available = plan.income - plan.essentials - plan.lifestyle - monthlyGoals;
  const budgetProgress = budgetBalanceProgress(plan.income, available);
  function sample() {
    update({ assets: [...plan.assets, ...[
      { name: "Everyday checking", institution: "Chase", kind: "Checking", balance: 3250 },
      { name: "High-yield savings", institution: "Ally", kind: "Savings", balance: 8500 },
      { name: "Roth IRA", institution: "Fidelity", kind: "Roth IRA", balance: 12400 },
      { name: "Individual brokerage", institution: "Vanguard", kind: "Brokerage", balance: 6750 },
    ].map(a => ({ ...a, id: crypto.randomUUID(), sample: true }))] });
  }
  const addAsset = () => setAssetForm({ id: crypto.randomUUID(), name: "", institution: "", kind: "Checking", balance: 0 });
  const accountList = <section className="wealth-card"><div className="wealth-section-head"><div><h2>Your accounts</h2><p>Every account. One clear picture.</p></div><button className="wealth-text-button" onClick={addAsset}><Plus size={16} /> Add manually</button></div>
    {!assets.length ? <div className="wealth-empty"><Landmark size={30} /><h3>Bring your money together</h3><p>Add balances manually, or connect your bank to get started.</p><button className="wealth-primary" onClick={addAsset}>Add a manual account <Plus size={16} /></button></div> : <div className="wealth-accounts">{assets.map(a => {
      const holdings = linked.some(account => account.id === a.id) ? bank.data?.holdings?.filter(holding => holding.accountId === a.id) ?? [] : [];
      return <div className="wealth-account-block" key={a.id}>
        <div className="wealth-account"><span className={`wealth-account-icon ${investment(a.kind) ? "invest" : ""}`}>{investment(a.kind) ? <ArrowUpRight size={20} /> : <Landmark size={20} />}</span><div className="wealth-account-name"><strong>{a.name}</strong><span>{a.institution || "Personal account"} · {a.kind}{a.sample ? " · Sample" : linked.some(l => l.id === a.id) ? " · Connected" : " · Manual"}</span></div><strong className="wealth-balance">{debt(a.kind) ? "−" : ""}{usd(a.balance)}</strong>{plan.assets.some(m => m.id === a.id) && <button className="wealth-icon-button" aria-label={`Edit ${a.name}`} onClick={() => setAssetForm(a)}><SlidersHorizontal size={15} /></button>}</div>
        {holdings.length > 0 && <details className="wealth-account-holdings"><summary>{holdings.length} investment holding{holdings.length === 1 ? "" : "s"}</summary><ul>{holdings.map(holding => <li key={holding.id}><span><strong>{holding.ticker || holding.name}</strong><small>{holding.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} shares</small></span><strong>{holdingMoney(holding.value, holding.currency)}</strong></li>)}</ul></details>}
      </div>;
    })}</div>}
    <div className="wealth-card-foot"><ShieldCheck size={14} /><span>{linked.length ? `${linked.length} connected accounts · ${bank.data?.env === "sandbox" ? "Sandbox balances" : "Bank balances"}` : "Manual balances stay in this browser"}</span><ConnectButton label="Connect accounts" variant="secondary" kind="all" onConnected={bank.reload} /></div>
  </section>;
  const goalList = <section className="wealth-card"><div className="wealth-section-head"><div><h2>Your savings goals</h2><p>Choose a goal and an amount to save each week.</p></div><button className="wealth-text-button" onClick={onNewGoal}><Plus size={16} /> New goal</button></div>
    {goals.length ? <div className="wealth-goal-grid">{goals.map(g => <button key={g.id} className="wealth-goal" onClick={() => onOpenGoal(g.id)}><span className="wealth-goal-top"><span className="wealth-account-icon"><Target size={19} /></span><ChevronRight size={17} /></span><h3>{g.name}</h3><p><strong>{usd(g.saved)}</strong> <span>of {usd(g.target)}</span></p><div className="wealth-progress" role="progressbar" aria-label={`${g.name} funded`} aria-valuenow={Math.min(100, Math.round(g.saved / g.target * 100))} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.min(100, g.saved / g.target * 100)}%` }} /></div><span className="wealth-goal-detail">{usd(g.weekly)}/week <span>{months(g.weekly > 0 ? Math.max(0, g.target - g.saved) / (g.weekly * 52 / 12) : Infinity)} to go</span></span>{g.deadline && <span className="wealth-goal-deadline">Target date · {g.deadline}</span>}</button>)}</div> : <div className="wealth-goal-placeholder"><Target size={25} /><div><h3>What does your money make possible?</h3><p>An emergency fund, a home, a trip. Give your savings a purpose.</p></div><button className="wealth-secondary" onClick={onNewGoal}>Create a goal <ArrowRight size={15} /></button></div>}
  </section>;
  const assistantContext: MoneyAssistantContext = {
    accounts: assets.map(account => ({ name: account.name, kind: account.kind, balance: account.balance, isDebt: debt(account.kind) })),
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
  };
  return <main id="main" className="wealth-dashboard">
    <div className="wealth-page-head"><div><h1>{tab === "Goals" ? "My goals" : tab === "Activity" ? "Account activity" : tab}</h1><p>{tab === "Overview" ? "Your whole financial picture, in one place." : tab === "Accounts" || tab === "Activity" ? "Track your balances and connected accounts." : tab === "Goals" ? "Plan your savings and watch your progress grow." : tab === "Retirement" ? "Explore your long-term savings plan." : "Give your monthly income a plan."}</p></div>{(tab === "Overview" || tab === "Accounts") && <ConnectButton label="Add account" kind="all" className="wealth-primary" onConnected={bank.reload} />}</div>
    {tab === "Overview" && <>
      {bank.loading && !bank.data && !assets.length ? <section className="wealth-card" role="status">Loading your money overview…</section> : <HomeOverview data={{
        env: bank.data?.env ?? "manual",
        accounts: [...(bank.data?.accounts ?? []), ...plan.assets.map(a => ({
          id: a.id, name: a.name, institution: a.institution || "Manual accounts", mask: null,
          type: debt(a.kind) ? a.kind === "Credit card" ? "credit" : "loan" : ["Checking", "Savings"].includes(a.kind) ? "depository" : investment(a.kind) ? "investment" : "other",
          subtype: a.kind === "Checking" ? "checking" : a.kind === "Savings" ? "savings" : null,
          current: a.balance, available: null,
        }))],
        transactions: bank.data?.transactions ?? [], status: bank.data?.status ?? [],
        fetchedAt: bank.data?.fetchedAt ?? new Date().toISOString(),
      }} goal={goals.find(g => g.saved < g.target) ?? goals[0]} onCheck={props.onCheck} onMoney={() => setTab("Accounts")} />}
      {!assets.length && <div className="wealth-sample"><Sparkles size={18} /><span>Start with your own numbers, or explore with clearly labeled sample accounts.</span><button onClick={sample}>Try sample accounts <ArrowRight size={15} /></button></div>}
      {assets.some(a => a.sample) && <div className="wealth-sample"><Sparkles size={17} /><span>Sample accounts are included in these totals.</span><button onClick={() => update({ assets: plan.assets.filter(a => !a.sample) })}>Remove sample accounts <X size={14} /></button></div>}

    </>}
    {tab === "Accounts" && <div className="wealth-stack">{accountList}<button className="wealth-secondary simple-activity-button" onClick={() => setTab("Activity")}>View connected bank activity <ArrowRight size={16} /></button><p className="wealth-note">Connected investment holdings appear inside their account. Add each account only once; manual balances stay on this device.</p></div>}

    {tab === "Goals" && <div className="wealth-stack">
      <NorthStar progress={goalProgress} previewProgress={northStarPreview} hasGoals={goals.length > 0} onNewGoal={onNewGoal} />
      {goalList}
      {goals.length > 0 && <SavingsPlanner goals={goals} onUpdate={props.onUpdateGoal} onOpen={onOpenGoal} />}
      <OpportunityCalculator goals={goals} totalGoalTarget={totalGoalTarget} savedTowardGoals={savedTowardGoals} onNewGoal={onNewGoal} onPreviewProgress={updateNorthStarPreview} />
      <details className="wealth-card wealth-preferences">
        <summary><span>Optional planning preferences</span><small>Risk comfort, timeline, and future priorities</small></summary>
        <div className="wealth-profile-grid">
          <div><h3>How do you feel about investment ups and downs?</h3><p className="wealth-note">This is your risk tolerance: how comfortable you feel when investments change in value.</p><div className="wealth-risk-options">{[["Conservative", "I value stability and smaller swings."], ["Moderate", "I’m comfortable with some ups and downs."], ["Aggressive", "I can tolerate substantial fluctuations."]].map(([name, desc]) => <button key={name} aria-pressed={plan.risk === name} onClick={() => update({ risk: plan.risk === name ? "" : name })} className={plan.risk === name ? "selected" : ""}><span><strong>{name}</strong>{plan.risk === name && <Check size={17} />}</span><small>{desc}</small></button>)}</div></div>
          <div className="wealth-stack"><Field label="When do you expect to use your invested money?"><select value={plan.horizon} onChange={e => update({ horizon: e.target.value })}><option value="">Select a time horizon</option>{["Under 3 years", "3–5 years", "5–10 years", "10+ years"].map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Future goals & priorities"><textarea rows={4} value={plan.future} onChange={e => update({ future: e.target.value })} placeholder="Buy a home, build an emergency fund, retire…" /></Field><p className="wealth-note">These preferences are saved on this device. They don’t change your investments.</p></div>
        </div>
      </details>
    </div>}
    {tab === "Retirement" && <section className="wealth-card wealth-retirement">
      <div className="wealth-section-head"><div><h2>Plan for retirement</h2><p>Explore how your savings could grow over time.</p></div><span className="wealth-account-icon"><Target size={20} /></span></div>
      <div className="wealth-retirement-balance"><span>Retirement accounts you’ve added</span><strong>{usd(retirementBalance)}</strong></div>
      {!retirementBalance && <p className="wealth-note">Add a Roth IRA, traditional IRA, or 401(k) in Accounts to include its current balance.</p>}
      <div className="wealth-two-fields">
        <Field label="Your age"><input type="number" min="1" max="100" step="1" required value={currentAge ?? ""} placeholder="e.g. 30" onChange={e => update({ currentAge: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Age you want to retire"><input type="number" min="1" max="100" step="1" required value={retirementAge ?? ""} placeholder="e.g. 65" onChange={e => update({ retirementAge: e.target.value ? Number(e.target.value) : null })} /></Field>
      </div>
      <div className="wealth-two-fields">
        <Amount label="Monthly retirement savings" value={retirementMonthly} onChange={retirementMonthly => update({ retirementMonthly })} />
        <Field label="Estimated annual growth"><div className="wealth-percent"><input type="number" min="0" max="20" step="0.1" value={retirementReturn} onChange={e => update({ retirementReturn: Math.min(20, Math.max(0, Number(e.target.value))) })} /><span>%</span></div></Field>
      </div>
      {currentAge !== null && retirementAge !== null && retirementAge <= currentAge
        ? <p className="wealth-retirement-warning" role="status">Choose a retirement age that is higher than your current age to see an estimate.</p>
        : retirementPoints.length > 0 && currentAge !== null && retirementAge !== null && <div className="wealth-retirement-result">
          <div><span>Estimated balance at age {retirementAge}</span><strong>{usd(retirementPoints.at(-1)?.balance ?? retirementBalance)}</strong></div>
          <RetirementChart points={retirementPoints} currentAge={currentAge} retirementAge={retirementAge} />
          <div className="wealth-chart-legend"><span><i /> Estimated balance</span><span><i /> Contributions only</span></div>
        </div>}
      <p className="wealth-note">This is an illustration, not a guarantee or investment advice. It assumes monthly contributions and a steady return, and excludes taxes, fees, inflation, and changes in investment value.</p>
    </section>}
    {tab === "Budget" && <div className="wealth-stack">
      <BudgetNorthStar progress={budgetProgress} hasIncome={plan.income > 0} remainder={available} />
      <section className="wealth-card"><div className="wealth-section-head"><div><h2>Your monthly budget</h2><p>Plan for your spending and savings.</p></div><CircleDollarSign size={22} /></div><div className="wealth-stack"><Amount label="Monthly income (after tax)" value={plan.income} onChange={income => update({ income })} /><Amount label="Monthly essentials · rent, groceries, bills" value={plan.essentials} onChange={essentials => update({ essentials })} /><Amount label="Monthly lifestyle · shopping, dining, fun" value={plan.lifestyle} onChange={lifestyle => update({ lifestyle })} /><div className="wealth-budget-line"><span>Savings goal contributions</span><strong>{usd(monthlyGoals)} / mo</strong></div><p className="wealth-note">Weekly contributions × 52 ÷ 12. Edit contributions in your goals.</p><div className={`wealth-budget-remainder ${available < 0 ? "over" : ""}`}><span>{available < 0 ? "Over budget" : "Left to plan"}</span><strong>{usd(Math.abs(available))}</strong></div>{available < 0 && <p className="wealth-note">Your spending and goal contributions exceed your income. Adjust your plan to close the gap.</p>}</div></section>
    </div>}
    {tab === "Activity" && <div className="wealth-stack"><button className="wealth-text-button" onClick={() => setTab("Accounts")}>← Back to your accounts</button><MoneyDashboard {...props} /></div>}
    <footer className="wealth-footer"><span>NorthStar <span> / </span> Keep your goals in sight.</span><span>{saved} · Planning estimates · Balances in USD <button className="wealth-text-button" onClick={props.onSettings}>Settings</button></span></footer>
    <MoneyAssistant context={assistantContext} />
    {assetForm && <div className="wealth-modal-backdrop"><section ref={modalRef} className="wealth-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title"><div className="wealth-section-head"><h2 id="asset-title">{plan.assets.some(a => a.id === assetForm.id) ? "Edit account" : "Add an account"}</h2><button className="wealth-icon-button" aria-label="Close account form" onClick={() => setAssetForm(null)}><X size={20} /></button></div><p className="wealth-note">Enter a current balance. Manual accounts are saved on this device.</p><form className="wealth-stack" onSubmit={e => { e.preventDefault(); update({ assets: [...plan.assets.filter(a => a.id !== assetForm.id), { ...assetForm, name: assetForm.name.trim(), institution: assetForm.institution.trim() }] }); setAssetForm(null); }}><Field label="Account name"><input autoFocus required maxLength={80} value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="My Roth IRA" pattern=".*\S.*" /></Field><Field label="Institution (optional)"><input maxLength={80} value={assetForm.institution} onChange={e => setAssetForm({ ...assetForm, institution: e.target.value })} placeholder="Fidelity" /></Field><Field label="Account type"><select value={assetForm.kind} onChange={e => setAssetForm({ ...assetForm, kind: e.target.value })}>{kinds.map(k => <option key={k}>{k}</option>)}</select></Field><Amount label={debt(assetForm.kind) ? "Amount owed" : "Current balance"} value={assetForm.balance} onChange={balance => setAssetForm({ ...assetForm, balance })} /><div className="wealth-modal-actions">{plan.assets.some(a => a.id === assetForm.id) && <button type="button" className="wealth-delete" onClick={() => { update({ assets: plan.assets.filter(a => a.id !== assetForm.id) }); setAssetForm(null); }}><Trash2 size={16} /> Remove</button>}<button type="button" className="wealth-secondary" onClick={() => setAssetForm(null)}>Cancel</button><button className="wealth-primary" type="submit">Save account <Check size={16} /></button></div></form></section></div>}
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
  const [goalId, setGoalId] = useState(goals[0]?.id || "");
  const [label, setLabel] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  const goal = goals.find(g => g.id === goalId) ?? goals[0];
  const result = goal ? opportunityCost(cost, frequency, goal.target, goal.saved, goal.weekly) : null;
  const previewProgress = previewReady && goal && totalGoalTarget > 0
    ? (savedTowardGoals - Math.min(goal.target, Math.max(0, goal.saved)) + Math.max(0, Math.min(goal.target, goal.saved) - (frequency === "once" ? cost : 0))) / totalGoalTarget * 100
    : null;
  useEffect(() => {
    onPreviewProgress(previewProgress);
    return () => onPreviewProgress(null);
  }, [onPreviewProgress, previewProgress]);

  return <section className="wealth-card wealth-opportunity"><div className="wealth-section-head"><div><h2>Spend or save?</h2><p>See what a purchase means for a savings goal. This trade-off is called opportunity cost.</p></div><span className="wealth-account-icon"><ArrowDownLeft size={22} /></span></div><div className="wealth-stack"><Field label="What are you considering?"><input value={label} onChange={e => setLabel(e.target.value)} placeholder="Dinner out, a new phone, a subscription…" /></Field><div className="wealth-two-fields"><Amount label="Cost" value={cost} onChange={value => { setCost(value); setPreviewReady(true); }} /><Field label="How often?"><select value={frequency} onChange={e => { setFrequency(e.target.value as SpendingFrequency); setPreviewReady(true); }}><option value="once">One-time</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></Field></div>{goal ? <Field label="Compare with this savings goal"><select value={goal.id} onChange={e => { setGoalId(e.target.value); setPreviewReady(true); }}>{goals.map(g => <option key={g.id} value={g.id}>{g.name} · {usd(g.weekly)}/week</option>)}</select></Field> : <div className="wealth-sample"><span>Add a savings goal to calculate the effect on your timeline.</span><button onClick={onNewGoal}>Create goal <Plus size={15} /></button></div>}
    <div className="wealth-opportunity-result" aria-live="polite"><span className="wealth-tag">{frequency === "once" ? "ONE PURCHASE, A REAL TRADE-OFF" : "SMALL AMOUNTS ADD UP"}</span><strong>{usd(frequency === "once" ? cost : cost * (frequency === "weekly" ? 52 : 12))}</strong><p>{frequency === "once" ? `that could go toward ${goal?.name || "your future"}` : `per year spent on ${label || "this choice"}`}</p>{result && goal && <><div className="wealth-timeline-compare"><div><span>Keep your savings plan</span><strong>{months(result.baselineMonths)}</strong></div><ArrowRight size={18} /><div><span>{label ? `With ${label}` : "With this spending"}</span><strong>{months(result.afterMonths)}</strong></div></div><p className="wealth-delay">{goal.saved >= goal.target ? "This goal is already funded. Choose an unfinished goal to compare." : goal.weekly <= 0 ? "Set a weekly savings contribution to calculate a timeline." : !Number.isFinite(result.delayDays) ? "This recurring cost uses all of this goal’s contribution. The goal will not be reached on this plan." : `${Math.round(result.delayDays * 10) / 10} days later for ${goal.name}.`}</p></>}</div><p className="wealth-note">Assumes this spending comes entirely from the selected goal’s savings{frequency !== "once" ? " and continues until the goal is reached" : ""}. Uses 52 weeks per year. No interest, investment growth, taxes, or inflation. Calculator scenarios do not change your budget or balances.</p></div></section>;
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
  const shortMoney = (value: number) => value >= 1_000_000
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
    <path d={path("contributions")} fill="none" stroke="#a9b69a" strokeWidth="2" strokeDasharray="5 5" />
    <path d={path("balance")} fill="none" stroke="#426745" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    {labels.map(year => <text key={year} x={x(year)} y={height - 8} textAnchor={year === 0 ? "start" : year === retirementAge - currentAge ? "end" : "middle"} fill="#657360" fontSize="11">{year === 0 ? `Age ${currentAge}` : `Age ${currentAge + year}`}</text>)}
  </svg>;
}
