import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  "../../../.github/workflows/showcase_angular_preview.yml",
);

interface WorkflowJob {
  if?: string;
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  steps?: Array<{
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, unknown>;
  }>;
}

interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
}

function workflow(): { parsed: Workflow; source: string } {
  const source = readFileSync(WORKFLOW_PATH, "utf8");
  return { parsed: parse(source) as Workflow, source };
}

function step(job: WorkflowJob, label: string) {
  const found = job.steps?.find((candidate) =>
    [candidate.run, candidate.uses, JSON.stringify(candidate.with)]
      .filter(Boolean)
      .some((value) => String(value).includes(label)),
  );
  expect(found, `missing workflow step containing ${label}`).toBeDefined();
  return found;
}

describe("Angular preview workflow", () => {
  it("runs port-opening verification only for labeled draft PRs or an explicit dispatch", () => {
    const { parsed } = workflow();
    expect(parsed.on).toHaveProperty("pull_request");
    expect(parsed.on).toHaveProperty("workflow_dispatch");
    const jobs = parsed.jobs ?? {};
    expect(Object.keys(jobs)).toEqual(["pack", "consumer", "image", "deploy"]);
    for (const job of Object.values(jobs)) {
      expect(job.if).toContain("github.event.pull_request.draft == true");
      expect(job.if).toContain("angular-preview");
      expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
    }
  });

  it("packs once and makes the consumer and image use that exact artifact graph", () => {
    const { parsed } = workflow();
    const jobs = parsed.jobs ?? {};
    const pack = jobs.pack;
    const consumer = jobs.consumer;
    const image = jobs.image;
    expect(pack).toBeDefined();
    expect(consumer?.needs).toEqual("pack");
    expect(image?.needs).toEqual(["pack", "consumer"]);

    expect(step(pack, "pack-angular-artifacts.ts").run).toContain(
      "_artifacts/angular-packages",
    );
    expect(step(pack, "actions/upload-artifact").with).toMatchObject({
      name: "angular-package-graph",
      path: "_artifacts/angular-packages",
      "if-no-files-found": "error",
    });
    expect(step(consumer, "actions/download-artifact").with).toMatchObject({
      name: "angular-package-graph",
      path: "_artifacts/angular-packages",
    });
    expect(step(consumer, "verify-angular-package.ts").run).toContain(
      "--artifacts _artifacts/angular-packages",
    );
    expect(step(image, "actions/download-artifact").with).toMatchObject({
      name: "angular-package-graph",
      path: "_artifacts/angular-packages",
    });
  });

  it("pushes an SHA-tagged image and hands only the resulting digest to Railway staging", () => {
    const { parsed, source } = workflow();
    const jobs = parsed.jobs ?? {};
    const image = jobs.image;
    const deploy = jobs.deploy;
    expect(image?.permissions).toEqual({
      contents: "read",
      packages: "write",
      "id-token": "write",
    });
    const build = step(image, "depot/build-push-action");
    expect(build.with).toMatchObject({
      context: ".",
      file: "showcase/angular/Dockerfile",
      push: true,
      platforms: "linux/amd64",
    });
    expect(String(build.with?.tags)).toContain("${{ needs.pack.outputs.sha }}");
    expect(String(build.with?.tags)).not.toContain(":latest");
    const reference = step(image, "image=ghcr.io/copilotkit/showcase-angular@");
    expect(reference.env).toMatchObject({
      IMAGE_DIGEST: "${{ steps.build.outputs.digest }}",
    });

    expect(deploy?.needs).toEqual("image");
    expect(deploy?.environment).toBe("railway");
    expect(step(deploy, "actions/checkout").with).toMatchObject({
      ref: "${{ needs.image.outputs.sha }}",
    });
    const deployStep = step(deploy, "deploy-angular-preview.ts");
    expect(deployStep.env).toMatchObject({
      ANGULAR_IMAGE: "${{ needs.image.outputs.image }}",
      RAILWAY_TOKEN: "${{ secrets.RAILWAY_TOKEN }}",
      GHCR_TOKEN: "${{ secrets.ORG_READ_PACKAGES_PAT }}",
    });
    expect(source).not.toContain("b14919f4-6417-429f-848d-c6ae2201e04f");
    expect(source).not.toContain("showcase-angular:latest");
  });

  it("pins every third-party action to a full commit SHA", () => {
    const { parsed } = workflow();
    for (const job of Object.values(parsed.jobs ?? {})) {
      for (const candidate of job.steps ?? []) {
        if (!candidate.uses) continue;
        expect(candidate.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });
});
