import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  return parseYaml(readFileSync(join(workflowsDir, name), "utf8")) as Record<
    string,
    unknown
  >;
}

type WorkflowStep = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  "working-directory"?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};

describe("docs_open_release_pr.yml", () => {
  it.each([0, 1])(
    "leaves the candidate unchanged when %i release PRs are open",
    (count) => {
      const doc = load("docs_open_release_pr.yml");
      const jobs = doc.jobs as Record<
        string,
        {
          if?: string;
          needs?: string;
          outputs?: Record<string, string>;
          steps: WorkflowStep[];
        }
      >;
      const pending = jobs["pending-release"];
      expect(pending.if).toContain("head_branch == 'main'");
      expect(pending.outputs?.exists).toBe(
        "${{ steps.pending.outputs.exists }}",
      );
      expect(jobs["open-pr"].needs).toBe("pending-release");
      expect(jobs["open-pr"].if).toBe(
        "needs.pending-release.outputs.exists == 'false'",
      );
      const script = pending.steps.find((step) => step.id === "pending")?.run;
      expect(script).toBeTruthy();
      const dir = mkdtempSync(join(tmpdir(), "docs-pending-"));
      try {
        const output = join(dir, "output");
        const args = join(dir, "args");
        execFileSync(
          "bash",
          [
            "-c",
            `
        gh() { printf '%s\\n' "$@" > "$GH_ARGS"; printf '%s\\n' "$PR_COUNT"; }
        ${script}
      `,
          ],
          {
            env: {
              ...process.env,
              GH_ARGS: args,
              PR_COUNT: String(count),
              GITHUB_OUTPUT: output,
              GITHUB_REPOSITORY: "CopilotKit/CopilotKit",
            },
          },
        );
        expect(readFileSync(output, "utf8")).toBe(`exists=${count > 0}\n`);
        expect(readFileSync(args, "utf8").trim().split("\n")).toEqual([
          "pr",
          "list",
          "--repo",
          "CopilotKit/CopilotKit",
          "--base",
          "main",
          "--head",
          "release/docs/prod",
          "--state",
          "open",
          "--json",
          "number",
          "--jq",
          "length",
        ]);
        expect(() =>
          execFileSync("bash", ["-c", `gh() { return 1; }; ${script}`], {
            env: {
              ...process.env,
              GITHUB_OUTPUT: join(dir, "failed-output"),
              GITHUB_REPOSITORY: "CopilotKit/CopilotKit",
            },
          }),
        ).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("runs after Verify Deploy on every conclusion", () => {
    const doc = load("docs_open_release_pr.yml");
    const on = doc.on as {
      workflow_run: {
        workflows: string[];
        types: string[];
        branches: string[];
      };
    };
    expect(on.workflow_run.workflows).toEqual(["Showcase: Verify Deploy"]);
    expect(on.workflow_run.types).toEqual(["completed"]);
    expect(on.workflow_run.branches).toEqual(["main"]);
    const jobs = doc.jobs as Record<
      string,
      { if?: string; steps: WorkflowStep[] }
    >;
    const open = jobs["open-pr"];
    expect(open.if ?? "").not.toMatch(/workflow_run\.conclusion/);
    const tokenStep = open.steps.find((s) =>
      s.uses?.startsWith("actions/create-github-app-token@"),
    );
    expect(tokenStep?.with?.["app-id"]).toBe("1108748");
    const pinStep = open.steps.find((s) => s.id === "pin");
    const probeStep = open.steps.find((s) => s.id === "probe");
    const probeScript = probeStep?.run ?? "";
    expect(probeScript).toContain(
      "liveFetchDeployedDigest(resolveRailwayToken().token",
    );
    expect(probeScript.indexOf("STAGING_DIGEST=$(")).toBeLessThan(
      probeScript.indexOf("verify-deploy.ts"),
    );
    expect(probeScript).toContain('echo "staging-digest=$STAGING_DIGEST"');
    expect(pinStep?.env?.VERIFIED_STAGING_DIGEST).toBe(
      "${{ steps.probe.outputs.staging-digest }}",
    );
    expect(pinStep?.run).toContain(
      '--verified-staging-digest="$VERIFIED_STAGING_DIGEST"',
    );
    expect(pinStep?.["working-directory"]).toBe("showcase/scripts");
    expect(pinStep?.run ?? "").toMatch(
      /--pin-path=\.\.\/\.\.\/showcase\/pins\/docs-prod\.json/,
    );
    const prStep = open.steps.find((s) =>
      s.uses?.startsWith("peter-evans/create-pull-request@"),
    );
    expect(prStep?.with?.branch).toBe("release/docs/prod");
    expect(prStep?.with?.body ?? "").toMatch(/steps\.pin\.outputs\.digest/);
  });
});

describe("docs_promote.yml", () => {
  it("promotes only a merged release/docs/prod PR", () => {
    const doc = load("docs_promote.yml");
    const concurrency = doc.concurrency as {
      group: string;
      "cancel-in-progress": boolean;
    };
    expect(concurrency.group).toBe("docs-promote");
    expect(concurrency["cancel-in-progress"]).toBe(false);
    const yaml = readFileSync(join(workflowsDir, "docs_promote.yml"), "utf8");
    expect(yaml).not.toMatch(/showcase-promote/);
    const jobs = doc.jobs as Record<
      string,
      { if?: string; environment?: string; steps: WorkflowStep[] }
    >;
    const promote = jobs.promote;
    const checkout = promote.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout?.with?.ref).toBe(
      "${{ github.event.pull_request.merge_commit_sha || github.sha }}",
    );
    expect(promote.environment).toBe("railway");
    expect(promote.if).toMatch(/release\/docs\/prod/);
    expect(promote.if).toMatch(/merged/);
    const runs = promote.steps.map((s) => s.run ?? "").join("\n");
    expect(runs).toMatch(/bin\/railway promote docs --digest/);
    expect(runs).toMatch(/verify-deploy\.ts --env prod --services docs/);
    expect(runs).toMatch(/parseDocsProdPin/);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dangerousTriggerIgnores(value: unknown): string[] {
  if (!isRecord(value)) {
    throw new Error("zizmor.yml root is not an object");
  }
  if (!isRecord(value.rules)) {
    throw new Error("zizmor.yml rules is not an object");
  }
  const rule = value.rules["dangerous-triggers"];
  if (!isRecord(rule) || !Array.isArray(rule.ignore)) {
    throw new Error("dangerous-triggers.ignore is missing");
  }
  const names: string[] = [];
  for (const item of rule.ignore) {
    if (typeof item !== "string") {
      throw new Error("dangerous-triggers.ignore is not a string list");
    }
    names.push(item);
  }
  return names;
}

describe("zizmor.yml", () => {
  it("allows the docs release workflow_run trigger with a safety comment", () => {
    const configPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      ".github",
      "zizmor.yml",
    );
    const text = readFileSync(configPath, "utf8");
    expect(dangerousTriggerIgnores(parseYaml(text))).toContain(
      "docs_open_release_pr.yml",
    );
    const entry = text.match(
      /# docs_open_release_pr\.yml:[\s\S]*?- docs_open_release_pr\.yml/,
    );
    expect(entry?.[0]).toContain("head_branch == 'main'");
    expect(entry?.[0]).toContain("ref: main");
    expect(entry?.[0]).toContain("persist-credentials: false");
  });
});

describe("showcase_validate.yml", () => {
  it("runs workflow contracts for docs workflow-only changes on PRs and main", () => {
    const doc = load("showcase_validate.yml");
    const on = doc.on as Record<string, { paths: string[] }>;
    for (const event of ["pull_request", "push"]) {
      expect(on[event].paths).toContain(
        ".github/workflows/docs_open_release_pr.yml",
      );
      expect(on[event].paths).toContain(".github/workflows/docs_promote.yml");
    }
  });
});
