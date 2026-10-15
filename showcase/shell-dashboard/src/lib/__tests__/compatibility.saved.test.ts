import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_SNAPSHOT,
  getCompatibilityPlatforms,
} from "../compatibility";
import { getIntegrations } from "../registry";

describe("saved compatibility assessments", () => {
  it("uses the supplied assessment rather than the bundled scores", () => {
    const row = COMPATIBILITY_SNAPSHOT.rows.find(
      (candidate) => candidate.slug === "agno",
    )!;
    const saved = {
      ...COMPATIBILITY_SNAPSHOT,
      rows: [{ ...row, currentScore: 100 }],
    };
    const platforms = getCompatibilityPlatforms(getIntegrations(), saved);
    expect(platforms).toHaveLength(1);
    expect(platforms[0].variants[0].assessment.currentScore).toBe(100);
  });
});
