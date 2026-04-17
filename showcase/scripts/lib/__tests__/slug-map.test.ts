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
