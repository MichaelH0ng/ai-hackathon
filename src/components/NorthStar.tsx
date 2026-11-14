import { ArrowRight, Sparkles } from "lucide-react";
import { formatMoney } from "../lib/finance";
import { northStarMilestone } from "../lib/northStar";

const orbits = [
  { radiusX: 24, radiusY: 16, x: 144, y: 88 },
  { radiusX: 43, radiusY: 28, x: 120, y: 60 },
  { radiusX: 62, radiusY: 40, x: 58, y: 88 },
  { radiusX: 81, radiusY: 52, x: 177, y: 51 },
  { radiusX: 100, radiusY: 64, x: 220, y: 88 },
];

function SolarSystem({ activePlanets }: { activePlanets: number }) {
  return <svg viewBox="0 0 240 176" className="northstar-visual" aria-hidden="true">
    {orbits.map((orbit, index) => <ellipse key={index} className="northstar-orbit" cx="120" cy="88" rx={orbit.radiusX} ry={orbit.radiusY} />)}
    {orbits.map((orbit, index) => <circle key={index} className={`northstar-planet planet-${index + 1} ${index < activePlanets ? "active" : ""}`} cx={orbit.x} cy={orbit.y} r={index === 2 ? 5 : 4} />)}
    <path className="northstar-star" d="M120 68l5.5 14.5L140 88l-14.5 5.5L120 108l-5.5-14.5L100 88l14.5-5.5z" />
    <circle className="northstar-star-core" cx="120" cy="88" r="3" />
  </svg>;
}

export function NorthStar({ progress, previewProgress, hasGoals, onNewGoal }: {
  progress: number;
  previewProgress: number | null;
  hasGoals: boolean;
  onNewGoal: () => void;
}) {
  const showingPreview = previewProgress !== null;
  const shownProgress = showingPreview ? previewProgress : progress;
  const milestone = northStarMilestone(shownProgress);

  return <section className="northstar-summary" aria-labelledby="northstar-title">
    <div className="northstar-art">
      <SolarSystem activePlanets={milestone.activePlanets} />
      <span>{milestone.name}</span>
    </div>
    <div className="northstar-copy">
      <span className="northstar-kicker"><Sparkles size={15} /> NORTHSTAR</span>
      <h2 id="northstar-title">Keep your goals in sight.</h2>
      <p>Your NorthStar reflects overall savings-goal progress. Each 20% milestone brings another planet into your system.</p>
      {hasGoals ? <>
        <div className="northstar-progress-label"><span>{showingPreview ? "With this spending scenario" : "Overall savings-goal progress"}</span><strong>{Math.round(shownProgress)}%</strong></div>
        <div className="northstar-progress" role="progressbar" aria-label={showingPreview ? "What-if savings goal progress" : "Overall savings-goal progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shownProgress)}><i style={{ width: `${shownProgress}%` }} /></div>
        {showingPreview && <p className="northstar-current">Your current progress is {Math.round(progress)}%. This is only a preview and does not change balances; recurring spending affects the goal timeline, not savings already set aside.</p>}
      </> : <div className="northstar-empty"><p>Create a savings goal to chart your first course.</p><button className="wealth-primary" onClick={onNewGoal}>Create a savings goal <ArrowRight size={16} /></button></div>}
    </div>
  </section>;
}

export function BudgetNorthStar({ progress, hasIncome, remainder }: {
  progress: number;
  hasIncome: boolean;
  remainder: number;
}) {
  const milestone = northStarMilestone(progress);
  const status = remainder < 0
    ? `${formatMoney(Math.abs(remainder), true)} over your monthly income. Adjust the plan to rebalance.`
    : remainder === 0
      ? "Your monthly plan is balanced."
      : `${formatMoney(remainder, true)} left to plan.`;

  return <section className="northstar-summary" aria-labelledby="budget-northstar-title">
    <div className="northstar-art">
      <SolarSystem activePlanets={milestone.activePlanets} />
      <span>{milestone.name}</span>
    </div>
    <div className="northstar-copy">
      <span className="northstar-kicker"><Sparkles size={15} /> BUDGET BALANCE</span>
      <h2 id="budget-northstar-title">Bring your budget into balance.</h2>
      <p>Your solar system grows as planned expenses and savings move closer to your monthly income.</p>
      {hasIncome ? <>
        <div className="northstar-progress-label"><span>Monthly plan balance</span><strong>{Math.round(progress)}%</strong></div>
        <div className="northstar-progress" role="progressbar" aria-label="Monthly plan balance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div>
        <p className="northstar-current">{status}</p>
      </> : <p className="northstar-current">Add monthly after-tax income to see your progress.</p>}
      <p className="wealth-note">Based on your plan, not actual transactions.</p>
    </div>
  </section>;
}
