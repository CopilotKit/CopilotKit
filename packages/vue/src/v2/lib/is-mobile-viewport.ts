/**
 * Reports whether the viewport is in the mobile range (`<768px`), where the
 * drawer and chat modal are mutually exclusive. SSR-safe (returns `false`
 * when `window` is absent).
 */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}
