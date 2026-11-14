import { Camera, House, LayoutGrid, Settings, Wallet } from "lucide-react";

export function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-11 items-center gap-2" aria-label="TradeOff home">
      <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden="true">
        <rect width="32" height="32" rx="10" fill="#7C3AED" />
        <path d="M9 12h11l-3-3M23 20H12l3 3" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-display text-xl font-bold tracking-tight text-ink max-[420px]:sr-only">TradeOff</span>
    </button>
  );
}

/** Sticky top navigation, the same on every screen. */
export function TopNav({
  onHome,
  onGoals,
  onSettings,
  onCheck,
  onMoney,
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
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:px-4" aria-label="Main">
        <Logo onClick={onHome} />

        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            onClick={onHome}
            aria-current={active === "home" ? "page" : undefined}
            aria-label="Home"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "home" ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50"}`}
          >
            <House className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Home</span>
          </button>
          <button
            onClick={onCheck}
            aria-current={active === "check" ? "page" : undefined}
            aria-label="Check a price"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "check" ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50"}`}
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Check a price</span>
          </button>
          <button
            onClick={onMoney}
            aria-current={active === "money" ? "page" : undefined}
            aria-label="Money"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "money" ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50"}`}
          >
            <Wallet className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Money</span>
          </button>
          {goalCount > 0 && (
            <button
              onClick={onGoals}
              aria-current={active === "goals" ? "page" : undefined}
              aria-label={`My goals (${goalCount})`}
              className={`flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "goals" ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50"}`}
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
