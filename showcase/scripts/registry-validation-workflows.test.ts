import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const load = (name: string) =>
  parse(
    readFileSync(
      resolve(import.meta.dirname, "../../.github/workflows", name),
      "utf8",
    ),
  );

/** Evaluate the boolean-only expressions used by these job and step guards. */
function enabled(
  expression: string | undefined,
  validation: boolean,
  options: {
    cancelled?: boolean;
    dryRun?: boolean;
    resolved?: string;
    promoted?: string;
    event?: string;
  } = {},
): boolean {
  const body =
    expression
      ?.replace(/needs\.resolve-targets/g, 'needs["resolve-targets"]')
      .replace(/^\$\{\{\s*|\s*\}\}$/g, "") ?? "success()";
  return new Function(
    "inputs",
    "needs",
    "github",
    "cancelled",
    "always",
    "success",
    `return (${body});`,
  )(
    { validate_registry_only: validation, dry_run: options.dryRun ?? false },
    {
      "resolve-targets": { result: options.resolved ?? "skipped" },
      promote: {
        result: options.promoted ?? "success",
        outputs: { succeeded_csv: "docs" },
      },
    },
    { event_name: options.event ?? "workflow_dispatch" },
    () => options.cancelled ?? false,
    () => true,
    () => true,
  );
}

const disabled = "inputs.validate_registry_only != true";

describe("registry-only validation", () => {
  it("runs workflow guard tests for showcase promotion workflow-only changes", () => {
    const workflow = load("showcase_validate.yml");
    for (const event of ["pull_request", "push"]) {
      expect(workflow.on[event].paths).toContain(
        ".github/workflows/showcase_promote.yml",
      );
    }
  });
  for (const name of ["showcase_promote.yml", "docs_promote.yml"]) {
    it(`${name} uses the normal reader installation with separate safe evidence`, () => {
      const workflow = load(name);
      expect(
        workflow.on.workflow_dispatch.inputs.validate_registry_only,
      ).toMatchObject({
        type: "boolean",
        default: false,
        required: false,
      });
      expect(workflow.concurrency.group).toContain(
        "inputs.validate_registry_only",
      );
      expect(workflow.concurrency.group).toContain("github.run_id");
      expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
      const steps = workflow.jobs.promote.steps;
      const probeIndex = steps.findIndex((step: any) =>
        step.run?.includes("ruby showcase/scripts/validate-registry.rb"),
      );
      expect(probeIndex).toBeGreaterThan(0);
      const probe = steps[probeIndex];
      expect(probe.if).toContain("inputs.validate_registry_only == true");
      expect(probe.env).toMatchObject({
        RAILWAY_TOKEN: "${{ secrets.RAILWAY_TOKEN }}",
        SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE:
          "${{ vars.SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE }}",
        SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN:
          "${{ secrets.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN }}",
        SHOWCASE_REGISTRY_CONSUMER: "ruby-promotion",
      });
      const setup = steps.slice(0, probeIndex);
      expect(
        setup.some((step: any) => step.uses?.startsWith("ruby/setup-ruby@")),
      ).toBe(true);
      expect(
        setup.some((step: any) => step.uses?.startsWith("actions/setup-node@")),
      ).toBe(true);
      expect(
        setup.some(
          (step: any) =>
            step.run ===
            "pnpm install --filter CopilotKit --frozen-lockfile --ignore-scripts",
        ),
      ).toBe(true);
      expect(
        setup.some(
          (step: any) =>
            step.run?.includes("npm ci") &&
            step.run?.includes("emit-railway-envs-json.ts"),
        ),
      ).toBe(true);
      const artifact = steps.find((step: any) =>
        step.uses?.startsWith("actions/upload-artifact@"),
      );
      expect(artifact.if).toContain("inputs.validate_registry_only == true");
      expect(artifact.with.path).toBe(
        "${{ runner.temp }}/registry-validation.json",
      );
      expect(artifact.with.name).toBe(
        `${name.replace(".yml", "")}-registry-validation`,
      );
    });
  }

  it("showcase skips every other job and mutation step even after probe failure", () => {
    const jobs = load("showcase_promote.yml").jobs;
    expect(jobs["compatibility-refresh"].uses).toBe(
      "$/.github/workflows/showcase_compatibility.yml",
    );
    for (const [name, job] of Object.entries<any>(jobs)) {
      if (name === "promote") continue;
      expect(job.if, name).toContain(disabled);
      expect(enabled(job.if, true), name).toBe(false);
    }
    expect(jobs.promote.if).toContain("!cancelled()");
    // A status function bypasses GitHub's implicit success() after skipped needs.
    expect(enabled(jobs.promote.if, true, { resolved: "skipped" })).toBe(true);
    expect(enabled(jobs.promote.if, true, { cancelled: true })).toBe(false);
    expect(enabled(jobs.promote.if, false, { resolved: "success" })).toBe(true);
    expect(enabled(jobs.promote.if, false, { resolved: "skipped" })).toBe(
      false,
    );
    expect(jobs.promote.if).toContain("inputs.validate_registry_only == true");
    const mutation = jobs.promote.steps.find(
      (step: any) => step.id === "promote",
    );
    expect(mutation.if).toContain(disabled);
    expect(enabled(mutation.if, true)).toBe(false);
    expect(enabled(mutation.if, false)).toBe(true);
  });

  it("docs skips pin, production probe and notification regardless of dry_run", () => {
    const steps = load("docs_promote.yml").jobs.promote.steps;
    for (const name of [
      "Read pin",
      "Promote docs",
      "Probe docs prod",
      "Slack notify",
    ]) {
      const guard = steps.find((step: any) => step.name === name).if;
      expect(guard, name).toContain(disabled);
      for (const dryRun of [true, false]) {
        for (const event of ["workflow_dispatch", "pull_request"]) {
          expect(enabled(guard, true, { dryRun, event }), name).toBe(false);
        }
      }
    }
    for (const name of ["Promote docs", "Probe docs prod", "Slack notify"]) {
      const guard = steps.find((step: any) => step.name === name).if;
      expect(guard).toContain("inputs.dry_run != true");
      expect(enabled(guard, false, { dryRun: true })).toBe(false);
      expect(enabled(guard, false, { dryRun: false })).toBe(true);
      expect(enabled(guard, false, { event: "pull_request" })).toBe(true);
    }
  });
});
