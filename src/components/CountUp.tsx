import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import DecryptedText from "./DecryptedText";
import { useMoneyHidden } from "../lib/privacy";

/**
 * Counts a number up from 0 the first time it scrolls into view, in the spirit of
 * React Bits' Count Up. After that, every change to `value` (like hovering across the
 * net-worth chart) counts quickly from the number on screen to the new one, so the
 * digits roll between days instead of jumping.
 * Screen readers get the final value; the ticking digits are hidden from them.
 * When "Hide amounts" is turned off, the number decrypts back in (React Bits' Decrypted Text).
 */
export function CountUp({ value, format, duration = 1.1, changeDuration = 0.35, className }: { value: number; format: (n: number) => string; duration?: number; changeDuration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const played = useRef(false);
  const shown = useRef(0); // the number currently on screen, so a new count starts from it
  const formatRef = useRef(format);
  // Showing amounts again: briefly swap the number for a Decrypted Text reveal of the same value.
  const hidden = useMoneyHidden();
  const wasHidden = useRef(hidden);
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    const showing = wasHidden.current && !hidden;
    wasHidden.current = hidden;
    if (!showing || reduce) return;
    setReveal((n) => n + 1);
    const done = setTimeout(() => setReveal(0), 1100);
    return () => clearTimeout(done);
  }, [hidden, reduce]);
  useLayoutEffect(() => {
    formatRef.current = format;
    // A re-render (e.g. "Hide amounts") puts back the starting 0; show the current number again, before paint.
    if (ref.current && !reduce) ref.current.textContent = format(shown.current);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      shown.current = value;
      el.textContent = formatRef.current(value);
      return;
    }
    if (!inView) return;
    const controls = animate(shown.current, value, {
      duration: played.current ? changeDuration : duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { shown.current = v; el.textContent = formatRef.current(v); },
      onComplete: () => { played.current = true; },
    });
    // Stopping mid-count leaves `shown` where the digits are, so the next count picks up smoothly.
    return () => controls.stop();
  }, [value, inView, reduce, duration, changeDuration]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true" style={reveal ? { display: "none" } : undefined}>{format(reduce ? value : 0)}</span>
      {reveal > 0 && <span aria-hidden="true"><DecryptedText key={reveal} text={format(value)} animateOn="view" sequential revealDirection="start" speed={28} maxIterations={8} characters="0123456789" /></span>}
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
