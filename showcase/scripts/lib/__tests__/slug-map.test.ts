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
    expect(SLUG_TO_EXAMPLES["crewai-flows"]).toBeUndefined();
    expect(SLUG_TO_EXAMPLES["agent-spec-langgraph"]).toBeUndefined();
    expect(SLUG_TO_EXAMPLES["mcp-apps"]).toBeUndefined();
  });

  it("is frozen at the top level (property assignment fails under strict mode)", () => {
    expect(Object.isFrozen(SLUG_TO_EXAMPLES)).toBe(true);
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

  it("is frozen — .set throws", () => {
    const m = SLUG_MAP as unknown as Map<string, string>;
    expect(() => m.set("bad", "mutation")).toThrow();
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

  it("is frozen at the top level", () => {
    expect(Object.isFrozen(FALLBACK_MAP)).toBe(true);
  });
});
