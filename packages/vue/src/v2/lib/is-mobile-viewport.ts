/**
 * Media query for the mobile breakpoint, re-exported from the shared
 * `@copilotkit/web-components` source of truth so Vue's coordination layer, the
 * React coordination layer, and the `<copilotkit-threads-drawer>` element all
 * key their mobile split off the same boundary. Re-exported (rather than
 * imported at each call site) so the string isn't duplicated across this
 * package's call sites (e.g. `CopilotModalHeader`, which needs a live
 * `matchMedia` change-listener and so can't call `isMobileViewport()` directly).
 */
import { MOBILE_MAX_WIDTH_QUERY } from "@copilotkit/web-components/threads-drawer/layout-constants";

export { MOBILE_MAX_WIDTH_QUERY };

/**
 * Reports whether the viewport is in the mobile range (`<768px`), where the
 * drawer and chat modal are mutually exclusive. SSR-safe (returns `false`
 * when `window` is absent) and guards environments where `window` exists but
 * `window.matchMedia` does not (some test runners, embedded webviews).
 */
export function isMobileViewport(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia(MOBILE_MAX_WIDTH_QUERY).matches;
}
