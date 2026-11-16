import { useEffect, useState } from "react";
import { MoneyGoalForm } from "./components/MoneyGoalForm";
import { WealthDashboard, type DashboardTab } from "./components/WealthDashboard";
import { MoneyGoalView } from "./components/MoneyGoalView";
import type { LogDecision } from "./components/MoneyWhatIf";
import { PriceCheck } from "./components/PriceCheck";
import { Profile } from "./components/Profile";
import { Settings } from "./components/Settings";
import { TopNav, type NavPage } from "./components/TopNav";
import SoftAurora from "./components/SoftAurora";
import { Toast } from "./components/Toast";
import { PlaidOAuthResume } from "./components/PlaidOAuthResume";
import { todayISO } from "./lib/dates";
import { applyTheme, savedTheme, type Theme } from "./lib/theme";
import { EMPTY_STATE, type SavedState, demoState, loadState, saveState } from "./lib/storage";
import type { Goal, MoneyGoal } from "./lib/types";
import { spendableCash } from "./lib/money";
import { useBank } from "./lib/useBank";
import { celebrateNewlyReached } from "./lib/celebrate";
import { activeGoals, boughtGoals, cashOnHand, envelopes, markBought, unmarkBought } from "./lib/envelopes";
import { bankDataForPlan, includedItems } from "./lib/planningAccounts";
import { readPlan } from "./components/WealthDashboard";
import { accountIdRemapper } from "./lib/accountMatch";

const pageHashes: Record<NavPage, string> = { Overview: "overview", Accounts: "accounts", Plan: "plan", Goals: "my-goals", "Price check": "price-check", Profile: "profile" };
const pageFromHash = (): NavPage => {
  const hash = window.location.hash.slice(1);
  // Keep previously shared retirement and budget links useful after their merger.
  if (hash === "retirement" || hash === "budget") return "Plan";
  return (Object.entries(pageHashes).find(([, value]) => value === hash)?.[0] as NavPage) ?? "Overview";
};

// Check a price, save for something, and understand your money.
type Screen =
  | { name: "home" } // landing page
  | { name: "goals" } // dashboard
  | { name: "new-money" }
  | { name: "goal"; id: string }
  | { name: "settings" }
  | { name: "profile" }
  | { name: "money" }; // bank dashboard (Plaid)

/** Top-nav pages that are their own screen rather than a tab of the money dashboard. */
const screenForPage = (page: NavPage): Screen =>
  page === "Profile" ? { name: "profile" } : { name: "money" };
const isDashboardTab = (page: NavPage): page is Exclude<NavPage, "Price check" | "Profile"> => page !== "Price check" && page !== "Profile";

export default function App() {
  const [state, setState] = useState<SavedState>(loadState);
  const [screen, setScreen] = useState<Screen>(() => screenForPage(pageFromHash()));

  const [dashboardTab, setDashboardTab] = useState<DashboardTab>(() => { const page = pageFromHash(); return isDashboardTab(page) ? page : page === "Price check" ? "Goals" : "Overview"; });
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const bank = useBank();
  const navigate = (page: NavPage) => {
    if (isDashboardTab(page)) setDashboardTab(page);
    else if (page === "Price check") setDashboardTab("Goals");
    setScreen(screenForPage(page));
    if (window.location.hash !== "#" + pageHashes[page]) window.location.hash = pageHashes[page];
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const syncPage = () => {
      const page = pageFromHash();
      if (isDashboardTab(page)) setDashboardTab(page);
      else if (page === "Price check") setDashboardTab("Goals");
      setScreen(screenForPage(page));
    };
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  useEffect(() => {
    saveState(state);
  }, [state]);
  // Confetti the first time a goal reaches its target (once per goal; see lib/celebrate).
  useEffect(() => {
    celebrateNewlyReached(state.goals);
  }, [state.goals]);

  // Fresh bank data: share spendable cash with Check a price, and sync goals linked to an account.
  useEffect(() => {
    const data = bank.data;
    if (!data) return;
    // A reconnected bank gives its accounts new IDs: follow each goal to the same account.
    const remap = accountIdRemapper(data.accounts);
    const excluded = readPlan().excludedAccountIds.map(remap);
    setState((s) => ({
      ...s,
      bank: { cash: spendableCash(bankDataForPlan(data, excluded)?.accounts ?? []), fetchedAt: data.fetchedAt },
      goals: s.goals.map((g) => {
        if (g.kind !== "money" || !g.linkedAccountId) return g;
        const linkedAccountId = remap(g.linkedAccountId);
        const moved = linkedAccountId === g.linkedAccountId ? g : { ...g, linkedAccountId };
        if (excluded.includes(linkedAccountId)) return moved;
        const a = data.accounts.find((x) => x.id === linkedAccountId);
        // Disconnected: keep the last synced balance until the bank comes back.
        return a ? { ...moved, saved: Math.round(a.current * 100) / 100 } : moved;
      }),
    }));
  }, [bank.data]);
  useEffect(() => {
    // Block body on purpose: newer Chrome returns a Promise from scrollTo, which React would treat as a cleanup.
    window.scrollTo(0, 0);
  }, [screen]);

  useEffect(() => {
    if (window.location.hash !== "#price-check" || dashboardTab !== "Goals") return;
    requestAnimationFrame(() => document.getElementById("goal-price-check")?.scrollIntoView({ block: "start" }));
  }, [dashboardTab]);

  const allMoneyGoals = state.goals.filter((g): g is MoneyGoal => g.kind === "money");
  // Bought goals leave the envelopes: everything else in the app sees only the goals still being saved for.
  const moneyGoals = activeGoals(allMoneyGoals);
  const completedGoals = boughtGoals(allMoneyGoals);
  const buyGoal = (goal: MoneyGoal, paid: number, leftoverToId?: string) => {
    const { bought, receiver } = markBought(goal, paid, todayISO(), moneyGoals.find((g) => g.id === leftoverToId));
    setState((s) => ({
      ...s,
      goals: s.goals.map((g) => (g.id === bought.id ? bought : receiver && g.id === receiver.id ? receiver : g)),
      history: [...s.history, { id: crypto.randomUUID(), date: todayISO(), goalId: goal.id, goalName: goal.name, kind: "money", label: `Bought ${goal.name}`, amount: -paid }],
    }));
  };
  const goHome = () => navigate("Overview");
  const goGoals = () => navigate("Goals");
  const addGoal = (g: Goal) => {
    setState((s) => ({ ...s, goals: [...s.goals, g] }));
    setScreen({ name: "goal", id: g.id });
  };
  const updateGoal = (g: Goal) => setState((s) => ({ ...s, goals: s.goals.map((x) => (x.id === g.id ? g : x)) }));
  const deleteGoal = (id: string) => {
    const goals = state.goals.filter((g) => g.id !== id);
    setState((s) => ({ ...s, goals }));
    goGoals();
  };
  const logFor = (goal: Goal) => (d: LogDecision & { goalId?: string; goalName?: string }) =>
    setState((s) => ({
      ...s,
      history: [
        ...s.history,
        {
          id: crypto.randomUUID(),
          date: todayISO(),
          goalId: d.goalId ?? goal.id,
          goalName: d.goalName ?? goal.name,
          kind: "money",
          label: d.label,
          effectDays: d.effectDays,
          amount: d.amount,
        },
      ],
    }));
  const loadDemo = () => {
    setState(demoState());
    goGoals();
  };
  const back = goGoals;

  let body: React.ReactNode;
  switch (screen.name) {
    case "home":
    case "goals":
    case "money":
      body = (
        <WealthDashboard
          bank={bank}
          priceCheck={<PriceCheck moneyGoals={moneyGoals} profile={state.profile} bank={state.bank} bankData={bank.data}
            onNewGoal={() => setScreen({ name: "new-money" })}
            onCreateGoal={addGoal}
            onUpdateGoal={updateGoal}
            onOpenGoal={(id) => setScreen({ name: "goal", id })}
            onSettings={() => setScreen({ name: "settings" })}
            onFreshBalances={() => { void bank.ensureFreshBalances(); }}
            refreshingBalances={bank.loading} />}
          selectedTab={dashboardTab}
          onTabChange={(page) => { if (page === "Activity") setDashboardTab(page); else navigate(page); }}
          onCheck={() => navigate("Price check")}
          onSettings={() => setScreen({ name: "settings" })}
          profileName={state.profile.name?.trim() || "Michael"}
          hourlyWage={state.profile.hourlyWage}
          goals={moneyGoals}
          completedGoals={completedGoals}
          onUpdateGoal={updateGoal}
          // Polaris adds and (on undo) removes goals without leaving the page.
          onAddGoal={(g) => setState((s) => ({ ...s, goals: [...s.goals, g] }))}
          onRemoveGoal={(id) => setState((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== id) }))}
          onOpenGoal={(id) => setScreen({ name: "goal", id })}
          onNewGoal={() => setScreen({ name: "new-money" })}
        />
      );
      break;
    case "profile":
      body = (
        <Profile
          profile={state.profile}
          onProfile={(p) => setState((s) => ({ ...s, profile: p }))}
          goals={moneyGoals}
          history={state.history}
          bank={bank}
          onGoals={goGoals}
          onAccounts={() => navigate("Accounts")}
          onSettings={() => setScreen({ name: "settings" })}
        />
      );
      break;
    case "new-money":
      body = <MoneyGoalForm onCreate={addGoal} onBack={back} />;
      break;
    case "goal": {
      const g = state.goals.find((x) => x.id === screen.id);
      const common = { onDelete: () => g && deleteGoal(g.id), onBack: goGoals };
      if (!g) body = null;
      else {
        const plan = readPlan();
        const planningBankData = bankDataForPlan(bank.data, plan.excludedAccountIds);
        const planningAssets = includedItems(plan.assets, plan.excludedAccountIds);
        const knowsCash = !!planningBankData?.accounts.length || planningAssets.some((a) => a.kind === "Checking" || a.kind === "Savings");
        const free = knowsCash ? envelopes(moneyGoals, cashOnHand(planningBankData?.accounts ?? [], planningAssets)).free : null;
        body = <MoneyGoalView goal={g} onChange={updateGoal} onLog={logFor(g)} {...common} freeCash={free}
          otherGoals={moneyGoals.filter((x) => x.id !== g.id)}
          onBuy={(paid, to) => buyGoal(g, paid, to)}
          onRestore={() => updateGoal(unmarkBought(g))}
          linkedAccount={(() => { const a = bank.data?.accounts.find((x) => x.id === g.linkedAccountId); return a ? { name: a.name, balance: a.current } : undefined; })()}
          linkPaused={g.kind === "money" && !!g.linkedAccountId && !!bank.status && !bank.loading && !bank.data?.accounts.some((x) => x.id === g.linkedAccountId)} />;
      }
      break;
    }
    case "settings":
      body = (
        <Settings
          profile={state.profile}
          onProfile={(p) => setState((s) => ({ ...s, profile: p }))}
          theme={theme}
          onTheme={setTheme}
          onDemo={loadDemo}
          onReset={() => {
            try { localStorage.removeItem("tradeoff:wealth:v1"); } catch { /* Storage can be blocked. */ }
            setState(EMPTY_STATE);
            goHome();
          }}
          onBack={goGoals}
          snapshots={bank.data?.netWorthSnapshots}
        />
      );
      break;
    default:
      body = null;
  }

  const isLanding = screen.name === "home" || screen.name === "money" || screen.name === "goals"; // these render their own full-width layout
  return (
    <div className="relative min-h-dvh isolate">
      <SoftAurora
        speed={0.6}
        scale={1.5}
        brightness={1}
        color1="#54e2c2"
        color2="#c294ff"
        bandHeight={0.5}
        bandSpread={1}
        enableMouseInteraction
        mouseInfluence={0.25}
        spectrum={0.35}
        colorSpeed={1}
        noiseFrequency={2.5}
        noiseAmplitude={1}
        tilt={0}
        octaveDecay={0.1}
        layerOffset={0}
        clickPulse
        intro
        lightMode={theme === "light"}
        className="soft-aurora-background"
      />
      <TopNav profile={state.profile} onNavigate={navigate} active={screen.name === "profile" ? "Profile" : screen.name === "goal" || screen.name === "new-money" ? "Goals" : screen.name === "settings" ? null : dashboardTab === "Activity" ? "Accounts" : dashboardTab} />
      {isLanding ? body : <main id="main" className="mx-auto max-w-md px-4 pb-16 pt-6 sm:max-w-2xl">{body}</main>}
      <PlaidOAuthResume onConnected={() => { void bank.reload(); }} />
      <Toast />
    </div>
  );
}
