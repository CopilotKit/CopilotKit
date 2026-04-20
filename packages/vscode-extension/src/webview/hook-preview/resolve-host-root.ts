import type { ReactNode } from "react";

/**
 * Pick a React component to mount from the module exported by a bundled
 * host file. Prefers the default export; otherwise the first named export
 * that's a function. Returns null if no function export is found.
 *
 * Pure so we can unit-test the ordering without touching React.
 */
export function resolveHostRootFn(
  mod: { default?: unknown; [k: string]: unknown } | undefined | null,
): (() => ReactNode) | null {
  if (!mod) return null;
  if (typeof mod.default === "function") {
    return mod.default as () => ReactNode;
  }
  const firstFn = Object.values(mod).find((v) => typeof v === "function");
  return typeof firstFn === "function"
    ? (firstFn as () => ReactNode)
    : null;
}
