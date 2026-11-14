import { Camera, House, LayoutGrid, Settings, Target } from "lucide-react";

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

export function TopNav({ onHome, onMoney, onCheck, onGoals, onSettings, active }: {
  onHome: () => void; onMoney: () => void; onCheck: () => void; onGoals: () => void; onSettings: () => void;
  active: "home" | "money" | "check" | "goals" | "settings" | "other";
}) {
  const links = [
    { id: "home", label: "Home", Icon: House, action: onHome },
    { id: "money", label: "Dashboard", Icon: LayoutGrid, action: onMoney },
    { id: "check", label: "Price check", Icon: Camera, action: onCheck },
    { id: "goals", label: "My goals", Icon: Target, action: onGoals },
  ];
  return <header className="sticky top-0 z-40 border-b border-brand-100 bg-white/85 backdrop-blur-md">
    <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
      <Logo onClick={onHome} />
      <div className="flex items-center gap-1 max-[600px]:w-full max-[600px]:justify-between">
        {links.map(({ id, label, Icon, action }) => <button key={id} onClick={action} aria-current={active === id ? "page" : undefined} className={"flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-xs font-bold sm:px-3 sm:text-sm " + (active === id ? "bg-brand-100 text-brand-700" : "text-stone-700 hover:bg-brand-50")}><Icon size={17} aria-hidden="true" />{label}</button>)}
        <button aria-label="Settings" aria-current={active === "settings" ? "page" : undefined} onClick={onSettings} className="flex h-11 w-11 items-center justify-center rounded-xl text-stone-600 hover:bg-brand-50"><Settings size={19} /></button>
      </div>
    </nav>
  </header>;
}
