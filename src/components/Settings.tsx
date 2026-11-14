import type { Profile } from "../lib/types";
import { BackButton, Button, Card, NumberField } from "./ui";

export function Settings({
  profile,
  onProfile,
  onDemo,
  onReset,
  onBack,
}: {
  profile: Profile;
  onProfile: (p: Profile) => void;
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
            onChange={(v) => onProfile({ hourlyWage: v === "" ? null : v })}
            suffix="/hr"
            hint={`Check a price will say "that's 2h 10m of work".`}
          />
        </div>
      </Card>
      <Card>
        <h3 className="font-bold text-stone-900">Demo</h3>
        <p className="mb-3 text-sm text-stone-600">Loads the hoodie, stats exam and spring break examples. Replaces your current goals.</p>
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
