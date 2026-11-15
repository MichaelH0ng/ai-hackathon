import { useEffect, useLayoutEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

/**
 * Counts a number up from 0 the first time it scrolls into view, in the spirit of
 * React Bits' Count Up. After that, every change to `value` (like hovering across the
 * net-worth chart) counts quickly from the number on screen to the new one, so the
 * digits roll between days instead of jumping.
 * Screen readers get the final value; the ticking digits are hidden from them.
 */
export function CountUp({ value, format, duration = 1.1, changeDuration = 0.35, className }: { value: number; format: (n: number) => string; duration?: number; changeDuration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const played = useRef(false);
  const shown = useRef(0); // the number currently on screen, so a new count starts from it
  const formatRef = useRef(format);
  useLayoutEffect(() => { formatRef.current = format; });

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
      <span ref={ref} aria-hidden="true">{format(reduce ? value : 0)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
