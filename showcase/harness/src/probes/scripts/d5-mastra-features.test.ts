import { describe, expect, it } from "vitest";

import {
  buildBackgroundAgentsTurns,
  buildBrowserUseTurns,
  buildObservationalMemoryTurns,
  preNavigateMastraRoute,
} from "./d5-mastra-features.js";

const context = {
  integrationSlug: "mastra",
  featureType: "background-agents" as const,
  baseUrl: "https://showcase.example",
};

describe("Mastra frontend probes", () => {
  it("probes the deterministic background-task activity surface", () => {
    const turns = buildBackgroundAgentsTurns(context);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.input).toBe(
      "Kick off deep research on the current landscape of AI agent frameworks.",
    );
    expect(turns[0]?.completeOnMount).toEqual({
      testIds: ["background-task-activity", "background-task-status"],
      minNewMounts: 2,
    });
  });

  it("uses the threshold-sized observational-memory prompt and activity surface", () => {
    const turns = buildObservationalMemoryTurns({
      ...context,
      featureType: "observational-memory",
    });

    expect(turns).toHaveLength(1);
    expect(turns[0]?.input).toContain("Northwind Insights");
    expect(turns[0]?.input.length).toBeGreaterThan(1_000);
    expect(turns[0]?.completeOnMount).toEqual({
      testIds: ["om-activity-card", "om-status-dot"],
      minNewMounts: 2,
    });
  });

  it("keeps Browser Use as a no-network hydration smoke", () => {
    expect(
      buildBrowserUseTurns({ ...context, featureType: "browser-use-smoke" }),
    ).toEqual([]);
  });

  it.each([
    ["background-agents", "/demos/background-agents"],
    ["observational-memory", "/demos/observational-memory"],
    ["browser-use-smoke", "/demos/browser-use"],
  ] as const)("routes %s to %s", (featureType, route) => {
    expect(preNavigateMastraRoute(featureType)).toBe(route);
  });
});
