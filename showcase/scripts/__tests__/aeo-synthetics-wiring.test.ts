import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

test("scheduled AEO synthetics stay contract-driven and alert the owned channel", () => {
  const workflow = readFileSync(
    resolve(repositoryRoot, ".github/workflows/aeo_synthetics.yml"),
    "utf8",
  );
  const contract = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "showcase/shared/aeo/public-surface-contract.v1.json",
      ),
      "utf8",
    ),
  ) as {
    syntheticMonitoring: {
      cadence: string;
      runbook: { repositoryPath: string };
    };
  };

  expect(workflow).toContain("schedule:");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain(
    `- cron: "${contract.syntheticMonitoring.cadence}"`,
  );
  expect(workflow).toContain(
    "pnpm nx run @copilotkit/showcase-scripts:check-aeo-synthetics",
  );
  expect(workflow).toContain("SLACK_WEBHOOK_OSS_ALERTS");
  expect(workflow).toContain("slackapi/slack-github-action@");
  expect(workflow).toContain("aeo-synthetic-output.txt");
  expect(workflow).not.toContain("docs.copilotkit.ai");
  expect(workflow).not.toContain("www.copilotkit.ai");
  expect(
    readFileSync(
      resolve(
        repositoryRoot,
        contract.syntheticMonitoring.runbook.repositoryPath,
      ),
      "utf8",
    ),
  ).toContain("#oss-alerts");
});
