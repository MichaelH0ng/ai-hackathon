import CometDial from "./CometDial";

/** The comet dial styled for light cards, for 0–100% inputs like confidence and quiz scores. */
export function PercentDial({
  value,
  onChange,
  label,
  caption,
  size = 210,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  caption?: (v: number) => string;
  size?: number;
}) {
  return (
    <CometDial
      value={value}
      min={0}
      max={100}
      step={5}
      unit="percent"
      label={label}
      accent="#7c3aed"
      ink="#1e1b2e"
      size={size}
      sweep={320}
      thickness={5}
      speed={25}
      tapBounce={0.2}
      flickBounce={0.1}
      momentum={1}
      cometReach={180}
      cometWidth={12}
      caption={caption}
      onChange={(v) => onChange(Math.round(v))}
      onChangeEnd={(v) => onChange(Math.round(v))}
    />
  );
}
