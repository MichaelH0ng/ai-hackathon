import { Moon, Sun } from "lucide-react";
import type { Theme } from "../lib/theme";
import type { Profile } from "../lib/types";
import { BackButton, Button, Card, NumberField } from "./ui";

export function Settings({
  profile,
  onProfile,
  theme,
  onTheme,
  onDemo,
  onReset,
  onBack,
}: {
  profile: Profile;
  onProfile: (p: Profile) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onDemo: () => void;
  onReset: () => void;
  onBack: () => void;
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
      <Card>
        <h3 className="font-bold text-stone-900">Demo</h3>
        <p className="mb-3 text-sm text-stone-600">Loads the hoodie and spring break savings examples. Replaces your current goals.</p>
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
