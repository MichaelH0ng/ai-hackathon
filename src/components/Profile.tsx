import { ArrowRight, Landmark, PiggyBank, Settings as SettingsIcon, Sparkles, Target, UserRound } from "lucide-react";
import { formatMoney } from "../lib/finance";
import { netWorth } from "../lib/money";
import type { Decision, MoneyGoal, Profile as ProfileData } from "../lib/types";
import type { Bank } from "../lib/useBank";
import { Card, Progress, Stat, TextField } from "./ui";

/** "Nicholas Pinto" → "NP"; empty → null so we can show a generic icon. */
function initials(name: string | undefined): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Profile: who you are (editable, saved on this device) plus a snapshot of your
 * goals, choices and connected banks. A starting point to build on.
 */
export function Profile({
  profile,
  onProfile,
  goals,
  history,
  bank,
  onGoals,
  onAccounts,
  onSettings,
}: {
  profile: ProfileData;
  onProfile: (p: ProfileData) => void;
  goals: MoneyGoal[];
  history: Decision[];
  bank: Bank;
  onGoals: () => void;
  onAccounts: () => void;
  onSettings: () => void;
}) {
  const update = (patch: Partial<ProfileData>) => onProfile({ ...profile, ...patch });

  const saved = goals.reduce((s, g) => s + Math.min(g.target, Math.max(0, g.saved)), 0);
  const target = goals.reduce((s, g) => s + g.target, 0);
  const finished = goals.filter((g) => g.saved >= g.target).length;
  const kept = history.reduce((s, d) => s + Math.max(0, d.amount ?? 0), 0);
  const daysSooner = history.reduce((s, d) => s + Math.max(0, d.effectDays ?? 0), 0);
  const banks = bank.status?.items ?? [];
  const worth = bank.data?.accounts.length ? netWorth(bank.data.accounts).net : null;

  const avatar = initials(profile.name);
  const emailLooksWrong = !!profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-600 font-display text-2xl font-bold text-white" aria-hidden="true">
          {avatar ?? <UserRound className="h-8 w-8" />}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-ink">{profile.name?.trim() || "Your profile"}</h1>
          <p className="truncate text-sm text-stone-600">{profile.email || "Add your details below."}</p>
        </div>
      </Card>

      {/* About you */}
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><UserRound className="h-5 w-5 text-brand-600" aria-hidden="true" /> About you</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField label="Name" autoComplete="name" value={profile.name ?? ""} onChange={(name) => update({ name })} placeholder="Alex Rivera" />
          </div>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={profile.email ?? ""}
            onChange={(email) => update({ email: email.trim() })}
            placeholder="alex@example.com"
            hint={emailLooksWrong ? "That doesn't look like an email address." : undefined}
          />
          <TextField label="Phone" type="tel" autoComplete="tel" value={profile.phone ?? ""} onChange={(phone) => update({ phone })} placeholder="(555) 123-4567" />
        </div>
        <p className="mt-3 text-xs text-stone-500">Saved on this device only.</p>
      </Card>

      {/* Snapshot */}
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Sparkles className="h-5 w-5 text-brand-600" aria-hidden="true" /> Your progress</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Savings goals" value={goals.length} sub={goals.length ? `${finished} finished` : "None yet"} />
          <Stat label="Saved toward goals" value={formatMoney(saved)} sub={target ? `of ${formatMoney(target)}` : undefined} />
          <Stat label="Money kept" value={formatMoney(kept)} sub="from skipped buys" tone={kept > 0 ? "good" : "default"} />
          <Stat label="Days sooner" value={Math.round(daysSooner)} sub="goals reached earlier" tone={daysSooner > 0 ? "good" : "default"} />
        </div>
        {target > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm text-stone-600"><span>Overall goal progress</span><strong className="text-ink">{Math.round((saved / target) * 100)}%</strong></div>
            <Progress value={saved / target} />
          </div>
        )}
      </Card>

      {/* Connected banks */}
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Landmark className="h-5 w-5 text-brand-600" aria-hidden="true" /> Connected banks</h2>
        {banks.length ? (
          <>
            <ul className="mt-3 space-y-1 text-sm text-stone-700">
              {banks.map((b) => <li key={b.itemId} className="flex items-center gap-2"><PiggyBank className="h-4 w-4 text-stone-400" aria-hidden="true" />{b.institution}</li>)}
            </ul>
            {worth !== null && <p className="mt-3 text-sm text-stone-600">Net worth across connected accounts: <strong className="text-ink">{formatMoney(worth)}</strong></p>}
          </>
        ) : (
          <p className="mt-2 text-sm text-stone-600">No banks connected yet.</p>
        )}
      </Card>

      {/* Shortcuts */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Shortcut Icon={Target} label="My goals" onClick={onGoals} />
        <Shortcut Icon={Landmark} label="Accounts" onClick={onAccounts} />
        <Shortcut Icon={SettingsIcon} label="Settings" onClick={onSettings} />
      </div>
    </div>
  );
}

function Shortcut({ Icon, label, onClick }: { Icon: typeof Target; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="clay clay-press flex min-h-12 items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-stone-800">
      <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-brand-600" aria-hidden="true" />{label}</span>
      <ArrowRight className="h-4 w-4 text-stone-400" aria-hidden="true" />
    </button>
  );
}
