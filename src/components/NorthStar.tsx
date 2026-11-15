import { ArrowRight, Sparkles } from "lucide-react";
import { formatMoney } from "../lib/finance";
import { northStarMilestone } from "../lib/northStar";

/** Path from your starting point (bottom left), through one star per milestone, to the North Star (top right). */
const constellation = [
  { x: 30, y: 146 },
  { x: 68, y: 120 },
  { x: 108, y: 134 },
  { x: 134, y: 96 },
  { x: 172, y: 80 },
  { x: 206, y: 38 },
];
const northStar = constellation[constellation.length - 1];

/** Faint background stars, purely decorative. */
const skyDust = [[18, 24], [52, 52], [88, 18], [120, 44], [152, 20], [228, 92], [196, 132], [222, 160], [146, 152], [90, 82], [36, 96], [168, 120]];

/** Four-pointed star centred on (x, y): outer radius r, waist w. */
const sparkle = (x: number, y: number, r: number, w: number) =>
  `M${x} ${y - r}L${x + w} ${y - w}L${x + r} ${y}L${x + w} ${y + w}L${x} ${y + r}L${x - w} ${y + w}L${x - r} ${y}L${x - w} ${y - w}Z`;

function Constellation({ litStars, segments }: { litStars: number; segments: number[] }) {
  const reached = litStars === segments.length;
  return <svg viewBox="0 0 240 176" className="northstar-visual" aria-hidden="true">
    {skyDust.map(([x, y], i) => <circle key={i} className="northstar-dust" cx={x} cy={y} r={i % 3 === 0 ? 1.1 : 0.7} />)}
    {segments.map((fill, i) => {
      const a = constellation[i], b = constellation[i + 1];
      return <g key={i}>
        <line className="northstar-link" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line className="northstar-link lit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} pathLength={1} strokeDashoffset={1 - fill} />
      </g>;
    })}
    {constellation.slice(0, -1).map((star, i) => <circle key={i} className={`northstar-node ${i <= litStars ? "lit" : ""}`} cx={star.x} cy={star.y} r={i === 0 ? 3 : 3.6} />)}
    <g className={`northstar-polaris ${reached ? "lit" : ""}`}>
      <circle className="northstar-halo" cx={northStar.x} cy={northStar.y} r="17" />
      <path className="northstar-star" d={sparkle(northStar.x, northStar.y, 15, 3.4)} />
      <circle className="northstar-star-core" cx={northStar.x} cy={northStar.y} r="2.6" />
    </g>
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
      <Constellation litStars={milestone.litStars} segments={milestone.segments} />
      <span>{milestone.name}</span>
    </div>
    <div className="northstar-copy">
      <span className="northstar-kicker"><Sparkles size={15} /> NORTHSTAR</span>
      <h2 id="northstar-title">Keep your goals in sight.</h2>
      <p>Your NorthStar reflects overall savings-goal progress. Each 20% milestone lights the next star in your constellation, until you reach the North Star.</p>
      {hasGoals ? <>
        <div className="northstar-progress-label"><span>{showingPreview ? "With this spending scenario" : "Overall savings-goal progress"}</span><strong>{Math.round(shownProgress)}%</strong></div>
        <div className="northstar-progress" role="progressbar" aria-label={showingPreview ? "What-if savings goal progress" : "Overall savings-goal progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shownProgress)}><i style={{ width: `${shownProgress}%` }} /></div>
        {showingPreview && <p className="northstar-current">Your current progress is {Math.round(progress)}%. This is only a preview and does not change balances; recurring spending affects the goal timeline, not savings already set aside.</p>}
      </> : <div className="northstar-empty"><p>Create a savings goal to chart your first course.</p><button className="wealth-primary" onClick={onNewGoal}>Create a savings goal <ArrowRight size={16} /></button></div>}
    </div>
  </section>;
}

export function BudgetNorthStar({ progress, hasIncome, remainder, incomeSource = "manual" }: {
  progress: number;
  hasIncome: boolean;
  remainder: number;
  incomeSource?: "detected" | "manual" | "none";
}) {
  const milestone = northStarMilestone(progress);
  const status = remainder < 0
    ? `${formatMoney(Math.abs(remainder), true)} over your monthly income. Adjust the plan to rebalance.`
    : remainder === 0
      ? "Your monthly plan is balanced."
      : `${formatMoney(remainder, true)} left to plan.`;

  return <section className="northstar-summary wealth-accent" aria-labelledby="budget-northstar-title">
    <div className="northstar-art">
      <Constellation litStars={milestone.litStars} segments={milestone.segments} />
      <span>{milestone.name}</span>
    </div>
    <div className="northstar-copy">
      <span className="northstar-kicker"><Sparkles size={15} /> BUDGET BALANCE</span>
      <h2 id="budget-northstar-title">Bring your budget into balance.</h2>
      <p>Your constellation lights up as planned expenses and savings move closer to your monthly income.</p>
      {hasIncome ? <>
        <div className="northstar-progress-label"><span>Monthly plan balance</span><strong>{Math.round(progress)}%</strong></div>
        <div className="northstar-progress" role="progressbar" aria-label="Monthly plan balance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div>
        <p className="northstar-current">{status}</p>
      </> : <p className="northstar-current">Add monthly after-tax income to see your progress.</p>}
      <p className="wealth-note">{incomeSource === "detected" ? "Income is estimated from recurring connected-account deposits; it can change as activity changes." : "Based on the monthly amounts you entered."}</p>
    </div>
  </section>;
}
