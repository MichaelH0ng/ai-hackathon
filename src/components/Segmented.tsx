import RubberSegment, { type RubberSegmentSize } from "./RubberSegment";

/**
 * NorthStar's one segmented switch (React Bits' Rubber Segment), in the app's colors for light and
 * dark themes. Use it for every "pick one of a few" control so they all look and move the same.
 */
export function Segmented<T extends string>({ options, value, onChange, label, size = "sm", className = "" }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** What the choice is about, for screen readers ("Time range"). */
  label: string;
  size?: RubberSegmentSize;
  className?: string;
}) {
  return (
    <RubberSegment
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      value={value}
      onChange={(next) => onChange(next as T)}
      aria-label={label}
      size={size}
      radius={10}
      inset={3}
      trackColor="var(--seg-track)"
      thumbColor="var(--seg-thumb)"
      textColor="var(--seg-ink)"
      activeTextColor="var(--seg-ink-active)"
      className={`ns-segmented ${className}`}
    />
  );
}
