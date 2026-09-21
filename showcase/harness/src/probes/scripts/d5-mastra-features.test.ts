import { UnverifiedDefinitionError } from "../helpers/conversation-runner.js";
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
  it.each([
    ["background-agents", buildBackgroundAgentsTurns],
    ["observational-memory", buildObservationalMemoryTurns],
    ["browser-use-smoke", buildBrowserUseTurns],
  ] as const)(
    "rejects %s without a canonical LGP control",
    (_feature, build) => {
      expect(() => build(context)).toThrow(UnverifiedDefinitionError);
    },
  );

  it.each([
    ["background-agents", "/demos/background-agents"],
    ["observational-memory", "/demos/observational-memory"],
    ["browser-use-smoke", "/demos/browser-use"],
  ] as const)("routes %s to %s", (featureType, route) => {
    expect(preNavigateMastraRoute(featureType)).toBe(route);
  });
});
