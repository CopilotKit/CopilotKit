import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const examplesRoot = path.join(repoRoot, "examples");
const readme = fs.readFileSync(path.join(examplesRoot, "README.md"), "utf8");
const multiAgentCanvasReadme = fs.readFileSync(
  path.join(examplesRoot, "showcases", "multi-agent-canvas", "README.md"),
  "utf8",
);
const publicExamplesWorkflow = fs.readFileSync(
  path.join(repoRoot, ".github", "workflows", "test_e2e-public-examples.yml"),
  "utf8",
);
const chatWithYourDataPackage = JSON.parse(
  fs.readFileSync(
    path.join(examplesRoot, "v1", "chat-with-your-data", "package.json"),
    "utf8",
  ),
);
const researchAgentPackage = JSON.parse(
  fs.readFileSync(
    path.join(
      examplesRoot,
      "v1",
      "research-canvas",
      "agents",
      "typescript",
      "package.json",
    ),
    "utf8",
  ),
);
const researchCanvasPackage = JSON.parse(
  fs.readFileSync(
    path.join(examplesRoot, "v1", "research-canvas", "package.json"),
    "utf8",
  ),
);
const pnpmWorkspace = fs.readFileSync(
  path.join(repoRoot, "pnpm-workspace.yaml"),
  "utf8",
);

const categories = [
  { directory: "integrations", heading: "Integrations" },
  { directory: "canvas", heading: "Canvas" },
  { directory: "showcases", heading: "Showcases" },
];

function currentExampleNames(category) {
  return fs
    .readdirSync(path.join(examplesRoot, category), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

function readmeCategory(category, heading) {
  const sectionPattern = new RegExp(
    `^## ${heading} \\((\\d+)\\)\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
    "m",
  );
  const section = readme.match(sectionPattern);
  assert.ok(section, `README is missing the ${heading} section and count`);

  const links = Array.from(
    section[2].matchAll(new RegExp(`\\(\\./${category}/([^/]+)/\\)`, "g")),
    (match) => match[1],
  ).sort();

  return { declaredCount: Number(section[1]), links };
}

function workflowTriggerPaths(eventName, workflow = publicExamplesWorkflow) {
  const eventSection = workflow.match(
    new RegExp(
      `^  ${eventName}:\\n([\\s\\S]*?)(?=^  (?:push|pull_request|workflow_dispatch):|^env:)`,
      "m",
    ),
  );
  assert.ok(eventSection, `workflow is missing the ${eventName} trigger`);

  const pathsSection = eventSection[1].match(
    /^    paths:\n((?:      - .+\n?)+)/m,
  );
  assert.ok(pathsSection, `${eventName} trigger is missing its paths filter`);

  return pathsSection[1]
    .trimEnd()
    .split("\n")
    .map((line) => {
      const item = line.match(/^      - (?:"([^"]+)"|'([^']+)'|([^'"].*))$/);
      assert.ok(item, `unsupported path entry: ${line.trim()}`);
      return item[1] ?? item[2] ?? item[3].trim();
    });
}

test("workflow trigger paths reject an unparseable entry", () => {
  const workflow = `on:
  push:
    paths:
      - "examples/valid/**"
      - "examples/unterminated
env:
  TEST: true
`;

  assert.throws(() => workflowTriggerPaths("push", workflow), {
    name: "AssertionError",
    message: 'unsupported path entry: - "examples/unterminated',
  });
});

function publicExamplesJob() {
  const job = publicExamplesWorkflow.match(/^  examples:\n([\s\S]*)$/m);
  assert.ok(job, "workflow is missing the examples job");
  return job[1];
}

function publicExampleMatrix() {
  const matrix = publicExamplesJob().match(
    /^      matrix:\n        include:\n((?:          - example: [^\n]+\n            directory: [^\n]+\n?)+)/m,
  );
  assert.ok(matrix, "examples job is missing its matrix include rows");

  return Array.from(
    matrix[1].matchAll(
      /^          - example: ([^\n]+)\n            directory: ([^\n]+)$/gm,
    ),
    ([, example, directory]) => ({ example, directory }),
  );
}

test("workflow trigger parser reads all valid YAML path quoting styles", () => {
  const workflow = `on:
  push:
    paths:
      - "examples/**"
      - 'packages/**'
      - scripts/**
env:
`;

  assert.deepEqual(workflowTriggerPaths("push", workflow), [
    "examples/**",
    "packages/**",
    "scripts/**",
  ]);
});

test("chat-with-your-data declares the runner used by its test script", () => {
  assert.match(chatWithYourDataPackage.scripts.test, /\btsx\b/);
  assert.equal(typeof chatWithYourDataPackage.devDependencies.tsx, "string");
});

test("Research Canvas TypeScript agent is an installable workspace package", () => {
  assert.match(
    pnpmWorkspace,
    /^  - "examples\/v1\/research-canvas\/agents\/typescript"$/m,
  );
  assert.equal(
    researchAgentPackage.name,
    "@copilotkit-examples/research-canvas-agent",
  );
  assert.equal(researchAgentPackage.private, true);
  assert.equal(researchAgentPackage.scripts.test, "vitest run src/*.test.ts");
  assert.equal(typeof researchAgentPackage.devDependencies.vitest, "string");
  assert.equal(researchAgentPackage.packageManager, undefined);
  assert.equal(
    researchCanvasPackage.scripts["install:agent:ts"],
    "pnpm install --filter @copilotkit-examples/research-canvas-agent...",
  );
});

for (const { directory, heading } of categories) {
  test(`${heading} count and links match the current example directories`, () => {
    const expectedNames = currentExampleNames(directory);
    const documented = readmeCategory(directory, heading);

    assert.equal(documented.declaredCount, expectedNames.length);
    assert.deepEqual(documented.links, expectedNames);
  });
}

test("catalog total matches all current example directories", () => {
  const expectedTotal = categories.reduce(
    (total, { directory }) => total + currentExampleNames(directory).length,
    0,
  );
  const totalMatch = readme.match(
    /contains (\d+) consolidated demo repositories/,
  );

  assert.ok(totalMatch, "README is missing the consolidated example total");
  assert.equal(Number(totalMatch[1]), expectedTotal);
});

test("multi-agent canvas links to the canonical research canvas agents", () => {
  const researcherLink = multiAgentCanvasReadme.match(
    /\[CoAgents AI Researcher\]\(https:\/\/github\.com\/CopilotKit\/CopilotKit\/tree\/main\/([^)]+)\)/,
  );

  assert.ok(researcherLink, "README is missing the AI Researcher link");
  assert.equal(researcherLink[1], "examples/v1/research-canvas/agents");
  assert.equal(
    fs.statSync(path.join(repoRoot, researcherLink[1])).isDirectory(),
    true,
  );
});

test("multi-agent canvas expands MCP as Model Context Protocol", () => {
  assert.match(multiAgentCanvasReadme, /MCP \(Model Context Protocol\) Agent/);
  assert.doesNotMatch(multiAgentCanvasReadme, /Multi-Channel Protocol/);
});

test("catalog and example jobs check out the requested dispatch ref", () => {
  const catalogJob = publicExamplesWorkflow.match(
    /^  catalog:\n([\s\S]*?)(?=^  examples:\n)/m,
  );
  const examplesJob = publicExamplesWorkflow.match(/^  examples:\n([\s\S]*)$/m);
  const requestedRef = "ref: ${{ github.event.inputs.branch || github.ref }}";

  assert.ok(catalogJob, "workflow is missing the catalog job");
  assert.ok(examplesJob, "workflow is missing the examples job");
  assert.ok(catalogJob[1].includes(requestedRef));
  assert.ok(examplesJob[1].includes(requestedRef));
});

test("public example workflow watches its complete shared input set", () => {
  const expectedPaths = [
    "examples/**",
    "scripts/__tests__/examples-readme-catalog.test.mjs",
    "scripts/deprecations/v1-dist-notices.mjs",
    "scripts/project.json",
    ".github/workflows/test_e2e-public-examples.yml",
    ".browserslistrc",
    ".npmrc",
    ".pnpmfile.cjs",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "nx.json",
    "patches/**",
    "packages/a2ui-renderer/**",
    "packages/channels*/**",
    "packages/core/**",
    "packages/react-core/**",
    "packages/runtime/**",
    "packages/runtime-client-gql/**",
    "packages/sdk-js/**",
    "packages/shared/**",
    "packages/tsconfig/**",
    "packages/typescript-config/**",
    "packages/web-components/**",
    "packages/web-inspector/**",
  ];

  assert.deepEqual(workflowTriggerPaths("push"), expectedPaths);
  assert.deepEqual(workflowTriggerPaths("pull_request"), expectedPaths);
  assert.equal(expectedPaths.includes("packages/**"), false);
});

test("public example jobs run each app's unit tests and Travel's Python tests", () => {
  const expectedMatrix = [
    {
      example: "form-filling",
      directory: "examples/v1/form-filling",
    },
    { example: "travel", directory: "examples/v1/travel" },
    {
      example: "research-canvas",
      directory: "examples/v1/research-canvas",
    },
    {
      example: "chat-with-your-data",
      directory: "examples/v1/chat-with-your-data",
    },
    {
      example: "state-machine",
      directory: "examples/v1/state-machine",
    },
  ];
  const examplesJob = publicExamplesJob();

  assert.deepEqual(publicExampleMatrix(), expectedMatrix);

  assert.match(
    examplesJob,
    /- name: Run example unit tests\n\s+working-directory: \$\{\{ matrix\.directory \}\}\n\s+run: pnpm test/,
  );
  assert.match(
    examplesJob,
    /- name: Set up uv for Travel tests\n\s+if: matrix\.example == 'travel'\n\s+uses: astral-sh\/setup-uv@[0-9a-f]{40}/,
  );
  assert.match(
    examplesJob,
    /- name: Run Travel agent tests\n\s+if: matrix\.example == 'travel'\n\s+working-directory: examples\/v1\/travel\/agent\n\s+run: uv run --locked --with pytest==9\.1\.1 python -m pytest tests/,
  );
});

test("public example jobs run the Research Canvas TypeScript agent tests", () => {
  assert.match(
    publicExamplesWorkflow,
    /- name: Run Research Canvas TypeScript agent tests\n\s+if: matrix\.example == 'research-canvas'\n\s+run: pnpm nx test @copilotkit-examples\/research-canvas-agent --excludeTaskDependencies/,
  );
});

test("multi-agent canvas describes linked agents as monorepo directories", () => {
  assert.match(
    multiAgentCanvasReadme,
    /they live in separate directories in this repository/,
  );
  assert.doesNotMatch(multiAgentCanvasReadme, /separate repositories/);
});

test("multi-agent canvas creates env files at the app roots", () => {
  assert.doesNotMatch(multiAgentCanvasReadme, /example\.env/);
  assert.match(multiAgentCanvasReadme, /Create `frontend\/\.env`:/);
  assert.match(multiAgentCanvasReadme, /NEXT_PUBLIC_CPK_PUBLIC_API_KEY=\.\.\./);
  assert.match(multiAgentCanvasReadme, /Create `agent\/\.env`:/);
  assert.match(multiAgentCanvasReadme, /OPENAI_API_KEY=\.\.\./);
  assert.match(multiAgentCanvasReadme, /LANGSMITH_API_KEY=\.\.\./);
});
