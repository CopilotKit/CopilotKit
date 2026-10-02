import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Workflow = {
  jobs: Record<
    string,
    { "runs-on"?: string; steps?: Array<{ id?: string; run?: string }> }
  >;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflow = parse(
  readFileSync(
    resolve(__dirname, "../../.github/workflows/showcase_build_check.yml"),
    "utf8",
  ),
) as Workflow;

const script =
  workflow.jobs["detect-changes"].steps?.find(
    (step) => step.id === "build-matrix",
  )?.run ?? "";
const allServices = script.match(/ALL_SERVICES='(\[[\s\S]*?\])'/)?.[1];
const selector = script.match(
  /MATRIX=\$\(echo "\$ALL_SERVICES" \| jq -c [^']*'([\s\S]*?)'\)/,
)?.[1];

// Runs the workflow's own jq selector, so the test follows the YAML.
function selected(changes: string[]): string[] {
  const out = execFileSync(
    "jq",
    [
      "-c",
      "--argjson",
      "changes",
      JSON.stringify(changes),
      "--arg",
      "sha",
      "abc123",
      "--arg",
      "ref",
      "some-branch",
      selector!,
    ],
    { input: allServices!, encoding: "utf8" },
  );
  return (JSON.parse(out) as Array<{ dispatch_name: string }>).map(
    (service) => service.dispatch_name,
  );
}

const SAMPLE = ["shell", "langgraph-python", "mastra"];

describe("Showcase: Build Check (PR) matrix selection", () => {
  it("finds the service list and the jq selector", () => {
    expect(allServices).toBeTruthy();
    expect(selector).toBeTruthy();
  });

  it("builds only the sample for a package (angular) change", () => {
    expect(selected(["angular"]).sort()).toEqual([...SAMPLE].sort());
  });

  it("builds only the sample for a workflow change", () => {
    expect(selected(["workflow_config"]).sort()).toEqual([...SAMPLE].sort());
  });

  it("still builds an integration whose own files changed", () => {
    expect(selected(["angular", "agno"]).sort()).toEqual(
      [...SAMPLE, "agno"].sort(),
    );
    expect(selected(["spring_ai"])).toEqual(["spring-ai"]);
  });

  it("builds nothing when no filter matched", () => {
    expect(selected([])).toEqual([]);
  });

  it("substitutes the PR head sha and branch into build args", () => {
    const out = JSON.parse(
      execFileSync(
        "jq",
        [
          "-c",
          "--argjson",
          "changes",
          '["shell"]',
          "--arg",
          "sha",
          "abc123",
          "--arg",
          "ref",
          "some-branch",
          selector!,
        ],
        { input: allServices!, encoding: "utf8" },
      ),
    );
    expect(out).toEqual([
      expect.objectContaining({
        dispatch_name: "shell",
        build_args_sha: "abc123",
        build_args_branch: "some-branch",
      }),
    ]);
  });

  it("waits for the Depot remote build on a GitHub-hosted runner", () => {
    expect(workflow.jobs["build-check"]["runs-on"]).not.toMatch(/^depot-/);
  });
});
