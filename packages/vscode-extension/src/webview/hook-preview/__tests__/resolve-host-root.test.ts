import { describe, it, expect } from "vitest";
import { resolveHostRootFn } from "../resolve-host-root";

describe("resolveHostRootFn", () => {
  it("returns null for undefined / null module", () => {
    expect(resolveHostRootFn(undefined)).toBeNull();
    expect(resolveHostRootFn(null)).toBeNull();
  });

  it("returns null for an empty module", () => {
    expect(resolveHostRootFn({})).toBeNull();
  });

  it("prefers the default export when it's a function", () => {
    const def = () => "default";
    const named = () => "named";
    expect(resolveHostRootFn({ default: def, named })).toBe(def);
  });

  it("falls back to the first named function export", () => {
    const named = () => "named";
    expect(resolveHostRootFn({ named, leftover: 123 })).toBe(named);
  });

  it("returns null when no function exports exist", () => {
    expect(resolveHostRootFn({ a: 1, b: "str", c: null })).toBeNull();
  });

  it("ignores non-function default and finds a named function", () => {
    const named = () => "named";
    expect(resolveHostRootFn({ default: "not-a-fn", named })).toBe(named);
  });
});
