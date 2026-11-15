# NorthStar Brand Guidelines

Use this one-page reference for every new screen, illustration, chart, social asset, or in-product graphic. NorthStar should feel calm, precise, optimistic, and trustworthy: a clear financial tool set against the quiet wonder of an aurora-lit night sky.

## Brand core

**Promise:** Keep your financial goals in sight.

**Visual idea:** a north star that makes a complex financial picture easier to navigate. Use light, orbit, horizon, and constellation motifs sparingly. The star is a guide—not decoration competing with the numbers.

**Voice:** plainspoken, encouraging, and specific. Prefer “Estimated balance at age 65” over “Unlock your financial future.” Never imply a guarantee, investment return, or financial advice.

## Logo

Use the NorthStar compass/star mark as the primary brand signature. Prefer it on a deep navy field; use a light surface only when necessary for contrast. Preserve clear space equal to roughly one star point on every side. Do not stretch, recolor with unrelated hues, add text inside the mark, or use a busy photo behind it.

## Color system

| Role | Color | Hex | Use |
|---|---|---:|---|
| Midnight | Night canvas | `#050B16` | Page background and deepest surface |
| Deep navy | Elevated surface | `#091426` | Navigation, panels, overlays |
| Aurora teal | Teal | `#54E2C2` | Links, positive progress, glow |
| Aurora blue | Blue | `#74B9FF` | Core interface blue, charts, gradients |
| Aurora violet | Violet | `#C294FF` | Gradient finish, investment accent |
| Starlight | Primary text | `#EDF6FF` | Headings, balances, essential labels |
| Moonlight | Secondary text | `#C0CDE0` | Supporting copy and metadata (brightened for contrast on cards) |
| Star mint | Mint | `#54E2C2` | Glow, progress, sparing success accent |
| Star sky | Sky | `#74B9FF` | Light/glow detail |
| Star lavender | Lavender | `#C294FF` | Small star/gradient detail |
| Positive | Green | `#138F83` | Gains, completed states, positive cash flow |
| Caution | Amber | `#BD6F3A` | Delays, warning—not primary CTAs |

**Signature gradient:** `linear-gradient(115deg, #168E90, #4B7FE0 60%, #9E64DF)`. Use it for primary actions or a hero/assistant accent, never as a full-page fill.

**Surfaces:** cards use a near-opaque navy gradient `linear-gradient(145deg, #13294A, #0C1B33)` with a cool border `rgb(160 198 244 / 26%)`. Rows, chips, and inner panels inside a card sit one step lighter at `rgb(148 192 243 / 9%)`. Cards should not be see-through: the aurora must never wash out text or numbers.

## Typography

**Typeface: Plus Jakarta Sans** for everything: headings, body, labels, buttons, and numbers. It is friendly and modern with crisp, even numerals, which keeps NorthStar calm and optimistic without looking like a default system app. One family keeps the type consistent across every screen.

- **In the app:** bundled with the `@fontsource-variable/plus-jakarta-sans` package (variable weights 200–800), so it works offline. Both `--font-sans` and `--font-display` in `src/index.css` point to it.
- **Fallback stack:** `"Plus Jakarta Sans Variable", "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- **Outside the app** (slides, social posts, documents): use Plus Jakarta Sans from Google Fonts.

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Hero numbers (net worth) | 38–60px | 750–800 | `-0.035em` |
| Page title | 27–34px | 700–800 | `-0.03em` |
| Section / card title | 17–21px | 650–700 | `-0.01em` |
| Body | 14–16px | 400–500, line height 1.5–1.7 | normal |
| Labels / metadata | 11–13px | 500–600, sentence case | normal (uppercase labels `+0.06em`) |
| Buttons | 14px | 650 | normal |

- Financial values: bold with tabular numerals (`font-variant-numeric: tabular-nums`) so columns line up; round only when precision would not help.

Avoid all-caps paragraphs, mixing in other typefaces, decorative display fonts, and more than three type sizes in a single card.

## Layout and components

- Use the width: page content spans up to `1320px` (header included), with 32px side padding on desktop and 16px on mobile. Avoid narrow centered columns on wide screens.
- Keep content roomy: 20–28px card padding on desktop.
- Use a 8px spacing rhythm (8, 16, 24, 32).
- The page canvas is Midnight. Cards use the surface gradient above with a cool border, a soft shadow, and 12–16px rounded corners.
- Buttons are clear verbs: one gradient/filled primary action, secondary actions as quiet outlined or text buttons.
- Use `44px` minimum interactive height. The header stays compact, translucent Midnight, and sticky.
- Numbers lead: put balances, goal progress, and due dates before explanatory copy.

## Graphics, charts, and imagery

Use abstract aurora light, soft constellations, orbit paths, and simple geometric stars. Keep the background deep and low contrast so charts and account balances remain the focus. Prefer line/area charts with Aurora blue as the main series, violet as the comparison series, mint for achieved progress, and amber only for risk/delay. For categorical breakdowns (such as assets by institution) use, in order: violet `#C294FF`, mint `#54E2C2`, blue `#74B9FF`, amber `#FFB47A`, pink `#FF8FC7`, slate `#9FB0C8`.

Keep the aurora background dim (about 55% opacity) so it reads as atmosphere, not as light behind the content.

Do not use stock-money imagery, neon cyberpunk gradients, cluttered 3D renders, fake bank logos, or visual effects that make financial values harder to read.

## Motion and accessibility

Motion is slow and atmospheric: gentle drift, 200–500ms component transitions, no flashing or rapid loops. Respect `prefers-reduced-motion`. Meet WCAG AA contrast for all text and controls; never rely on color alone for a gain, loss, selected state, or chart series. Give every chart a text label and every icon button an accessible name.

## Final visual checklist

Before shipping a new visual, confirm: it uses the night-sky palette above; the NorthStar mark is treated with space and restraint; one action is visually primary; financial numbers are easy to scan; Starlight/Moonlight text meets contrast requirements; text is specific and not advisory; and the result remains readable over the aurora background.
