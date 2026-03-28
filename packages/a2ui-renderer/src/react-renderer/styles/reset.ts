/**
 * Browser default reset for A2UI surfaces.
 *
 * The React renderer uses Light DOM, which means host-app CSS resets
 * (e.g. Tailwind preflight, normalize.css) can strip browser defaults
 * like heading margins, list styles, and form element appearance from
 * elements inside the renderer.
 *
 * The Lit renderer avoids this because Shadow DOM isolates its elements
 * from external stylesheets.
 *
 * This reset restores browser defaults inside `.a2ui-surface` by using
 * `all: revert` in a CSS @layer. Layered styles have the lowest author
 * priority, so every other A2UI style (utility classes, component styles,
 * theme classes, inline styles) automatically overrides the reset.
 */
export const resetStyles: string = `
@layer a2ui-reset {
  :where(.a2ui-surface) :where(*) {
    all: revert;
  }
}
`;
