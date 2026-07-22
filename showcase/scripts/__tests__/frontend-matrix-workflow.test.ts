import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  "../../../.github/workflows/test_showcase-frontend-matrix.yml",
);

interface WorkflowStep {
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  if?: string;
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

function workflowJobs(): Record<string, WorkflowJob> {
  return (parse(readFileSync(WORKFLOW_PATH, "utf8")) as Workflow).jobs ?? {};
}

function runStep(job: WorkflowJob | undefined, name: string): string {
  const step = job?.steps?.find((candidate) => candidate.name === name);
  expect(step, `missing ${name} step`).toBeDefined();
  return step?.run ?? "";
}

describe("complete frontend matrix workflow", () => {
  it("builds the canonical host from the exact packed package graph", () => {
    const build = workflowJobs()["build-angular-host"];

    expect(runStep(build, "Pack Angular package graph")).toContain(
      "pack-angular-artifacts.ts",
    );
    expect(runStep(build, "Install packed Angular package graph")).toContain(
      "use-packed-artifacts.mjs",
    );
    expect(runStep(build, "Install packed Angular package graph")).toContain(
      "--strict-peer-dependencies",
    );
  });

  it("opens browser and server ports only for draft pull requests or non-PR runs", () => {
    const jobs = workflowJobs();

    for (const name of ["matrix", "browser-suite", "performance"]) {
      expect(jobs[name]?.if).toContain(
        "github.event.pull_request.draft == true",
      );
      expect(jobs[name]?.if).toContain("github.event_name != 'pull_request'");
    }
  });

  it("checks out the exact pull-request head in every job", () => {
    for (const job of Object.values(workflowJobs())) {
      const checkout = job.steps?.find(
        (candidate) => candidate.name === "Checkout",
      );
      expect(checkout?.with?.ref).toBe(
        "${{ github.event.pull_request.head.sha || github.event.inputs.branch || github.ref }}",
      );
    }
  });

  it("records the checked-out commit for every evidence-producing job", () => {
    const jobs = workflowJobs();

    for (const name of ["matrix", "browser-suite", "performance"]) {
      expect(runStep(jobs[name], "Record checked-out commit")).toContain(
        "CHECKOUT_SHA=$(git rev-parse HEAD)",
      );
    }
  });
});
