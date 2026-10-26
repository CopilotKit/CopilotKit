import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { WorkflowDoc } from "./__tests__/showcase-build-workflow";

const workflowPath = fileURLToPath(
  new URL(
    "../../.github/workflows/showcase_eval-webhook_build.yml",
    import.meta.url,
  ),
);
const workflow = parse(readFileSync(workflowPath, "utf8")) as WorkflowDoc;
const build = workflow.jobs.build;
const latest = workflow.jobs["advance-latest"];

// These guards use only string comparisons, boolean conjunctions and the
// cancelled() function. Execute the LIVE expression for the bounded contexts
// below; actionlint separately validates it as a GitHub Actions expression.
function canAdvance({
  buildResult = "success",
  policyResult = "success",
  autoRedeploy = "true",
  ref = "refs/heads/main",
  cancelled = false,
} = {}): boolean {
  if (!latest?.if) throw new Error("Missing latest eligibility guard");
  return runInNewContext(latest.if.replace(/^\s*\$\{\{|\}\}\s*$/g, ""), {
    needs: {
      build: { result: buildResult },
      "verify-image-refs": { result: policyResult },
    },
    vars: { SHOWCASE_AUTO_REDEPLOY: autoRedeploy },
    github: { ref },
    cancelled: () => cancelled,
  }) as boolean;
}

describe("webhook publication eligibility", () => {
  it("publishes the commit tag independently of live policy", () => {
    expect(build.needs).toBeUndefined();
    expect(build.if).toBeUndefined();
    const publish = build.steps?.find((step) => step.id === "publish");
    expect(publish?.with?.push).toBe(true);
    expect(String(publish?.with?.tags).trim()).toBe(
      "ghcr.io/copilotkit/showcase-eval-webhook:${{ github.sha }}",
    );
    expect(publish?.with?.labels).toContain(
      "org.opencontainers.image.revision=${{ github.sha }}",
    );
  });

  it("requires the build and live-policy jobs before latest advancement", () => {
    expect(latest?.needs).toEqual(["build", "verify-image-refs"]);
    expect(workflow.jobs["verify-image-refs"]?.needs).toBeUndefined();
    expect(
      workflow.jobs["verify-image-refs"]?.steps?.some((step) =>
        step.run?.includes("showcase/scripts/verify-railway-image-refs.ts"),
      ),
    ).toBe(true);
  });

  it.each(["true", ""])(
    "allows eligible main builds with switch=%j",
    (value) => {
      expect(canAdvance({ autoRedeploy: value })).toBe(true);
    },
  );

  it("holds latest while the operator kill switch is off", () => {
    expect(canAdvance({ autoRedeploy: "false" })).toBe(false);
  });

  it.each(["failure", "skipped", "cancelled", ""])(
    "holds latest when policy result is %j",
    (policyResult) => expect(canAdvance({ policyResult })).toBe(false),
  );

  it.each(["failure", "skipped", "cancelled", ""])(
    "holds latest when build result is %j",
    (buildResult) => expect(canAdvance({ buildResult })).toBe(false),
  );

  it("holds latest for cancelled runs and non-main manual dispatches", () => {
    expect(canAdvance({ cancelled: true })).toBe(false);
    expect(canAdvance({ ref: "refs/heads/feature" })).toBe(false);
    expect(canAdvance({ ref: "refs/tags/v1" })).toBe(false);
  });

  it("reuses authenticated monotonic advancement without deploying", () => {
    const steps = latest?.steps ?? [];
    const advance = steps.find((step) =>
      step.run?.includes("advance-latest-tag.ts"),
    );
    expect(advance?.env?.IMAGES).toBe(
      "ghcr.io/copilotkit/showcase-eval-webhook",
    );
    expect(advance?.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");
    expect(latest?.permissions).toMatchObject({
      contents: "read",
      packages: "write",
    });
    expect(
      steps.some((step) => step.uses?.startsWith("docker/login-action@")),
    ).toBe(true);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        expect(step.run ?? "").not.toMatch(
          /redeploy-env|railway\s+(up|redeploy|deploy)/,
        );
        expect(String(step.with?.tags ?? "")).not.toContain(":latest");
      }
    }
  });
});
