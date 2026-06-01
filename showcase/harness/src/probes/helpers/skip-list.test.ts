/**
 * Skip-list loader tests.
 *
 * The skip-list is an explicit, reviewed per-integration "not
 * applicable" declaration: a legit-unsupported feature is a DISTINCT
 * state (skipped), never silently absent and never forced-red. The
 * driver (a later task) calls `declaredSkips(slug)` and injects the
 * result into the pure rollup; the rollup never imports this loader.
 *
 * These tests exercise the loader against an in-memory map (the
 * exported `loadSkipList` accepts an injected source) so they don't
 * depend on the checked-in JSON staying empty, AND assert the shipped
 * `skip-list.json` loads cleanly via the default `isSkipped` /
 * `declaredSkips` entry points.
 */
import { describe, it, expect } from "vitest";
import {
  isSkipped,
  declaredSkips,
  loadSkipList,
} from "./skip-list.js";

describe("skip-list loader", () => {
  it("isSkipped is true only for a declared <slug, spec-file> pair", () => {
    const sl = loadSkipList({
      "google-adk": ["gen-ui-interrupt.spec.ts"],
    });
    expect(sl.isSkipped("google-adk", "gen-ui-interrupt.spec.ts")).toBe(true);
    // declared slug, undeclared file → false
    expect(sl.isSkipped("google-adk", "agentic-chat.spec.ts")).toBe(false);
    // undeclared slug → false
    expect(sl.isSkipped("langgraph-python", "gen-ui-interrupt.spec.ts")).toBe(
      false,
    );
  });

  it("declaredSkips returns the sorted list for a slug, [] for unknown", () => {
    const sl = loadSkipList({
      "google-adk": ["voice.spec.ts", "auth.spec.ts"],
    });
    expect(sl.declaredSkips("google-adk")).toEqual([
      "auth.spec.ts",
      "voice.spec.ts",
    ]);
    expect(sl.declaredSkips("langgraph-python")).toEqual([]);
  });

  it("throws at load when an entry is not a .spec.ts filename", () => {
    expect(() =>
      loadSkipList({ "google-adk": ["not-a-spec"] }),
    ).toThrow(/\.spec\.ts/);
  });

  it("throws at load when a slug's value is not an array", () => {
    expect(() =>
      loadSkipList({ "google-adk": "voice.spec.ts" as unknown as string[] }),
    ).toThrow();
  });

  it("the checked-in skip-list.json loads and the default exports work", () => {
    // Seed is empty `{}` — nothing is skipped, no slug has declared skips.
    expect(declaredSkips("langgraph-python")).toEqual([]);
    expect(isSkipped("langgraph-python", "voice.spec.ts")).toBe(false);
  });
});
