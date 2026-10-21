// Temporary, exact staging installation. Removed after the controlled test.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";
import { STAGING, BUILD_WORKFLOW, sha256, equal } from "./contract.mjs";
import {
  createRailway,
  createRunner,
  REMOVAL_HANDOFF_BASELINE,
} from "./adapters.mjs";
import { createGithub, verifyRegistryImage } from "./github.mjs";
import {
  validateRun,
  validateArtifactTime,
  verifySource,
  readBaselineReceipt,
} from "./provenance.mjs";
import { validateWorkflowContext } from "./run.mjs";
import { verifyRemovedHandoff } from "./removal-handoff.mjs";
const env = process.env;
const workflowPath = validateWorkflowContext(env, {
  development: true,
  event: JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8")),
});
assert.equal(env.GITHUB_REF, "refs/heads/dev/railway-runner-browser-trial");
assert.equal(
  env.GITHUB_RUN_ATTEMPT,
  "1",
  "Do not rerun a provider mutation; inspect its receipt",
);
const bytes = await readFile(
  "tools/railway-runner-deploy/releases/guard-upgrade-once.json",
);
const intent = JSON.parse(bytes),
  operationId = `github-655515393-${env.GITHUB_RUN_ID}`;
const deadline = Date.now() + 30 * 60000;
const directory = join(env.RUNNER_TEMP, "runner-deployment-receipt");
await mkdir(directory, { recursive: true, mode: 0o700 });
const receipt = {
  schemaVersion: 1,
  operationId,
  releaseSha256: sha256(bytes),
  run: {
    id: Number(env.GITHUB_RUN_ID),
    attempt: 1,
    sha: env.GITHUB_SHA,
    workflowPath,
    workflowSha256: sha256(await readFile(workflowPath)),
  },
  outcome: "unknown",
  providerWorkStarted: false,
  finalState: { verified: false },
};
const save = async (stage) => {
  receipt.stage = stage;
  await writeFile(
    join(directory, "deployment-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(stage);
};
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const hash = (v) => sha256(JSON.stringify(canonical(v)));
const binding = (r) =>
  hash({
    operationId: r.operationId,
    lifecycleRunId: r.lifecycleRunId,
    runnerRunId: r.runnerRunId,
    oldJournalSha256: r.oldJournalSha256,
    authorizationSha256: r.authorizationSha256,
    originalReceiptSha256: r.originalReceiptSha256,
    originalWatchSnapshotSha256: r.originalWatchSnapshotSha256,
  });
const watchIds = (r) =>
  r.watches.map((w) => ({
    operationId: w.operationId,
    lifecycleRunId: w.lifecycleRunId,
    runnerRunId: w.runnerRunId,
    oldJournalSha256: w.oldJournalSha256,
    originalStatus: w.originalStatus,
    deadlineExceeded: w.deadlineExceeded,
  }));
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
  if (response.status !== 200) receipt.providerHttpStatus = response.status;
  assert.equal(response.status, 200, "Provider request failed");
  const value = await response.json();
  if (!value?.data || value.errors) receipt.providerGraphqlRefused = true;
  assert.ok(value.data && !value.errors, "Provider request refused");
  return value.data;
};
const scope = {
  projectId: STAGING.projectId,
  environmentId: STAGING.environmentId,
  serviceId: STAGING.serviceId,
};
try {
  await save("verify-reviewed-build");
  const github = createGithub({ token: env.GITHUB_TOKEN });
  const run = await github.run(intent.build.runId, intent.build.runAttempt);
  validateRun(run, {
    ...intent.build,
    sourceRevision: intent.sourceRevision,
    workflowPath: BUILD_WORKFLOW,
  });
  assert.equal(
    sha256(await github.workflow(BUILD_WORKFLOW, intent.sourceRevision)),
    intent.build.workflowSha256,
  );
  const artifact = await github.artifact(intent.build.artifactId);
  assert.equal(artifact.digest, `sha256:${intent.build.artifactSha256}`);
  assert.equal(artifact.expired, false);
  assert.equal(artifact.name, "bounded-row1-image-candidates");
  assert.equal(artifact.workflow_run.id, intent.build.runId);
  assert.equal(artifact.workflow_run.head_sha, intent.sourceRevision);
  validateArtifactTime(artifact, run);
  verifySource(await github.archive(artifact), intent);
  await verifyRegistryImage(intent.candidate.image, {
    token: env.GITHUB_TOKEN,
  });
  await save("verify-trusted-baseline");
  const trustedBaseline = await readBaselineReceipt(39555213358, github);
  assert.deepEqual(trustedBaseline, intent.baseline);
  const baselineRun = await github.run(39555213358, 1);
  const prior = await github.receipt(baselineRun);
  assert.equal(
    prior.finalState.deploymentId,
    intent.removalBaseline.deploymentId,
  );
  assert.equal(prior.finalState.templateSha256, intent.baselineTemplateSha256);
  assert.deepEqual(REMOVAL_HANDOFF_BASELINE, intent.removalBaseline);
  const railway = createRailway({ token: env.RAILWAY_TOKEN, deadline });
  await save("verify-staging-template");
  const vars = (
    await graphql(
      "query($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}",
      { p: scope.projectId, e: scope.environmentId, s: scope.serviceId },
    )
  ).variables;
  const runner = createRunner({ token: vars.RICH_RUNNER_TOKEN, deadline });
  const template = JSON.parse(vars.RICH_TEMPLATE_JSON);
  template.permanentRunner = { ...scope, volumeId: STAGING.volumeId };
  assert.equal(hash(template), intent.baselineTemplateSha256);
  const target = structuredClone(template),
    workers = target.services.filter((s) =>
      s.roles.includes("inspection-worker"),
    );
  assert.equal(workers.length, 1);
  workers[0].image = intent.inspector;
  assert.equal(hash(target), intent.targetTemplateSha256);
  await save("verify-provider-instance");
  const provider = await railway.inspect();
  assert.deepEqual(provider.active, {
    id: intent.removalBaseline.deploymentId,
    status: "SUCCESS",
    image: intent.baseline.image,
  });
  assert.deepEqual(provider.latest, provider.active);
  assert.equal(provider.configuredImage, intent.baseline.image);
  await save("verify-idle-runner");
  let old = await runner.get();
  while (old.busy && Date.now() < deadline) {
    await sleep(1000);
    old = await runner.get();
  }
  assert.equal(old.busy, false);
  assert.equal(old.blocked, false);
  assert.equal(old.active, null);
  assert.equal(old.phase, "running");
  assert.equal(old.operation?.operationId, "github-655515393-39555213358");
  assert.equal(old.operation.status, "resumed");
  assert.deepEqual(old.runtimeIdentity, intent.baseline.runtimeIdentity);
  assert.equal(old.templateSha256, intent.baselineTemplateSha256);
  assert.equal(old.recovery.status, "watching");
  assert.equal(binding(old.recovery), intent.recoveryBindingSha256);
  assert.deepEqual(watchIds(old.recovery), intent.watches);
  await save("verify-complete-inventory");
  const inventory = await railway.handoffInventory();
  assert.equal(
    inventory.filter(
      (r) =>
        r.id === intent.removalBaseline.deploymentId &&
        r.image === intent.baseline.image &&
        r.status === "SUCCESS",
    ).length,
    1,
  );
  assert.ok(
    inventory.every(
      (r) =>
        r.id === intent.removalBaseline.deploymentId || r.status === "REMOVED",
    ),
  );
  const fresh = await railway.inspect();
  assert.deepEqual(fresh.active, provider.active);
  assert.deepEqual(fresh.latest, fresh.active);
  assert.equal(fresh.configuredImage, intent.baseline.image);
  receipt.providerWorkStarted = true;
  await save("remove-exact-idle-baseline");
  await railway.removeDeployment(intent.removalBaseline.deploymentId);
  let handoff;
  while (Date.now() < deadline) {
    try {
      handoff = await verifyRemovedHandoff({
        railway,
        scope: STAGING,
        baseline: intent.removalBaseline,
        configuredImages: [intent.baseline.image],
      });
      break;
    } catch {
      await sleep(5000);
    }
  }
  assert.ok(handoff, "Removed handoff was not independently verified");
  receipt.removalProof = handoff.removalProof;
  await save("removed-handoff-verified");
  const authorization = {
    operationId,
    baselineIdentity: intent.baseline.runtimeIdentity,
    targetIdentity: intent.candidate.runtimeIdentity,
    baselineTemplateSha256: intent.baselineTemplateSha256,
    targetTemplateSha256: intent.targetTemplateSha256,
    recoveryBindingSha256: intent.recoveryBindingSha256,
    removalProof: handoff.removalProof,
  };
  for (const [name, value] of [
    ["RICH_RUNNER_UPGRADE_JSON", authorization],
    ["RICH_TEMPLATE_JSON", target],
  ]) {
    await verifyRemovedHandoff({
      railway,
      scope: STAGING,
      baseline: intent.removalBaseline,
      configuredImages: [intent.baseline.image],
    });
    assert.equal(
      (
        await graphql(
          "mutation($input:VariableUpsertInput!){variableUpsert(input:$input)}",
          {
            input: {
              ...scope,
              name,
              value: JSON.stringify(value),
              skipDeploys: true,
            },
          },
        )
      ).variableUpsert,
      true,
    );
  }
  await verifyRemovedHandoff({
    railway,
    scope: STAGING,
    baseline: intent.removalBaseline,
    configuredImages: [intent.baseline.image],
  });
  await railway.setImage(intent.candidate.image);
  await verifyRemovedHandoff({
    railway,
    scope: STAGING,
    baseline: intent.removalBaseline,
    configuredImages: [intent.candidate.image],
  });
  await save("deploy-reviewed-guard-image");
  receipt.candidateDeploymentId = await railway.deploy();
  await save("candidate-deployment-requested");
  let state;
  while (Date.now() < deadline) {
    state = await railway.deployment(receipt.candidateDeploymentId);
    if (state.status === "SUCCESS") break;
    assert.ok(
      !["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(state.status),
      "Candidate deployment failed",
    );
    await sleep(5000);
  }
  assert.equal(state?.status, "SUCCESS");
  await save("candidate-provider-success");
  let live;
  while (Date.now() < deadline) {
    live = await runner.probe();
    if (
      live &&
      equal(live.runtimeIdentity, intent.candidate.runtimeIdentity) &&
      live.phase === "drained" &&
      !live.busy &&
      !live.active &&
      !live.blocked
    )
      break;
    await sleep(5000);
  }
  assert.equal(live?.phase, "drained");
  assert.equal(live.busy, false);
  assert.equal(live.active, null);
  assert.equal(live.blocked, false);
  assert.equal(live.operation?.operationId, operationId);
  assert.deepEqual(live.runtimeIdentity, intent.candidate.runtimeIdentity);
  assert.equal(live.templateSha256, intent.targetTemplateSha256);
  assert.equal(binding(live.recovery), intent.recoveryBindingSha256);
  assert.deepEqual(watchIds(live.recovery), intent.watches);
  receipt.drainedState = live;
  await save("reconciled-and-drained");
  await runner.resume({
    operationId,
    expectedRuntimeIdentity: intent.candidate.runtimeIdentity,
  });
  live = await runner.get();
  while ((live.busy || live.blocked || live.active) && Date.now() < deadline) {
    await sleep(1000);
    live = await runner.get();
  }
  assert.equal(live.phase, "running");
  assert.equal(live.busy, false);
  assert.equal(live.blocked, false);
  assert.equal(live.active, null);
  assert.deepEqual(live.runtimeIdentity, intent.candidate.runtimeIdentity);
  assert.equal(binding(live.recovery), intent.recoveryBindingSha256);
  assert.deepEqual(watchIds(live.recovery), intent.watches);
  const final = await railway.inspect();
  assert.equal(final.active.id, receipt.candidateDeploymentId);
  assert.equal(final.active.status, "SUCCESS");
  assert.equal(final.active.image, intent.candidate.image);
  assert.deepEqual(final.latest, final.active);
  assert.equal(final.configuredImage, intent.candidate.image);
  receipt.finalState = {
    verified: true,
    phase: live.phase,
    deploymentId: final.active.id,
    image: final.active.image,
    runtimeIdentity: live.runtimeIdentity,
    templateSha256: live.templateSha256,
    volumeId: final.volumeId,
    volumeInstanceId: final.volumeInstanceId,
    mountPath: final.mountPath,
  };
  receipt.outcome = "deployed";
  receipt.recovery = live.recovery;
  await save("verified-running-unblocked");
} catch {
  receipt.outcome = "failed";
  await save(`failed-at-${receipt.stage}`);
  process.exitCode = 1;
}
