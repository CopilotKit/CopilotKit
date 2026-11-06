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
const publicExamplesWorkflow = fs.readFileSync(
  path.join(repoRoot, ".github", "workflows", "test_e2e-public-examples.yml"),
  "utf8",
);

// Top-level sections count toward the README total. The dev subsections sit
// under `## Dev` and are counted on their own.
const categories = [
  { directory: "starters", heading: "Starters", level: 2 },
  { directory: "demos", heading: "Demos", level: 2 },
  { directory: "templates", heading: "Templates", level: 2 },
];
const devCategories = [
  { directory: "dev/by-frontend", heading: "By frontend", level: 3 },
  { directory: "dev/by-backend", heading: "By backend", level: 3 },
  { directory: "dev/by-feature", heading: "By feature", level: 3 },
];

function currentExampleNames(category) {
  return fs
    .readdirSync(path.join(examplesRoot, category), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function readmeCategory(category, heading, level) {
  const sectionPattern = new RegExp(
    `^${"#".repeat(level)} ${heading} \\((\\d+)\\)\\n([\\s\\S]*?)(?=^#{2,${level}} |(?![\\s\\S]))`,
    "m",
  );
  const section = readme.match(sectionPattern);
  assert.ok(section, `README is missing the ${heading} section and count`);

  const links = Array.from(
    section[2].matchAll(
      new RegExp(`\\(\\./${escapeRegExp(category)}/([^/]+)/\\)`, "g"),
    ),
    (match) => match[1],
  )
    .filter((name) => !name.startsWith("_"))
    .sort();

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

for (const { directory, heading, level } of [...categories, ...devCategories]) {
  test(`${heading} count and links match the current example directories`, () => {
    const expectedNames = currentExampleNames(directory);
    const documented = readmeCategory(directory, heading, level);

    assert.equal(documented.declaredCount, expectedNames.length);
    assert.deepEqual(documented.links, expectedNames);
  });
}

test("catalog total matches all current example directories", () => {
  const expectedTotal = categories.reduce(
    (total, { directory }) => total + currentExampleNames(directory).length,
    0,
  );
  const totalMatch = readme.match(/contains (\d+) examples/);

  assert.ok(totalMatch, "README is missing the example total");
  assert.equal(Number(totalMatch[1]), expectedTotal);
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
    "packages/sdk-js/**",
    "packages/shared/**",
    "packages/typescript-config/**",
    "packages/web-components/**",
    "packages/web-inspector/**",
  ];

  assert.deepEqual(workflowTriggerPaths("push"), expectedPaths);
  assert.deepEqual(workflowTriggerPaths("pull_request"), expectedPaths);
  assert.equal(expectedPaths.includes("packages/**"), false);
});

test("example jobs run the dev apps the e2e harness covers", () => {
  const examplesJob = publicExamplesJob();

  assert.deepEqual(publicExampleMatrix(), [
    {
      example: "react-demo",
      directory: "examples/dev/by-frontend/react/demo",
    },
  ]);
  assert.match(
    examplesJob,
    /- name: Run example unit tests\n\s+working-directory: \$\{\{ matrix\.directory \}\}\n\s+run: pnpm test/,
  );
  assert.match(
    examplesJob,
    /- name: Run e2e tests\n\s+working-directory: examples\/dev\/e2e\n/,
  );
});
