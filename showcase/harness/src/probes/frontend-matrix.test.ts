import { describe, expect, it } from "vitest";

import backendCatalog from "../../../shell/src/data/catalog.json";
import frontendCatalog from "../../../shell/src/data/frontend-catalog.json";
import frontendRegistry from "../../../shell/src/data/frontend-registry.json";
import {
  buildFrontendMatrix,
  shardFrontendMatrix,
  urlForFrontendCell,
} from "./frontend-matrix.js";

describe("frontend showcase matrix", () => {
  it("plans every source-supported wired intersection without loss or duplication", () => {
    const matrix = buildFrontendMatrix(frontendCatalog);
    const ids = matrix.map((cell) => cell.id);
    const featureSupport = frontendRegistry.feature_support as Record<
      string,
      Record<string, { state: string } | undefined>
    >;
    const expectedIds = frontendRegistry.frontends
      .filter((frontend) => frontend.runnable)
      .flatMap((frontend) =>
        backendCatalog.cells.flatMap((cell) => {
          if (cell.feature === null || cell.status !== "wired") return [];
          const declaration = featureSupport[cell.feature]?.[frontend.id];
          return declaration?.state === "supported"
            ? [`${frontend.id}/${cell.id}`]
            : [];
        }),
      )
      .sort();

    expect(matrix).toHaveLength(frontendCatalog.metadata.runnable);
    expect(new Set(ids).size).toBe(ids.length);
    const runnableCatalogCells = frontendCatalog.cells.filter(
      (cell) => cell.runnable,
    );
    for (const frontend of frontendRegistry.frontends.filter(
      (candidate) => candidate.runnable,
    )) {
      expect(
        matrix.filter((cell) => cell.frontend === frontend.id),
      ).toHaveLength(
        runnableCatalogCells.filter((cell) => cell.frontend === frontend.id)
          .length,
      );
    }
    expect(ids).toEqual(expectedIds);
    expect(matrix.every((cell) => cell.featureTypes.length > 0)).toBe(true);
  });

  it("limits Vue to the source-derived runnable agentic-chat intersections", () => {
    const matrix = buildFrontendMatrix(frontendCatalog);
    const vueCells = matrix.filter((cell) => cell.frontend === "vue");
    const expectedIntegrations = backendCatalog.cells
      .filter(
        (cell) => cell.feature === "agentic-chat" && cell.status === "wired",
      )
      .map((cell) => cell.integration)
      .sort();

    expect(new Set(vueCells.map((cell) => cell.feature))).toEqual(
      new Set(["agentic-chat"]),
    );
    expect(vueCells.map((cell) => cell.integration).sort()).toEqual(
      expectedIntegrations,
    );
  });

  it("shards deterministically and keeps every cell exactly once", () => {
    const matrix = buildFrontendMatrix(frontendCatalog);
    const first = shardFrontendMatrix(matrix, 32);
    const second = shardFrontendMatrix(matrix, 32);
    const flattened = first.flat().map((cell) => cell.id);

    expect(second).toEqual(first);
    expect(first).toHaveLength(32);
    expect(Math.max(...first.map((shard) => shard.length))).toBeLessThanOrEqual(
      Math.min(...first.map((shard) => shard.length)) + 1,
    );
    expect(flattened.sort()).toEqual(matrix.map((cell) => cell.id).sort());
  });

  it("filters a baseline plan to one frontend and integration", () => {
    const matrix = buildFrontendMatrix(frontendCatalog, {
      frontends: ["react"],
      integrations: ["mastra"],
    });

    expect(matrix.length).toBeGreaterThan(0);
    expect(
      matrix.every(
        (cell) => cell.frontend === "react" && cell.integration === "mastra",
      ),
    ).toBe(true);
  });

  it("limits a proof plan to an explicit feature set", () => {
    const matrix = buildFrontendMatrix(frontendCatalog, {
      frontends: ["angular"],
      integrations: ["mastra"],
      features: ["agentic-chat", "frontend-tools"],
    });

    expect(matrix.map((cell) => cell.feature)).toEqual([
      "agentic-chat",
      "frontend-tools",
    ]);
  });

  it("builds exact React, canonical Angular, and canonical Vue routes", () => {
    const cell = {
      id: "angular/langgraph-python/frontend-tools",
      frontend: "angular" as const,
      integration: "langgraph-python",
      feature: "frontend-tools",
      featureTypes: ["frontend-tools" as const],
    };

    expect(
      urlForFrontendCell(cell, {
        angularBaseUrl: "http://127.0.0.1:4300/",
        integrationBaseUrl: "https://showcase-langgraph-python.example/",
      }),
    ).toBe("http://127.0.0.1:4300/angular/frontend-tools");
    expect(
      urlForFrontendCell(
        { ...cell, id: "react/x", frontend: "react" },
        {
          angularBaseUrl: "http://127.0.0.1:4300/",
          integrationBaseUrl: "https://showcase-langgraph-python.example/",
        },
      ),
    ).toBe("https://showcase-langgraph-python.example/demos/frontend-tools");
    expect(
      urlForFrontendCell(
        {
          ...cell,
          id: "vue/langgraph-python/agentic-chat",
          frontend: "vue",
          feature: "agentic-chat",
        },
        {
          angularBaseUrl: "http://127.0.0.1:4300/",
          integrationBaseUrl: "https://showcase-langgraph-python.example/",
        },
      ),
    ).toBe("https://showcase-langgraph-python.example/vue/agentic-chat");
  });

  it("fails closed when a runnable feature has no probe mapping", () => {
    expect(() =>
      buildFrontendMatrix({
        metadata: { ...frontendCatalog.metadata, runnable: 1 },
        cells: [
          {
            id: "angular/example/unmapped",
            frontend: "angular",
            integration: "example",
            feature: "unmapped",
            runnable: true,
          },
        ],
      }),
    ).toThrow(/unmapped.*no deterministic probe mapping/i);
  });
});
