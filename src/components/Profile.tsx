import { useRef, useState } from "react";
import { ProfileAvatar, avatarColors } from "./ProfileAvatar";
import { ArrowRight, Landmark, PiggyBank, Settings as SettingsIcon, Sparkles, Target, UserRound } from "lucide-react";
import { formatMoney } from "../lib/finance";
import { netWorth } from "../lib/money";
import type { Decision, MoneyGoal, Profile as ProfileData } from "../lib/types";
import type { Bank } from "../lib/useBank";
import { Card, Progress, Stat, TextField } from "./ui";

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

  const uploadInput = useRef<HTMLInputElement>(null);
  const latestProfile = useRef(profile);
  latestProfile.current = profile;
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);
  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    setImageError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImageError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError("Choose an image smaller than 5 MB.");
      return;
    }
    setUploading(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image editing unavailable");
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
      onProfile({ ...latestProfile.current, avatarImage: canvas.toDataURL("image/webp", 0.85) });
    } catch {
      setImageError("Couldn't read that image. Try another photo.");
    } finally {
      URL.revokeObjectURL(url);
      setUploading(false);
    }
  }
  const emailLooksWrong = !!profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="flex items-center gap-4">
        <ProfileAvatar profile={profile} className="h-16 w-16 text-2xl" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-ink">{profile.name?.trim() || "Your profile"}</h1>
          <p className="truncate text-sm text-stone-600">{profile.email || "Add your details below."}</p>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Profile picture</h2>
        <p className="mt-1 text-sm text-stone-600">Choose a color for your initials or upload a photo.</p>
        <div className="mt-4 flex flex-wrap gap-3" role="group" aria-label="Profile picture colors">
          {avatarColors.map(color => <button key={color.value} type="button" aria-label={color.name} aria-pressed={!profile.avatarImage && (profile.avatarColor ?? avatarColors[0].value) === color.value} disabled={uploading} onClick={() => update({ avatarColor: color.value, avatarImage: undefined })} className="profile-color-swatch" style={{ backgroundColor: color.value }}>
            {!profile.avatarImage && (profile.avatarColor ?? avatarColors[0].value) === color.value ? "✓" : ""}
          </button>)}
        </div>
        <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Upload profile picture" onChange={event => { void uploadPhoto(event.target.files?.[0]); event.target.value = ""; }} />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="wealth-secondary" disabled={uploading} onClick={() => uploadInput.current?.click()}>{uploading ? "Preparing photo…" : "Upload photo"}</button>
          {profile.avatarImage && <button type="button" className="wealth-secondary" disabled={uploading} onClick={() => update({ avatarImage: undefined })}>Remove photo</button>}
        </div>
        <p className="mt-3 text-xs text-stone-500">JPG, PNG, or WebP, up to 5 MB. Photos are cropped to the center and saved on this device.</p>
        {imageError && <p role="alert" className="mt-2 text-sm text-cost">{imageError}</p>}
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
