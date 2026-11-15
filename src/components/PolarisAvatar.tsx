import { useId } from "react";

export type PolarisMood = "idle" | "thinking" | "happy" | "worried";

const ink = "#1b2f55";

/**
 * Polaris, the chat mascot: a little four-pointed star with a face, on a teal-to-violet badge.
 * - thinking: bobs and glances up while an answer is on the way
 * - happy: happy eyes, big smile and a little hop (a goal is nearly or fully funded)
 * - worried: tilted brows and a wobbly mouth (planned spending is over income)
 */
export function PolarisAvatar({ size = 32, mood = "idle", className = "" }: { size?: number; mood?: PolarisMood; className?: string }) {
  const id = useId().replace(/:/g, "");
  return <svg className={`polaris-avatar ${mood} ${className}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#168e90" />
        <stop offset=".6" stopColor="#4b7fe0" />
        <stop offset="1" stopColor="#9e64df" />
      </linearGradient>
    </defs>
    <circle cx="20" cy="20" r="20" fill={`url(#${id}-bg)`} />
    <circle className="polaris-avatar-twinkle" cx="31" cy="9" r="1.3" fill="#dffeff" />
    {mood === "happy" && <circle className="polaris-avatar-twinkle late" cx="9" cy="30" r="1.1" fill="#ffe9a8" />}
    <g className="polaris-avatar-body">
      {/* Star body */}
      <path d="M20 5.5 C21.6 14 24 16.6 33 20 C24 23.4 21.6 26 20 34.5 C18.4 26 16 23.4 7 20 C16 16.6 18.4 14 20 5.5 Z" fill="#f4fffd" />
      {/* Face */}
      {mood === "happy"
        ? <path d="M16.2 19.6 Q17.4 17.6 18.6 19.6 M21.4 19.6 Q22.6 17.6 23.8 19.6" fill="none" stroke={ink} strokeWidth="1.2" strokeLinecap="round" />
        : <g className="polaris-avatar-eyes" fill={ink}>
          <ellipse cx="17.4" cy="19" rx="1.25" ry="1.6" />
          <ellipse cx="22.6" cy="19" rx="1.25" ry="1.6" />
        </g>}
      {mood === "worried" && <path d="M15.8 16.4 L18.6 15.6 M24.2 16.4 L21.4 15.6" fill="none" stroke={ink} strokeWidth="1" strokeLinecap="round" />}
      {mood === "happy"
        ? <path d="M17.6 21.8 Q20 25.2 22.4 21.8 Z" fill={ink} stroke={ink} strokeWidth=".8" strokeLinejoin="round" />
        : mood === "worried"
          ? <path d="M18 23.2 Q19 22.2 20 23.2 T22 23.2" fill="none" stroke={ink} strokeWidth="1.1" strokeLinecap="round" />
          : <path d="M18.2 22.4 Q20 24 21.8 22.4" fill="none" stroke={ink} strokeWidth="1.2" strokeLinecap="round" />}
      <circle cx="15.6" cy="22" r="1" fill="#ff9fb4" opacity={mood === "happy" ? 1 : .75} />
      <circle cx="24.4" cy="22" r="1" fill="#ff9fb4" opacity={mood === "happy" ? 1 : .75} />
    </g>
  </svg>;
}
