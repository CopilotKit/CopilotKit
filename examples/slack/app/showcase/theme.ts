/**
 * shadcn-style design tokens for the image-rendered showcase cards.
 *
 * This CSS string is fed once to `createChannel({ render: { stylesheets } })`.
 * Takumi resolves `var()` and class selectors for box-model props (div
 * `background`/`color`/`border`), so cards set **structure** inline
 * (`display:flex`, gap, padding — Yoga needs explicit flex) and pull **color +
 * typography** from these classes. Values are plain hex (not oklch) — the
 * safest form the renderer resolves. Font is Geist (Takumi's built-in Latin
 * fallback), so no font file is fed.
 *
 * Palette is shadcn "zinc" dark; the indigo accent matches chart palette[0]
 * (`#6366f1`) so cards and charts read as one theme.
 */
export const GEIST = "Geist";

export const shadcnCss = `
  :root {
    --card: #18181b;
    --card-inset: #0f0f11;
    --fg: #fafafa;
    --muted: #a1a1aa;
    --border: #27272a;
    --accent: #6366f1;
    --green-bg: #0b2e1a; --green-fg: #4ade80;
    --amber-bg: #3a2a05; --amber-fg: #fbbf24;
    --red-bg: #3a0f0f;   --red-fg: #f87171;
  }
  .card      { background: var(--card); color: var(--fg); border: 1px solid var(--border); border-radius: 16px; }
  .inset     { background: var(--card-inset); border: 1px solid var(--border); border-radius: 12px; }
  .title     { color: var(--fg); font-weight: 700; }
  .muted     { color: var(--muted); }
  .fg        { color: var(--fg); }
  .accent    { color: var(--accent); }
  .divider   { background: var(--border); }
  .kpi-value { color: var(--fg); font-weight: 700; }
  .kpi-label { color: var(--muted); }
  .badge       { border-radius: 999px; font-weight: 600; }
  .badge-green { background: var(--green-bg); color: var(--green-fg); }
  .badge-amber { background: var(--amber-bg); color: var(--amber-fg); }
  .badge-red   { background: var(--red-bg);   color: var(--red-fg); }
`;
