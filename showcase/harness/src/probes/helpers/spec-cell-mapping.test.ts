/**
 * spec-cell-mapping loader — red-green unit tests.
 *
 * RED phase: these tests run BEFORE the loader exists and must fail to
 *   resolve the import (module-not-found or type errors).
 * GREEN phase: after spec-cell-mapping.ts is created, all assertions pass.
 */

import { describe, it, expect } from "vitest";
import { loadSpecCellMapping } from "./spec-cell-mapping.js";
import type { SpecCellMapping } from "./spec-cell-mapping.js";

describe("spec-cell-mapping loader", () => {
  it("returns a typed SpecCellMapping for a well-formed N:M JSON object", () => {
    const raw = {
      "langgraph-python": {
        "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
        "tests/e2e/beautiful-chat.spec.ts": [
          "beautiful-chat-toggle-theme",
          "beautiful-chat-pie-chart",
          "beautiful-chat-bar-chart",
          "beautiful-chat-search-flights",
          "beautiful-chat-schedule-meeting",
        ],
        "tests/e2e/reasoning-custom.spec.ts": ["reasoning-display"],
        "tests/e2e/reasoning-default.spec.ts": ["reasoning-display"],
      },
    };

    const mapping = loadSpecCellMapping(JSON.stringify(raw));

    // Slug key present
    expect(mapping["langgraph-python"]).toBeDefined();

    // 1:1 case
    expect(
      mapping["langgraph-python"]["tests/e2e/agentic-chat.spec.ts"],
    ).toEqual(["agentic-chat"]);

    // 1:many case (beautiful-chat → 5 cells)
    expect(
      mapping["langgraph-python"]["tests/e2e/beautiful-chat.spec.ts"],
    ).toHaveLength(5);
    expect(
      mapping["langgraph-python"]["tests/e2e/beautiful-chat.spec.ts"],
    ).toContain("beautiful-chat-toggle-theme");

    // N:1 case (two specs → same cell)
    expect(
      mapping["langgraph-python"]["tests/e2e/reasoning-custom.spec.ts"],
    ).toEqual(["reasoning-display"]);
    expect(
      mapping["langgraph-python"]["tests/e2e/reasoning-default.spec.ts"],
    ).toEqual(["reasoning-display"]);
  });

  it("throws on malformed JSON", () => {
    expect(() => loadSpecCellMapping("{not valid json")).toThrow();
  });

  it("throws when top-level value is not an object", () => {
    expect(() => loadSpecCellMapping(JSON.stringify([1, 2, 3]))).toThrow(
      /SpecCellMapping/,
    );
  });

  it("throws when a slug's value is not an object", () => {
    const bad = { "langgraph-python": "not-an-object" };
    expect(() => loadSpecCellMapping(JSON.stringify(bad))).toThrow(
      /SpecCellMapping/,
    );
  });

  it("throws when a spec path's cell list is not an array", () => {
    const bad = {
      "langgraph-python": {
        "tests/e2e/agentic-chat.spec.ts": "agentic-chat",
      },
    };
    expect(() => loadSpecCellMapping(JSON.stringify(bad))).toThrow(
      /SpecCellMapping/,
    );
  });

  it("throws when a cell list contains a non-string entry", () => {
    const bad = {
      "langgraph-python": {
        "tests/e2e/agentic-chat.spec.ts": [42],
      },
    };
    expect(() => loadSpecCellMapping(JSON.stringify(bad))).toThrow(
      /SpecCellMapping/,
    );
  });

  it("accepts an empty mapping (no slugs mapped yet)", () => {
    const mapping = loadSpecCellMapping(JSON.stringify({}));
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it("accepts a slug with no spec paths yet (empty inner object)", () => {
    const raw = { "langgraph-python": {} };
    const mapping = loadSpecCellMapping(JSON.stringify(raw));
    expect(mapping["langgraph-python"]).toEqual({});
  });

  it("type-checks: SpecCellMapping is assignable without cast", () => {
    const mapping: SpecCellMapping = loadSpecCellMapping(
      JSON.stringify({ "some-slug": { "a/b.spec.ts": ["agentic-chat"] } }),
    );
    expect(mapping["some-slug"]["a/b.spec.ts"]).toEqual(["agentic-chat"]);
  });

  // ── prototype-pollution guard ──────────────────────────────────────────
  it("output contains only own keys — inherited prototype keys do not appear even when source object has them", () => {
    // Build a JSON string whose parsed form would have an inherited key if the
    // loader iterated the prototype chain instead of only own keys.
    // We inject the crafted payload through the REAL parse path by JSON-encoding
    // an object that has an own key "slug-a" only; then we verify that an
    // inherited-via-prototype key ("inheritedSlug") is absent from the output.
    //
    // Seeded defect proof: if loadSpecCellMapping iterated prototype-chain keys
    // (e.g. `for ... in` instead of Object.entries/Object.keys), an Object.create
    // payload passed after JSON.parse reconstruction would leak prototype keys.
    // JSON.parse itself strips the prototype, so the real guard is that the loader
    // uses Object.entries / Object.keys and does NOT re-attach inherited properties.
    //
    // The crafted vector: JSON string for {"slug-a": {"a.spec.ts": ["cell-a"]}}.
    // A hypothetical buggy loader that uses `for (key in parsed)` on a manually-
    // reconstructed object could expose prototype keys; we verify the output has
    // ONLY own keys from the parsed JSON.
    const crafted = JSON.stringify({ "slug-a": { "a.spec.ts": ["cell-a"] } });
    const mapping = loadSpecCellMapping(crafted);

    // Only own keys must appear in the output.
    expect(Object.keys(mapping)).toEqual(["slug-a"]);
    expect(Object.prototype.hasOwnProperty.call(mapping, "slug-a")).toBe(true);

    // Inherited prototype keys must not bleed through.
    // "toString", "valueOf", "constructor" are inherited on every plain object.
    expect(Object.prototype.hasOwnProperty.call(mapping, "toString")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(mapping, "valueOf")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(mapping, "__proto__")).toBe(
      false,
    );

    // Inner map is also own-keys-only.
    const inner = mapping["slug-a"];
    expect(Object.keys(inner)).toEqual(["a.spec.ts"]);
    expect(Object.prototype.hasOwnProperty.call(inner, "a.spec.ts")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(inner, "toString")).toBe(false);
  });

  // ── dangerous key rejection (R6-LB Fix 2) ────────────────────────────────
  it("throws when a top-level slug key is '__proto__'", () => {
    // __proto__ as a slug key must be explicitly rejected to prevent prototype
    // pollution via the spec-cell-mapping load path.
    expect(() =>
      loadSpecCellMapping('{"__proto__": {"a.spec.ts": ["agentic-chat"]}}'),
    ).toThrow(/dangerous key|__proto__|SpecCellMapping/i);
  });

  it("throws when a top-level slug key is 'constructor'", () => {
    expect(() =>
      loadSpecCellMapping('{"constructor": {"a.spec.ts": ["agentic-chat"]}}'),
    ).toThrow(/dangerous key|constructor|SpecCellMapping/i);
  });

  it("throws when a top-level slug key is 'prototype'", () => {
    expect(() =>
      loadSpecCellMapping('{"prototype": {"a.spec.ts": ["agentic-chat"]}}'),
    ).toThrow(/dangerous key|prototype|SpecCellMapping/i);
  });

  it("throws when an inner spec-path key is '__proto__'", () => {
    // __proto__ nested inside a slug value must also be rejected.
    expect(() =>
      loadSpecCellMapping('{"slug-a": {"__proto__": ["agentic-chat"]}}'),
    ).toThrow(/dangerous key|__proto__|SpecCellMapping/i);
  });

  it("does not poison Object.prototype via literal __proto__ key in JSON input — loader rejects", () => {
    // Previously the loader silently admitted __proto__ as an own key.
    // Now it must throw. After rejection, Object.prototype must be clean.
    const beforeProtoKeys = Object.keys(Object.prototype).length;
    const beforeSentinel = (Object.prototype as Record<string, unknown>)[
      "agentic-chat"
    ];

    // All dangerous-key payloads must throw.
    expect(() =>
      loadSpecCellMapping('{"__proto__": {"a.spec.ts": ["agentic-chat"]}}'),
    ).toThrow();
    expect(() =>
      loadSpecCellMapping('{"slug-a": {"__proto__": ["agentic-chat"]}}'),
    ).toThrow();

    // Payload: JSON string with literal "__proto__" as a cell value inside an array.
    // This is valid shape (string value, not a key) — must be stored as own data only.
    const p3 = loadSpecCellMapping('{"slug-a": {"a.spec.ts": ["__proto__"]}}');
    expect(p3["slug-a"]["a.spec.ts"]).toEqual(["__proto__"]);

    // Critical invariant: Object.prototype must not have been poisoned.
    expect(Object.keys(Object.prototype)).toHaveLength(beforeProtoKeys);
    expect((Object.prototype as Record<string, unknown>)["agentic-chat"]).toBe(
      beforeSentinel,
    );
    expect(
      (Object.prototype as Record<string, unknown>)["a.spec.ts"],
    ).toBeUndefined();
  });

  // ── loader strictness: empty-string cell names (R6-LB Fix 3) ─────────────
  it("throws when a cell name is an empty string", () => {
    const bad = {
      "slug-a": {
        "tests/e2e/agentic-chat.spec.ts": ["agentic-chat", ""],
      },
    };
    expect(() => loadSpecCellMapping(JSON.stringify(bad))).toThrow(
      /empty.*cell|SpecCellMapping/i,
    );
  });

  // ── loader strictness: intra-spec duplicate cells (R6-LB Fix 3) ──────────
  it("throws when a spec path has duplicate cell names", () => {
    const bad = {
      "slug-a": {
        "tests/e2e/agentic-chat.spec.ts": ["agentic-chat", "agentic-chat"],
      },
    };
    expect(() => loadSpecCellMapping(JSON.stringify(bad))).toThrow(
      /duplicate.*cell|SpecCellMapping/i,
    );
  });
});
