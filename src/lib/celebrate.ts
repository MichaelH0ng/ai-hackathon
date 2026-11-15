import confetti from "canvas-confetti";

// Goals we've already celebrated, per browser, so each goal gets confetti only once.
const KEY = "northstar:celebrated-goals";
const BRAND = ["#54e2c2", "#74b9ff", "#c294ff", "#edf6ff"];

function readCelebrated(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/** One short burst the first time any goal reaches its target. Skipped for reduced motion. */
export function celebrateNewlyReached(goals: { id: string; target: number; saved: number }[]): void {
  const done = goals.filter((g) => g.target > 0 && g.saved >= g.target);
  const celebrated = readCelebrated();
  const fresh = done.filter((g) => !celebrated.has(g.id));
  if (!fresh.length) return;
  for (const g of fresh) celebrated.add(g.id);
  try { localStorage.setItem(KEY, JSON.stringify([...celebrated])); } catch { /* still celebrate, just maybe again next visit */ }
  confetti({ particleCount: 90, spread: 75, startVelocity: 38, origin: { y: 0.3 }, colors: BRAND, disableForReducedMotion: true });
}
