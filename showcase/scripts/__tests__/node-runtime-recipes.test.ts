import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { globSync } from "glob";
import { load } from "js-yaml";
import { expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const build = read(".github/workflows/showcase_build.yml");
const starters = JSON.parse(
  build.match(/ALL_STARTERS='(\[[\s\S]*?\])'/)![1],
) as Array<{ slug: string }>;
const recipes = [
  ...globSync("showcase/{*,integrations/*}/Dockerfile", { cwd: root }).filter(
    (path) => path !== "showcase/pocketbase/Dockerfile",
  ),
  ...starters.map(({ slug }) => `examples/integrations/${slug}/Dockerfile`),
];

test("covers every Showcase Node image and the twelve deployed starters", () => {
  expect(starters).toHaveLength(12);
  expect(recipes).toHaveLength(41);
});

test.each(recipes)("%s cannot silently rebuild with an older Node", (path) => {
  const dockerfile = read(path);
  const nodeBases = [...dockerfile.matchAll(/^FROM (node:\S+)/gm)];
  expect(nodeBases.length).toBeGreaterThan(0);
  for (const [, image] of nodeBases) {
    expect(image).toMatch(
      /^node:22\.23\.4-(?:bookworm-slim|alpine)@sha256:[a-f0-9]{64}$/,
    );
  }
  if (dockerfile.includes("deb.nodesource.com")) {
    expect(dockerfile).not.toContain("setup_20.x");
    expect(dockerfile).toContain("nodejs=22.23.4-1nodesource1");
  }
  // This runs inside the final image's filesystem, including mixed-language
  // runners that install Node independently of their frontend build stage.
  const finalStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
  expect(finalStage).toContain('test "$(node --version)" = "v22.23.4"');
});

test("aimock replaces its inherited Node with an Alpine-compatible executable", () => {
  const dockerfile = read("showcase/aimock/Dockerfile");
  expect(dockerfile).toMatch(
    /^FROM ghcr\.io\/copilotkit\/aimock@sha256:[a-f0-9]{64}$/m,
  );
  // The pinned upstream is Alpine/musl: a Debian/glibc executable cannot run
  // in its filesystem, even when the Node version matches.
  expect(dockerfile).toMatch(
    /^FROM node:22\.23\.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS node-runtime$/m,
  );
  expect(dockerfile).toMatch(/COPY --from=node-runtime .*\/node .*\/node/);
});

test("PR builds execute Node from every final image without starting the app", () => {
  const workflow = load(read(".github/workflows/showcase_build_check.yml")) as {
    jobs: Record<
      string,
      { steps?: Array<{ with?: Record<string, unknown>; run?: string }> }
    >;
  };
  const steps = workflow.jobs["build-check"].steps!;
  expect(steps.some((step) => step.with?.load === true)).toBe(true);
  expect(
    steps.some(
      (step) =>
        step.run?.includes(
          "docker run --rm --network none --entrypoint node",
        ) && step.run.includes('= "v22.23.4"'),
    ),
  ).toBe(true);
  const matrixText = steps.find((step) => step.with?.load === true)!.with!;
  expect(matrixText.push).toBe(false);
});

type BuildStep = {
  id?: string;
  if?: string;
  env?: Record<string, string>;
  with?: { filters?: string };
  run?: string;
  uses?: string;
};
const buildCheck = load(read(".github/workflows/showcase_build_check.yml")) as {
  on: Record<string, unknown>;
  concurrency: { group: string };
  permissions: Record<string, string>;
  jobs: Record<
    string,
    { steps: BuildStep[]; permissions?: Record<string, string> }
  >;
};
const detectSteps = buildCheck.jobs["detect-changes"].steps;
const matrixStep = detectSteps.find((step) => step.id === "build-matrix")!;

type MatrixService = {
  dispatch_name: string;
  context: string;
  dockerfile: string;
  build_args_sha?: string;
  build_args_branch?: string;
};

function runBuildMatrix(changes: string[], sha: string, ref: string) {
  const directory = mkdtempSync(join(tmpdir(), "node-runtime-matrix-"));
  const output = join(directory, "output");
  writeFileSync(output, "");
  try {
    const result = spawnSync(
      "bash",
      ["-e", "-o", "pipefail", "-c", matrixStep.run!],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          FILTER_CHANGES: JSON.stringify(changes),
          PR_HEAD_SHA: sha,
          PR_HEAD_REF: ref,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const values = Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    return {
      has_changes: values.has_changes,
      needs_angular: values.needs_angular,
      matrix: JSON.parse(values.matrix) as MatrixService[],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function matrixRecipePaths(matrix: MatrixService[]) {
  return matrix
    .map((service) => service.dockerfile || `${service.context}/Dockerfile`)
    .sort();
}

test("manual builds bypass PR filtering and use event-safe metadata", () => {
  expect(buildCheck.on).toHaveProperty("workflow_dispatch", {});
  expect(buildCheck.concurrency.group).toBe(
    "showcase-build-check-${{ github.event.pull_request.number || github.ref }}",
  );
  expect(detectSteps.find((step) => step.id === "filter")?.if).toBe(
    "github.event_name == 'pull_request'",
  );
  expect(matrixStep.env).toEqual({
    PR_HEAD_SHA: "${{ github.event.pull_request.head.sha || github.sha }}",
    PR_HEAD_REF: "${{ github.head_ref || github.ref_name }}",
    FILTER_CHANGES:
      "${{ github.event_name == 'workflow_dispatch' && '[\"workflow_config\"]' || steps.filter.outputs.changes }}",
  });
  // Metadata reaches jq through env/--arg, never GitHub interpolation in Bash.
  expect(matrixStep.run).not.toContain("${{");
});

test("manual matrix executes Bash/jq and covers exactly all 41 recipe paths", () => {
  // Read the actual dispatch filter value from the workflow's environment.
  const dispatchChanges =
    matrixStep.env!.FILTER_CHANGES.match(/&& '([^']+)'/)?.[1];
  expect(dispatchChanges).toBeDefined();
  const sha = 'sha"\\$(printf injected)';
  const ref = "feature/quote'\"$(printf injected)\nnext-line";
  const result = runBuildMatrix(JSON.parse(dispatchChanges!), sha, ref);
  expect(matrixRecipePaths(result.matrix)).toEqual([...recipes].sort());
  expect(result.has_changes).toBe("true");
  expect(result.needs_angular).toBe("true");
  const metadataServices = result.matrix.filter(
    (entry) => entry.build_args_sha,
  );
  expect(
    metadataServices.map((service) => service.dispatch_name).sort(),
  ).toEqual(["shell", "shell-dashboard", "shell-docs"]);
  for (const service of metadataServices) {
    expect(service.build_args_sha).toBe(sha);
    expect(service.build_args_branch).toBe(ref);
  }
});

test("PR starter filter executes Bash/jq with its exact standalone context", () => {
  const filters = load(
    detectSteps.find((step) => step.id === "filter")!.with!.filters!,
  ) as Record<string, string[]>;
  expect(filters.starter_langgraph_js).toEqual([
    "examples/integrations/langgraph-js/**",
  ]);
  const result = runBuildMatrix(
    ["starter_langgraph_js"],
    "pr-sha",
    "pr-branch",
  );
  expect(result.matrix).toEqual([
    expect.objectContaining({
      dispatch_name: "starter-langgraph-js",
      context: "examples/integrations/langgraph-js",
      dockerfile: "",
    }),
  ]);
  expect(matrixRecipePaths(result.matrix)).toEqual([
    "examples/integrations/langgraph-js/Dockerfile",
  ]);
  expect(result.has_changes).toBe("true");
  expect(result.needs_angular).toBe("false");
});

test("PR path detection has job-local read access to pull request files", () => {
  const detection = buildCheck.jobs["detect-changes"];
  expect(detection.steps.find((step) => step.id === "filter")?.uses).toMatch(
    /^dorny\/paths-filter@/,
  );
  // Explicit job permissions replace the workflow defaults. The REST API
  // that paths-filter uses for pull_request events needs this read scope.
  expect(detection.permissions).toEqual({
    contents: "read",
    "pull-requests": "read",
  });
  expect(buildCheck.permissions).toEqual({ contents: "read" });
});
