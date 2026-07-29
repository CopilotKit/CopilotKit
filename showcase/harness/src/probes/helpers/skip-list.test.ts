/**
 * Tests for the skip-list loader.
 *
 * The skip-list has two merge inputs:
 *   1. The static JSON file (`skip-list.json`) — seeded empty in Phase 0.
 *   2. Runtime `notSupportedFeatures` from each slug's manifest — folded in
 *      by the caller (driver/CLI) via `mergeSkipList(base, notSupportedFeatures)`.
 *
 * RED-GREEN proof:
 *   RED  — import fails before loader exists.
 *   GREEN — all assertions pass after loader created.
 */

import { describe, it, expect } from "vitest";
import {
  loadSkipList,
  mergeSkipList,
  validateSkipListShape,
  __overrideSkipListForTesting,
} from "./skip-list.js";

describe("skip-list loader", () => {
  // ── static JSON loading ────────────────────────────────────────────────
  it("loadSkipList returns an empty map when the JSON file is empty", () => {
    __overrideSkipListForTesting({});
    const result = loadSkipList();
    expect(result).toEqual({});
  });

  it("loadSkipList returns declared cells when JSON has entries", () => {
    __overrideSkipListForTesting({
      "my-slug": ["agentic-chat", "tool-rendering"],
    });
    const result = loadSkipList();
    expect(result["my-slug"]).toEqual(["agentic-chat", "tool-rendering"]);
  });

  it("loadSkipList returns a fresh outer map that does not share inner arrays with the module cache", () => {
    // This test proves the DEEP copy contract: mutating a returned inner array
    // must NOT corrupt subsequent calls to loadSkipList.
    //
    // With a shallow copy (`{ ..._current() }`), `result["my-slug"]` and the
    // cached inner array are the SAME reference. Pushing to it poisons the
    // module cache. This test FAILS against the shallow-copy implementation
    // (which was the pre-fix behaviour) and PASSES after deep copy.
    __overrideSkipListForTesting({
      "my-slug": ["agentic-chat"],
    });

    const first = loadSkipList();
    // Mutate the inner array of the first returned copy.
    first["my-slug"].push("INJECTED");

    // A subsequent load must be unaffected — module cache must still have
    // only the original entry.
    const second = loadSkipList();
    expect(second["my-slug"]).toEqual(["agentic-chat"]);
    expect(second["my-slug"]).not.toContain("INJECTED");

    // The mutation must have affected the first result (confirming we pushed
    // into it successfully) without bleeding into the second.
    expect(first["my-slug"]).toContain("INJECTED");
  });

  // ── malformed JSON guard (uses the real exported validator) ────────────
  it("validateSkipListShape throws on a non-object JSON value", () => {
    expect(() => {
      validateSkipListShape(null);
    }).toThrow();

    expect(() => {
      validateSkipListShape("bad");
    }).toThrow();

    expect(() => {
      validateSkipListShape(42);
    }).toThrow();
  });

  it("validateSkipListShape throws when a slug entry is not an array", () => {
    expect(() => {
      validateSkipListShape({ "my-slug": "not-an-array" });
    }).toThrow();
  });

  it("validateSkipListShape throws when a cell entry is not a string", () => {
    expect(() => {
      validateSkipListShape({ "my-slug": [42] });
    }).toThrow();
  });

  // ── prototype-pollution guard ──────────────────────────────────────────
  it("validateSkipListShape ignores inherited/prototype keys", () => {
    const obj = Object.create({ inherited: ["some-cell"] });
    // inherited key must NOT trigger per-slug validation
    expect(() => validateSkipListShape(obj)).not.toThrow();
    const result = validateSkipListShape(obj);
    expect(Object.prototype.hasOwnProperty.call(result, "inherited")).toBe(
      false,
    );
  });

  it("validateSkipListShape rejects __proto__ as a key (must throw)", () => {
    // __proto__ as a slug key must be EXPLICITLY rejected (R6-LB Fix 2).
    // Using JSON.parse to get a true own-property "__proto__" key, then feeding
    // through the REAL load path — the validator must throw.
    const jsonWithProto = '{"__proto__": ["agentic-chat"]}';
    const parsed: unknown = JSON.parse(jsonWithProto);
    // JSON.parse stores __proto__ as an own enumerable key (not on prototype).
    expect(() => validateSkipListShape(parsed)).toThrow(
      /dangerous key|__proto__|skip-list/i,
    );
    // Critical invariant: Object.prototype must not be poisoned.
    expect(
      (Object.prototype as Record<string, unknown>)["agentic-chat"],
    ).toBeUndefined();
  });

  it("validateSkipListShape rejects 'constructor' and 'prototype' as keys", () => {
    const constructorPayload = JSON.parse('{"constructor": ["agentic-chat"]}');
    expect(() => validateSkipListShape(constructorPayload)).toThrow(
      /dangerous key|constructor|skip-list/i,
    );
    const protoPayload = JSON.parse('{"prototype": ["agentic-chat"]}');
    expect(() => validateSkipListShape(protoPayload)).toThrow(
      /dangerous key|prototype|skip-list/i,
    );
  });

  // ── mergeSkipList: runtime not_supported_features fold-in ─────────────
  it("mergeSkipList returns a fresh copy (not the same reference) when notSupportedFeatures is empty", () => {
    const base = { "slug-a": ["agentic-chat"] as string[] };
    const merged = mergeSkipList(base, "slug-a", []);
    // Must NOT return the same reference (aliasing asymmetry fix)
    expect(merged).not.toBe(base);
    expect(merged).toEqual(base);
  });

  it("mergeSkipList adds notSupportedFeatures for a slug not yet in base", () => {
    const base = {};
    const merged = mergeSkipList(base, "langgraph-python", ["tool-rendering"]);
    expect(merged["langgraph-python"]).toEqual(["tool-rendering"]);
  });

  it("mergeSkipList unions notSupportedFeatures with existing declared cells", () => {
    const base = { "langgraph-python": ["agentic-chat"] as string[] };
    const merged = mergeSkipList(base, "langgraph-python", ["tool-rendering"]);
    expect(merged["langgraph-python"]).toContain("agentic-chat");
    expect(merged["langgraph-python"]).toContain("tool-rendering");
    expect(merged["langgraph-python"]).toHaveLength(2);
  });

  it("mergeSkipList does not duplicate cells already present in both sources", () => {
    const base = { "langgraph-python": ["agentic-chat"] as string[] };
    // "agentic-chat" is in both base AND notSupportedFeatures
    const merged = mergeSkipList(base, "langgraph-python", [
      "agentic-chat",
      "headless-simple",
    ]);
    const cells = merged["langgraph-python"]!;
    const deduped = [...new Set(cells)];
    expect(cells.length).toBe(deduped.length);
  });

  it("mergeSkipList does not mutate the original base object", () => {
    const base = { "slug-a": ["agentic-chat"] as string[] };
    const baseCopy = JSON.parse(JSON.stringify(base));
    mergeSkipList(base, "slug-b", ["tool-rendering"]);
    expect(base).toEqual(baseCopy);
  });

  // ── Fix 4: deep copy inner arrays (R6-LB) ─────────────────────────────
  it("mergeSkipList (empty branch) — returned inner arrays are independent of base inner arrays", () => {
    // The empty-branch path (`notSupportedFeatures.length === 0`) must deep-copy
    // inner arrays so that mutating a returned inner array does not corrupt the
    // base. With `{ ...base }` (shallow copy), `result["slug-a"]` is the SAME
    // array reference as `base["slug-a"]`, so `result["slug-a"].push(x)` mutates
    // `base` — a violation of the "pure function / no side-effects" contract.
    const innerArr = ["agentic-chat"] as string[];
    const base = { "slug-a": innerArr };

    const result = mergeSkipList(base, "slug-b", []); // empty → no-op branch

    // The returned inner array for "slug-a" must NOT be the same reference.
    expect(result["slug-a"]).not.toBe(innerArr);

    // Mutating the returned inner array must not affect base.
    result["slug-a"].push("INJECTED");
    expect(base["slug-a"]).not.toContain("INJECTED");
    expect(base["slug-a"]).toEqual(["agentic-chat"]);
  });

  it("mergeSkipList (non-empty branch) — unaffected slug inner arrays are independent of base", () => {
    // The non-empty branch (`{ ...base, [slug]: merged }`) spreads base — other
    // slugs' inner arrays are the SAME references as in base. Mutating a returned
    // unaffected slug's inner array must not corrupt base.
    const slugAArr = ["agentic-chat"] as string[];
    const base = { "slug-a": slugAArr };

    // Non-empty branch: slug-b gets new merged array; slug-a is spread from base.
    const result = mergeSkipList(base, "slug-b", ["tool-rendering"]);

    // slug-a inner array in result must NOT be the same reference as in base.
    expect(result["slug-a"]).not.toBe(slugAArr);

    // Mutating result["slug-a"] must not affect base["slug-a"].
    result["slug-a"].push("INJECTED");
    expect(base["slug-a"]).not.toContain("INJECTED");
    expect(base["slug-a"]).toEqual(["agentic-chat"]);
  });
});
