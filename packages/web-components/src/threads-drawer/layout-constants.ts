/**
 * Structural layout constants for `<copilotkit-threads-drawer>`.
 *
 * These are the drawer's OWN structural values — its default desktop width and
 * the viewport width at which it switches to a mobile off-canvas overlay. They
 * are deliberately NOT theme tokens (they are not derived from react-core's
 * `globals.css` like {@link GENERATED_DRAWER_TOKEN_DEFAULTS}); they describe the
 * element's layout behavior, not its skin.
 *
 * This module is the single source of truth so that:
 *  - the element's shadow-DOM styles ({@link drawerStyles}) and its `matchMedia`
 *    listener both read the same numbers,
 *  - host layouts can reserve the drawer's column / coordinate responsive
 *    behavior off the shipped `threads-drawer/layout.css` helper instead of
 *    hand-copying `320px` / `768px` literals, and
 *  - the React and Vue chat coordination layers key their mobile split off the
 *    same boundary as the element (reconciling the historical 767-vs-768 seam
 *    where the element flipped to mobile at `max-width: 768px` while the
 *    coordination layers used `max-width: 767px`).
 *
 * A unit test asserts the shipped `layout.css` and the element's `matchMedia`
 * query stay consistent with these values (anti-drift).
 */

/** Default desktop width of the drawer, in CSS pixels. */
export const DRAWER_DEFAULT_WIDTH_PX = 320;

/**
 * Default desktop width as a CSS length string. Backs the `--cpk-drawer-width`
 * fallback in the shadow styles and the `:root` default in `layout.css`.
 */
export const DRAWER_DEFAULT_WIDTH = `${DRAWER_DEFAULT_WIDTH_PX}px`;

/**
 * Viewport width (px) at which the chat surface enters its DESKTOP layout: at
 * this width and above the drawer is an in-flow column; strictly below it the
 * drawer becomes an off-canvas overlay. Shared across the element, react-core,
 * and vue so all three agree on the boundary.
 */
export const MOBILE_BREAKPOINT_PX = 768;

/**
 * Largest viewport width (px) still treated as mobile — one less than
 * {@link MOBILE_BREAKPOINT_PX}. A device at exactly {@link MOBILE_BREAKPOINT_PX}
 * is desktop, matching the `(min-width: 768px)` / `(max-width: 767px)` split the
 * chat coordination layers already use.
 */
export const MOBILE_MAX_WIDTH_PX = MOBILE_BREAKPOINT_PX - 1;

/**
 * `matchMedia`/CSS media query string matching the mobile range
 * (`(max-width: 767px)`). The element listens on this; host stylesheets key
 * their responsive collapse off the same value via `layout.css`.
 */
export const MOBILE_MAX_WIDTH_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;
