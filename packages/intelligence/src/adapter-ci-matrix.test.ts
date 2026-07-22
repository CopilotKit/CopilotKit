import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const matrixPath = fileURLToPath(
  new URL("../conformance/adapter-ci-matrix-v1.json", import.meta.url),
);
const workflowPath = fileURLToPath(
  new URL(
    "../../../.github/workflows/test-intelligence-adapters.yml",
    import.meta.url,
  ),
);

const adapters = [
  "adk-python",
  "langgraph-python",
  "langgraph-typescript",
  "agent-framework-python",
  "agent-framework-dotnet",
] as const;
const boundaries = ["minimum", "latest"] as const;

const requirements = {
  "adk-python:minimum": ["google-adk==2.0.0"],
  "adk-python:latest": ["google-adk>=2.0.0,<3.0.0"],
  "langgraph-python:minimum": ["langgraph==1.2.2", "langchain==1.3.2"],
  "langgraph-python:latest": [
    "langgraph>=1.2.2,<2.0.0",
    "langchain>=1.3.2,<2.0.0",
  ],
  "langgraph-typescript:minimum": [
    "@langchain/langgraph@1.3.0",
    "langchain@1.4.4",
  ],
  "langgraph-typescript:latest": [
    "@langchain/langgraph@>=1.3.0 <2.0.0",
    "langchain@>=1.4.4 <2.0.0",
  ],
  "agent-framework-python:minimum": ["agent-framework-core==1.11.0"],
  "agent-framework-python:latest": ["agent-framework-core>=1.11.0,<2.0.0"],
  "agent-framework-dotnet:minimum": ["Microsoft.Agents.AI.Abstractions@1.13.0"],
  "agent-framework-dotnet:latest": [
    "Microsoft.Agents.AI.Abstractions@[1.13.0,2.0.0)",
  ],
} as const;

interface MatrixCell {
  adapter: (typeof adapters)[number];
  boundary: (typeof boundaries)[number];
  frameworkRequirements: string[];
}

interface AdapterCiMatrix {
  schemaVersion: number;
  cells: MatrixCell[];
}

describe("adapter CI matrix", () => {
  test("declares and consumes exactly ten minimum/latest cells", () => {
    const matrix = JSON.parse(
      readFileSync(matrixPath, "utf8"),
    ) as AdapterCiMatrix;
    const workflow = readFileSync(workflowPath, "utf8");
    const expectedCellIds = adapters.flatMap((adapter) =>
      boundaries.map((boundary) => `${adapter}:${boundary}`),
    );
    const actualCellIds = matrix.cells.map(
      ({ adapter, boundary }) => `${adapter}:${boundary}`,
    );

    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.cells).toHaveLength(10);
    expect(new Set(actualCellIds).size).toBe(10);
    expect([...actualCellIds].sort()).toEqual([...expectedCellIds].sort());

    for (const cell of matrix.cells) {
      const cellId = `${cell.adapter}:${cell.boundary}`;
      expect(cell.frameworkRequirements).toEqual(
        requirements[cellId as keyof typeof requirements],
      );
    }

    expect(workflow).toContain(
      "jq -c '{include: .cells}' packages/intelligence/conformance/adapter-ci-matrix-v1.json",
    );
    expect(workflow).toContain(
      "matrix: ${{ fromJSON(needs.matrix.outputs.adapter_matrix) }}",
    );
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).not.toMatch(/adapter:\s*\[(?:.|\n)*?adk-python/);
  });
});
