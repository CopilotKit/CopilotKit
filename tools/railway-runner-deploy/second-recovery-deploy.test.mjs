import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { deploySecondRecoveryRunner } from "./second-recovery-deploy.mjs";
import {
  SECOND_BASELINE,
  SECOND_RECOVERY,
  SECOND_TEMPLATE,
  ORIGINAL_WATCH,
  bindingDigest,
} from "./second-recovery-contract.mjs";
import { STAGING, POLICY } from "./contract.mjs";
import { validateRelease } from "./provenance.mjs";
import { createRailway } from "./adapters.mjs";
import { secondRecoveryAuthorization } from "./second-recovery-contract.mjs";

function fixture() {
  const baseline = structuredClone(SECOND_BASELINE);
  const candidate = {
    image: `ghcr.io/copilotkit/rich-thread-runner@sha256:${"a".repeat(64)}`,
    runtimeIdentity: {
      protocolVersion: 1,
      sourceRevision: "a".repeat(40),
      sourceManifestSha256: "a".repeat(64),
      compatibilitySha256: "b".repeat(64),
      policySha256: POLICY,
    },
  };
  const release = {
    baseline,
    candidate,
    recovery: structuredClone(SECOND_RECOVERY),
  };
  const operationId = "github-655515393-555";
  let now = Date.parse("2026-10-20T12:00:00Z");
  const oldId = SECOND_RECOVERY.providerHandoff.deploymentId;
  const row = {
    id: oldId,
    image: baseline.image,
    status: "SUCCESS",
    deploymentStopped: false,
  };
  const provider = {
    configuredImage: baseline.image,
    active: { ...row },
    latest: { ...row },
    volumeId: STAGING.volumeId,
    volumeInstanceId: STAGING.volumeInstanceId,
    mountPath: "/data",
  };
  const rows = [row];
  const firstWatch = {
    ...ORIGINAL_WATCH,
    status: "watching",
    providerFinality: "unknown",
    originalStatus: "failed",
    deadlineExceeded: true,
    watchSha256: "e".repeat(64),
    observationCount: 5,
    lastVerifiedAt: new Date(now).toISOString(),
  };
  const state = {
    protocolVersion: 1,
    runtimeIdentity: baseline.runtimeIdentity,
    templateSha256: SECOND_TEMPLATE,
    phase: "running",
    blocked: true,
    active: SECOND_RECOVERY.runnerRunId,
    busy: false,
    recovery: firstWatch,
    operation: {
      version: 1,
      kind: "bounded-environment-retry",
      operationId: ORIGINAL_WATCH.operationId,
      status: "resumed",
      templateSha256: SECOND_TEMPLATE,
      baselineIdentity: {
        protocolVersion: 1,
        sourceRevision: "1c9f51ca5d3180079e5a43369a3bb7573d46d806",
        sourceManifestSha256:
          "42f3f61c34d61f81948c66136cab2b784ed09822e1bf2a355049513ee45e7403",
        compatibilitySha256:
          "423d1f8af5c05530e4d31feba1d0f1c7ad0a215e52fa0748aee1690d5191a74a",
        policySha256: POLICY,
      },
      targetIdentity: baseline.runtimeIdentity,
    },
  };
  const calls = [],
    receipts = [];
  let auth;
  const railway = {
    inspect: async () => structuredClone(provider),
    handoffInventory: async () => structuredClone(rows),
    stoppedDeployment: async () => structuredClone(row),
    stopDeployment: async () => {
      calls.push("stop");
      row.deploymentStopped = true;
      provider.active = null;
    },
    setRecoveryAuthorization: async (value) => {
      calls.push("authorize");
      auth = value;
    },
    setImage: async (image) => {
      calls.push("image");
      provider.configuredImage = image;
    },
    deploy: async () => {
      calls.push("deploy");
      assert.equal(row.deploymentStopped, true);
      assert.equal(auth.providerHandoff.deploymentStopped, true);
      rows.push({
        id: "new",
        image: candidate.image,
        status: "SUCCESS",
        deploymentStopped: false,
      });
      provider.active = { ...rows[1] };
      provider.latest = { ...rows[1] };
      state.runtimeIdentity = candidate.runtimeIdentity;
      state.operation = {
        version: 1,
        kind: "bounded-environment-retry",
        operationId,
        status: "draining",
        baselineIdentity: baseline.runtimeIdentity,
        targetIdentity: candidate.runtimeIdentity,
        templateSha256: SECOND_TEMPLATE,
      };
      state.phase = "draining";
      return "new";
    },
    deployment: async (id) => ({ id, status: "SUCCESS" }),
  };
  const runner = {
    get: async () => structuredClone(state),
    recover: async () => {
      calls.push("recover");
      const second = {
        status: "watching",
        operationId,
        runnerRunId: SECOND_RECOVERY.runnerRunId,
        lifecycleRunId: SECOND_RECOVERY.lifecycleRunId,
        oldJournalSha256: "c".repeat(64),
        watchSha256: "d".repeat(64),
        observationCount: 1,
        lastVerifiedAt: new Date(now).toISOString(),
        providerFinality: "unknown",
        originalStatus: "failed",
        deadlineExceeded: true,
      };
      state.recovery = {
        ...second,
        authorizationSha256: bindingDigest(auth),
        journalBindingSha256: SECOND_RECOVERY.journalSha256,
        retainedSourceEnvironmentId: SECOND_RECOVERY.sourceEnvironmentId,
        watches: [firstWatch, second],
      };
      state.operation.status = "recovery-ready";
      state.phase = "recovery-ready";
      state.active = null;
      state.blocked = false;
    },
    resume: async () => {
      calls.push("resume");
      state.operation.status = "resumed";
      state.phase = "running";
    },
  };
  const options = {
    release,
    operationId,
    railway,
    runner,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    deadline: now + 10000,
    receipt: async (value) => receipts.push(structuredClone(value)),
    provenance: {
      releaseSha256: "f".repeat(64),
      run: {
        id: 555,
        attempt: 1,
        sha: "f".repeat(40),
        workflowSha256: "e".repeat(64),
      },
    },
  };
  return {
    options,
    railway,
    runner,
    rows,
    row,
    provider,
    state,
    calls,
    receipts,
  };
}

test("second recovery stops the exact deployment, preserves both watches and resumes only after proof", async () => {
  const h = fixture();
  const result = await deploySecondRecoveryRunner(h.options);
  assert.deepEqual(h.calls, [
    "stop",
    "authorize",
    "image",
    "deploy",
    "recover",
    "resume",
  ]);
  assert.equal(result.finalState.verified, true);
  assert.equal(result.recovery.watches.length, 2);
  assert.equal(
    result.recovery.retainedSourceEnvironmentId,
    SECOND_RECOVERY.sourceEnvironmentId,
  );
  assert.equal(
    h.receipts.find((receipt) => receipt.checkpoint)?.checkpoint.stage,
    "stop-requested",
  );
});

for (const mismatch of [
  "baseline",
  "run",
  "watch",
  "operation",
  "volume",
  "competing-running",
  "competing-queued",
  "missing-stop-proof",
])
  test(`second recovery rejects ${mismatch} before provider mutations`, async () => {
    const h = fixture();
    if (mismatch === "baseline") h.provider.active.image = "other";
    if (mismatch === "run") h.state.active = "other";
    if (mismatch === "watch")
      h.state.recovery.oldJournalSha256 = "0".repeat(64);
    if (mismatch === "operation") h.state.operation.operationId = "other";
    if (mismatch === "volume") h.provider.volumeId = "other";
    if (mismatch === "competing-running")
      h.rows.push({ id: "other", status: "SUCCESS", deploymentStopped: false });
    if (mismatch === "competing-queued")
      h.rows.push({ id: "other", status: "QUEUED", deploymentStopped: true });
    if (mismatch === "missing-stop-proof") delete h.row.deploymentStopped;
    await assert.rejects(deploySecondRecoveryRunner(h.options));
    assert.deepEqual(h.calls, []);
  });

test("lost stop response is resolved by explicit stopped readback", async () => {
  const h = fixture(),
    stop = h.railway.stopDeployment;
  h.railway.stopDeployment = async () => {
    await stop();
    throw Error("lost");
  };
  assert.equal(
    (await deploySecondRecoveryRunner(h.options)).finalState.verified,
    true,
  );
});

test("stop acknowledgement without stopped instances never permits an image update or a repeated stop", async () => {
  const h = fixture();
  h.railway.stopDeployment = async () => {
    h.calls.push("stop");
  };
  await assert.rejects(deploySecondRecoveryRunner(h.options), /deadline/);
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  h.calls.length = 0;
  await assert.rejects(
    deploySecondRecoveryRunner({ ...h.options, previousCheckpoint }),
  );
  assert.deepEqual(h.calls, []);
  assert.equal(previousCheckpoint.stage, "stop-requested");
});

test("stopped checkpoint resumes idempotent configuration without calling the stopped runner", async () => {
  const h = fixture();
  h.railway.setRecoveryAuthorization = async () => {
    throw Error("lost");
  };
  await assert.rejects(deploySecondRecoveryRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  assert.equal(previousCheckpoint.stage, "stopped");
  // Rebuild fixture adapters with a stop-requested checkpoint to exercise stop adoption separately.
  const resumed = fixture();
  resumed.row.deploymentStopped = true;
  resumed.provider.active = null;
  const result = await deploySecondRecoveryRunner({
    ...resumed.options,
    previousCheckpoint,
  });
  assert.equal(result.finalState.verified, true);
  assert.equal(resumed.calls.includes("stop"), false);
});

test("lost deploy response can adopt exact candidate but cannot deploy twice", async () => {
  const h = fixture(),
    deploy = h.railway.deploy;
  h.railway.deploy = async () => {
    await deploy();
    throw Error("lost");
  };
  await assert.rejects(deploySecondRecoveryRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  assert.equal(previousCheckpoint.stage, "candidate-requested");
  h.calls.length = 0;
  await deploySecondRecoveryRunner({ ...h.options, previousCheckpoint });
  assert.deepEqual(h.calls, ["recover", "resume"]);
  const unknown = fixture();
  unknown.railway.deploy = async () => {
    unknown.calls.push("deploy");
    throw Error("lost");
  };
  await assert.rejects(deploySecondRecoveryRunner(unknown.options));
  unknown.calls.length = 0;
  await assert.rejects(
    deploySecondRecoveryRunner({
      ...unknown.options,
      previousCheckpoint: unknown.receipts.at(-1).checkpoint,
    }),
    /unresolved/,
  );
  assert.deepEqual(unknown.calls, []);
});

for (const missing of [
  "first",
  "second",
  "source",
  "original-outcome",
  "second-outcome",
  "inventory",
  "candidate-failed",
  "volume-after-deploy",
  "authorization",
  "journal-binding",
  "second-deadline",
  "candidate-missing",
  "candidate-stopped",
])
  test(`second recovery retains closed admission without ${missing} proof`, async () => {
    const h = fixture(),
      recover = h.runner.recover;
    h.runner.recover = async () => {
      await recover();
      if (missing === "first") h.state.recovery.watches.shift();
      if (missing === "second") h.state.recovery.watches.pop();
      if (missing === "source")
        delete h.state.recovery.retainedSourceEnvironmentId;
      if (missing === "authorization")
        h.state.recovery.authorizationSha256 = "0".repeat(64);
      if (missing === "journal-binding")
        h.state.recovery.journalBindingSha256 = "0".repeat(64);
      if (missing === "second-deadline")
        h.state.recovery.watches[1].deadlineExceeded = false;
      if (missing === "candidate-missing") h.rows.splice(1, 1);
      if (missing === "candidate-stopped") h.rows[1].deploymentStopped = true;
      if (missing === "original-outcome")
        h.state.recovery.watches[0].originalStatus = "passed";
      if (missing === "second-outcome")
        h.state.recovery.watches[1].originalStatus = "passed";
      if (missing === "inventory")
        h.rows.push({
          id: "rogue",
          status: "DEPLOYING",
          deploymentStopped: false,
        });
    };
    if (missing === "candidate-failed")
      h.railway.deployment = async (id) => ({ id, status: "FAILED" });
    if (missing === "volume-after-deploy") {
      const deploy = h.railway.deploy;
      h.railway.deploy = async () => {
        const id = await deploy();
        h.provider.volumeId = "other";
        return id;
      };
    }
    await assert.rejects(deploySecondRecoveryRunner(h.options));
    assert.equal(h.calls.includes("resume"), false);
    assert.equal(h.receipts.at(-1).finalState.verified, false);
  });

test("lost resume is read back without a second resume", async () => {
  const h = fixture(),
    resume = h.runner.resume;
  h.runner.resume = async () => {
    await resume();
    throw Error("lost");
  };
  await assert.rejects(deploySecondRecoveryRunner(h.options));
  h.calls.length = 0;
  await deploySecondRecoveryRunner({
    ...h.options,
    previousCheckpoint: h.receipts.at(-1).checkpoint,
  });
  assert.deepEqual(h.calls, []);
});

test("release and variable adapters accept only the exact second incident with a new candidate", async () => {
  const h = fixture();
  const release = {
    ...h.options.release,
    schemaVersion: 1,
    sourceRevision: h.options.release.candidate.runtimeIdentity.sourceRevision,
    build: {
      runId: 555,
      runAttempt: 1,
      workflowPath: ".github/workflows/intelligence-rich-threads-build.yml",
      workflowSha256: "a".repeat(64),
      artifactId: 999,
      artifactSha256: "b".repeat(64),
    },
  };
  validateRelease(release);
  for (const key of [
    "journalSha256",
    "leaseSha256",
    "intentSha256",
    "originalWatchSha256",
    "deploymentOperationSha256",
    "sourceEnvironmentId",
  ]) {
    const changed = structuredClone(release);
    changed.recovery[key] = "wrong";
    assert.throws(() => validateRelease(changed));
  }
  const schema = JSON.parse(
    await readFile(new URL("./release.schema.json", import.meta.url)),
  );
  assert.deepEqual(schema.properties.recovery.oneOf[1].const, SECOND_RECOVERY);
  assert.deepEqual(
    schema.allOf[1].then.properties.baseline.const,
    SECOND_BASELINE,
  );
  const requests = [];
  const railway = createRailway({
    token: "private",
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return Response.json({ data: { variableUpsert: true } });
    },
  });
  const authorization = secondRecoveryAuthorization(
    release,
    h.options.operationId,
  );
  await railway.setRecoveryAuthorization(authorization);
  assert.equal(requests[0].variables.input.skipDeploys, true);
  assert.deepEqual(
    JSON.parse(requests[0].variables.input.value),
    authorization,
  );
  for (const invalid of [
    { ...authorization, force: true },
    { ...authorization, templateSha256: "0".repeat(64) },
    {
      ...authorization,
      providerHandoff: {
        ...authorization.providerHandoff,
        deploymentStopped: false,
      },
    },
    { ...authorization, targetIdentity: authorization.baselineIdentity },
  ])
    await assert.rejects(railway.setRecoveryAuthorization(invalid));
  assert.equal(requests.length, 1);
});
