import { ProfileAvatar } from "./ProfileAvatar";
import type { Profile } from "../lib/types";
import { ArrowLeftRight, ChartNoAxesCombined, House, Landmark, Target } from "lucide-react";

export function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-11 items-center gap-2" aria-label="NorthStar home">
      <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden="true">
        <defs>
          <linearGradient id="compass-north" x1="16" y1="8" x2="24" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#54e2c2" />
            <stop offset=".52" stopColor="#74b9ff" />
            <stop offset="1" stopColor="#c294ff" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="12" fill="#15243c" />
        <circle cx="20" cy="20" r="12.5" fill="none" stroke="#8696b2" strokeWidth="1.1" />
        <path d="M20 4.5v3.2M35.5 20h-3.2M20 35.5v-3.2M4.5 20h3.2" stroke="#8696b2" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M20 8 24 18 20 20 16 18z" fill="url(#compass-north)" />
        <path d="M20 32 16 22 20 20 24 22z" fill="#8290b2" />
        <path d="M8 20 18 16 20 20 18 24z" fill="#69cce0" />
        <path d="M32 20 22 24 20 20 22 16z" fill="#987de0" />
        <circle cx="20" cy="20" r="1.7" fill="#f3fbff" />
      </svg>
      <span className="font-display text-xl font-bold tracking-tight text-ink max-[420px]:sr-only">NorthStar</span>
    </button>
  );
}

export type NavPage = "Overview" | "Accounts" | "Activity" | "Plan" | "Goals" | "Price check" | "Profile";
export function TopNav({ onNavigate, active, profile }: { profile: Profile; onNavigate: (page: NavPage) => void; active: NavPage | null }) {
  const links = [
    { id: "Overview", label: "Home", Icon: House },
    { id: "Accounts", label: "Accounts", Icon: Landmark },
    { id: "Activity", label: "Activity", Icon: ArrowLeftRight },
    { id: "Plan", label: "Plan", Icon: ChartNoAxesCombined },
    { id: "Goals", label: "My goals", Icon: Target },
  ] as const;
  return <header className="sticky top-0 z-40 border-b border-brand-100 bg-white/85 backdrop-blur-md">
    <nav aria-label="Main" className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-2 px-4 py-2 lg:px-8">
      <Logo onClick={() => onNavigate("Overview")} />
      {/* Phones: five tabs plus the profile fit across by stacking each icon over its label. */}
      <div className="ml-auto flex max-w-full items-center gap-1 overflow-x-auto max-[650px]:order-last max-[650px]:w-full max-[650px]:justify-between max-[650px]:gap-0">
        {links.map(({ id, label, Icon }) => <button key={id} onClick={() => onNavigate(id)} aria-current={active === id ? "page" : undefined} className={"flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold sm:text-sm max-[650px]:min-w-14 max-[650px]:flex-col max-[650px]:justify-center max-[650px]:gap-0.5 max-[650px]:px-1.5 max-[650px]:py-1 max-[650px]:text-[11px] " + (active === id ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50")}><Icon size={17} aria-hidden="true" />{label}</button>)}
        <button onClick={() => onNavigate("Profile")} aria-label="Your profile" title="Your profile" aria-current={active === "Profile" ? "page" : undefined} className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-full " + (active === "Profile" ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50")}><ProfileAvatar profile={profile} className="h-9 w-9 text-sm" /></button>
      </div>
    </nav>
  </header>;
}
