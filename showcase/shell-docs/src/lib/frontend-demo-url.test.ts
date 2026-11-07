import { describe, expect, it } from "vitest";

import { resolveFrontendDemoUrl } from "./frontend-demo-url";
import type { FrontendDemoCell } from "./frontend-demo-url";

const cells: FrontendDemoCell[] = [
  {
    frontend: "react",
    integration: "mastra",
    feature: "agentic-chat",
    demo_route: "/demos/agentic-chat",
    runnable: true,
  },
  {
    frontend: "angular",
    integration: "mastra",
    feature: "agentic-chat",
    demo_route: "/angular/agentic-chat",
    runnable: true,
  },
  {
    frontend: "vue",
    integration: "mastra",
    feature: "agentic-chat",
    demo_route: "/vue/agentic-chat",
    runnable: true,
  },
  {
    frontend: "vue",
    integration: "mastra",
    feature: "unsupported-feature",
    demo_route: "/vue/unsupported-feature",
    runnable: false,
  },
];

describe("resolveFrontendDemoUrl", () => {
  it.each([
    ["react", "/demos/agentic-chat"],
    ["angular", "/angular/agentic-chat"],
    ["vue", "/vue/agentic-chat"],
  ])("uses the %s catalog route", (frontend, route) => {
    expect(
      resolveFrontendDemoUrl({
        frontend,
        integration: "mastra",
        feature: "agentic-chat",
        backendUrl: "https://mastra.example/",
        catalogCells: cells,
      }),
    ).toMatchObject({
      kind: "catalog",
      url: `https://mastra.example${route}`,
    });
  });

  it("returns an explicit unsupported result for a non-runnable cell", () => {
    expect(
      resolveFrontendDemoUrl({
        frontend: "vue",
        integration: "mastra",
        feature: "unsupported-feature",
        backendUrl: "https://mastra.example",
        catalogCells: cells,
      }),
    ).toMatchObject({ kind: "unsupported" });
  });

  it("keeps the legacy backend route when no frontend cell exists", () => {
    expect(
      resolveFrontendDemoUrl({
        frontend: "vue",
        integration: "mastra",
        feature: "authored-feature",
        backendUrl: "https://mastra.example/",
        catalogCells: cells,
      }),
    ).toEqual({
      kind: "fallback",
      url: "https://mastra.example/demos/authored-feature",
    });
  });
});
