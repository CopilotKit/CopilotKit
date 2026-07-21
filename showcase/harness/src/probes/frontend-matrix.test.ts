import { describe, expect, it } from "vitest";

import frontendCatalog from "../../../shell/src/data/frontend-catalog.json";
import {
  buildFrontendMatrix,
  shardFrontendMatrix,
  urlForFrontendCell,
} from "./frontend-matrix.js";

describe("frontend showcase matrix", () => {
  it("plans every runnable catalog cell without loss or duplication", () => {
    const matrix = buildFrontendMatrix(frontendCatalog);
    const ids = matrix.map((cell) => cell.id);

    expect(matrix).toHaveLength(frontendCatalog.metadata.runnable);
    expect(new Set(ids).size).toBe(ids.length);
    expect(matrix.filter((cell) => cell.frontend === "react")).toHaveLength(
      650,
    );
    expect(matrix.filter((cell) => cell.frontend === "angular")).toHaveLength(
      638,
    );
    expect(matrix.every((cell) => cell.featureTypes.length > 0)).toBe(true);
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

  it("builds exact React and canonical Angular routes", () => {
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
        reactBaseUrl: "https://showcase-langgraph-python.example/",
      }),
    ).toBe("http://127.0.0.1:4300/langgraph-python/frontend-tools");
    expect(
      urlForFrontendCell(
        { ...cell, id: "react/x", frontend: "react" },
        {
          angularBaseUrl: "http://127.0.0.1:4300/",
          reactBaseUrl: "https://showcase-langgraph-python.example/",
        },
      ),
    ).toBe("https://showcase-langgraph-python.example/demos/frontend-tools");
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
