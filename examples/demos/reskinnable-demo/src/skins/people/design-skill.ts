/**
 * The OGUI design brief, injected as agent context so anything
 * `generateSandboxedUi` produces looks like it belongs to Rowan rather than to
 * a generic dashboard template.
 *
 * Written as instructions about RESTRAINT as much as about style: generated UI
 * defaults to gradient hero numbers and rainbow chart palettes, and either
 * would clash badly with an app whose entire visual argument is a quiet plum
 * chrome carrying colourful per-person monograms.
 */
export const ROWAN_DESIGN_SKILL = `
Rowan is a People Ops product. Generated UI must look like part of it.

Palette. Deep plum is the only brand colour: hsl(315 38% 36%) for accents and
fills, hsl(322 44% 26%) for the darker end of any gradient, and a very pale
hsl(316 46% 95%) for soft backgrounds. Warm gold, hsl(38 88% 50%), marks
milestones and nothing else. Positive is hsl(158 56% 34%); anything wrong or out
of policy is hsl(352 70% 48%). Surfaces are white on a hsl(318 16% 95%) canvas,
text is hsl(318 24% 12%) with hsl(316 9% 44%) for secondary.

Shape and space. 0.875rem corners on cards, 1px hairline borders in
hsl(318 18% 89%), one soft shadow, generous padding. No heavy borders, no
double-outlined cards, no drop shadows on text.

Type. System sans throughout. One weight step between a label and its value, no
more. Every figure — salary, band position, day count, headcount — uses tabular
numerals so columns line up and a changed digit reads as a change.

People. Anyone shown gets a round monogram tile with their initials, in a
desaturated colour derived from their name (roughly hsl(H 44% 92%) background
with hsl(H 52% 28%) text). Never invent avatars or photographs.

Restraint. One accent per view. Do not build gradient hero numbers, multi-colour
chart palettes, or decorative icons. Bands and positions are the interesting
part; let them carry the view. Empty states say what to do next, never just
"no data".

Figures. Never type a number into generated markup. Every value comes from the
exposed sandbox functions, so the UI stays bound to the real ledger.
`.trim();
