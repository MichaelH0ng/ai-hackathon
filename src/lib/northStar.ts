const planetNames = ["Mercury", "Venus", "Earth", "Mars", "Jupiter"] as const;

export function northStarMilestone(progress: number) {
  const percent = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  const activePlanets = Math.floor(percent / 20);
  const name = activePlanets === 0
    ? "Launchpad"
    : activePlanets === planetNames.length
      ? "Full system"
      : `${planetNames[activePlanets - 1]} reached`;
  return {
    name,
    activePlanets,
    nextAt: activePlanets < planetNames.length ? (activePlanets + 1) * 20 : null,
  };
}
