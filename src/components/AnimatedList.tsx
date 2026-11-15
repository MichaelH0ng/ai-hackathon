import { Children, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * A list whose rows slide in one after another the first time it scrolls into view,
 * in the spirit of React Bits' Animated List. Each child becomes one <li>.
 * With reduced motion turned on, rows simply appear.
 */
export function AnimatedList({ children, className, itemClassName, stagger = 0.07 }: { children: ReactNode; className?: string; itemClassName?: string; stagger?: number }) {
  const reduce = useReducedMotion();
  return (
    <ul className={className}>
      {Children.toArray(children).map((child, i) => (
        <motion.li
          key={(child as { key?: string }).key ?? i}
          className={itemClassName}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "0px 0px -40px 0px" }}
          transition={{ duration: 0.35, delay: i * stagger, ease: [0.16, 1, 0.3, 1] }}
        >
          {child}
        </motion.li>
      ))}
    </ul>
  );
}
