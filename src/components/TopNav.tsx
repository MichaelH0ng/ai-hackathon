import { Camera, House, LayoutGrid, Settings } from "lucide-react";

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

/** Sticky top navigation, the same on every screen. */
export function TopNav({
  onHome,
  onGoals,
  onSettings,
  onCheck,
  goalCount,
  active,
}: {
  onHome: () => void;
  onGoals: () => void;
  onSettings: () => void;
  onCheck: () => void;
  onMoney: () => void;
  goalCount: number;
  active: "home" | "goals" | "settings" | "check" | "money" | "other";
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-brand-100 bg-white/85 backdrop-blur-md">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2 sm:px-4" aria-label="Main">
        <Logo onClick={onHome} />

        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            onClick={onHome}
            aria-current={active === "home" ? "page" : undefined}
            aria-label="Dashboard"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "home" ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50"}`}
          >
            <House className="h-5 w-5" aria-hidden="true" />
            <span>Dashboard</span>
          </button>
          <button
            onClick={onCheck}
            aria-current={active === "check" ? "page" : undefined}
            aria-label="Check a price"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "check" ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50"}`}
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
            <span>Price check</span>
          </button>
          {goalCount > 0 && (
            <button
              onClick={onGoals}
              aria-current={active === "goals" ? "page" : undefined}
              aria-label={`My goals (${goalCount})`}
              className={`hidden min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:flex sm:px-3 ${active === "goals" ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50"}`}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">My goals</span>
              <span className="rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{goalCount}</span>
            </button>
          )}
          <button
            onClick={onSettings}
            aria-label="Settings"
            aria-current={active === "settings" ? "page" : undefined}
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${active === "settings" ? "bg-brand-100 text-brand-700" : "text-stone-600 hover:bg-brand-50"}`}
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </nav>
    </header>
  );
}
