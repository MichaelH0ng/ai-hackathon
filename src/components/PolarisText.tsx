import type { CSSProperties, ReactNode } from "react";
import { maskMoneyText, useMoneyHidden } from "../lib/privacy";

/**
 * Renders a Polaris answer with light formatting, without ever injecting HTML:
 *   **bold** / __bold__, *italic* / _italic_, "- " / "* " / "• " bullets, "1. " numbered steps,
 *   blank lines between paragraphs. A "# Heading" line shows as a bold line.
 *
 * With `animate`, words fade in from a soft blur one after another (the React Bits "Blur Text"
 * look, done in CSS so it works with bold text and lists). Long answers speed up so the
 * whole reveal stays under about 1.5 seconds.
 */
export function PolarisText({ text: raw, animate = false }: { text: string; animate?: boolean }) {
  useMoneyHidden(); // re-render when "Hide amounts" changes
  const text = maskMoneyText(raw);
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  const step = Math.min(35, 1500 / Math.max(1, totalWords));
  const counter = { i: 0 };
  const style = { "--polaris-step": `${step.toFixed(1)}ms` } as CSSProperties;

  const words = (chunk: string, key: string): ReactNode[] =>
    !animate ? [chunk] : chunk.split(/(\s+)/).map((part, n) =>
      !part || /^\s+$/.test(part) ? part : <span key={`${key}-${n}`} className="polaris-word" style={{ "--i": counter.i++ } as CSSProperties}>{part}</span>);

  const inline = (line: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    // Bold first, then italics. Underscore emphasis needs non-word edges so snake_case stays intact.
    const pattern = /\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g;
    let last = 0;
    let n = 0;
    for (const match of line.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (at > last) out.push(...words(line.slice(last, at), `${key}-t${n}`));
      const bold = match[1] ?? match[2];
      const italic = match[3] ?? match[4];
      out.push(bold !== undefined
        ? <strong key={`${key}-b${n}`}>{words(bold, `${key}-b${n}`)}</strong>
        : <em key={`${key}-i${n}`}>{words(italic ?? "", `${key}-i${n}`)}</em>);
      last = at + match[0].length;
      n += 1;
    }
    if (last < line.length) out.push(...words(line.slice(last), `${key}-t${n}`));
    return out;
  };

  type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const bullet = /^(?:[-*•])\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const prev = blocks[blocks.length - 1];
    if (!line) { blocks.push({ kind: "p", lines: [] }); continue; }
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      if (prev?.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
      continue;
    }
    const content = heading ? `**${heading[1].replace(/\*\*/g, "")}**` : line;
    if (prev?.kind === "p" && prev.lines.length) prev.lines.push(content);
    else blocks.push({ kind: "p", lines: [content] });
  }

  return <div className={`polaris-text${animate ? " animate" : ""}`} style={style}>
    {blocks.map((block, b) => {
      if (block.kind === "p") {
        if (!block.lines.length) return null;
        return <p key={b}>{block.lines.map((line, l) => <span key={l}>{l > 0 && <br />}{inline(line, `${b}-${l}`)}</span>)}</p>;
      }
      const List = block.kind;
      return <List key={b}>{block.items.map((item, i) => <li key={i}>{inline(item, `${b}-${i}`)}</li>)}</List>;
    })}
  </div>;
}
