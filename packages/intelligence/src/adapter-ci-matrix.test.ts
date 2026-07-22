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

interface MatrixCell {
  adapter: (typeof adapters)[number];
  boundary: (typeof boundaries)[number];
  language: "python" | "typescript" | "dotnet";
  runtimeVersion: string;
  nodeVersion: string;
  adapterRoot: string;
  nxProject: string;
  frameworkRequirements: string[];
}

interface AdapterCiMatrix {
  schemaVersion: number;
  cells: MatrixCell[];
}

const expectedCells: MatrixCell[] = [
  {
    adapter: "adk-python",
    boundary: "minimum",
    language: "python",
    runtimeVersion: "3.10",
    nodeVersion: "22",
    adapterRoot: "sdk-python-adk",
    nxProject: "@copilotkit/intelligence-adk",
    frameworkRequirements: ["google-adk==2.0.0"],
  },
  {
    adapter: "adk-python",
    boundary: "latest",
    language: "python",
    runtimeVersion: "3.10",
    nodeVersion: "22",
    adapterRoot: "sdk-python-adk",
    nxProject: "@copilotkit/intelligence-adk",
    frameworkRequirements: ["google-adk>=2.0.0,<3.0.0"],
  },
  {
    adapter: "langgraph-python",
    boundary: "minimum",
    language: "python",
    runtimeVersion: "3.10",
    nodeVersion: "22",
    adapterRoot: "sdk-python-langgraph",
    nxProject: "@copilotkit/intelligence-langgraph-python",
    frameworkRequirements: ["langgraph==1.2.2", "langchain==1.3.2"],
  },
  {
    adapter: "langgraph-python",
    boundary: "latest",
    language: "python",
    runtimeVersion: "3.10",
    nodeVersion: "22",
    adapterRoot: "sdk-python-langgraph",
    nxProject: "@copilotkit/intelligence-langgraph-python",
    frameworkRequirements: [
      "langgraph>=1.2.2,<2.0.0",
      "langchain>=1.3.2,<2.0.0",
    ],
  },
  {
    adapter: "langgraph-typescript",
    boundary: "minimum",
    language: "typescript",
    runtimeVersion: "20",
    nodeVersion: "20",
    adapterRoot: "packages/intelligence-langgraph",
    nxProject: "@copilotkit/intelligence-langgraph",
    frameworkRequirements: ["@langchain/langgraph@1.3.0", "langchain@1.4.4"],
  },
  {
    adapter: "langgraph-typescript",
    boundary: "latest",
    language: "typescript",
    runtimeVersion: "22",
    nodeVersion: "22",
    adapterRoot: "packages/intelligence-langgraph",
    nxProject: "@copilotkit/intelligence-langgraph",
    frameworkRequirements: [
      "@langchain/langgraph@>=1.3.0 <2.0.0",
      "langchain@>=1.4.4 <2.0.0",
    ],
  },
  {
    adapter: "agent-framework-python",
    boundary: "minimum",
    language: "python",
    runtimeVersion: "3.10",
    nodeVersion: "22",
    adapterRoot: "sdk-python-agent-framework",
    nxProject: "@copilotkit/intelligence-agent-framework-python",
    frameworkRequirements: ["agent-framework-core==1.11.0"],
  },
  {
    adapter: "agent-framework-python",
    boundary: "latest",
    language: "python",
    runtimeVersion: "3.10",
    nodeVersion: "22",
    adapterRoot: "sdk-python-agent-framework",
    nxProject: "@copilotkit/intelligence-agent-framework-python",
    frameworkRequirements: ["agent-framework-core>=1.11.0,<2.0.0"],
  },
  {
    adapter: "agent-framework-dotnet",
    boundary: "minimum",
    language: "dotnet",
    runtimeVersion: "8.0.x",
    nodeVersion: "22",
    adapterRoot: "sdk-dotnet-agent-framework",
    nxProject: "@copilotkit/intelligence-agent-framework-dotnet",
    frameworkRequirements: ["Microsoft.Agents.AI.Abstractions@1.13.0"],
  },
  {
    adapter: "agent-framework-dotnet",
    boundary: "latest",
    language: "dotnet",
    runtimeVersion: "8.0.x",
    nodeVersion: "22",
    adapterRoot: "sdk-dotnet-agent-framework",
    nxProject: "@copilotkit/intelligence-agent-framework-dotnet",
    frameworkRequirements: ["Microsoft.Agents.AI.Abstractions@[1.13.0,2.0.0)"],
  },
];

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

    expect(matrix.cells).toEqual(expectedCells);

    expect(workflow).toContain(
      "jq -c '{include: .cells}' packages/intelligence/conformance/adapter-ci-matrix-v1.json",
    );
    expect(workflow).toContain(
      "matrix: ${{ fromJSON(needs.matrix.outputs.adapter_matrix) }}",
    );
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).not.toMatch(/adapter:\s*\[(?:.|\n)*?adk-python/);
  });

  test("smoke-tests both supported LangGraph Python public spellings", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain(
      "from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware, create_skill_registry_middleware",
    );
    expect(workflow).toContain(
      "assert createSkillRegistryMiddleware is create_skill_registry_middleware",
    );
    expect(workflow).not.toContain("create_skill_registry_before_model");
  });

  test.each([
    [
      "Install Python boundary",
      '"${ADAPTER_ROOT}/.venv/bin/pip" freeze | tee dependency-versions.txt',
    ],
    [
      "Install TypeScript boundary",
      'pnpm --dir "${ADAPTER_ROOT}" list --depth 0 --json | tee dependency-versions.txt',
    ],
    [
      "Install .NET boundary",
      'dotnet list "${ADAPTER_ROOT}/CopilotKit.Intelligence.AgentFramework.Tests/CopilotKit.Intelligence.AgentFramework.Tests.csproj" package --include-transitive | tee -a dependency-versions.txt',
    ],
    [
      "Run Nx target and shared corpus runner",
      'pnpm nx run "${NX_PROJECT}:test" 2>&1 | tee adapter-test-report.txt',
    ],
  ])(
    "fails the %s step when its version evidence producer fails",
    (stepName, producer) => {
      const workflow = readFileSync(workflowPath, "utf8");
      const nextStepIndex = workflow.indexOf(
        "\n      - name:",
        workflow.indexOf(stepName),
      );
      const step = workflow.slice(
        workflow.indexOf(stepName),
        nextStepIndex === -1 ? undefined : nextStepIndex,
      );
      const pipefailIndex = step.indexOf("set -o pipefail");
      const producerIndex = step.indexOf(producer);

      expect(pipefailIndex).toBeGreaterThanOrEqual(0);
      expect(producerIndex).toBeGreaterThan(pipefailIndex);
    },
  );
});
