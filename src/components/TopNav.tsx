import { Camera, House, LayoutGrid, Settings, Wallet } from "lucide-react";

export function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-14 items-center" aria-label="North Star home">
      <svg viewBox="0 0 128 128" className="h-11 w-11 sm:h-12 sm:w-12" aria-hidden="true">
        <path d="M64 4 80 48 64 64 48 48Z" fill="#fff" />
        <path d="M124 64 80 80 64 64 80 48Z" fill="#e5e7eb" />
        <path d="M64 124 48 80 64 64 80 80Z" fill="#f8fafc" />
        <path d="M4 64 48 48 64 64 48 80Z" fill="#f3f4f6" />
      </svg>
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
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#051226]/80 shadow-[0_8px_30px_rgb(0_0_0/0.22)] backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:px-4" aria-label="Main">
        <Logo onClick={onHome} />

        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            onClick={onHome}
            aria-current={active === "home" ? "page" : undefined}
            aria-label="Home"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "home" ? "bg-emerald-300/20 text-emerald-100 ring-1 ring-emerald-200/30" : "text-slate-200 hover:bg-white/10 hover:text-white"}`}
          >
            <House className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Home</span>
          </button>
          <button
            onClick={onCheck}
            aria-current={active === "check" ? "page" : undefined}
            aria-label="Check a price"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "check" ? "bg-emerald-300/20 text-emerald-100 ring-1 ring-emerald-200/30" : "text-slate-200 hover:bg-white/10 hover:text-white"}`}
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Check a price</span>
          </button>
          <button
            onClick={onMoney}
            aria-current={active === "money" ? "page" : undefined}
            aria-label="Money"
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "money" ? "bg-emerald-300/20 text-emerald-100 ring-1 ring-emerald-200/30" : "text-slate-200 hover:bg-white/10 hover:text-white"}`}
          >
            <Wallet className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Money</span>
          </button>
          {goalCount > 0 && (
            <button
              onClick={onGoals}
              aria-current={active === "goals" ? "page" : undefined}
              aria-label={`My goals (${goalCount})`}
              className={`flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold sm:px-3 ${active === "goals" ? "bg-emerald-300/20 text-emerald-100 ring-1 ring-emerald-200/30" : "text-slate-200 hover:bg-white/10 hover:text-white"}`}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">My goals</span>
              <span className="rounded-full bg-emerald-400 px-1.5 text-[11px] text-emerald-950">{goalCount}</span>
            </button>
          )}
          <button
            onClick={onSettings}
            aria-label="Settings"
            aria-current={active === "settings" ? "page" : undefined}
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${active === "settings" ? "bg-emerald-300/20 text-emerald-100 ring-1 ring-emerald-200/30" : "text-slate-200 hover:bg-white/10 hover:text-white"}`}
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </nav>
    </header>
  );
}
