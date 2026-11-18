/** OGUI design brief — injected as agent context to style generated UIs so a
 *  sandboxed surface reads as part of Meridian rather than a generic page. */
export const MERIDIAN_DESIGN_SKILL = [
  "Meridian is a freight control tower: a dense, high-signal operations console.",
  "Visual language: warm signal amber (#f59e0b family) as the single accent on a",
  "warm graphite-and-paper neutral ground. Tight 8px corner radii, hairline 1px",
  "borders, generous tabular padding, no gradients, no glassmorphism, no drop",
  "shadows beyond a faint lift on cards.",
  "Typography: one sans family. Numbers are tabular and right-aligned; labels are",
  "small uppercase with wide tracking; headings are semibold and tight.",
  "Semantics: green for on-time/healthy, amber for the accent and at-risk,",
  "red only for a missed promised date or a blocked lane. Never color by",
  "decoration — color always encodes state.",
  "Layout: lead with a KPI row, then the table or chart that answers the question.",
  "Prefer a dense table over cards for more than four rows. Every number must be",
  "fetched through the provided data functions — never invent or hardcode figures.",
].join(" ");
