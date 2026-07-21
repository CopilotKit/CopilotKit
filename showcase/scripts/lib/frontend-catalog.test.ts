import { expect, it } from "vitest";

import { generateFrontendCatalog } from "./frontend-catalog.js";
import type { BackendCatalogCell } from "./frontend-catalog.js";
import type { FrontendRegistry } from "./frontend-registry.js";

const frontendRegistry: FrontendRegistry = {
  version: "1.0.0",
  default_frontend: "react",
  frontends: [
    {
      id: "react",
      name: "React",
      icon: "react",
      summary: "React frontend.",
      runnable: true,
      feature_support_required: true,
    },
    {
      id: "angular",
      name: "Angular",
      icon: "angular",
      summary: "Angular frontend.",
      runnable: true,
      feature_support_required: true,
    },
  ],
  feature_support: {
    chat: {
      react: { state: "supported" },
      angular: { state: "supported" },
    },
    renderer: {
      react: { state: "supported" },
      angular: {
        state: "not-applicable",
        reason: "The renderer is React-specific.",
        owner: "Angular SDK maintainers",
        review_date: "2027-01-21",
      },
    },
    guide: {
      react: { state: "docs-only" },
      angular: { state: "docs-only" },
    },
  },
};

const backendCells: BackendCatalogCell[] = [
  {
    id: "langgraph/chat",
    integration: "langgraph",
    feature: "chat",
    status: "wired",
  },
  {
    id: "mastra/chat",
    integration: "mastra",
    feature: "chat",
    status: "unshipped",
  },
  {
    id: "langgraph/renderer",
    integration: "langgraph",
    feature: "renderer",
    status: "wired",
  },
  {
    id: "langgraph/guide",
    integration: "langgraph",
    feature: "guide",
    status: "stub",
  },
  {
    id: "starter/langgraph",
    integration: "langgraph",
    feature: null,
    status: "wired",
  },
];

it("marks only supported frontend and wired backend intersections runnable", () => {
  const catalog = generateFrontendCatalog(frontendRegistry, backendCells);

  expect(
    catalog.cells.find((cell) => cell.id === "angular/langgraph/chat"),
  ).toMatchObject({
    frontend: "angular",
    backend_status: "wired",
    frontend_status: "supported",
    runnable: true,
  });
  expect(
    catalog.cells.find((cell) => cell.id === "angular/mastra/chat"),
  ).toMatchObject({
    backend_status: "unshipped",
    frontend_status: "supported",
    runnable: false,
  });
});

it("preserves permanent exception metadata in non-runnable cells", () => {
  const catalog = generateFrontendCatalog(frontendRegistry, backendCells);

  expect(
    catalog.cells.find((cell) => cell.id === "angular/langgraph/renderer"),
  ).toMatchObject({
    frontend_status: "not-applicable",
    runnable: false,
    exception: {
      reason: "The renderer is React-specific.",
      owner: "Angular SDK maintainers",
      review_date: "2027-01-21",
    },
  });
});

it("excludes starter cells and reports deterministic support counts", () => {
  const catalog = generateFrontendCatalog(frontendRegistry, backendCells);

  expect(catalog.cells).toHaveLength(8);
  expect(catalog.metadata).toEqual({
    total_cells: 8,
    runnable: 3,
    docs_only: 2,
    not_supported: 0,
    not_applicable: 1,
    quarantined: 0,
    backend_unavailable: 2,
  });
});
