/**
 * Replace the jsdom window's `location` with `undefined` for the duration of
 * a test, and restore the original descriptor afterwards.
 *
 * Used by tests that want CopilotKitProvider's localhost auto-open-inspector
 * heuristic to skip. The previous pattern replaced the entire window with
 * `{}` in `beforeEach`, which broke React 18's concurrent renderer — it
 * touches `window.addEventListener` and `instanceof window.HTMLIFrameElement`
 * during commit and needs the real jsdom globals. (React 19 happens to
 * tolerate the empty-window swap; React 18 throws "Should not already be
 * working." mid-commit, which then corrupts the scheduler for the rest of the
 * file.)
 */
export function stubWindowLocation(): () => void {
  const target = (globalThis as { window?: unknown }).window;
  if (!target || typeof target !== "object") {
    return () => {};
  }

  const original = Object.getOwnPropertyDescriptor(
    target as object,
    "location",
  );

  Object.defineProperty(target as object, "location", {
    value: undefined,
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
