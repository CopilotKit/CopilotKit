/**
 * Tests for showcase/scripts/lib/slug-map.ts.
 *
 * Pins the shared slug/examples mapping tables and the
 * born-in-showcase set so all three validators agree.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  BORN_IN_SHOWCASE,
  SLUG_MAP,
  SLUG_TO_EXAMPLES,
  FALLBACK_MAP,
  isShowcaseSlug,
  type ShowcaseSlug,
} from "../slug-map.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGES_DIR = path.resolve(__dirname, "..", "..", "..", "packages");

describe("BORN_IN_SHOWCASE", () => {
  it("contains the 5 known born-in-showcase slugs", () => {
    expect(BORN_IN_SHOWCASE.has("ag2")).toBe(true);
    expect(BORN_IN_SHOWCASE.has("claude-sdk-python")).toBe(true);
    expect(BORN_IN_SHOWCASE.has("claude-sdk-typescript")).toBe(true);
    expect(BORN_IN_SHOWCASE.has("langroid")).toBe(true);
    expect(BORN_IN_SHOWCASE.has("spring-ai")).toBe(true);
  });

  it("has exactly 5 entries — guards against accidental additions", () => {
    // Size assertion: if someone adds a new born-in-showcase slug without
    // updating the test above, this pins the cardinality so the addition
    // is caught rather than silently accepted.
    expect(BORN_IN_SHOWCASE.size).toBe(5);
  });

  it("is a frozen / immutable ReadonlySet (add throws)", () => {
    // Callers must not mutate the shared set at runtime. A ReadonlySet type
    // is compile-time only; we back it with a frozen Set so a runtime
    // `.add()` attempt throws in strict mode rather than silently diverging
    // from the other validator copies.
    const s = BORN_IN_SHOWCASE as unknown as Set<string>;
    expect(() => s.add("sneaky-mutation")).toThrow();
  });

  it("rejects .delete and .clear on the frozen set", () => {
    const s = BORN_IN_SHOWCASE as unknown as Set<string>;
    expect(() => s.delete("ag2")).toThrow();
    expect(() => s.clear()).toThrow();
  });
});

describe("SLUG_TO_EXAMPLES (showcase slug → examples dir names)", () => {
  // This test reads the live showcase/packages/ tree. In sparse
  // checkouts (CI shards, partial clones) the directory may be absent;
  // skip rather than false-fail when that happens.
  it.skipIf(!fs.existsSync(PACKAGES_DIR))(
    "has no dead entries — every target dir exists under showcase/packages/",
    () => {
      // Regression guard: the old audit.ts map contained crewai-flows,
      // agent-spec-langgraph, and mcp-apps which produced phantom "no
      // examples source" anomalies. Removing them here is the whole point of
      // the extraction.
      for (const slug of Object.keys(SLUG_TO_EXAMPLES)) {
        const pkgPath = path.join(PACKAGES_DIR, slug);
        expect(
          fs.existsSync(pkgPath),
          `SLUG_TO_EXAMPLES slug '${slug}' has no matching showcase/packages/${slug}/`,
        ).toBe(true);
      }
    },
  );

  it("does not include the three known dead entries", () => {
    expect(
      (SLUG_TO_EXAMPLES as Record<string, unknown>)["crewai-flows"],
    ).toBeUndefined();
    expect(
      (SLUG_TO_EXAMPLES as Record<string, unknown>)["agent-spec-langgraph"],
    ).toBeUndefined();
    expect(
      (SLUG_TO_EXAMPLES as Record<string, unknown>)["mcp-apps"],
    ).toBeUndefined();
  });

  it("rejects adding a new top-level key at runtime", () => {
    // Object.isFrozen is the weak form of this assertion: it only checks
    // a flag. An actual mutation attempt is the real invariant — strict
    // mode is active in ESM, so assignment on a frozen object throws.
    expect(() => {
      (SLUG_TO_EXAMPLES as unknown as Record<string, readonly string[]>)[
        "bogus-new-slug"
      ] = ["nothing"];
    }).toThrow();
  });

  it("rejects reassigning an existing top-level entry at runtime", () => {
    expect(() => {
      (SLUG_TO_EXAMPLES as unknown as Record<string, readonly string[]>)[
        "mastra"
      ] = ["replaced"];
    }).toThrow();
  });

  it("rejects mutating an inner array (element assignment throws)", () => {
    // freezeMap2D must freeze BOTH the outer record AND each inner array.
    // Without the inner freeze, `SLUG_TO_EXAMPLES.mastra[0] = "x"` would
    // silently succeed even though the outer Object.isFrozen reports true.
    expect(() => {
      (SLUG_TO_EXAMPLES.mastra as unknown as string[])[0] = "mutated";
    }).toThrow();
  });

  it("rejects .push on an inner array (all mutation methods fail)", () => {
    expect(() => {
      (SLUG_TO_EXAMPLES.mastra as unknown as string[]).push("extra");
    }).toThrow();
  });
});

describe("SLUG_MAP (examples dir → showcase slug)", () => {
  it("contains the known mapping for langgraph-js → langgraph-typescript", () => {
    // Sample entry inversely matched with SLUG_TO_EXAMPLES.
    expect(SLUG_MAP.get("langgraph-js")).toBe("langgraph-typescript");
  });

  it("inverse of SLUG_MAP covers a sample SLUG_TO_EXAMPLES entry", () => {
    // For a slug with a unique examples dir (not a fan-out like crewai-*),
    // the entries should be bidirectionally consistent.
    const exampleDirs = SLUG_TO_EXAMPLES["langgraph-typescript"];
    expect(exampleDirs).toBeDefined();
    for (const dir of exampleDirs!) {
      expect(SLUG_MAP.get(dir)).toBe("langgraph-typescript");
    }
  });

  // Reads the live showcase/packages/ tree — skip in sparse checkouts
  // where that directory is not materialized.
  it.skipIf(!fs.existsSync(PACKAGES_DIR))(
    "every VALUE in SLUG_MAP names a real showcase/packages/<slug>/ dir",
    () => {
      // Dead-entry guard: the old SLUG_MAP carried values like `crewai`,
      // `maf-dotnet`, `maf-python`, `aws-strands`, `agent-spec-langgraph`,
      // `a2a`, `mcp-apps`, `pydanticai` that did NOT exist under
      // showcase/packages/. Those broke validate-pins.ts's reverse lookup
      // and forced FALLBACK_MAP to re-express the corrections.
      for (const [, slug] of SLUG_MAP) {
        const pkgPath = path.join(PACKAGES_DIR, slug);
        expect(
          fs.existsSync(pkgPath),
          `SLUG_MAP value '${slug}' has no matching showcase/packages/${slug}/`,
        ).toBe(true);
      }
    },
  );

  it("is frozen — .set throws", () => {
    const m = SLUG_MAP as unknown as Map<string, string>;
    expect(() => m.set("bad", "mutation")).toThrow();
  });

  it("is frozen — .delete and .clear throw", () => {
    const m = SLUG_MAP as unknown as Map<string, string>;
    expect(() => m.delete("langgraph-js")).toThrow();
    expect(() => m.clear()).toThrow();
  });
});

describe("isShowcaseSlug runtime validator", () => {
  it("accepts a non-empty, kebab-cased-or-plain slug string", () => {
    expect(isShowcaseSlug("ag2")).toBe(true);
    expect(isShowcaseSlug("langgraph-typescript")).toBe(true);
    expect(isShowcaseSlug("ms-agent-framework-python")).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(isShowcaseSlug("")).toBe(false);
  });

  it("rejects non-string inputs via defensive typeof check", () => {
    // Signature widened from (s: string) to (s: unknown) so the guard
    // is a live validator at any API boundary. Pass the values directly
    // — no `as unknown as string` casts needed now that the parameter
    // type accepts unknown.
    expect(isShowcaseSlug(null)).toBe(false);
    expect(isShowcaseSlug(undefined)).toBe(false);
    expect(isShowcaseSlug(42)).toBe(false);
    expect(isShowcaseSlug({})).toBe(false);
    expect(isShowcaseSlug([])).toBe(false);
    expect(isShowcaseSlug(true)).toBe(false);
  });

  it("narrows its argument via a user-defined type predicate", () => {
    // isShowcaseSlug is declared `(s: unknown): s is ShowcaseSlug`, so
    // when it returns true the compiler narrows the caller's variable to
    // ShowcaseSlug. This test is primarily a compile-time assertion; a
    // runtime check backs it up.
    const candidate: unknown = "ag2";
    if (isShowcaseSlug(candidate)) {
      // Must be assignable to ShowcaseSlug without further casts.
      const s: ShowcaseSlug = candidate;
      expect(s).toBe("ag2");
    } else {
      throw new Error("expected 'ag2' to satisfy isShowcaseSlug");
    }
  });

  it("rejects slugs containing whitespace or path separators", () => {
    // These are the most likely garbage-input patterns at the boundary.
    expect(isShowcaseSlug("foo bar")).toBe(false);
    expect(isShowcaseSlug("foo/bar")).toBe(false);
    expect(isShowcaseSlug("foo\\bar")).toBe(false);
  });

  it("is applied at construction — every BORN_IN_SHOWCASE and SLUG_MAP slug satisfies it", () => {
    for (const s of BORN_IN_SHOWCASE) expect(isShowcaseSlug(s)).toBe(true);
    for (const [, slug] of SLUG_MAP) expect(isShowcaseSlug(slug)).toBe(true);
    for (const slug of Object.keys(SLUG_TO_EXAMPLES))
      expect(isShowcaseSlug(slug)).toBe(true);
    for (const slug of Object.keys(FALLBACK_MAP))
      expect(isShowcaseSlug(slug)).toBe(true);
  });
});

describe("freezeSet / freezeMap behavioral invariants", () => {
  it("BORN_IN_SHOWCASE rejects re-defining its mutation methods", () => {
    // Behavioral form of the old descriptor-bit check: the concrete
    // invariant is that a later caller cannot restore a working `.add`
    // by re-replacing the property. Assert that any re-defineProperty
    // attempt throws, rather than inspecting descriptor bits directly —
    // tests should pin observable behavior, not implementation shape.
    const s = BORN_IN_SHOWCASE as unknown as Set<string>;
    expect(() => {
      Object.defineProperty(s, "add", { value: (_v: string) => s });
    }).toThrow();
    expect(() => {
      Object.defineProperty(s, "delete", { value: (_v: string) => true });
    }).toThrow();
    expect(() => {
      Object.defineProperty(s, "clear", { value: () => undefined });
    }).toThrow();
  });

  it("SLUG_MAP rejects re-defining its mutation methods", () => {
    const m = SLUG_MAP as unknown as Map<string, string>;
    expect(() => {
      Object.defineProperty(m, "set", {
        value: (_k: string, _v: string) => m,
      });
    }).toThrow();
    expect(() => {
      Object.defineProperty(m, "delete", { value: (_k: string) => true });
    }).toThrow();
    expect(() => {
      Object.defineProperty(m, "clear", { value: () => undefined });
    }).toThrow();
  });
});

describe("SLUG_TO_EXAMPLES / FALLBACK_MAP / BORN_IN_SHOWCASE derive from one entries source", () => {
  it("every FALLBACK_MAP entry names a slug also present in SLUG_TO_EXAMPLES", () => {
    // Derivation invariant: both maps come from the same per-slug entry
    // (slug, examples dirs, optional fallback). A FALLBACK_MAP key with
    // no SLUG_TO_EXAMPLES counterpart would mean the two maps were edited
    // independently and fell out of sync.
    for (const slug of Object.keys(FALLBACK_MAP)) {
      expect(
        (SLUG_TO_EXAMPLES as Record<string, unknown>)[slug],
        `FALLBACK_MAP slug '${slug}' missing from SLUG_TO_EXAMPLES`,
      ).toBeDefined();
    }
  });

  it("FALLBACK_MAP target equals the first SLUG_TO_EXAMPLES candidate for the same slug", () => {
    // Both maps share the same underlying entry; the fallback is simply
    // the chosen preferred dir out of SLUG_TO_EXAMPLES[slug]. If someone
    // edits one side but not the other, the two maps will disagree.
    for (const [slug, target] of Object.entries(FALLBACK_MAP)) {
      const dirs = SLUG_TO_EXAMPLES[slug];
      expect(dirs).toBeDefined();
      expect(dirs![0]).toBe(target);
    }
  });

  it("BORN_IN_SHOWCASE and SLUG_TO_EXAMPLES are disjoint (no slug is both)", () => {
    // A born-in-showcase slug has no examples counterpart by definition;
    // putting it in SLUG_TO_EXAMPLES would contradict that. The derivation
    // pipeline enforces that an entry with `bornInShowcase: true` has NO
    // examples dirs, so the two outputs can never overlap.
    for (const slug of BORN_IN_SHOWCASE) {
      expect(
        (SLUG_TO_EXAMPLES as Record<string, unknown>)[slug],
        `'${slug}' is in both BORN_IN_SHOWCASE and SLUG_TO_EXAMPLES`,
      ).toBeUndefined();
    }
  });

  it("BORN_IN_SHOWCASE and FALLBACK_MAP are disjoint", () => {
    // Same pairing: born-in-showcase slugs have no examples dir, so a
    // FALLBACK_MAP target for one would be nonsensical.
    for (const slug of BORN_IN_SHOWCASE) {
      expect(
        (FALLBACK_MAP as Record<string, unknown>)[slug],
        `'${slug}' is in both BORN_IN_SHOWCASE and FALLBACK_MAP`,
      ).toBeUndefined();
    }
  });
});

describe("FALLBACK_MAP (documents SLUG_MAP staleness)", () => {
  it("contains the stale-mapping entries validate-pins.ts relied on", () => {
    expect(FALLBACK_MAP["crewai-crews"]).toBe("crewai-crews");
    expect(FALLBACK_MAP["ms-agent-dotnet"]).toBe("ms-agent-framework-dotnet");
    expect(FALLBACK_MAP["ms-agent-python"]).toBe("ms-agent-framework-python");
    expect(FALLBACK_MAP["pydantic-ai"]).toBe("pydantic-ai");
    expect(FALLBACK_MAP["strands"]).toBe("strands-python");
  });

  it("rejects runtime mutation", () => {
    expect(() => {
      (FALLBACK_MAP as unknown as Record<string, string>)["new-key"] = "bogus";
    }).toThrow();
    expect(() => {
      (FALLBACK_MAP as unknown as Record<string, string>)["strands"] = "other";
    }).toThrow();
  });
});
