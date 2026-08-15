import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { expect, test } from "vitest";

const repositoryRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

test("production synthetics remain manual until the baseline and alert path are proven", () => {
  const workflow = parse(
    readFileSync(
      resolve(repositoryRoot, ".github/workflows/aeo_synthetics.yml"),
      "utf8",
    ),
  ) as {
    on: Record<string, unknown>;
    jobs: {
      check: {
        steps: Array<{
          name?: string;
          if?: string;
          run?: string;
          uses?: string;
          with?: Record<string, unknown>;
        }>;
      };
    };
  };

  expect(workflow.on).toHaveProperty("workflow_dispatch");
  expect(workflow.on).not.toHaveProperty("schedule");

  const steps = workflow.jobs.check.steps;
  expect(
    steps.some(({ run }) =>
      run?.includes(
        "pnpm nx run @copilotkit/showcase-scripts:check-aeo-synthetics",
      ),
    ),
  ).toBe(true);
  expect(
    steps.some(
      (step) =>
        step.if?.includes("inputs.exercise_alert") &&
        step.run?.includes("exit 1"),
    ),
  ).toBe(true);
  expect(
    steps.some(
      ({ uses, with: input }) =>
        uses?.startsWith("slackapi/slack-github-action@") &&
        String(input?.webhook).includes("SLACK_WEBHOOK_OSS_ALERTS"),
    ),
  ).toBe(true);
});
