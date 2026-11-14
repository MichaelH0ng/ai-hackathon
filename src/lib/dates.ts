// Local-date helpers. Dates are stored as "YYYY-MM-DD" strings in the user's time zone.

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date {
  return new Date(s + "T00:00:00");
}

export function todayISO(from: Date = new Date()): string {
  return toISO(from);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

export function formatDate(iso: string): string {
  return parseISO(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatWeekday(iso: string): string {
  return parseISO(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
