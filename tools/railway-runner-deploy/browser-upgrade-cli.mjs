import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { STAGING, RUNNER_URL, sha256 } from "./contract.mjs";
import { createRailway, createRunner } from "./adapters.mjs";
import { createGithub, verifyRegistryImage } from "./github.mjs";
import { verifyBuild } from "./provenance.mjs";
import { upgradeBrowser } from "./browser-upgrade.mjs";

const workflow = ".github/workflows/intelligence-browser-upgrade.yml";
const env = process.env;
const workflowSha256 = sha256(await readFile(workflow));
const bytes = await readFile(
  "tools/railway-runner-deploy/releases/browser-upgrade.json",
);
const intent = JSON.parse(bytes);
assert.equal(intent.sourceRevision, "b6f89b83d4b6dd4efd2a1bc04f999cf38ff7233b");
assert.equal(
  intent.baseline.runtimeIdentity.sourceRevision,
  "855fb75ec8fd5bfbd0102ffe83765fe03a3953fb",
);
const github = createGithub({ token: env.GITHUB_TOKEN });
async function verifyProvenance() {
  const manifests = [];
  const archives = new Map();
  const verifiedGithub = {
    ...github,
    archive: async (artifact) => {
      if (!archives.has(artifact.id))
        archives.set(artifact.id, await github.archive(artifact));
      return archives.get(artifact.id);
    },
  };
  for (const [candidate, build] of [
    [intent.baseline, intent.baselineBuild],
    [intent.candidate, intent.build],
  ]) {
    const record = {
      schemaVersion: 1,
      sourceRevision: candidate.runtimeIdentity.sourceRevision,
      build,
      baseline: candidate,
      candidate,
    };
    await verifyBuild(record, verifiedGithub, {
      verifyImage: (image) =>
        verifyRegistryImage(image, { token: env.GITHUB_TOKEN }),
    });
    const archive = archives.get(build.artifactId);
    assert.ok(archive, "Verified archive required");
    manifests.push(JSON.parse(archive["runner-source.json"]).files);
  }
  const before = new Map(manifests[0].map((f) => [f.path, f.sha256]));
  const after = new Map(manifests[1].map((f) => [f.path, f.sha256]));
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((p) => before.get(p) !== after.get(p))
    .sort();
  assert.deepEqual(changed, [
    "tools/intelligence-smoke/rich-threads/browser/session.mjs",
    "tools/intelligence-smoke/rich-threads/driver.integration.mjs",
    "tools/intelligence-smoke/rich-threads/lifecycle/railway/recovery.test.mjs",
    "tools/intelligence-smoke/rich-threads/lifecycle/railway/runner/deployment.mjs",
  ]);
}
if (process.argv.includes("--validate")) {
  await verifyProvenance();
} else {
  assert.equal(env.GITHUB_REPOSITORY, "CopilotKit/CopilotKit");
  assert.equal(env.GITHUB_REPOSITORY_ID, "655515393");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    `CopilotKit/CopilotKit/${workflow}@refs/heads/main`,
  );
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA);
  assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/);
  assert.match(env.GITHUB_RUN_ID, /^\d+$/);
  assert.equal(env.GITHUB_RUN_ATTEMPT, "1", "Never rerun an uncertain handoff");
  const deadline = Date.now() + 30 * 60_000;
  const graphql = async (query, variables) => {
    const response = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RAILWAY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200, "Provider request failed");
    const value = await response.json();
    assert.ok(value.data && !value.errors, "Provider request refused");
    return value.data;
  };
  const railway = createRailway({ token: env.RAILWAY_TOKEN, deadline });
  let removalSent = false;
  railway.removeDeployment = async (id) => {
    assert.equal(id, "5816a613-4b0a-425f-ae82-f6a44ed53a42");
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
  const verifyReceipts = async () => {
    const status = await fetch(`${RUNNER_URL}/status`, {
      headers: { authorization: `Bearer ${env.RICH_RUNNER_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).scheduleEnabled, false);
    for (const expected of [...intent.watches, intent.volumeWatch]) {
      const response = await fetch(
        `${RUNNER_URL}/runs/${expected.runnerRunId}`,
        {
          headers: { authorization: `Bearer ${env.RICH_RUNNER_TOKEN}` },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
      assert.equal(response.status, 200);
      const value = await response.json();
      assert.equal(value.status, "failed");
      assert.equal(value.cleanup, "retained-watch");
      assert.equal(value.deadlineExceeded, true);
    }
  };
  const directory = join(env.RUNNER_TEMP, "runner-deployment-receipt");
  await mkdir(directory, { recursive: true });
  await upgradeBrowser({
    intent,
    operationId: `github-655515393-${env.GITHUB_RUN_ID}`,
    railway,
    runner: createRunner({ token: env.RICH_RUNNER_TOKEN, deadline }),
    verifyProvenance,
    verifyReceipts,
    deadline,
    sleep,
    setUpgrade: async (authorization) => {
      const result = await graphql(
        "mutation($input:VariableUpsertInput!){variableUpsert(input:$input)}",
        {
          input: {
            projectId: STAGING.projectId,
            environmentId: STAGING.environmentId,
            serviceId: STAGING.serviceId,
            name: "RICH_RUNNER_UPGRADE_JSON",
            value: JSON.stringify(authorization),
            skipDeploys: true,
          },
        },
      );
      assert.equal(result.variableUpsert, true);
    },
    save: (value) =>
      writeFile(
        join(directory, "deployment-receipt.json"),
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
            ...value,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      ),
  }).catch(() => {
    console.error(
      "Browser upgrade refused or failed; inspect receipt, do not rerun or clear the fence.",
    );
    process.exitCode = 1;
  });
}
