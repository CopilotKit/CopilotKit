/**
 * Media query for the mobile breakpoint, shared so the string literal isn't
 * duplicated across call sites within this package (e.g. `CopilotModalHeader`,
 * which needs a live `matchMedia` change-listener and so can't call
 * `isMobileViewport()` directly).
 */
export const MOBILE_MAX_WIDTH_QUERY = "(max-width: 767px)";

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
