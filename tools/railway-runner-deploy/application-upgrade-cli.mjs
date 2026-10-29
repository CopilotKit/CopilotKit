import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { STAGING, RUNNER_URL, sha256, equal } from "./contract.mjs";
import { boundedBytes, createRailway, createRunner } from "./adapters.mjs";
import { createGithub } from "./github.mjs";
import { upgradeApplication, verifyWatches } from "./application-upgrade.mjs";
import {
  freezeApplicationTemplate,
  validateApplicationRelease,
} from "./application-release.mjs";
import { verifyApplicationProvenance } from "./application-provenance.mjs";
import { activateRegistryReaders } from "../../showcase/scripts/activate-registry-readers.mjs";
import { createRetainedHarnessJournal } from "./harness-journal.mjs";

async function main() {
  const env = process.env;
  const bytes = await readFile(env.RICH_APPLICATION_RELEASE_PATH);
  assert.equal(
    sha256(bytes),
    env.RICH_APPLICATION_RELEASE_SHA256,
    "Reviewed release digest required",
  );
  const intent = JSON.parse(bytes);
  validateApplicationRelease(intent);
  const github = createGithub({ token: env.GITHUB_TOKEN });
  const verifyProvenance = () =>
    verifyApplicationProvenance(intent, github, env.GITHUB_TOKEN);
  if (process.argv.includes("--validate")) {
    await verifyProvenance();
    return;
  }
  assert.deepEqual(
    process.argv.slice(2),
    ["--execute"],
    "Explicit execution mode required",
  );
  const workflow = ".github/workflows/intelligence-application-upgrade.yml";
  assert.equal(env.GITHUB_REPOSITORY, "CopilotKit/CopilotKit");
  assert.equal(env.GITHUB_REPOSITORY_ID, "655515393");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    `CopilotKit/CopilotKit/${workflow}@refs/heads/main`,
  );
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA);
  assert.equal(
    env.GITHUB_RUN_ATTEMPT,
    "1",
    "Never rerun an uncertain transition",
  );
  assert.match(env.GITHUB_RUN_ID, /^\d+$/);
  const operationId = `github-655515393-${env.GITHUB_RUN_ID}`;
  const workflowSha256 = sha256(await readFile(workflow));
  const deadline = Date.now() + 35 * 60_000;
  const graphql = async (
    query,
    variables,
    signal = AbortSignal.timeout(30000),
  ) => {
    const response = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        authorization: `Bearer ${env.RAILWAY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    assert.ok(response.ok, "Provider request failed");
    const value = JSON.parse(await boundedBytes(response));
    assert.ok(value.data && !value.errors, "Provider request refused");
    return value.data;
  };
  // CLI renders the exact service reference. Capture only in memory; no key on argv.
  const readVariables = async () => {
    const { stdout } = await promisify(execFile)(
      "railway",
      [
        "variable",
        "list",
        "--project",
        STAGING.projectId,
        "--environment",
        STAGING.environmentId,
        "--service",
        STAGING.serviceId,
        "--json",
      ],
      {
        env: {
          ...env,
          RAILWAY_API_TOKEN: env.RAILWAY_TOKEN,
          RAILWAY_TOKEN: undefined,
        },
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    );
    return JSON.parse(stdout);
  };
  const variables = await readVariables();
  const frozen = freezeApplicationTemplate(intent, variables);
  const railway = createRailway({ token: env.RAILWAY_TOKEN, deadline });
  const runner = createRunner({ token: env.RICH_RUNNER_TOKEN, deadline });
  let removalSent = false;
  railway.removeDeployment = async (id) => {
    assert.equal(id, intent.removalBaseline.deploymentId);
    assert.equal(removalSent, false);
    const old = await railway.readDeploymentStatus(id);
    assert.equal(old.status, "SUCCESS");
    assert.equal(old.image, intent.baseline.image);
    removalSent = true;
    const value = await graphql(
      "mutation($id:String!){deploymentRemove(id:$id)}",
      { id },
    );
    if (value.deploymentRemove !== true) {
      const error = Error("Removal not acknowledged");
      error.removalOutcome =
        value.deploymentRemove === false ? "refused" : "unknown";
      throw error;
    }
  };
  const assertCandidateDrained = async (signal) => {
    signal?.throwIfAborted();
    const live = await runner.get();
    assert.ok(equal(live.runtimeIdentity, intent.candidate.runtimeIdentity));
    assert.equal(live.templateSha256, intent.targetTemplateSha256);
    assert.equal(live.phase, "drained");
    assert.equal(live.busy, false);
    assert.equal(live.active, null);
    assert.equal(live.blocked, false);
    assert.equal(live.operation.operationId, operationId);
    assert.equal(live.operation.status, "drained");
    verifyWatches(live, intent);
    assert.equal((await runner.status()).scheduleEnabled, false);
    signal?.throwIfAborted();
  };
  const readConsumerReceipt = async (role, signal) => {
    assert.ok(["image-gate", "ruby-promotion", "harness"].includes(role));
    const response = await fetch(`${RUNNER_URL}/consumers/${role}`, {
      headers: { authorization: `Bearer ${env.RICH_RUNNER_TOKEN}` },
      redirect: "error",
      signal,
    });
    if (response.status === 404) return null;
    assert.ok(response.ok, "Consumer receipt unavailable");
    return JSON.parse(await boundedBytes(response, 16384));
  };
  const directory = join(env.RUNNER_TEMP, "application-transition-receipt");
  await mkdir(directory, { recursive: true });
  let harnessReceipt;
  // The separate adapter is bound to the one reviewed staging harness and preserves its config.
  const { createHarnessPolicyRollout } =
    await import("./harness-policy-rollout.mjs");
  const journalContext = {
    operationId,
    releaseSha256: env.RICH_APPLICATION_RELEASE_SHA256,
    runtimeIdentity: intent.candidate.runtimeIdentity,
    templateSha256: intent.targetTemplateSha256,
    runnerImage: intent.candidate.image,
    harnessImage: intent.harness.image,
    harnessPolicySha256: intent.harness.policySha256,
    harnessBaseline: intent.harness.baseline,
    harnessBaselineConfigSha256: intent.harness.baselineConfigSha256,
  };
  const harness = createHarnessPolicyRollout({
    graphql,
    intent: intent.harness,
    deadline,
    operationId,
    durableJournal: createRetainedHarnessJournal({
      context: journalContext,
      inspectRunner: () => railway.inspect(),
      assertCandidateDrained,
      env,
    }),
    journalPath: join(directory, "harness-journal.json"),
    env,
    save: (receipt) =>
      writeFile(
        join(directory, "harness.json"),
        JSON.stringify(receipt, null, 2),
        { mode: 0o600 },
      ),
  });
  await upgradeApplication({
    intent,
    operationId,
    railway,
    runner,
    verifyProvenance: async () => {
      await verifyProvenance();
      await harness.preflight();
      // Read-only SSH/mount/claim check before draining the baseline runner.
      const baselineJournal = createRetainedHarnessJournal({
        context: {
          ...journalContext,
          runnerImage: intent.baseline.image,
          runtimeIdentity: intent.baseline.runtimeIdentity,
          templateSha256: intent.baselineTemplateSha256,
        },
        inspectRunner: () => railway.inspect(),
        assertCandidateDrained: async () => {
          const live = await runner.get();
          assert.deepEqual(
            live.runtimeIdentity,
            intent.baseline.runtimeIdentity,
          );
          assert.equal(live.templateSha256, intent.baselineTemplateSha256);
          assert.equal(live.phase, "running");
          assert.equal(live.busy, false);
          assert.equal(live.active, null);
          assert.equal(live.blocked, false);
          assert.equal(live.operation.operationId, intent.baselineOperationId);
          assert.equal((await runner.status()).scheduleEnabled, false);
          verifyWatches(live, intent);
        },
        env,
      });
      assert.equal(
        await baselineJournal.load(),
        null,
        "Retained harness claim already exists; recovery required",
      );
    },
    verifyTemplate: async () => frozen.verify(await readVariables()),
    verifyReceipts: async () => {
      assert.equal((await runner.status()).scheduleEnabled, false);
      for (const expected of [...intent.watches, intent.volumeWatch]) {
        const value = await runner.readRun(expected.runnerRunId);
        assert.equal(value.status, "failed");
        assert.equal(value.cleanup, "retained-watch");
        assert.equal(value.deadlineExceeded, true);
      }
    },
    setUpgrade: async (authorization) => {
      for (const [name, value] of [
        ["RICH_TEMPLATE_JSON", frozen.bytes],
        ["RICH_RUNNER_UPGRADE_JSON", JSON.stringify(authorization)],
      ]) {
        const result = await graphql(
          "mutation($input:VariableUpsertInput!){variableUpsert(input:$input)}",
          {
            input: {
              projectId: STAGING.projectId,
              environmentId: STAGING.environmentId,
              serviceId: STAGING.serviceId,
              name,
              value,
              skipDeploys: true,
            },
          },
        );
        assert.equal(
          result.variableUpsert,
          true,
          "Configuration install not acknowledged",
        );
      }
    },
    activateConsumers: async () => {
      await assertCandidateDrained();
      harnessReceipt = await harness.rollout({ assertCandidateDrained });
    },
    verifyConsumers: async ({ policySha256, notBefore }) => {
      // Recheck final receipts without invoking readers again after admission resumes.
      if ((await runner.get()).phase === "running") {
        assert.ok(harnessReceipt, "Harness rollout evidence required");
        assert.deepEqual(await harness.read(), {
          id: harnessReceipt.deploymentId,
          image: intent.harness.image,
          status: "SUCCESS",
        });
        for (const role of ["image-gate", "ruby-promotion", "harness"]) {
          const receipt = await readConsumerReceipt(
            role,
            AbortSignal.timeout(30000),
          );
          assert.equal(receipt?.policySha256, policySha256);
          assert.equal(receipt.consumer, role);
          assert.equal(receipt.reader, "railway-lifecycle-records-v1");
          assert.equal(receipt.recordsFile, `${RUNNER_URL}/registry`);
          assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
          assert.ok(
            Date.parse(receipt.at) >= Date.parse(notBefore) &&
              Date.parse(receipt.at) <= Date.now(),
          );
        }
        return;
      }
      await activateRegistryReaders({
        policySha256,
        notBefore,
        recordsFile: `${RUNNER_URL}/registry`,
        harnessDeploymentId: harnessReceipt.deploymentId,
        harnessImage: intent.harness.image,
        readHarnessDeployment: (signal) => harness.read(signal),
        readConsumerReceipt,
        assertCandidateDrained,
        activateHarnessReader: ({ signal }) =>
          harness.invokeReader({
            deploymentId: harnessReceipt.deploymentId,
            policySha256,
            signal,
          }),
        env: {
          ...env,
          SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE: `${RUNNER_URL}/registry`,
          SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN: env.RICH_RUNNER_TOKEN,
        },
      });
    },
    deadline,
    sleep,
    save: (receipt) =>
      writeFile(
        join(directory, "runner.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            releaseSha256: sha256(bytes),
            run: {
              id: Number(env.GITHUB_RUN_ID),
              attempt: 1,
              sha: env.GITHUB_SHA,
              workflowPath: workflow,
              workflowSha256,
            },
            ...receipt,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      ),
  });
}
main().catch(() => {
  console.error(
    "Application transition refused or failed; retain fences and inspect redacted receipts. Do not retry automatically.",
  );
  process.exitCode = 1;
});
