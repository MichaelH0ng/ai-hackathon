import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * CometDial — a radial gauge whose value is a glowing "comet" with a fading tail.
 * Spring physics: the comet eases toward its target; drag it, tap a spot, or flick it.
 *
 * Uncontrolled: pass `defaultValue`. Controlled: pass `value` — the dial shows it,
 * lets the user drag to preview another value (reported via onChange/onChangeEnd),
 * and springs back to `value` on release unless the parent updates `value`.
 */
export interface CometDialProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: "percent" | "none" | (string & {});
  label?: string;
  accent?: string; // comet + progress color
  ink?: string; // text + track color
  size?: number; // px
  sweep?: number; // degrees of arc (gap at the bottom)
  thickness?: number; // track stroke width
  speed?: number; // spring speed (higher = snappier)
  tapBounce?: number; // 0–1 overshoot after a tap/drag
  flickBounce?: number; // 0–1 overshoot after a flick
  momentum?: number; // how far a flick carries
  cometReach?: number; // max tail length in degrees
  cometWidth?: number; // head/tail thickness
  onChange?: (value: number) => void;
  onChangeEnd?: (value: number, info: { velocity: number; bounce: number }) => void;
  disabled?: boolean;
  format?: (value: number) => string; // center text
  valueText?: (value: number) => string; // screen-reader text
  caption?: (value: number) => string; // small text under the value
  className?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

export default function CometDial({
  value,
  defaultValue = 0,
  min = 0,
  max = 100,
  step = 1,
  unit = "percent",
  label,
  accent = "#f5f5f5",
  ink = "#fdfdfd",
  size = 250,
  sweep = 320,
  thickness = 5,
  speed = 25,
  tapBounce = 0.2,
  flickBounce = 0.1,
  momentum = 1,
  cometReach = 180,
  cometWidth = 12,
  onChange,
  onChangeEnd,
  disabled = false,
  format,
  valueText,
  caption,
  className = "",
}: CometDialProps) {
  const controlled = value !== undefined;
  const initial = clamp(controlled ? value! : defaultValue, min, max);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // physics state lives in refs; `frame` re-renders the SVG
  const pos = useRef(reduceMotion ? initial : min); // start at min and sweep in
  const vel = useRef(0);
  const target = useRef(initial);
  const bounce = useRef(tapBounce);
  const dragging = useRef(false);
  const samples = useRef<{ t: number; v: number }[]>([]);
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  const idle = useRef<number | null>(null);
  const [, setFrame] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const gid = useId().replace(/:/g, "");

  const range = max - min || 1;
  const startDeg = 90 + (360 - sweep) / 2; // SVG angles: 0° = +x, clockwise
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - cometWidth - 12;
  const snap = useCallback((v: number) => clamp(Math.round((v - min) / step) * step + min, min, max), [min, max, step]);
  const toDeg = (v: number) => startDeg + ((clamp(v, min, max) - min) / range) * sweep;
  const pt = (deg: number, radius = r) => [cx + radius * Math.cos(rad(deg)), cy + radius * Math.sin(rad(deg))] as const;
  const arc = (a0: number, a1: number, radius = r) => {
    if (a1 - a0 < 0.01) return "";
    const [x0, y0] = pt(a0, radius);
    const [x1, y1] = pt(a1, radius);
    return `M ${x0} ${y0} A ${radius} ${radius} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };

  // ---- animation loop: damped spring toward target ----
  const tick = useCallback(
    (now: number) => {
      const dt = Math.min(1 / 30, (now - (last.current || now)) / 1000) || 1 / 60;
      last.current = now;
      const omega = (speed * 0.4) * (dragging.current ? 1.8 : 1); // rad/s
      const zeta = clamp(1 - bounce.current, 0.05, 1);
      for (let i = 0; i < 4; i++) {
        const h = dt / 4;
        const a = omega * omega * (target.current - pos.current) - 2 * zeta * omega * vel.current;
        vel.current += a * h;
        pos.current += vel.current * h;
      }
      // keep inside the arc, with a soft bounce off the ends
      if (pos.current < min || pos.current > max) {
        pos.current = clamp(pos.current, min, max);
        vel.current *= -0.25;
      }
      setFrame((f) => (f + 1) % 1e6);
      const settled = Math.abs(target.current - pos.current) < range * 0.0005 && Math.abs(vel.current) < range * 0.002;
      if (settled && !dragging.current) {
        pos.current = target.current;
        vel.current = 0;
        raf.current = null;
        last.current = 0;
        setFrame((f) => (f + 1) % 1e6);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    },
    [speed, min, max, range],
  );

  const kick = useCallback(() => {
    if (reduceMotion) {
      pos.current = target.current;
      vel.current = 0;
      setFrame((f) => (f + 1) % 1e6);
      return;
    }
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  }, [tick, reduceMotion]);

  useEffect(() => {
    kick();
    return () => {
      // reset handles too: React StrictMode runs effects twice in development
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
      last.current = 0;
      if (idle.current != null) clearTimeout(idle.current);
      idle.current = null;
    };
  }, [kick]);

  // controlled: follow the prop
  useEffect(() => {
    if (!controlled || dragging.current) return;
    target.current = clamp(value!, min, max);
    bounce.current = tapBounce;
    kick();
  }, [value, controlled, min, max, tapBounce, kick]);

  // ---- pointer interaction ----
  const valueFromPointer = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * size - cx;
    const y = ((clientY - rect.top) / rect.height) * size - cy;
    const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    let rel = (deg - startDeg + 720) % 360;
    if (rel > sweep) rel = rel - sweep < 360 - rel ? sweep : 0; // in the gap: nearest end
    return min + (rel / sweep) * range;
  };

  const setTarget = (v: number) => {
    const s = snap(v);
    if (s !== snap(target.current)) onChange?.(s);
    target.current = v;
    kick();
  };

  const release = (v: number, b: number, velocity: number) => {
    const s = snap(v);
    bounce.current = b;
    target.current = s;
    onChangeEnd?.(s, { velocity, bounce: b });
    if (controlled) {
      // spring back to the real value unless the parent changes it
      idle.current = window.setTimeout(() => {
        target.current = clamp(value!, min, max);
        bounce.current = tapBounce;
        kick();
      }, 450);
    }
    kick();
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    if (idle.current != null) clearTimeout(idle.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const v = valueFromPointer(e.clientX, e.clientY);
    samples.current = [{ t: performance.now(), v }];
    bounce.current = tapBounce;
    setTarget(v);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    let v = valueFromPointer(e.clientX, e.clientY);
    // don't jump across the bottom gap mid-drag
    if (Math.abs(v - target.current) > range * 0.6) v = target.current;
    const now = performance.now();
    samples.current.push({ t: now, v });
    samples.current = samples.current.filter((s) => now - s.t < 120);
    setTarget(v);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const s = samples.current;
    const velocity = s.length > 1 ? (s[s.length - 1].v - s[0].v) / Math.max(0.016, (s[s.length - 1].t - s[0].t) / 1000) : 0;
    const isFlick = Math.abs(velocity) > range * 0.8;
    if (isFlick) {
      vel.current = velocity;
      release(clamp(target.current + velocity * momentum * 0.18, min, max), flickBounce, velocity);
    } else {
      release(target.current, tapBounce, 0);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const big = Math.max(step, range / 10);
    const map: Record<string, number> = {
      ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big,
      Home: min - target.current, End: max - target.current,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    if (idle.current != null) clearTimeout(idle.current);
    const next = clamp(snap(target.current) + map[e.key], min, max);
    setTarget(next);
    release(next, tapBounce, 0);
  };

  // ---- drawing ----
  const shown = pos.current;
  const head = toDeg(shown);
  const degPerSec = (Math.abs(vel.current) / range) * sweep;
  const tailLen = Math.min(cometReach, cometReach * 0.3 + degPerSec * 0.18, head - startDeg);
  const N = 32;
  const segments = Array.from({ length: N }, (_, i) => {
    const a1 = head - (tailLen * i) / N;
    const a0 = head - (tailLen * (i + 1)) / N;
    const k = 1 - i / N;
    return { d: arc(Math.max(startDeg, a0), a1), w: thickness + (cometWidth - thickness) * k * k, o: 0.95 * k * k };
  });
  const [hx, hy] = pt(head);
  const pct = Math.round(((shown - min) / range) * 100);
  const display = format ? format(shown) : unit === "percent" ? `${Math.round(shown)}` : `${Math.round(shown)}`;
  const suffix = format ? "" : unit === "percent" ? "%" : unit === "none" ? "" : ` ${unit}`;
  const ticks = Array.from({ length: 11 }, (_, i) => i);

  return (
    <div className={`inline-block select-none ${disabled ? "opacity-50" : ""} ${className}`} style={{ width: size, maxWidth: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label ?? "Dial"}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(snap(target.current))}
        aria-valuetext={valueText ? valueText(snap(target.current)) : `${Math.round(snap(target.current))}${suffix}`}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{ touchAction: "none", cursor: disabled ? "default" : dragging.current ? "grabbing" : "grab", overflow: "visible" }}
        className="rounded-full outline-none focus-visible:[outline:3px_solid_rgb(167_139_250)] focus-visible:[outline-offset:4px]"
      >
        <defs>
          <filter id={`glow-${gid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={cometWidth * 0.6} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ticks */}
        {ticks.map((i) => {
          const a = startDeg + (sweep * i) / 10;
          const major = i % 5 === 0;
          const [x0, y0] = pt(a, r + cometWidth / 2 + 6);
          const [x1, y1] = pt(a, r + cometWidth / 2 + (major ? 13 : 9));
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={ink} strokeOpacity={major ? 0.45 : 0.2} strokeWidth={major ? 2 : 1.25} strokeLinecap="round" />;
        })}

        {/* track + progress */}
        <path d={arc(startDeg, startDeg + sweep)} stroke={ink} strokeOpacity={0.14} strokeWidth={thickness} fill="none" strokeLinecap="round" />
        <path d={arc(startDeg, head)} stroke={accent} strokeOpacity={0.35} strokeWidth={thickness} fill="none" strokeLinecap="round" />

        {/* comet tail */}
        {segments.map((s, i) => (s.d ? <path key={i} d={s.d} stroke={accent} strokeOpacity={s.o} strokeWidth={s.w} fill="none" strokeLinecap="butt" /> : null))}

        {/* comet head */}
        <circle cx={hx} cy={hy} r={cometWidth * 0.75} fill={accent} opacity={0.35} filter={`url(#glow-${gid})`} />
        <circle cx={hx} cy={hy} r={cometWidth / 2} fill={accent} />

        {/* center readout */}
        {label && (
          <text x={cx} y={cy - size * 0.13} textAnchor="middle" fill={ink} fillOpacity={0.6} style={{ font: `600 ${Math.round(size * 0.055)}px var(--font-sans)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {label}
          </text>
        )}
        <text x={cx} y={cy + size * 0.07} textAnchor="middle" fill={ink} style={{ font: `700 ${Math.round(size * 0.22)}px var(--font-display)` }}>
          {display}
          {suffix && <tspan style={{ font: `600 ${Math.round(size * 0.09)}px var(--font-display)` }} fillOpacity={0.7}>{suffix}</tspan>}
        </text>
        <text x={cx} y={cy + size * 0.36} textAnchor="middle" fill={ink} fillOpacity={0.6} style={{ font: `700 ${Math.max(12, Math.round(size * 0.055))}px var(--font-sans)` }}>
          {caption ? caption(shown) : pct >= 100 ? "Goal reached" : ""}
        </text>
      </svg>
    </div>
  );
}
