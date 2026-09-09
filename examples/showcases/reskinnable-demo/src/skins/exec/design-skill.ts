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
 *
 * THE COPY IS PINNED, not trusted. A hand-kept copy of another file drifts the
 * moment that file moves, and this one did: the brief kept shipping the
 * PRE-contrast-fix brand, positive, dark negative and muted ink long after
 * `theme.css` deepened them, so generated UI rendered the unreadable palette
 * the app itself had already fixed. `./theme.test.ts` ("the OGUI design brief
 * quotes theme.css") now parses every `hsl(...)` out of the string below and
 * asserts it equals the `theme.css` token it names, and fails on any literal it
 * has no mapping for. Change a colour here and there, or neither.
 *
 * DARK MODE IS `prefers-color-scheme`, NOT THE APP'S TOGGLE. The host resolves
 * dark by putting a `.dark` class on <html> (`src/hooks/use-theme.ts`), and
 * that class cannot reach the sandbox: the OGUI renderer builds the iframe
 * document out of the model's own HTML plus a CSS reset, with no host class, no
 * host attribute and no theme message (`OpenGenerativeUIRenderer.tsx`'s
 * `ensureHead`/`injectCssIntoHtml`). `prefers-color-scheme` is therefore the
 * only dark signal the generated markup can actually observe — so the brief
 * asks for it, and the consequence is honest rather than hidden: the iframe
 * follows the OS, so a reader who toggles the app to dark against a light OS
 * gets a light generated view inside a dark app. Instructing the model to key
 * off `.dark` instead would be strictly worse — that selector never matches in
 * there, so every generated view would be stuck light.
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
  hsl(220 10% 42%), hairline hsl(220 13% 87%).
- Dark-mode aware, and it is worth supporting. The sandbox never sees the host
  page's theme class, so \`@media (prefers-color-scheme: dark)\` is the only dark
  signal available: wrap the dark values in it rather than assuming light. Dark:
  canvas hsl(220 18% 9%), surfaces hsl(220 15% 13%), muted surface
  hsl(220 13% 16%), ink hsl(220 14% 94%), secondary ink hsl(220 8% 60%),
  hairline hsl(220 11% 23%).
- Exactly one accent: muted brass gold — hsl(43 62% 30%) on light,
  hsl(43 62% 58%) on dark — used sparingly for the single figure, badge, or
  action that matters most on a view. Note the polarity: on light it is a DEEP
  brass that carries a white label, on dark a lifted brass that carries a
  near-black one. Gold marks emphasis, not sentiment — it is never a stand-in
  for positive/negative.
- Variance gets its own muted green/red — positive hsl(152 56% 30%) light /
  hsl(152 42% 48%) dark, negative hsl(0 68% 48%) light / hsl(0 66% 66%) dark —
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
