/**
 * The OGUI design brief, injected as agent context so anything
 * `generateSandboxedUi` produces looks like it belongs to Bellwether rather than
 * to a generic dashboard template.
 *
 * Written as instructions about RESTRAINT as much as about style: generated UI
 * defaults to gradient hero numbers and rainbow chart palettes, and either would
 * clash badly with an app whose entire visual argument is a quiet ink-blue
 * chrome carrying exactly one loud colour, reserved for markdowns.
 */
export const BELLWETHER_DESIGN_SKILL = `
Bellwether is a commerce operations console. Generated UI must look like part of
it — a back office behind a storefront, not the storefront.

Palette. Deep ink blue is the only brand colour: hsl(206 72% 30%) for accents and
fills, hsl(210 66% 21%) for the darker end of any gradient, and a very pale
hsl(206 62% 95%) for soft backgrounds. Hot rose, hsl(336 78% 44%), is reserved
for discounts, markdowns and promotions and is used for NOTHING else — it is the
one colour that has to still mean something after ten screens. Positive is
hsl(162 58% 33%); anything below policy or otherwise wrong is hsl(4 74% 48%).
Surfaces are white on a hsl(210 22% 95%) canvas, text is hsl(212 32% 12%) with
hsl(210 12% 44%) for secondary.

Shape and space. 0.625rem corners on cards, 1px hairline borders in
hsl(210 20% 89%), one soft shadow, generous padding. No heavy borders, no
double-outlined cards, no drop shadows on text.

Type. System sans throughout. One weight step between a label and its value, no
more. Every figure — price, cost, margin percent, unit count, day count — uses
tabular numerals so columns line up and a changed digit reads as a change.

Products. Any SKU shown gets a small SQUARE tile with its initials, in a
desaturated colour derived from its name (roughly hsl(H 40% 92%) background with
hsl(H 48% 28%) text). People get the same tile, round instead of square. Never
invent product photography.

Margin. When margin appears, show it against its category FLOOR, not on a bare
axis — the distance from the floor is the whole story, and a margin figure with
no floor beside it is decoration. Below-floor values are the only thing that ever
gets the negative colour.

Restraint. One accent per view. Do not build gradient hero numbers, multi-colour
chart palettes, or decorative icons. Margins, exceptions and cover are the
interesting part; let them carry the view. Empty states say what to do next,
never just "no data".

Figures. Never type a number into generated markup. Every value comes from the
exposed sandbox functions, so the UI stays bound to the real ledger.
`.trim();
