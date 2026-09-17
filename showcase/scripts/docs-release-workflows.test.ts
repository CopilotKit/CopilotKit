import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const workflowsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".github",
  "workflows",
);

function load(name: string): Record<string, unknown> {
  return parseYaml(
    readFileSync(join(workflowsDir, name), "utf8"),
  ) as Record<string, unknown>;
}

describe("docs_open_release_pr.yml", () => {
  it("runs after Verify Deploy on every conclusion", () => {
    const doc = load("docs_open_release_pr.yml");
    const on = doc.on as {
      workflow_run: { workflows: string[]; types: string[]; branches: string[] };
    };
    expect(on.workflow_run.workflows).toEqual(["Showcase: Verify Deploy"]);
    expect(on.workflow_run.types).toEqual(["completed"]);
    expect(on.workflow_run.branches).toEqual(["main"]);
    const jobs = doc.jobs as Record<string, { if?: string; steps: Array<{ uses?: string; with?: Record<string, string> }> }>;
    const open = jobs["open-pr"];
    expect(open.if ?? "").not.toMatch(/workflow_run\.conclusion/);
    const tokenStep = open.steps.find((s) =>
      s.uses?.startsWith("actions/create-github-app-token@"),
    );
    expect(tokenStep?.with?.["app-id"]).toBe("1108748");
    const prStep = open.steps.find((s) =>
      s.uses?.startsWith("peter-evans/create-pull-request@"),
    );
    expect(prStep?.with?.branch).toBe("release/docs/prod");
  });
});

describe("docs_promote.yml", () => {
  it("promotes only a merged release/docs/prod PR", () => {
    const doc = load("docs_promote.yml");
    const concurrency = doc.concurrency as { group: string; "cancel-in-progress": boolean };
    expect(concurrency.group).toBe("docs-promote");
    expect(concurrency["cancel-in-progress"]).toBe(false);
    const yaml = readFileSync(
      join(workflowsDir, "docs_promote.yml"),
      "utf8",
    );
    expect(yaml).not.toMatch(/showcase-promote/);
    const jobs = doc.jobs as Record<
      string,
      { if?: string; environment?: string; steps: Array<{ run?: string }> }
    >;
    const promote = jobs.promote;
    expect(promote.environment).toBe("railway");
    expect(promote.if).toMatch(/release\/docs\/prod/);
    expect(promote.if).toMatch(/merged/);
    const runs = promote.steps.map((s) => s.run ?? "").join("\n");
    expect(runs).toMatch(/bin\/railway promote docs --digest/);
    expect(runs).toMatch(/verify-deploy\.ts --env prod --services docs/);
  });
});
