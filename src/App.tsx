import { useEffect, useState } from "react";
import { Home } from "./components/Home";
import { MoneyGoalForm } from "./components/MoneyGoalForm";
import { WealthDashboard } from "./components/WealthDashboard";
import { MoneyGoalView } from "./components/MoneyGoalView";
import type { LogDecision } from "./components/MoneyWhatIf";
import { PriceCheck } from "./components/PriceCheck";
import { Settings } from "./components/Settings";
import { TopNav } from "./components/TopNav";
import { FinancialChat } from "./components/FinancialChat";
import { AuroraBackground } from "./components/AuroraBackground";
import SoftAurora from "./components/SoftAurora";
import { StudyGoalForm } from "./components/StudyGoalForm";
import { StudyGoalView } from "./components/StudyGoalView";
import { BackButton } from "./components/ui";
import { todayISO } from "./lib/dates";
import { EMPTY_STATE, type SavedState, demoState, loadState, saveState } from "./lib/storage";
import type { Goal, MoneyGoal } from "./lib/types";
import { spendableCash } from "./lib/money";
import { useBank } from "./lib/useBank";

// Check a price, save for something, and understand your money.
type Screen =
  | { name: "home" } // landing page
  | { name: "goals" } // dashboard
  | { name: "new-money" }
  | { name: "goal"; id: string }
  | { name: "settings" }
  | { name: "check" } // snap a price tag / type a price
  | { name: "money" }; // bank dashboard (Plaid)

export default function App() {
  const [state, setState] = useState<SavedState>(loadState);
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  const bank = useBank();

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
  const goHome = () => setScreen({ name: "home" });
  const goGoals = () => setScreen(state.goals.length ? { name: "goals" } : { name: "home" });
  const addGoal = (g: Goal) => {
    setState((s) => ({ ...s, goals: [...s.goals, g] }));
    setScreen({ name: "goal", id: g.id });
  };
  const updateGoal = (g: Goal) => setState((s) => ({ ...s, goals: s.goals.map((x) => (x.id === g.id ? g : x)) }));
  const deleteGoal = (id: string) => {
    const goals = state.goals.filter((g) => g.id !== id);
    setState((s) => ({ ...s, goals }));
    setScreen(goals.length ? { name: "goals" } : { name: "home" });
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
    setScreen({ name: "goals" });
  };
  const back = goGoals;

  let body: React.ReactNode;
  switch (screen.name) {
    case "home":
      body = <Landing onMoney={() => setScreen({ name: "money" })} goalCount={state.goals.length} onNewGoal={() => setScreen({ name: "new-money" })} onDemo={loadDemo} onGoals={goGoals} onCheck={() => setScreen({ name: "check" })} moneyGoals={moneyGoals} bank={bank} onOpenGoal={(id) => setScreen({ name: "goal", id })} onUpdateGoal={updateGoal} />;
      break;
    case "money":
      body = (
        <WealthDashboard
          bank={bank}
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
            setScreen({ name: "home" });
          }}
          onBack={goGoals}
        />
      );
      break;
    default:
      body = <Home goals={state.goals} history={state.history} onOpen={(id) => setScreen({ name: "goal", id })} onNew={() => setScreen({ name: "new-money" })} onCheck={() => setScreen({ name: "check" })} />;
  }

  const isLanding = screen.name === "home" || screen.name === "money"; // these render their own full-width layout
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
      <TopNav
        onHome={goHome}
        onGoals={goGoals}
        onSettings={() => setScreen({ name: "settings" })}
        onCheck={() => setScreen({ name: "check" })}
        onMoney={() => setScreen({ name: "money" })}
        goalCount={state.goals.length}
        active={screen.name === "goals" ? "goals" : screen.name === "settings" ? "settings" : screen.name === "home" ? "home" : screen.name === "check" ? "check" : screen.name === "money" ? "money" : "other"}
      />
      {isLanding ? body : <main id="main" className="mx-auto max-w-md px-4 pb-16 pt-6 sm:max-w-2xl">{body}</main>}
    </div>
  );
}
