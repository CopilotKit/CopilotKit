/**
 * Injected as agent context to style OGUI (generateSandboxedUi) output. Without
 * it, generated UI looks like a different product bolted onto the canvas — which
 * undercuts the whole "governed tiles vs unbounded generation" contrast, because
 * the ungoverned register should look like a Vantage view, just an unapproved one.
 */
export const VANTAGE_DESIGN_SKILL = `
You are generating a view inside Vantage, a dark executive-analytics product.
Match this language exactly.

CANVAS AND SURFACES
- Page background: #0b0e14. Cards/panels: #14181f. Muted fills: #191e27.
- Hairline borders: #2a303d, 1px. Corner radius 6px everywhere. Never rounder.
- Elevation comes from surface-lightness steps and hairlines, NOT drop shadows.
  Do not use box-shadow to float a card; it reads muddy on this canvas.

INK
- Primary text #f0f2f7. Secondary/labels #939cb0.
- Section labels are 10-11px, uppercase, letter-spacing 0.06em, secondary ink.

ACCENT AND SEMANTICS
- Accent (single, used sparingly): #3b82f6 azure. Accent tint fill: #14243d.
- Positive #3ddc97. Negative #f4566b. Use the tint fills #10281f / #2b1319
  behind delta chips, never saturated blocks.
- Series colours in order: #3b82f6, #26d0c0, #a78bfa, #f5a524, #f472b6, #34d399.

NUMBERS — non-negotiable
- Every numeral uses font-variant-numeric: tabular-nums. Columns of currency
  must not jitter.
- Currency reads compact at exec scale: $41.2M, $940K. Never show cents.
- Ratios as 3.4x, percentages to one decimal, durations as "17.9 mo".
- Deltas always carry an explicit sign, and are RED when a metric got worse —
  remember that for CAC payback and churn, DOWN is good.

CHARTS
- Hairline gridlines at 8% ink opacity. No chart borders. No legend when a direct
  label fits on the mark.
- Line charts: 2px stroke, rounded caps, a 14%-opacity fill beneath.
- Bars: 6px radius, single accent unless the categories are the point.

LAYOUT AND TONE
- Generous whitespace; 20-24px between sections. Max content width ~1100px.
- Lead with the number, then the label. A tile is a big figure with a small
  caption, not a caption with a figure.
- Terse, declarative copy. No exclamation marks, no emoji, no "Insights!" —
  this is read by a CFO.
`.trim();
