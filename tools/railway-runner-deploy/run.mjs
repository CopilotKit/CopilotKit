import { readAttemptCheckpoint } from "./checkpoint.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  DEPLOY_WORKFLOW,
  REPOSITORY,
  REPOSITORY_ID,
  REVISION,
  requireThat,
  sha256,
} from "./contract.mjs";
import { verifyBuild } from "./provenance.mjs";
import { createGithub, verifyRegistryImage } from "./github.mjs";
import { createRailway, createRunner } from "./adapters.mjs";
import { deployReviewedRunner } from "./deploy.mjs";
import { deployRecoveryRunner } from "./recovery-deploy.mjs";

/** Require a trusted main dispatch, or the one exact reviewed bootstrap commit. */
export function validateWorkflowContext(env) {
  requireThat(
    env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID) &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch",
    "Untrusted deployment context",
  );
  requireThat(
    REVISION.test(env.GITHUB_SHA ?? "") &&
      /^\d+$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "Invalid workflow identity",
  );
  const bootstrap =
    env.GITHUB_REF === "refs/heads/fix/PNI-605-registry-activation" &&
    REVISION.test(env.RICH_RUNNER_DEPLOY_BOOTSTRAP_SHA ?? "") &&
    env.GITHUB_SHA === env.RICH_RUNNER_DEPLOY_BOOTSTRAP_SHA;
  requireThat(
    env.GITHUB_REF === "refs/heads/main" || bootstrap,
    "Deployment requires main or the exact bootstrap commit",
  );
}
/** Execute only reviewed control code; candidate artifacts remain data throughout the credential step. */
async function main(env = process.env) {
  validateWorkflowContext(env);
  requireThat(env.RUNNER_TEMP, "Runner temporary directory required");
  const directory = join(env.RUNNER_TEMP, "runner-deployment-receipt");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receipt = async (value) =>
    writeFile(
      join(directory, "deployment-receipt.json"),
      JSON.stringify(value, null, 2) + "\n",
      { mode: 0o600 },
    );
  const releaseBytes = await readFile(
    "tools/railway-runner-deploy/releases/staging.json",
  );
  const provenance = {
    releaseSha256: sha256(releaseBytes),
    run: {
      id: Number(env.GITHUB_RUN_ID),
      attempt: Number(env.GITHUB_RUN_ATTEMPT),
      sha: env.GITHUB_SHA,
      workflowPath: DEPLOY_WORKFLOW,
      workflowSha256: sha256(await readFile(DEPLOY_WORKFLOW)),
    },
  };
  await receipt({
    schemaVersion: 1,
    ...provenance,
    operationId: `github-${REPOSITORY_ID}-${env.GITHUB_RUN_ID}`,
    outcome: "unknown",
    providerWorkStarted: false,
    finalState: { verified: false },
  });
  const release = JSON.parse(releaseBytes),
    token = env.GITHUB_TOKEN;
  const github = createGithub({ token });
  await verifyBuild(release, github, {
    verifyImage: (image) => verifyRegistryImage(image, { token }),
  });
  const previousCheckpoint = await readAttemptCheckpoint(github, {
    ...provenance,
    operationId: `github-${REPOSITORY_ID}-${env.GITHUB_RUN_ID}`,
  });
  const deadline = Date.now() + 210 * 60000;
  const deploy = release.recovery ? deployRecoveryRunner : deployReviewedRunner;
  const result = await deploy({
    release,
    operationId: `github-${REPOSITORY_ID}-${env.GITHUB_RUN_ID}`,
    railway: createRailway({ token: env.RAILWAY_TOKEN, deadline }),
    runner: createRunner({ token: env.RICH_RUNNER_TOKEN, deadline }),
    sleep,
    deadline,
    receipt,
    provenance,
    previousCheckpoint,
  });
  console.log(
    `Staging runner ${result.outcome}; retained receipt verifies running state`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Runner deployment failed; inspect the redacted receipt before retrying. The deployment drain is never automatically cleared.",
    );
    process.exitCode = 1;
  });
