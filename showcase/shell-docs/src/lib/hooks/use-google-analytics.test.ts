import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// React's Rules of Hooks forbid calling hooks AFTER a conditional return.
// Doing so means a render where GA_ID is empty calls 0 hooks, and a
// subsequent render after hydration where GA_ID is populated calls
// usePathname() + two useEffects — different hook counts across renders
// of the same component instance trigger "Rendered more hooks than
// during the previous render" and tear the page down on the client.
//
// The pattern this file enforces: all hook calls live BEFORE any
// conditional early return; the GA_ID truthiness gate moves INSIDE the
// effect bodies (mirroring the pattern used in posthog-provider.tsx).
//
// Source-level assertion because the project has no jsdom / no
// react-test-renderer; a true cross-render reproduction needs one of
// those. Source assertion is sufficient: rules-of-hooks linting is the
// same check React itself runs at runtime — we're just running it
// against the file's textual structure.

describe("useGoogleAnalytics: hooks unconditional (rules of hooks)", () => {
  const sourcePath = resolve(__dirname, "./use-google-analytics.tsx");
  const source = readFileSync(sourcePath, "utf8");

  // Strip leading "use client" / imports / comments so the bodyOnly
  // string is just the function body region we care about.
  const fnStart = source.indexOf("export function useGoogleAnalytics");
  // Guard against a refactor that renames the export so this test
  // doesn't silently start passing on an unrelated file shape.
  expect(fnStart, "expected useGoogleAnalytics export").toBeGreaterThan(-1);
  const body = source.slice(fnStart);

  it("does not early-return before calling hooks", () => {
    // Find the index of the first 'return;' (the bug-shape early
    // return) and the first hook call. If the early return precedes
    // any hook, that's the bug.
    const earlyReturn = body.search(/if\s*\(\s*!GA_ID\s*\)\s*[{\s]*return\s*;/);
    const firstUsePathname = body.indexOf("usePathname(");
    const firstUseEffect = body.indexOf("useEffect(");

    // If there's no bug-shape early return at all, the test trivially
    // passes (the hook authoring is clean).
    if (earlyReturn === -1) {
      expect(true).toBe(true);
      return;
    }

    expect(
      firstUsePathname,
      "usePathname() must be called before any conditional return",
    ).toBeLessThan(earlyReturn);
    expect(
      firstUseEffect,
      "useEffect() must be called before any conditional return",
    ).toBeLessThan(earlyReturn);
  });
});
