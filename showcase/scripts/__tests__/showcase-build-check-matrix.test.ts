import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { WORKFLOWS_DIR } from "./paths";
import { parseJsonLiteralFromRun } from "./showcase-build-workflow";
import type { WorkflowStep } from "./showcase-build-workflow";

interface Job {
  if?: string;
  needs?: string[];
  outputs?: Record<string, string>;
  steps: WorkflowStep[];
}

interface Service {
  dispatch_name: string;
  filter_key: string;
  context: string;
  build_args_sha?: string;
  build_args_branch?: string;
}

const workflow = load(
  readFileSync(join(WORKFLOWS_DIR, "showcase_build_check.yml"), "utf8"),
) as {
  on: { pull_request: { paths: string[] } };
  jobs: Record<string, Job>;
};
const detect = workflow.jobs["detect-changes"];
const matrixStep = detect.steps.find((step) => step.id === "build-matrix")!;
const filters = load(
  detect.steps.find((step) => step.id === "filter")!.with!.filters as string,
) as Record<string, string[]>;
const services = parseJsonLiteralFromRun<Service[]>(
  matrixStep.run!,
  "ALL_SERVICES",
);

// Execute the workflow itself. Only its event inputs and output file are stubbed.
function runMatrix(
  changes?: string[],
  sha = "test-pr-sha",
  ref = "test-pr-ref",
) {
  const directory = mkdtempSync(join(tmpdir(), "showcase-build-check-"));
  const outputPath = join(directory, "github-output");
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PR_HEAD_SHA: sha,
      PR_HEAD_REF: ref,
      GITHUB_OUTPUT: outputPath,
    };
    delete env.FILTER_CHANGES;
    if (changes !== undefined) env.FILTER_CHANGES = JSON.stringify(changes);
    execFileSync("bash", ["-e", "-o", "pipefail", "-c", matrixStep.run!], {
      cwd: directory,
      env,
      timeout: 10_000,
    });
    const outputs = Object.fromEntries(
      readFileSync(outputPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    return {
      outputs,
      matrix: JSON.parse(outputs.matrix) as Service[],
      metadataExecuted: existsSync(join(directory, "metadata-executed")),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("showcase PR build matrix", () => {
  it.each([
    { name: "empty", changes: [], images: [], angular: false, vue: false },
    {
      name: "unrelated",
      changes: ["unrelated"],
      images: [],
      angular: false,
      vue: false,
    },
    {
      name: "Vue only",
      changes: ["vue"],
      images: [],
      angular: false,
      vue: true,
    },
    {
      name: "Angular only",
      changes: ["angular"],
      images: [],
      angular: true,
      vue: false,
    },
    {
      name: "shared frontend packages",
      changes: ["angular", "vue"],
      images: [],
      angular: true,
      vue: true,
    },
    {
      name: "one integration",
      changes: ["google_antigravity"],
      images: ["google-antigravity"],
      angular: true,
      vue: true,
    },
    {
      name: "shell only",
      changes: ["shell"],
      images: ["shell"],
      angular: false,
      vue: false,
    },
  ])(
    "selects images and artifacts for $name",
    ({ changes, images, angular, vue }) => {
      const { outputs, matrix } = runMatrix(changes);
      expect(matrix.map((service) => service.dispatch_name)).toEqual(images);
      expect(outputs).toEqual({
        matrix: JSON.stringify(matrix),
        has_changes: String(images.length > 0),
        needs_angular: String(angular),
        needs_vue: String(vue),
      });
    },
  );

  it.each(
    services.filter((service) =>
      service.context.startsWith("showcase/integrations/"),
    ),
  )("requires both artifacts for $dispatch_name", (service) => {
    expect(filters[service.filter_key]).toContain(`${service.context}/**`);
    const { outputs, matrix } = runMatrix([service.filter_key]);
    expect(matrix).toEqual([service]);
    expect(outputs.has_changes).toBe("true");
    expect(outputs.needs_angular).toBe("true");
    expect(outputs.needs_vue).toBe("true");
  });

  it("defaults missing filter output to an empty matrix", () => {
    const { outputs, matrix } = runMatrix();
    expect(matrix).toEqual([]);
    expect(outputs.has_changes).toBe("false");
    expect(outputs.needs_angular).toBe("false");
    expect(outputs.needs_vue).toBe("false");
  });

  it("selects every declared PR-check service and both artifacts for workflow changes", () => {
    const { outputs, matrix } = runMatrix(
      ["workflow_config"],
      "__GH_SHA__",
      "__GH_REF_NAME__",
    );
    expect(matrix).toEqual(services);
    expect(outputs.has_changes).toBe("true");
    expect(outputs.needs_angular).toBe("true");
    expect(outputs.needs_vue).toBe("true");
  });

  it("encodes SHA and branch metadata as data without executing shell syntax", () => {
    const sha = 'sha"\\$(touch metadata-executed)';
    const ref =
      'branch"\\\n$(touch metadata-executed);`touch metadata-executed`';
    const { matrix, metadataExecuted } = runMatrix(
      ["workflow_config"],
      sha,
      ref,
    );
    const stamped = matrix.filter(
      (service) => service.build_args_sha !== undefined,
    );
    expect(stamped.map((service) => service.dispatch_name).sort()).toEqual(
      services
        .filter((service) => service.build_args_sha === "__GH_SHA__")
        .map((service) => service.dispatch_name)
        .sort(),
    );
    expect(stamped.length).toBeGreaterThan(0);
    for (const service of stamped) {
      expect(service.build_args_sha).toBe(sha);
      expect(service.build_args_branch).toBe(ref);
    }
    expect(metadataExecuted).toBe(false);
  });

  it.each(["angular", "vue"])(
    "keeps the %s dependency successful for shell images while gating compilation steps",
    (frontend) => {
      const job = workflow.jobs[`build-${frontend}`];
      const required = `needs.detect-changes.outputs.needs_${frontend} == 'true'`;
      expect(job.needs).toEqual(["detect-changes"]);
      expect(job.if).toBe(
        `needs.detect-changes.outputs.has_changes == 'true' || ${required}`,
      );
      expect(job.steps.length).toBeGreaterThan(0);
      for (const step of job.steps) expect(step.if).toBe(required);
      expect(job.steps.find((step) => step.name === "Build")?.run).toBe(
        `pnpm nx build @copilotkit/showcase-${frontend}-host`,
      );
      expect(detect.outputs?.[`needs_${frontend}`]).toBe(
        `\${{ steps.build-matrix.outputs.needs_${frontend} }}`,
      );
      const download = workflow.jobs["build-check"].steps.find(
        (step) =>
          step.name ===
          `Download canonical ${frontend === "vue" ? "Vue" : "Angular"} browser artifact`,
      );
      expect(download?.if).toBe(
        "startsWith(matrix.service.context, 'showcase/integrations/')",
      );
    },
  );

  it("runs Docker checks only for a nonempty matrix after both artifact jobs", () => {
    expect(workflow.jobs["build-check"].needs).toEqual([
      "detect-changes",
      "build-angular",
      "build-vue",
    ]);
    expect(workflow.jobs["build-check"].if).toBe(
      "needs.detect-changes.outputs.has_changes == 'true'",
    );
  });

  it.each([
    ["packages/core/**", ["angular", "vue"]],
    ["packages/shared/**", ["angular", "vue"]],
    ["packages/web-components/**", ["angular", "vue"]],
    ["packages/vue/**", ["vue"]],
    ["packages/web-inspector/**", ["vue"]],
    ["packages/angular/**", ["angular"]],
    ["packages/a2ui-renderer/**", ["angular"]],
    ["showcase/vue/**", ["vue"]],
    ["showcase/angular/**", ["angular"]],
  ])(
    "routes %s to canonical artifacts, not Docker filters",
    (path, expected) => {
      expect(workflow.on.pull_request.paths).toContain(
        path.startsWith("showcase/") ? "showcase/**" : path,
      );
      expect(
        Object.entries(filters)
          .filter(([, paths]) => paths.includes(path))
          .map(([key]) => key),
      ).toEqual(expected);
    },
  );
});
