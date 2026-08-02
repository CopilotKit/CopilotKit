import { describe, it, expect } from "vitest";
import { getDoc, getDocsBySpace, KEEL_SPACES } from "./corpus";
import { searchCorpus } from "./search";

// The genuine knowledge query shared by spec §10 (pill "Contractor PHI access")
// and §11 beat 1. Its top hit must be POL-114 §contractor-access.
const CONTRACTOR_QUERY =
  "What's our policy on giving a contractor access to patient records?";

describe("searchCorpus", () => {
  it("returns POL-114 §contractor-access as the top hit for the demo query (§10/§11)", () => {
    const [top] = searchCorpus(CONTRACTOR_QUERY);
    expect(top).toBeDefined();
    expect(top.docId).toBe("phi-access-policy");
    expect(top.ref).toBe("POL-114");
    expect(top.sectionId).toBe("contractor-access");
    expect(top.heading).toBe("Contractor & Vendor Access");
  });

  it("returns [] for a nonsense query (below the score threshold)", () => {
    expect(searchCorpus("asdfghjkl qwertyuiop zxcvbnm")).toEqual([]);
  });

  it("is deterministic — repeated calls are byte-identical", () => {
    const a = searchCorpus(CONTRACTOR_QUERY);
    const b = searchCorpus(CONTRACTOR_QUERY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("honors the space filter", () => {
    const results = searchCorpus("how do we credential a physician", {
      space: "clinical",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("credentialing-standard");
    // Every hit resolves to a clinical document — nothing leaked past the filter.
    for (const hit of results) {
      expect(getDoc(hit.docId)?.space).toBe("clinical");
    }
  });

  it("bounds the snippet length to ~200 characters", () => {
    for (const hit of searchCorpus(CONTRACTOR_QUERY)) {
      expect(hit.snippet.length).toBeGreaterThan(0);
      expect(hit.snippet.length).toBeLessThanOrEqual(210);
    }
  });

  it("respects the default limit of 4", () => {
    expect(searchCorpus(CONTRACTOR_QUERY).length).toBeLessThanOrEqual(4);
  });
});

describe("corpus helpers", () => {
  it("ships nine documents across the three spaces", () => {
    expect(getDocsBySpace("privacy")).toHaveLength(3);
    expect(getDocsBySpace("clinical")).toHaveLength(3);
    expect(getDocsBySpace("vendor")).toHaveLength(3);
  });

  it("exposes the three spaces with labels", () => {
    expect(KEEL_SPACES.map((s) => s.id)).toEqual([
      "privacy",
      "clinical",
      "vendor",
    ]);
    for (const space of KEEL_SPACES) {
      expect(space.label.length).toBeGreaterThan(0);
      expect(space.description.length).toBeGreaterThan(0);
    }
  });

  it("resolves a known doc and returns undefined for an unknown id", () => {
    expect(getDoc("phi-access-policy")?.ref).toBe("POL-114");
    expect(getDoc("nope")).toBeUndefined();
  });
});
