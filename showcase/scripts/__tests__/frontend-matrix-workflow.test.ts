import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  "../../../.github/workflows/test_showcase-frontend-matrix.yml",
);

interface WorkflowStep {
  if?: string;
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

  it("retains aggregate matrix evidence when exact cells fail", () => {
    const verifySteps = workflowJobs()["verify"]?.steps ?? [];
    const aggregateIndex = verifySteps.findIndex(
      (step) => step.name === "Verify exact coverage, results, and p95",
    );
    const uploadIndex = verifySteps.findIndex(
      (step) => step.name === "Upload aggregate evidence",
    );
    const prerequisiteIndex = verifySteps.findIndex(
      (step) => step.name === "Require every prerequisite gate",
    );

    expect(aggregateIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(aggregateIndex);
    expect(prerequisiteIndex).toBeGreaterThan(uploadIndex);
    expect(verifySteps[uploadIndex]?.if).toBe("always() && !cancelled()");
    expect(verifySteps[prerequisiteIndex]?.if).toBe("always() && !cancelled()");
  });
});
