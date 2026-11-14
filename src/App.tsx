import { useEffect, useState } from "react";
import { FoodGoalForm } from "./components/FoodGoalForm";
import { FoodGoalView } from "./components/FoodGoalView";
import { Home } from "./components/Home";
import { LANDING_SECTIONS, Landing } from "./components/Landing";
import { MoneyGoalForm } from "./components/MoneyGoalForm";
import { MoneyGoalView } from "./components/MoneyGoalView";
import type { LogDecision } from "./components/MoneyWhatIf";
import { PathCards, type PathKind } from "./components/PathCards";
import { PriceCheck } from "./components/PriceCheck";
import { Settings } from "./components/Settings";
import { StudyGoalForm } from "./components/StudyGoalForm";
import { StudyGoalView } from "./components/StudyGoalView";
import { TopNav } from "./components/TopNav";
import { BackButton } from "./components/ui";
import { todayISO } from "./lib/dates";
import { EMPTY_STATE, type SavedState, demoState, loadState, saveState } from "./lib/storage";
import type { Goal, MoneyGoal } from "./lib/types";

// Flow: Set a Goal → Generate a Plan → Test a Decision → Calculate Opportunity Cost → Update the Timeline.
type Screen =
  | { name: "home" } // landing page
  | { name: "goals" } // dashboard
  | { name: "new" } // pick a goal type
  | { name: "new-money" }
  | { name: "new-study" }
  | { name: "new-food" }
  | { name: "goal"; id: string }
  | { name: "settings" }
  | { name: "check" }; // snap a price tag / type a price

export default function App() {
  const [state, setState] = useState<SavedState>(loadState);
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  useEffect(() => {
    saveState(state);
  }, [state]);
  useEffect(() => {
    // Block body on purpose: newer Chrome returns a Promise from scrollTo, which React would treat as a cleanup.
    window.scrollTo(0, 0);
  }, [screen]);

  const moneyGoals = state.goals.filter((g): g is MoneyGoal => g.kind === "money");
  const goHome = () => setScreen({ name: "home" });
  const goGoals = () => setScreen(state.goals.length ? { name: "goals" } : { name: "home" });
  const pick = (k: PathKind) => setScreen(k === "money" ? { name: "new-money" } : k === "study" ? { name: "new-study" } : { name: "new-food" });
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
          kind: goal.kind === "study" ? "study" : "money",
          label: d.label,
          effectDays: d.effectDays,
          amount: d.amount,
          hours: d.hours,
        },
      ],
    }));
  const loadDemo = () => {
    setState(demoState());
    setScreen({ name: "goals" });
  };
  const back = () => setScreen(state.goals.length ? { name: "new" } : { name: "home" });

  let body: React.ReactNode;
  switch (screen.name) {
    case "home":
      body = <Landing goalCount={state.goals.length} onPick={pick} onDemo={loadDemo} onGoals={goGoals} onCheck={() => setScreen({ name: "check" })} />;
      break;
    case "check":
      body = (
        <PriceCheck
          moneyGoals={moneyGoals}
          profile={state.profile}
          onUpdateGoal={updateGoal}
          onLog={(g, d) => logFor(g)(d)}
          onNewGoal={() => setScreen({ name: "new-money" })}
          onSettings={() => setScreen({ name: "settings" })}
        />
      );
      break;
    case "new":
      body = (
        <div>
          <BackButton onClick={goGoals} label="My goals" />
          <h1 className="text-3xl font-bold text-ink">What are you working toward?</h1>
          <p className="mb-6 mt-1 text-stone-600">Pick a goal type. You can have as many as you like.</p>
          <PathCards onPick={pick} compact />
        </div>
      );
      break;
    case "new-money":
      body = <MoneyGoalForm onCreate={addGoal} onBack={back} />;
      break;
    case "new-study":
      body = <StudyGoalForm onCreate={addGoal} onBack={back} />;
      break;
    case "new-food":
      body = <FoodGoalForm moneyGoals={moneyGoals} onCreate={addGoal} onBack={back} />;
      break;
    case "goal": {
      const g = state.goals.find((x) => x.id === screen.id);
      const common = { onDelete: () => g && deleteGoal(g.id), onBack: goGoals };
      if (!g) body = null;
      else if (g.kind === "money") body = <MoneyGoalView goal={g} profile={state.profile} onChange={updateGoal} onLog={logFor(g)} {...common} />;
      else if (g.kind === "study") body = <StudyGoalView goal={g} onChange={updateGoal} onLog={logFor(g)} {...common} />;
      else body = <FoodGoalView goal={g} moneyGoals={moneyGoals} onChange={updateGoal} onChangeMoney={updateGoal} onLog={logFor(g)} {...common} />;
      break;
    }
    case "settings":
      body = (
        <Settings
          profile={state.profile}
          onProfile={(p) => setState((s) => ({ ...s, profile: p }))}
          onDemo={loadDemo}
          onReset={() => {
            setState(EMPTY_STATE);
            setScreen({ name: "home" });
          }}
          onBack={goGoals}
        />
      );
      break;
    default:
      body = <Home goals={state.goals} history={state.history} onOpen={(id) => setScreen({ name: "goal", id })} onNew={() => setScreen({ name: "new" })} onCheck={() => setScreen({ name: "check" })} />;
  }

  const isLanding = screen.name === "home";
  return (
    <div className="min-h-dvh">
      <TopNav
        onHome={goHome}
        onGoals={goGoals}
        onSettings={() => setScreen({ name: "settings" })}
        onStart={() => (isLanding ? document.getElementById("paths")?.scrollIntoView({ behavior: "smooth" }) : setScreen({ name: "home" }))}
        onCheck={() => setScreen({ name: "check" })}
        goalCount={state.goals.length}
        sections={isLanding ? LANDING_SECTIONS : undefined}
        active={screen.name === "goals" ? "goals" : screen.name === "settings" ? "settings" : screen.name === "home" ? "home" : screen.name === "check" ? "check" : "other"}
      />
      {isLanding ? body : <main id="main" className="mx-auto max-w-md px-4 pb-16 pt-6 sm:max-w-2xl">{body}</main>}
    </div>
  );
}
