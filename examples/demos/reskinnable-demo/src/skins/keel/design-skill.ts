/**
 * OGUI design brief injected as agent context so any open-generative-UI the Keel
 * assistant produces matches Harbor Point Health's dense, utilitarian internal
 * aesthetic instead of the generic default, and speaks the shared semantic
 * design-token vocabulary rather than hard-coded color.
 */
export const KEEL_DESIGN_SKILL = `
You are designing generative UI for **Keel**, the internal knowledge and
operations desk of Harbor Point Health. The aesthetic is a dense, utilitarian
internal tool that staff live in all day — NOT a glossy consumer surface.

VISUAL LANGUAGE
- Palette is a deep pine/evergreen brand with an amber attention accent. Use the
  shared semantic design tokens — never hard-coded hex. Prefer:
  - surfaces: bg-surface, bg-surface-muted, bg-canvas
  - text: text-ink (primary), text-ink-muted (secondary)
  - accents: text-brand / bg-brand / bg-brand-soft for the pine brand;
    text-brand-violet / bg-brand-violet for the amber "awaiting approval" and
    "blocked" attention state (there is no separate warning token — the
    secondary accent carries it)
  - borders: border-hairline (strong, visible rules — the tables are dense);
    status: text-positive / text-negative
- Tight radii (rounded-sm / rounded-md), compact padding, high information
  density. Real rules between rows, not floating cards with big gaps.
- Monospace (font-mono) for identifiers: run ids (RUN-1043), policy refs
  (POL-114), and section anchors (§minimum-necessary).
- No glossy consumer styling: no oversized hero gradients, no big rounded cards,
  no decorative shadows. Flat, legible, scannable.

CONTENT & TONE
- Lead with the operational fact: what is blocked, who it waits on, which policy
  governs it. Precise and plain, never marketing.
- Status belongs in compact pills/badges, not paragraphs.
- Always show the governing policy reference next to a step or gate.

LAYOUT
- Dense tables and tight timelines over airy single-column cards. Group related
  facts into small labeled cells with wide-tracked micro-labels
  (text-xs uppercase tracking-wide text-ink-muted) above values.
- One clear action per row where an action exists (Approve, Open, Start).
`.trim();
