/**
 * The OGUI design brief, injected as agent context to style any sandboxed UI the
 * agent generates. Required by the `Skin` contract.
 *
 * This skin has NO OGUI beat (spec §10) — no `sandboxFunctions`, no canvas
 * surface — so this brief is deliberately short. It is not empty because an
 * unstyled generated surface would look like a different product, and the field
 * exists precisely to prevent that.
 */
export const BOOKSTORE_DESIGN_SKILL = `
Warm bookshop, not a tech dashboard. Cream paper background (#F6F1E7), near-black
warm ink (#1C1A17), a single oxblood accent (#7A2E2E) used sparingly for actions
and emphasis. Hairline rules (#E3DACB) instead of heavy borders or shadows.
Corners barely rounded — 6px. Titles set in a serif; everything else sans.
Generous whitespace, small uppercase tracked labels, prices in a serif at a
larger size than their label. Never neon, never gradients, never dark mode.
`.trim();
