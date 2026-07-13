/**
 * spec-cell-mapping loader — red-green unit tests.
 *
 * RED phase: these tests run BEFORE the loader exists and must fail to
 *   resolve the import (module-not-found or type errors).
 * GREEN phase: after spec-cell-mapping.ts is created, all assertions pass.
 */

import { describe, it, expect } from "vitest";
import { parseSpecCellMapping } from "./spec-cell-mapping.js";
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

    const mapping = parseSpecCellMapping(JSON.stringify(raw));

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
    expect(() => parseSpecCellMapping("{not valid json")).toThrow();
  });

  it("throws when top-level value is not an object", () => {
    expect(() => parseSpecCellMapping(JSON.stringify([1, 2, 3]))).toThrow(
      /SpecCellMapping/,
    );
  });

  it("throws when a slug's value is not an object", () => {
    const bad = { "langgraph-python": "not-an-object" };
    expect(() => parseSpecCellMapping(JSON.stringify(bad))).toThrow(
      /SpecCellMapping/,
    );
  });

  it("throws when a spec path's cell list is not an array", () => {
    const bad = {
      "langgraph-python": {
        "tests/e2e/agentic-chat.spec.ts": "agentic-chat",
      },
    };
    expect(() => parseSpecCellMapping(JSON.stringify(bad))).toThrow(
      /SpecCellMapping/,
    );
  });

  it("throws when a cell list contains a non-string entry", () => {
    const bad = {
      "langgraph-python": {
        "tests/e2e/agentic-chat.spec.ts": [42],
      },
    };
    expect(() => parseSpecCellMapping(JSON.stringify(bad))).toThrow(
      /SpecCellMapping/,
    );
  });

  it("accepts an empty mapping (no slugs mapped yet)", () => {
    const mapping = parseSpecCellMapping(JSON.stringify({}));
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it("accepts a slug with no spec paths yet (empty inner object)", () => {
    const raw = { "langgraph-python": {} };
    const mapping = parseSpecCellMapping(JSON.stringify(raw));
    expect(mapping["langgraph-python"]).toEqual({});
  });

  it("type-checks: SpecCellMapping is assignable without cast", () => {
    const mapping: SpecCellMapping = parseSpecCellMapping(
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
    // Seeded defect proof: if parseSpecCellMapping iterated prototype-chain keys
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
    const mapping = parseSpecCellMapping(crafted);

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
      parseSpecCellMapping('{"__proto__": {"a.spec.ts": ["agentic-chat"]}}'),
    ).toThrow(/dangerous key|__proto__|SpecCellMapping/i);
  });

  it("throws when a top-level slug key is 'constructor'", () => {
    expect(() =>
      parseSpecCellMapping('{"constructor": {"a.spec.ts": ["agentic-chat"]}}'),
    ).toThrow(/dangerous key|constructor|SpecCellMapping/i);
  });

  it("throws when a top-level slug key is 'prototype'", () => {
    expect(() =>
      parseSpecCellMapping('{"prototype": {"a.spec.ts": ["agentic-chat"]}}'),
    ).toThrow(/dangerous key|prototype|SpecCellMapping/i);
  });

  it("throws when an inner spec-path key is '__proto__'", () => {
    // __proto__ nested inside a slug value must also be rejected.
    expect(() =>
      parseSpecCellMapping('{"slug-a": {"__proto__": ["agentic-chat"]}}'),
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
      parseSpecCellMapping('{"__proto__": {"a.spec.ts": ["agentic-chat"]}}'),
    ).toThrow();
    expect(() =>
      parseSpecCellMapping('{"slug-a": {"__proto__": ["agentic-chat"]}}'),
    ).toThrow();

    // Payload: JSON string with literal "__proto__" as a cell value inside an array.
    // This is valid shape (string value, not a key) — must be stored as own data only.
    const p3 = parseSpecCellMapping('{"slug-a": {"a.spec.ts": ["__proto__"]}}');
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
    expect(() => parseSpecCellMapping(JSON.stringify(bad))).toThrow(
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
    expect(() => parseSpecCellMapping(JSON.stringify(bad))).toThrow(
      /duplicate.*cell|SpecCellMapping/i,
    );
  });
});

// ── resolver: loadSpecCellMapping(slug, deps) ────────────────────────────────
//
// The resolver computes  base ⊕ override(slug) ⊖ auto-omit(slug)  restricted to
// the slug's on-disk specs. All dependencies are injected (present-specs lister,
// base map, delta map, merged skip-list) so it is unit-testable without disk.

import {
  loadSpecCellMapping,
  type ResolveDeps,
} from "./spec-cell-mapping.js";
import type { D5FeatureType } from "./d5-registry.js";

describe("loadSpecCellMapping(slug, deps) resolver", () => {
  /** Build a ResolveDeps with sensible empty defaults, overridable per test. */
  function deps(over: Partial<ResolveDeps> = {}): ResolveDeps {
    return {
      base: {},
      delta: {},
      listPresentSpecs: () => [],
      mergedSkipList: () => new Set<string>(),
      ...over,
    };
  }

  it("(1) base pass-through: present specs mapped by base", () => {
    const resolved = loadSpecCellMapping(
      "slug",
      deps({
        base: {
          "a2ui-recovery": ["a2ui-recovery"] as D5FeatureType[],
          "agentic-chat": ["agentic-chat"] as D5FeatureType[],
        },
        listPresentSpecs: () => [
          "tests/e2e/a2ui-recovery.spec.ts",
          "tests/e2e/agentic-chat.spec.ts",
        ],
      }),
    );
    expect(resolved).toEqual({
      "tests/e2e/a2ui-recovery.spec.ts": ["a2ui-recovery"],
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
  });

  it("(2) on-disk restriction: base cell absent when spec not present", () => {
    const resolved = loadSpecCellMapping(
      "slug",
      deps({
        base: {
          hitl: ["hitl-text-input"] as D5FeatureType[],
          "agentic-chat": ["agentic-chat"] as D5FeatureType[],
        },
        // hitl.spec.ts is NOT present on disk for this slug
        listPresentSpecs: () => ["tests/e2e/agentic-chat.spec.ts"],
      }),
    );
    expect(Object.keys(resolved)).toEqual(["tests/e2e/agentic-chat.spec.ts"]);
    expect(resolved["tests/e2e/hitl.spec.ts"]).toBeUndefined();
  });

  it("(3) auto-omit: present + in base but cell in merged skip-list is dropped", () => {
    const resolved = loadSpecCellMapping(
      "slug",
      deps({
        base: {
          "gen-ui-interrupt": ["gen-ui-interrupt"] as D5FeatureType[],
          "agentic-chat": ["agentic-chat"] as D5FeatureType[],
        },
        listPresentSpecs: () => [
          "tests/e2e/gen-ui-interrupt.spec.ts",
          "tests/e2e/agentic-chat.spec.ts",
        ],
        mergedSkipList: () => new Set<string>(["gen-ui-interrupt"]),
      }),
    );
    expect(Object.keys(resolved)).toEqual(["tests/e2e/agentic-chat.spec.ts"]);
  });

  it("(4) unmapped WARN: present spec with no base cell + no override calls onUnmapped once, absent from resolved", () => {
    const warned: Array<[string, string]> = [];
    const resolved = loadSpecCellMapping(
      "slug",
      deps({
        base: { "agentic-chat": ["agentic-chat"] as D5FeatureType[] },
        listPresentSpecs: () => [
          "tests/e2e/agentic-chat.spec.ts",
          "tests/e2e/agentic-chat-reasoning.spec.ts",
        ],
        onUnmapped: (slug, rel) => warned.push([slug, rel]),
      }),
    );
    expect(warned).toEqual([["slug", "tests/e2e/agentic-chat-reasoning.spec.ts"]]);
    expect(resolved["tests/e2e/agentic-chat-reasoning.spec.ts"]).toBeUndefined();
    expect(Object.keys(resolved)).toEqual(["tests/e2e/agentic-chat.spec.ts"]);
  });

  it("(5) override supplies a missing cell (no base entry): resolved maps it, no WARN", () => {
    const warned: string[] = [];
    const resolved = loadSpecCellMapping(
      "slug",
      deps({
        base: {}, // shared-state-write has no base cell
        delta: {
          slug: {
            overrides: {
              "shared-state-write": {
                cells: ["shared-state-write"] as D5FeatureType[],
              },
            },
          },
        },
        listPresentSpecs: () => ["tests/e2e/shared-state-write.spec.ts"],
        onUnmapped: (_s, rel) => warned.push(rel),
      }),
    );
    expect(resolved).toEqual({
      "tests/e2e/shared-state-write.spec.ts": ["shared-state-write"],
    });
    expect(warned).toHaveLength(0);
  });

  it("(6) override force re-maps a base-mapped stem to a different cell", () => {
    const resolved = loadSpecCellMapping(
      "slug",
      deps({
        base: { "some-stem": ["agentic-chat"] as D5FeatureType[] },
        delta: {
          slug: {
            overrides: {
              "some-stem": { cells: ["auth"] as D5FeatureType[], force: true },
            },
          },
        },
        listPresentSpecs: () => ["tests/e2e/some-stem.spec.ts"],
      }),
    );
    expect(resolved).toEqual({ "tests/e2e/some-stem.spec.ts": ["auth"] });
  });

  it("(7) explicit omit escape hatch drops a stem even when partially skipped", () => {
    const resolved = loadSpecCellMapping(
      "slug",
      deps({
        base: {
          "multi-cell": ["agentic-chat", "auth"] as D5FeatureType[],
          "agentic-chat": ["agentic-chat"] as D5FeatureType[],
        },
        delta: { slug: { omit: ["multi-cell"] } },
        listPresentSpecs: () => [
          "tests/e2e/multi-cell.spec.ts",
          "tests/e2e/agentic-chat.spec.ts",
        ],
        // only ONE of multi-cell's two cells is skipped → auto-omit would NOT
        // drop it, so the explicit omit is what removes it.
        mergedSkipList: () => new Set<string>(["auth"]),
      }),
    );
    expect(Object.keys(resolved)).toEqual(["tests/e2e/agentic-chat.spec.ts"]);
  });

  it("(8) non-empty guarantee: any present mapped non-quarantined stem yields non-empty resolved", () => {
    const resolved = loadSpecCellMapping(
      "slug",
      deps({
        base: { "agentic-chat": ["agentic-chat"] as D5FeatureType[] },
        listPresentSpecs: () => ["tests/e2e/agentic-chat.spec.ts"],
      }),
    );
    expect(Object.keys(resolved).length).toBeGreaterThan(0);
  });
});

// ── Task 7: claude-sdk-python shared-state-write stem alias (via committed delta) ─
//
// claude-sdk-python's on-disk stem `shared-state-write` has NO REGISTRY_TO_D5
// key, but the cell it SHOULD feed (`shared-state-write`) already exists via
// REGISTRY_TO_D5["shared-state-read-write"]. The committed spec-cell-delta.json
// aliases the stem onto that EXISTING cell (not a new cell). Resolving
// claude-sdk-python with the REAL committed base + delta must map the stem and
// emit NO unmapped-onDisk-spec WARN.

import { readFileSync } from "node:fs";
import { fileURLToPath as _fileURLToPath } from "node:url";
import { dirname as _dirname, join as _join } from "node:path";

describe("claude-sdk-python shared-state-write alias (committed base+delta)", () => {
  const HELPERS = _dirname(_fileURLToPath(import.meta.url));
  const base = JSON.parse(
    readFileSync(_join(HELPERS, "spec-cell-mapping.base.json"), "utf-8"),
  ) as Record<string, D5FeatureType[]>;
  const delta = JSON.parse(
    readFileSync(_join(HELPERS, "spec-cell-delta.json"), "utf-8"),
  );

  it("maps shared-state-write.spec.ts to cell shared-state-write with NO unmapped WARN", () => {
    const warned: string[] = [];
    const resolved = loadSpecCellMapping("claude-sdk-python", {
      base,
      delta,
      listPresentSpecs: () => ["tests/e2e/shared-state-write.spec.ts"],
      mergedSkipList: () => new Set<string>(),
      onUnmapped: (_s, rel) => warned.push(rel),
    });

    expect(resolved["tests/e2e/shared-state-write.spec.ts"]).toEqual([
      "shared-state-write",
    ]);
    expect(warned).toHaveLength(0);
  });
});
