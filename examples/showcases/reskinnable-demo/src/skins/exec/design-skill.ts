/**
 * OGUI design brief injected as agent context so any open-generative-UI Vantage
 * produces matches Cascade Industries' boardroom aesthetic instead of a
 * generic dashboard template.
 *
 * ⚠ EVERY COLOUR HERE IS A LITERAL, ON PURPOSE. Generated UI is rendered inside
 * the OGUI sandbox iframe, whose document ships a bare CSS reset and nothing
 * else — no `globals.css`, no Tailwind, and no `.theme-exec` ancestor. So the
 * host's custom properties (`--surface`, `--canvas`, `--ink`, …) and the
 * semantic utility classes built on them (`bg-surface`, `text-ink`) do NOT
 * resolve in there: an instruction to "read colors from the CSS variables"
 * yields `var(--surface)` against an empty cascade, i.e. transparent surfaces
 * and default-black text — an unstyled panel that looks like a different
 * product. The values below are copied from `./theme.css`; keep the two in step
 * (commerce's and bookstore's briefs inline literals for the same reason).
 */
export const VANTAGE_DESIGN_SKILL = `
You are designing generative UI for **Vantage**, the executive reporting desk
for Cascade Industries. The audience is board members and C-suite readers
scanning between meetings — every surface should read like a board pack, not a
consumer dashboard.

PALETTE — write these values literally
Your markup is rendered in an isolated sandbox that ships a bare CSS reset and
nothing else. The host app's stylesheet never reaches it, so its CSS custom
properties and its utility classes resolve to nothing in there. Ship your own
styles, with every color written as a literal \`hsl(...)\` value.
- Cool graphite chrome. Light: canvas hsl(220 16% 95%), surfaces hsl(0 0% 100%),
  muted surface hsl(220 14% 93%), ink hsl(220 20% 14%), secondary ink
  hsl(220 9% 44%), hairline rules hsl(220 13% 87%).
- Dark-mode aware, and it is worth supporting: wrap the dark values in
  \`@media (prefers-color-scheme: dark)\` rather than assuming light. Dark:
  canvas hsl(220 18% 9%), surfaces hsl(220 15% 13%), muted surface
  hsl(220 13% 16%), ink hsl(220 14% 94%), secondary ink hsl(220 8% 60%),
  hairline hsl(220 11% 23%).
- Exactly one accent: muted brass gold — hsl(43 55% 45%) on light,
  hsl(43 62% 58%) on dark — used sparingly for the single figure, badge, or
  action that matters most on a view. Gold marks emphasis, not sentiment — it is
  never a stand-in for positive/negative.
- Variance gets its own muted green/red — positive hsl(152 50% 38%) light /
  hsl(152 42% 48%) dark, negative hsl(0 68% 48%) light / hsl(0 65% 60%) dark —
  used ONLY on the delta glyph and delta value, never on the absolute figure
  beside it (see FIGURES below).
- Corners 0.625rem, 1px hairline borders, no drop shadows.

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
