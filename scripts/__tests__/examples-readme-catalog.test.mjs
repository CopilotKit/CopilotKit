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

function workflowTriggerPaths(eventName) {
  const eventSection = publicExamplesWorkflow.match(
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

  return Array.from(
    pathsSection[1].matchAll(/^      - "([^"]+)"$/gm),
    (match) => match[1],
  );
}

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
  assert.equal(researcherLink[1], "examples/canvas/research-canvas/agents");
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
  const expectedDirectories = new Map([
    ["form-filling", "examples/showcases/form-filling"],
    ["travel", "examples/showcases/travel"],
    ["research-canvas", "examples/canvas/research-canvas"],
    ["chat-with-your-data", "examples/showcases/chat-with-your-data"],
    ["state-machine", "examples/showcases/state-machine"],
  ]);

  for (const [example, directory] of expectedDirectories) {
    assert.match(
      publicExamplesWorkflow,
      new RegExp(`- example: ${example}\\n\\s+directory: ${directory}`),
    );
  }

  assert.match(
    publicExamplesWorkflow,
    /- name: Run example unit tests\n\s+working-directory: \$\{\{ matrix\.directory \}\}\n\s+run: pnpm test/,
  );
  assert.match(
    publicExamplesWorkflow,
    /- name: Set up uv for Travel tests\n\s+if: matrix\.example == 'travel'\n\s+uses: astral-sh\/setup-uv@[0-9a-f]{40}/,
  );
  assert.match(
    publicExamplesWorkflow,
    /- name: Run Travel agent tests\n\s+if: matrix\.example == 'travel'\n\s+working-directory: examples\/showcases\/travel\/agent\n\s+run: uv run --locked --with pytest==9\.1\.1 python -m pytest tests/,
  );
});

test("public example jobs run the Research Canvas TypeScript agent tests", () => {
  assert.match(
    publicExamplesWorkflow,
    /- name: Run Research Canvas TypeScript agent tests\n\s+if: matrix\.example == 'research-canvas'\n\s+working-directory: examples\/canvas\/research-canvas\n\s+run: pnpm exec vitest run agents\/typescript\/src\/\*\.test\.ts/,
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
