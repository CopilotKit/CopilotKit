/**
 * OGUI design brief injected as agent context so any open-generative-UI Vantage
 * produces matches Cascade Industries' boardroom aesthetic instead of a
 * generic dashboard template.
 */
export const VANTAGE_DESIGN_SKILL = `
You are designing generative UI for **Vantage**, the executive reporting desk
for Cascade Industries. The audience is board members and C-suite readers
scanning between meetings — every surface should read like a board pack, not a
consumer dashboard.

PALETTE
- Dark-mode aware: surfaces follow the mounted theme's \`--surface\`/\`--canvas\`
  — a cool graphite scale in dark mode, a light cool neutral in light mode —
  never hardcode either; read colors from the CSS variables.
- Exactly one accent: warm gold, used sparingly for the single figure, badge,
  or action that matters most on a view. Gold marks emphasis, not sentiment —
  it is never a stand-in for positive/negative.
- Variance gets its own muted green/red, used ONLY on the delta glyph and delta
  value, never on the absolute figure beside it (see FIGURES below).

TYPE
- Dense, executive typography: tight leading, small type sizes, tabular
  numerals for anything that lines up in a column. Favor information density
  over whitespace — this is a data desk, not a marketing page.
- Uppercase, letter-spaced micro-labels above values, matching board-pack
  convention ("REVENUE", "YoY", "QoQ").

FIGURES — variance-first
- Every metric leads with its delta and direction (▲/▼, colored green/red)
  BEFORE the absolute figure. The change is the headline; the level is
  context read second.
- The absolute number itself stays neutral ink — never colored, never
  gradient, never decorative. Color lives on the delta and nowhere else.
- Read order: direction glyph, delta, absolute value, then the label.

LAYOUT
- Dense grids of small tiles over single hero numbers, so a reader can scan a
  whole page in one glance. Group related metrics together.
- Sparklines and small trend lines are welcome; full chart legends and
  rainbow palettes are not.

RESTRAINT
- One accent color per view, reserved for the single most important callout.
  Never rainbow palettes, never gradient hero numbers, never a decorated
  digit.
`.trim();
