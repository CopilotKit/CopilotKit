import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { scopeByIntegrationAndFeature } from "./frontend-matrix-ci.js";

describe("frontend matrix CI command", () => {
  it("describes every route served by the shared integration origin", async () => {
    const source = await readFile(
      new URL("./frontend-matrix-ci.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "branch-local origin that serves /demos/*, /angular/*, and /vue/*",
    );
  });

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
