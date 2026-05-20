import { describe, it, expect } from "vitest";
import {
  type BaselineStatus,
  type BaselineTag,
  type BaselineCell,
  STATUSES,
  TAGS,
  INDIVIDUAL_TAGS,
  TAG_BADGE_CONFIG,
  STATUS_CONFIG,
  FEATURE_CATEGORIES,
  BASELINE_PARTNERS,
  validateCell,
} from "../baseline-types";

/* ------------------------------------------------------------------ */
/*  validateCell                                                       */
/* ------------------------------------------------------------------ */
describe("validateCell", () => {
  function cell(
    status: BaselineStatus,
    tags: BaselineTag[] = [],
    overrides: Partial<BaselineCell> = {},
  ): BaselineCell {
    return {
      id: "test-id",
      key: "test-key",
      partner: "langchain-python",
      feature: "beautiful-chat",
      status,
      tags,
      updated_at: "2026-05-01T00:00:00Z",
      updated_by: "tester",
      ...overrides,
    };
  }

  it("works + empty tags = valid", () => {
    expect(validateCell(cell("works"))).toBe(true);
  });

  it("possible + tags = valid", () => {
    expect(validateCell(cell("possible", ["cpk"]))).toBe(true);
  });

  it("works + tags = invalid", () => {
    expect(validateCell(cell("works", ["cpk"]))).toBe(false);
  });

  it("possible + empty tags = invalid", () => {
    expect(validateCell(cell("possible"))).toBe(false);
  });

  it("impossible + tags = invalid", () => {
    expect(validateCell(cell("impossible", ["int"]))).toBe(false);
  });

  it("possible + all tag = valid", () => {
    expect(validateCell(cell("possible", ["all"]))).toBe(true);
  });

  it("unknown + empty tags = valid", () => {
    expect(validateCell(cell("unknown"))).toBe(true);
  });

  it("unknown + tags = invalid", () => {
    expect(validateCell(cell("unknown", ["docs"]))).toBe(false);
  });

  it("impossible + empty tags = valid", () => {
    expect(validateCell(cell("impossible"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  TAG_BADGE_CONFIG                                                   */
/* ------------------------------------------------------------------ */
describe("TAG_BADGE_CONFIG", () => {
  it("has entries for all tags", () => {
    for (const tag of TAGS) {
      expect(TAG_BADGE_CONFIG).toHaveProperty(tag);
      const entry = TAG_BADGE_CONFIG[tag];
      expect(entry).toHaveProperty("label");
      expect(entry).toHaveProperty("color");
      expect(entry).toHaveProperty("bgColor");
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.color).toBe("string");
      expect(typeof entry.bgColor).toBe("string");
    }
  });

  it("has no extra entries beyond known tags", () => {
    const keys = Object.keys(TAG_BADGE_CONFIG);
    expect(keys.sort()).toEqual([...TAGS].sort());
  });
});

/* ------------------------------------------------------------------ */
/*  STATUS_CONFIG                                                      */
/* ------------------------------------------------------------------ */
describe("STATUS_CONFIG", () => {
  it("has entries for all statuses", () => {
    for (const status of STATUSES) {
      expect(STATUS_CONFIG).toHaveProperty(status);
      const entry = STATUS_CONFIG[status];
      expect(entry).toHaveProperty("emoji");
      expect(entry).toHaveProperty("color");
      expect(entry).toHaveProperty("bgColor");
    }
  });
});

/* ------------------------------------------------------------------ */
/*  FEATURE_CATEGORIES                                                 */
/* ------------------------------------------------------------------ */
describe("FEATURE_CATEGORIES", () => {
  it("contains exactly 33 features across all categories", () => {
    const all = Object.values(FEATURE_CATEGORIES).flat();
    expect(all).toHaveLength(33);
  });

  it("has no duplicate features across categories", () => {
    const all = Object.values(FEATURE_CATEGORIES).flat();
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });

  // Updated: FEATURE_CATEGORIES expanded from 5 to 9 to match Coverage tab structure
  it("has exactly 9 categories", () => {
    expect(Object.keys(FEATURE_CATEGORIES)).toHaveLength(9);
  });

  it("contains expected category names", () => {
    const names = Object.keys(FEATURE_CATEGORIES);
    expect(names).toContain("Chat & UI");
    expect(names).toContain("Controlled Generative UI");
    expect(names).toContain("Declarative Generative UI");
    expect(names).toContain("Open-Ended Generative UI");
    expect(names).toContain("Operational Generative UI");
    expect(names).toContain("Interactivity");
    expect(names).toContain("Agent State");
    expect(names).toContain("Multi-Agent");
    expect(names).toContain("BYOC");
  });
});

/* ------------------------------------------------------------------ */
/*  BASELINE_PARTNERS                                                  */
/* ------------------------------------------------------------------ */
describe("BASELINE_PARTNERS", () => {
  it("has exactly 25 partners", () => {
    expect(BASELINE_PARTNERS).toHaveLength(25);
  });

  it("each partner has name and slug", () => {
    for (const p of BASELINE_PARTNERS) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.slug).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.slug.length).toBeGreaterThan(0);
    }
  });

  it("slugs are unique", () => {
    const slugs = BASELINE_PARTNERS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
describe("INDIVIDUAL_TAGS", () => {
  it("equals TAGS minus 'all'", () => {
    expect(INDIVIDUAL_TAGS).toEqual(TAGS.filter((t) => t !== "all"));
    expect(INDIVIDUAL_TAGS).not.toContain("all");
  });
});
