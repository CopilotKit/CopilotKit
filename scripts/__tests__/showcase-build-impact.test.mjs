import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { workflowRuntimeChanged } from "../showcase-build-impact.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(resolve(root, "showcase/scripts/package.json"));
const { parse } = require("yaml");
const nxRequire = createRequire(
  createRequire(import.meta.url).resolve("nx/package.json"),
);
const picomatch = nxRequire("picomatch");
const source = readFileSync(
  resolve(root, ".github/workflows/showcase_build.yml"),
  "utf8",
);
const workflow = parse(source);

function selected(jobId, files, workflowChanged = false, dispatch = "") {
  const job = workflow.jobs[jobId];
  const filter = parse(job.steps.find((s) => s.id === "filter").with.filters);
  const changes = Object.entries(filter)
    .filter(([, patterns]) =>
      patterns.some((pattern) =>
        files.some((file) => picomatch(pattern, { dot: true })(file)),
      ),
    )
    .map(([name]) => name);
  const step = job.steps.find((s) =>
    ["build-matrix", "starter-matrix"].includes(s.id),
  );
  const directory = mkdtempSync(resolve(tmpdir(), "build-impact-"));
  try {
    const output = resolve(directory, "output");
    const run = spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
      encoding: "utf8",
      cwd: root,
      env: {
        PATH: process.env.PATH,
        DISPATCH_SERVICE: dispatch,
        FILTER_CHANGES: JSON.stringify(changes),
        WORKFLOW_RUNTIME_CHANGED: String(workflowChanged),
        GITHUB_SHA_ENV: "a".repeat(40),
        GITHUB_REF_NAME_ENV: "main",
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal(run.status, 0, run.stderr);
    const matrix = readFileSync(output, "utf8")
      .split("\n")
      .find((s) => s.startsWith("matrix="));
    return JSON.parse(matrix.slice("matrix=".length));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const job of ["detect-changes", "detect-starter-changes"]) {
  test(`${job}: verifier-only merge selects no images, including the filter workflow edit`, () => {
    assert.deepEqual(
      selected(job, [
        "showcase/scripts/verify-prod-resweep.ts",
        "showcase/scripts/verify-prod-resweep.test.ts",
        "showcase/scripts/verify-prod-resweep-cli.test.ts",
        ".github/workflows/showcase_build.yml",
        "scripts/showcase-build-impact.mjs",
        "scripts/__tests__/showcase-build-impact.test.mjs",
      ]),
      [],
    );
  });
  test(`${job}: runtime workflow changes and manual all still rebuild every slot`, () => {
    assert.ok(selected(job, [], true).length > 10);
    assert.deepEqual(selected(job, [], true), selected(job, [], false, "all"));
  });
}

test("all other shared scripts, including subdirectories, retain five runtime consumers", () => {
  for (const file of [
    "showcase/scripts/generate-registry.ts",
    "showcase/scripts/verify-prod-resweep-helper.ts",
    "showcase/scripts/cli/_common.sh",
    "showcase/scripts/lib/registry.ts",
    "showcase/scripts/lib/verify-prod-resweep.ts",
  ]) {
    assert.deepEqual(
      selected("detect-changes", [file])
        .map((s) => s.dispatch_name)
        .sort(),
      [
        "shell",
        "shell-dashboard",
        "shell-docs",
        "shell-dojo",
        "showcase-harness",
      ].sort(),
    );
  }
});

test("manual single-service dispatch stays narrow even when the workflow changes", () => {
  assert.deepEqual(
    selected("detect-changes", [], true, "shell").map((s) => s.dispatch_name),
    ["shell"],
  );
  assert.deepEqual(selected("detect-starter-changes", [], true, "shell"), []);
  assert.deepEqual(
    selected(
      "detect-starter-changes",
      [],
      true,
      "starter-ms-agent-framework-dotnet",
    ).map((s) => s.image),
    ["starter-ms-agent-framework-dotnet"],
  );
  assert.deepEqual(
    selected("detect-changes", [], true, "starter-ms-agent-framework-dotnet"),
    [],
  );
});

test("mixed verifier and application changes still build the affected application", () => {
  const files = [
    "showcase/scripts/verify-prod-resweep.ts",
    "examples/integrations/ms-agent-framework-dotnet/agent/Program.cs",
  ];
  assert.deepEqual(selected("detect-changes", files), []);
  assert.deepEqual(
    selected("detect-starter-changes", files).map((s) => s.image),
    ["starter-ms-agent-framework-dotnet"],
  );
});

test("workflow selection maintenance is isolated, but build/deploy and global changes are not", () => {
  const filterEdit = source.replace(
    "showcase/shell/**",
    "showcase/shell/src/**",
  );
  assert.notEqual(source, filterEdit);
  assert.equal(workflowRuntimeChanged(source, filterEdit), false);
  for (const [from, to] of [
    ["contents: read", "contents: write"],
    ["branches: [main]", "branches: [main, release]"],
    [
      "          npx tsx showcase/scripts/redeploy-env.ts",
      "          npx tsx showcase/scripts/new-redeploy-env.ts",
    ],
    ["  build:\n", "  build-renamed:\n"],
  ]) {
    const modified = source.replace(from, to);
    assert.notEqual(modified, source, `fixture missing: ${from}`);
    assert.equal(workflowRuntimeChanged(source, modified), true);
  }
});

test("runtime metadata in selection jobs still forces a full rebuild", () => {
  for (const [from, to] of [
    [
      '"dockerfile":"showcase/shell-docs/Dockerfile"',
      '"dockerfile":"showcase/shell-docs/ReplacementDockerfile"',
    ],
    ['"build_args_sha":"__GH_SHA__"', '"build_args_sha":"replacement-sha"'],
    [
      "GITHUB_REF_NAME_ENV: ${{ github.ref_name }}",
      "GITHUB_REF_NAME_ENV: replacement-branch",
    ],
    ['echo "matrix=$MATRIX"', 'echo "matrix=[]"'],
  ]) {
    const modified = source.replace(from, to);
    assert.notEqual(modified, source, `fixture missing: ${from}`);
    assert.equal(workflowRuntimeChanged(source, modified), true);
  }
});

test("unfamiliar classifier step content refuses classification", () => {
  for (const [from, to] of [
    [
      "run: node scripts/showcase-build-impact.mjs",
      "run: node scripts/showcase-build-impact.mjs; echo changed",
    ],
    ["id: workflow-impact", "id: workflow-impact\n        if: false"],
    ["BEFORE_SHA: ${{ github.event.before }}", "BEFORE_SHA: altered"],
  ]) {
    const modified = source.replace(from, to);
    assert.notEqual(modified, source, `fixture missing: ${from}`);
    assert.throws(
      () => workflowRuntimeChanged(source, modified),
      /Unsupported classifier step/,
    );
  }
});

test("both selectors consume the classifier", () => {
  for (const id of ["detect-changes", "detect-starter-changes"]) {
    const job = workflow.jobs[id];
    const classifier = job.steps.find((s) => s.id === "workflow-impact");
    assert.equal(classifier.run, "node scripts/showcase-build-impact.mjs");
    assert.equal(classifier.env.BEFORE_SHA, "${{ github.event.before }}");
    const matrix = job.steps.find((s) =>
      ["build-matrix", "starter-matrix"].includes(s.id),
    );
    assert.equal(
      matrix.env.WORKFLOW_RUNTIME_CHANGED,
      "${{ steps.workflow-impact.outputs.changed }}",
    );
  }
});

test("unrecognized workflow layout refuses classification", () => {
  for (const broken of [
    source.replace("jobs:", "not-jobs:"),
    source.replace("  detect-changes:", "  unknown-selector:"),
    source.replace(
      "  build:\n",
      "  build: { runs-on: ubuntu-latest, steps: [] }\n",
    ),
    source.replace("  build:\n", "  'build':\n"),
    source + "permissions:\n  contents: write\n",
  ]) {
    assert.throws(() => workflowRuntimeChanged(source, broken));
  }
});

test("missing push history refuses without emitting a no-build decision", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "build-impact-error-"));
  try {
    const output = resolve(directory, "output");
    const result = spawnSync(
      process.execPath,
      [resolve(root, "scripts/showcase-build-impact.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          GITHUB_EVENT_NAME: "push",
          BEFORE_SHA: "0".repeat(40),
          GITHUB_SHA: "a".repeat(40),
          GITHUB_OUTPUT: output,
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires nonzero before\/after/);
    assert.throws(() => readFileSync(output), { code: "ENOENT" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
