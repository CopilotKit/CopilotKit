import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Service = {
  context: string;
  dispatch_name: string;
  skip_build?: boolean;
  timeout: number;
};

type Workflow = {
  jobs: Record<
    string,
    {
      steps?: Array<{ id?: string; run?: string }>;
      "timeout-minutes"?: number;
    }
  >;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
function readWorkflow(file: string): Workflow {
  return parse(
    readFileSync(resolve(__dirname, `../../.github/workflows/${file}`), "utf8"),
  ) as Workflow;
}

function services(workflow: Workflow): Service[] {
  const matrixStep = workflow.jobs["detect-changes"].steps?.find(
    (step) => step.id === "build-matrix",
  );
  const match = matrixStep?.run?.match(/ALL_SERVICES='(\[[\s\S]*?\])'/);
  expect(match, "could not find the ALL_SERVICES JSON matrix").toBeTruthy();
  return JSON.parse(match![1]) as Service[];
}

describe("Showcase: Build & Push timeout backstops", () => {
  describe.each(["showcase_build.yml", "showcase_build_check.yml"])(
    "%s",
    (file) => {
      const workflow = readWorkflow(file);

      it("gives per-integration image builds enough room for a cold fleet build", () => {
        const underBudget = services(workflow)
          .filter((service) =>
            service.context.startsWith("showcase/integrations/"),
          )
          .filter((service) => service.timeout < 25)
          .map((service) => `${service.dispatch_name}=${service.timeout}`);

        expect(underBudget).toEqual([]);
      });

      it("gives root-context image builds enough room for export and push", () => {
        const underBudget = services(workflow)
          .filter((service) => service.context === "." && !service.skip_build)
          .filter((service) => service.timeout < 30)
          .map((service) => `${service.dispatch_name}=${service.timeout}`);

        expect(underBudget).toEqual([]);
      });
    },
  );

  it("gives starter image builds enough room for a cold fleet build", () => {
    const workflow = readWorkflow("showcase_build.yml");
    expect(
      workflow.jobs["build-starters"]["timeout-minutes"],
    ).toBeGreaterThanOrEqual(30);
  });
});
