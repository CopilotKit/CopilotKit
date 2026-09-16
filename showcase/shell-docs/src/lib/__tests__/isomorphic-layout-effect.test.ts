// @vitest-environment jsdom

import * as React from "react";
import { describe, expect, it } from "vitest";

import {
  chooseLayoutEffect,
  useIsomorphicLayoutEffect,
} from "../isomorphic-layout-effect";

describe("useIsomorphicLayoutEffect", () => {
  it("is React.useLayoutEffect in this suite's DOM environment", () => {
    // This suite runs under jsdom, where `window` exists — the same branch
    // a real browser takes. If this module ever regressed to always
    // choosing `useEffect`, the wizard's restore would go back to flashing
    // step 1 before the jump, and this assertion is what would catch it.
    expect(useIsomorphicLayoutEffect).toBe(React.useLayoutEffect);
    expect(useIsomorphicLayoutEffect).not.toBe(React.useEffect);
  });
});

describe("chooseLayoutEffect", () => {
  // The module-level export above can only ever prove the browser branch,
  // since this suite always runs with `window` defined — jsdom cannot be
  // undefined mid-suite. The underlying choice is factored into this pure
  // function precisely so the server branch (no `window`, where
  // `useLayoutEffect` would warn) has something testable too.
  it("resolves to useLayoutEffect when isBrowser is true", () => {
    expect(chooseLayoutEffect(true)).toBe(React.useLayoutEffect);
  });

  it("resolves to useEffect when isBrowser is false", () => {
    expect(chooseLayoutEffect(false)).toBe(React.useEffect);
  });
});
