import { describe, expect, it } from "vitest";

import { scopeByIntegrationAndFeature } from "./frontend-matrix-ci.js";

describe("frontend matrix CI command", () => {
  it("scopes baseline cells and accepted failures to one proof job", () => {
    const cells = [
      { integration: "mastra", feature: "agentic-chat" },
      { integration: "mastra", feature: "frontend-tools" },
      { integration: "langgraph-python", feature: "agentic-chat" },
    ];

    expect(
      scopeByIntegrationAndFeature(cells, {
        integration: "mastra",
        features: ["agentic-chat"],
      }),
    ).toEqual([{ integration: "mastra", feature: "agentic-chat" }]);
  });
});
