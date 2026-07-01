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
  return window.matchMedia("(max-width: 767px)").matches;
}
