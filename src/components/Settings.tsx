import { CalendarDays, Moon, Sun } from "lucide-react";
import { addDays, daysBetween, formatDate } from "../lib/dates";
import type { NetWorthSnapshot } from "../lib/money";
import type { Theme } from "../lib/theme";
import type { Profile } from "../lib/types";
import { BackButton, Button, Card, NumberField } from "./ui";
import { PolarisVoiceSettings } from "./PolarisVoiceSettings";

export function Settings({
  profile,
  onProfile,
  theme,
  onTheme,
  onDemo,
  onReset,
  onBack,
  snapshots = [],
}: {
  profile: Profile;
  onProfile: (p: Profile) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onDemo: () => void;
  onReset: () => void;
  onBack: () => void;
  snapshots?: NetWorthSnapshot[];
}) {
  return (
    <div className="space-y-3">
      <BackButton onClick={onBack} />
      <Card>
        <h2 className="text-xl font-bold text-stone-900">Settings</h2>
        <div className="mt-4">
          <NumberField
            label="Your hourly pay (optional)"
            value={profile.hourlyWage ?? ""}
            onChange={(v) => onProfile({ ...profile, hourlyWage: v === "" ? null : v })}
            suffix="/hr"
            hint={`Check a price will say "that's 2h 10m of work".`}
          />
        </div>
      </Card>
      <Card>
        <h3 className="font-bold text-stone-900">Appearance</h3>
        <p className="mb-3 text-sm text-stone-600">Choose how NorthStar looks on this device.</p>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
          {([
            { value: "light", label: "Light", Icon: Sun },
            { value: "dark", label: "Dark", Icon: Moon },
          ] as const).map(({ value, label, Icon }) => (
            <button
              key={value}
              role="radio"
              aria-checked={theme === value}
              onClick={() => onTheme(value)}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-bold ring-1 transition-colors duration-200 ${
                theme === value ? "bg-brand-600 text-white ring-brand-600" : "bg-stone-100 text-stone-800 ring-stone-300 hover:bg-stone-200"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </Card>
      <DataHistory snapshots={snapshots} />
      <PolarisVoiceSettings />
      <Card>
        <h3 className="font-bold text-stone-900">Demo</h3>
        <p className="mb-3 text-sm text-stone-600">Loads the $1,199 new phone and spring break savings examples. Replaces your current goals.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onDemo}>
            Load demo
          </Button>
          <Button variant="ghost" className="text-red-700" onClick={onReset}>
            Start over
          </Button>
        </div>
      </Card>
    </div>
  );
}

function DataHistory({ snapshots }: { snapshots: NetWorthSnapshot[] }) {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1)?.date;
  const ranges = latest
    ? [
        { label: "1 month", start: addDays(latest, -30) },
        { label: "3 months", start: addDays(latest, -90) },
        { label: "Year to date", start: `${latest.slice(0, 4)}-01-01` },
        { label: "All tracked", start: sorted[0]?.date ?? latest },
      ].map((range) => {
        const expected = Math.max(1, daysBetween(range.start, latest) + 1);
        const recorded = new Set(sorted.filter((snapshot) => snapshot.date >= range.start && snapshot.date <= latest).map((snapshot) => snapshot.date)).size;
        return { ...range, expected, recorded, pct: Math.min(100, Math.round(recorded / expected * 100)) };
      })
    : [];

  return <Card>
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><CalendarDays size={19} aria-hidden="true" /></span>
      <div>
        <h3 className="font-bold text-stone-900">Data history</h3>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">NorthStar saves one daily net-worth snapshot at 3:15 AM while this local API is running. Missed days stay visible as gaps.</p>
      </div>
    </div>
    {latest ? <>
      <p className="mt-4 text-sm text-stone-600">Recording since <strong className="text-stone-900">{formatDate(sorted[0].date)}</strong> · latest snapshot <strong className="text-stone-900">{formatDate(latest)}</strong></p>
      <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Recorded daily coverage by chart range">
        {ranges.map((range) => <div key={range.label} className="rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
          <div className="flex items-baseline justify-between gap-2"><span className="text-xs font-semibold text-stone-600">{range.label}</span><strong className="shrink-0 text-xs tabular-nums text-stone-900">{range.recorded}/{range.expected}</strong></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${range.pct}%` }} /></div>
        </div>)}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-stone-500">A complete range has one snapshot for every calendar day. Before then, the graph can still show estimated transaction history; it is not a statement.</p>
    </> : <p className="mt-3 text-sm text-stone-600">Your first snapshot appears after NorthStar successfully loads all connected accounts.</p>}
  </Card>;
}
