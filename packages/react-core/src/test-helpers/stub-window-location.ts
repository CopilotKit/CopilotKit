/**
 * Replace the jsdom window's `location` for the duration of a test and restore
 * the original descriptor afterwards. Pass a full URL to retain the standard
 * location fields, or omit it to use `undefined`.
 *
 * Tests use this to exercise browser-location behavior without replacing the
 * entire window. Replacing it with `{}` breaks React 18's concurrent renderer,
 * which touches `window.addEventListener` and `instanceof window.HTMLIFrameElement`
 * during commit and needs the real jsdom globals. (React 19 happens to
 * tolerate the empty-window swap; React 18 throws "Should not already be
 * working." mid-commit, which then corrupts the scheduler for the rest of the
 * file.)
 */
export function stubWindowLocation(url?: string): () => void {
  const target = (globalThis as { window?: unknown }).window;
  if (!target || typeof target !== "object") {
    return () => {};
  }

  const original = Object.getOwnPropertyDescriptor(
    target as object,
    "location",
  );

  Object.defineProperty(target as object, "location", {
    value: url === undefined ? undefined : new URL(url),
    configurable: true,
    writable: true,
  });

  return function restoreWindowLocation() {
    if (original) {
      Object.defineProperty(target as object, "location", original);
    } else {
      delete (target as { location?: unknown }).location;
    }
  };
}
