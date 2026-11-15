import { useEffect, useId, useState } from "react";

/**
 * A circular progress ring with the percentage in the middle (in the spirit of Magic UI's
 * animated circular progress bar). It fills from empty on first render; with reduced
 * motion turned on it simply appears full (see .progress-ring in system.css).
 */
export function ProgressRing({ value, label, size = 56, stroke = 5 }: { value: number; label: string; size?: number; stroke?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const gradientId = useId();
  // Start empty, then fill on the next frame so the stroke animates in.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(frame);
  }, [pct]);

  return (
    <span className="progress-ring" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#54e2c2" />
            <stop offset="60%" stopColor="#74b9ff" />
            <stop offset="100%" stopColor="#c294ff" />
          </linearGradient>
        </defs>
        <circle className="progress-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="progress-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="progress-ring-text" aria-hidden="true">{Math.round(pct)}%</span>
    </span>
  );
}
