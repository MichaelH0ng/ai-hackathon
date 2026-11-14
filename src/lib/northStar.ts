/** Stars between the starting point and the North Star, one per 20% milestone. The fifth milestone is the North Star itself. */
const milestoneNames = ["First star", "Second star", "Halfway star", "Last star"] as const;
export const constellationMilestones = milestoneNames.length + 1;

export function northStarMilestone(progress: number) {
  const percent = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  const litStars = Math.floor(percent / 20);
  const name = litStars === 0
    ? "Starting point"
    : litStars === constellationMilestones
      ? "North Star reached"
      : `${milestoneNames[litStars - 1]} lit`;
  return {
    name,
    litStars,
    nextAt: litStars < constellationMilestones ? (litStars + 1) * 20 : null,
    /** How much of each line between stars is lit (0–1), so the path fills in between milestones. */
    segments: Array.from({ length: constellationMilestones }, (_, i) => Math.max(0, Math.min(1, (percent - i * 20) / 20))),
  };
}
