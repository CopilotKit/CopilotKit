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
  it("has no dead entries — every target dir exists under showcase/packages/", () => {
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
  });

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

  it("every VALUE in SLUG_MAP names a real showcase/packages/<slug>/ dir", () => {
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
  });

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

describe("isShowcaseSlug runtime validator (S-R8-1)", () => {
  it("accepts a non-empty, kebab-cased-or-plain slug string", () => {
    expect(isShowcaseSlug("ag2")).toBe(true);
    expect(isShowcaseSlug("langgraph-typescript")).toBe(true);
    expect(isShowcaseSlug("ms-agent-framework-python")).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(isShowcaseSlug("")).toBe(false);
  });

  it("rejects non-string inputs via defensive typeof check", () => {
    // The function signature is (s: string) but it is used at API
    // boundaries where TS guarantees may not hold; cover the runtime guard
    // so a misuse at the seam does not silently admit garbage.
    expect(isShowcaseSlug(null as unknown as string)).toBe(false);
    expect(isShowcaseSlug(undefined as unknown as string)).toBe(false);
    expect(isShowcaseSlug(42 as unknown as string)).toBe(false);
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

describe("freezeSet / freezeMap override descriptors (S-R8-2)", () => {
  it("BORN_IN_SHOWCASE.add property descriptor is writable:false, configurable:false", () => {
    // Without writable:false / configurable:false the replacement can be
    // re-replaced: `Object.defineProperty(set, "add", { value: realAdd })`
    // would silently restore the mutating method. Lock the descriptor so
    // any re-defineProperty attempt throws in strict mode.
    const s = BORN_IN_SHOWCASE as unknown as Set<string>;
    const desc = Object.getOwnPropertyDescriptor(s, "add");
    expect(desc).toBeDefined();
    expect(desc!.writable).toBe(false);
    expect(desc!.configurable).toBe(false);
  });

  it("re-defining add on BORN_IN_SHOWCASE throws", () => {
    const s = BORN_IN_SHOWCASE as unknown as Set<string>;
    expect(() => {
      Object.defineProperty(s, "add", {
        value: (v: string) => s,
      });
    }).toThrow();
  });

  it("SLUG_MAP.set property descriptor is writable:false, configurable:false", () => {
    const m = SLUG_MAP as unknown as Map<string, string>;
    const desc = Object.getOwnPropertyDescriptor(m, "set");
    expect(desc).toBeDefined();
    expect(desc!.writable).toBe(false);
    expect(desc!.configurable).toBe(false);
  });

  it("re-defining set on SLUG_MAP throws", () => {
    const m = SLUG_MAP as unknown as Map<string, string>;
    expect(() => {
      Object.defineProperty(m, "set", {
        value: (k: string, v: string) => m,
      });
    }).toThrow();
  });
});

describe("SLUG_TO_EXAMPLES / FALLBACK_MAP / BORN_IN_SHOWCASE derive from one entries source (S-R8-3)", () => {
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
