/**
 * Tests for spec-driven-slugs loader + isSpecDriven predicate.
 *
 * Safe-default invariant: an EMPTY `spec_driven_slugs` array means every
 * slug resolves to false (heuristic remains authoritative). A slug only
 * becomes spec-driven when explicitly listed.
 *
 * RED-GREEN proof:
 *   RED  — import fails / module absent before loader exists.
 *   GREEN — all assertions below pass after loader is created.
 */

import { describe, it, expect } from "vitest";
import {
  isSpecDriven,
  validateSpecDrivenSlugsShape,
  __getSpecDrivenSlugsForTesting,
  __overrideSpecDrivenSlugsForTesting,
} from "./spec-driven-slugs.js";

describe("spec-driven-slugs loader", () => {
  // ── safe-default (empty file) ──────────────────────────────────────────
  it("returns false for any slug when slug list is empty (safe default)", () => {
    __overrideSpecDrivenSlugsForTesting([]);
    expect(isSpecDriven("langgraph-python")).toBe(false);
    expect(isSpecDriven("coagents-starter")).toBe(false);
    expect(isSpecDriven("")).toBe(false);
  });

  it("returns false for an unknown slug even when list has entries", () => {
    __overrideSpecDrivenSlugsForTesting(["langgraph-python"]);
    expect(isSpecDriven("coagents-starter")).toBe(false);
    expect(isSpecDriven("built-in-agent")).toBe(false);
  });

  // ── positive membership ────────────────────────────────────────────────
  it("returns true for a slug that appears in the list", () => {
    __overrideSpecDrivenSlugsForTesting(["langgraph-python"]);
    expect(isSpecDriven("langgraph-python")).toBe(true);
  });

  it("returns true for each slug in a multi-entry list", () => {
    __overrideSpecDrivenSlugsForTesting([
      "langgraph-python",
      "coagents-starter",
    ]);
    expect(isSpecDriven("langgraph-python")).toBe(true);
    expect(isSpecDriven("coagents-starter")).toBe(true);
  });

  // ── loaded default (from the real JSON) ────────────────────────────────
  it("ships with an EMPTY list (Phase-0 safe default) — langgraph-python is false", () => {
    // This test deliberately does NOT call __overrideSpecDrivenSlugsForTesting
    // so it reads the module-level default loaded from the real JSON file.
    // Restore any prior override first so this test is isolated.
    __overrideSpecDrivenSlugsForTesting(undefined);
    expect(isSpecDriven("langgraph-python")).toBe(false);
  });

  // ── accessor exposes the current list ─────────────────────────────────
  it("__getSpecDrivenSlugsForTesting reflects override", () => {
    __overrideSpecDrivenSlugsForTesting(["a", "b"]);
    expect(__getSpecDrivenSlugsForTesting()).toEqual(["a", "b"]);
  });

  // ── shape validator (exported for test coverage) ───────────────────────
  it("validateSpecDrivenSlugsShape throws when input is not an object", () => {
    expect(() => validateSpecDrivenSlugsShape(null)).toThrow();
    expect(() => validateSpecDrivenSlugsShape("bad")).toThrow();
    expect(() => validateSpecDrivenSlugsShape(42)).toThrow();
    expect(() => validateSpecDrivenSlugsShape([])).toThrow();
  });

  it("validateSpecDrivenSlugsShape throws when spec_driven_slugs is missing", () => {
    expect(() => validateSpecDrivenSlugsShape({})).toThrow();
  });

  it("validateSpecDrivenSlugsShape throws when spec_driven_slugs is not an array", () => {
    expect(() =>
      validateSpecDrivenSlugsShape({ spec_driven_slugs: "not-array" }),
    ).toThrow();
  });

  it("validateSpecDrivenSlugsShape throws when an entry is not a string", () => {
    expect(() =>
      validateSpecDrivenSlugsShape({ spec_driven_slugs: [42] }),
    ).toThrow();
  });

  it("validateSpecDrivenSlugsShape accepts a valid shape", () => {
    expect(() =>
      validateSpecDrivenSlugsShape({ spec_driven_slugs: ["langgraph-python"] }),
    ).not.toThrow();
  });

  // ── prototype-pollution guard ──────────────────────────────────────────
  it("validateSpecDrivenSlugsShape accesses spec_driven_slugs via own-key only", () => {
    // Object with inherited spec_driven_slugs — should fail (missing own key)
    const obj = Object.create({ spec_driven_slugs: ["langgraph-python"] });
    expect(() => validateSpecDrivenSlugsShape(obj)).toThrow();
  });
});
