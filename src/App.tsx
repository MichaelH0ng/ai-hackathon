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
import { todayISO } from "./lib/dates";
import { EMPTY_STATE, type SavedState, demoState, loadState, saveState } from "./lib/storage";
import type { Goal, MoneyGoal } from "./lib/types";
import { spendableCash } from "./lib/money";
import { useBank } from "./lib/useBank";

const pageHashes: Record<NavPage, string> = { Overview: "overview", Accounts: "accounts", Goals: "my-goals", Retirement: "retirement", Budget: "budget", "Price check": "price-check", Profile: "profile" };
const pageFromHash = (): NavPage => (Object.entries(pageHashes).find(([, hash]) => hash === window.location.hash.slice(1))?.[0] as NavPage) ?? "Overview";

// Check a price, save for something, and understand your money.
type Screen =
  | { name: "home" } // landing page
  | { name: "goals" } // dashboard
  | { name: "new-money" }
  | { name: "goal"; id: string }
  | { name: "settings" }
  | { name: "check" } // snap a price tag / type a price
  | { name: "profile" }
  | { name: "money" }; // bank dashboard (Plaid)

/** Top-nav pages that are their own screen rather than a tab of the money dashboard. */
const screenForPage = (page: NavPage): Screen =>
  page === "Price check" ? { name: "check" } : page === "Profile" ? { name: "profile" } : { name: "money" };
const isDashboardTab = (page: NavPage): page is Exclude<NavPage, "Price check" | "Profile"> => page !== "Price check" && page !== "Profile";

export default function App() {
  const [state, setState] = useState<SavedState>(loadState);
  const [screen, setScreen] = useState<Screen>(() => screenForPage(pageFromHash()));

  const [dashboardTab, setDashboardTab] = useState<DashboardTab>(() => { const page = pageFromHash(); return isDashboardTab(page) ? page : "Overview"; });
  const bank = useBank();
  const navigate = (page: NavPage) => {
    if (isDashboardTab(page)) setDashboardTab(page);
    setScreen(screenForPage(page));
    if (window.location.hash !== "#" + pageHashes[page]) window.location.hash = pageHashes[page];
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const syncPage = () => {
      const page = pageFromHash();
      if (isDashboardTab(page)) setDashboardTab(page);
      setScreen(screenForPage(page));
    };
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  useEffect(() => {
    saveState(state);
  }, [state]);

  // Fresh bank data: share spendable cash with Check a price, and sync goals linked to an account.
  useEffect(() => {
    const data = bank.data;
    if (!data) return;
    setState((s) => ({
      ...s,
      bank: { cash: spendableCash(data.accounts), fetchedAt: data.fetchedAt },
      goals: s.goals.map((g) => {
        if (g.kind !== "money" || !g.linkedAccountId) return g;
        const a = data.accounts.find((x) => x.id === g.linkedAccountId);
        return a ? { ...g, saved: Math.round(a.current * 100) / 100 } : g;
      }),
    }));
  }, [bank.data]);
  useEffect(() => {
    // Block body on purpose: newer Chrome returns a Promise from scrollTo, which React would treat as a cleanup.
    window.scrollTo(0, 0);
  }, [screen]);

  const moneyGoals = state.goals.filter((g): g is MoneyGoal => g.kind === "money");
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
          selectedTab={dashboardTab}
          onTabChange={(page) => { if (page === "Activity") setDashboardTab(page); else navigate(page); }}
          onCheck={() => navigate("Price check")}
          onSettings={() => setScreen({ name: "settings" })}
          goals={moneyGoals}
          onUpdateGoal={updateGoal}
          onOpenGoal={(id) => setScreen({ name: "goal", id })}
          onNewGoal={() => setScreen({ name: "new-money" })}
        />
      );
      break;
    case "check":
      body = (
        <PriceCheck
          moneyGoals={moneyGoals}
          profile={state.profile}
          bank={state.bank}
          onUpdateGoal={updateGoal}
          onLog={(g, d) => logFor(g)(d)}
          onNewGoal={() => setScreen({ name: "new-money" })}
          onSettings={() => setScreen({ name: "settings" })}
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
      else body = <MoneyGoalView goal={g} onChange={updateGoal} onLog={logFor(g)} {...common} />;
      break;
    }
    case "settings":
      body = (
        <Settings
          profile={state.profile}
          onProfile={(p) => setState((s) => ({ ...s, profile: p }))}
          onDemo={loadDemo}
          onReset={() => {
            try { localStorage.removeItem("tradeoff:wealth:v1"); } catch { /* Storage can be blocked. */ }
            setState(EMPTY_STATE);
            goHome();
          }}
          onBack={goGoals}
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
        lightMode={false}
        className="soft-aurora-background"
      />
      <TopNav onNavigate={navigate} active={screen.name === "check" ? "Price check" : screen.name === "profile" ? "Profile" : screen.name === "goal" || screen.name === "new-money" ? "Goals" : screen.name === "settings" ? null : dashboardTab === "Activity" ? "Accounts" : dashboardTab} />
      {isLanding ? body : <main id="main" className="mx-auto max-w-md px-4 pb-16 pt-6 sm:max-w-2xl">{body}</main>}
    </div>
  );
}
