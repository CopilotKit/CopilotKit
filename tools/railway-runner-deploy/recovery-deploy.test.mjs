import assert from "node:assert/strict";
import test from "node:test";
import { deployRecoveryRunner } from "./recovery-deploy.mjs";
import {
  BOUNDED_RECOVERY,
  recoveryAuthorization,
  RECOVERY_BASELINE_IMAGE,
} from "./recovery-contract.mjs";
import { createRailway } from "./adapters.mjs";
import { POLICY, STAGING } from "./contract.mjs";
import { validateRelease } from "./provenance.mjs";
import { readFile } from "node:fs/promises";

function setup() {
  const baseline = {
    image: RECOVERY_BASELINE_IMAGE,
    runtimeIdentity: {
      protocolVersion: 1,
      sourceRevision: "1c9f51ca5d3180079e5a43369a3bb7573d46d806",
      sourceManifestSha256:
        "42f3f61c34d61f81948c66136cab2b784ed09822e1bf2a355049513ee45e7403",
      compatibilitySha256:
        "423d1f8af5c05530e4d31feba1d0f1c7ad0a215e52fa0748aee1690d5191a74a",
      policySha256: POLICY,
    },
  };
  const candidate = {
    image: `ghcr.io/copilotkit/rich-thread-runner@sha256:${"b".repeat(64)}`,
    runtimeIdentity: {
      ...baseline.runtimeIdentity,
      sourceRevision: "b".repeat(40),
      compatibilitySha256: "b".repeat(64),
      sourceManifestSha256: "b".repeat(64),
    },
  };
  const release = {
    baseline,
    candidate,
    recovery: structuredClone(BOUNDED_RECOVERY),
  };
  const operationId = "github-655515393-123";
  const state = {
    protocolVersion: 1,
    runtimeIdentity: baseline.runtimeIdentity,
    templateSha256: "d".repeat(64),
    phase: "running",
    operation: null,
    busy: false,
    active: BOUNDED_RECOVERY.runnerRunId,
    blocked: true,
  };
  const provider = {
    configuredImage: baseline.image,
    active: { id: "old", status: "SUCCESS", image: baseline.image },
    latest: { id: "old", status: "SUCCESS", image: baseline.image },
    volumeId: STAGING.volumeId,
    volumeInstanceId: STAGING.volumeInstanceId,
    mountPath: "/data",
  };
  const calls = [],
    receipts = [];
  let now = 0;
  const runner = {
    get: async () => structuredClone(state),
    drain: async ({ operationId: id, targetIdentity }) => {
      calls.push("drain");
      assert.deepEqual(targetIdentity, baseline.runtimeIdentity);
      state.operation = {
        version: 1,
        operationId: id,
        status: "draining",
        baselineIdentity: baseline.runtimeIdentity,
        targetIdentity,
        templateSha256: state.templateSha256,
      };
      state.phase = "draining";
    },
    recover: async () => {
      calls.push("recover");
      state.recovery = {
        status: "watching",
        operationId,
        runnerRunId: BOUNDED_RECOVERY.runnerRunId,
        lifecycleRunId: BOUNDED_RECOVERY.lifecycleRunId,
        oldJournalSha256: "1".repeat(64),
        watchSha256: "2".repeat(64),
        observationCount: 1,
        lastVerifiedAt: "2026-10-16T16:00:00Z",
        providerFinality: "unknown",
        originalStatus: "failed",
        deadlineExceeded: true,
      };
      state.phase = "recovery-ready";
      state.operation.status = "recovery-ready";
      state.active = null;
      state.blocked = false;
    },
    resume: async () => {
      calls.push("resume");
      state.phase = "running";
      state.operation.status = "resumed";
    },
  };
  const railway = {
    inspect: async () => structuredClone(provider),
    setRecoveryAuthorization: async (value) => {
      calls.push("authorize");
      assert.deepEqual(
        value,
        recoveryAuthorization(release, operationId, state.templateSha256),
      );
    },
    setImage: async (value) => {
      calls.push("image");
      provider.configuredImage = value;
    },
    deploy: async () => {
      calls.push("deploy");
      state.runtimeIdentity = candidate.runtimeIdentity;
      state.operation.kind = "bounded-environment-retry";
      state.operation.targetIdentity = candidate.runtimeIdentity;
      state.recovery = { status: "prepared" };
      provider.active = {
        id: "new",
        status: "SUCCESS",
        image: candidate.image,
      };
      provider.latest = { ...provider.active };
      return "new";
    },
    deployment: async (id) => ({ id, status: "SUCCESS" }),
  };
  const options = {
    release,
    operationId,
    runner,
    railway,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    deadline: 10000,
    receipt: async (value) => receipts.push(structuredClone(value)),
    provenance: {
      releaseSha256: "e".repeat(64),
      run: {
        id: 123,
        attempt: 1,
        sha: "f".repeat(40),
        workflowSha256: "a".repeat(64),
      },
    },
  };
  return { options, state, provider, runner, railway, calls, receipts };
}

test("release accepts only the exact incident exception and schema keeps that binding", async () => {
  const { options } = setup();
  const release = {
    ...options.release,
    schemaVersion: 1,
    sourceRevision: options.release.candidate.runtimeIdentity.sourceRevision,
    build: {
      runId: 123,
      runAttempt: 1,
      workflowPath: ".github/workflows/intelligence-rich-threads-build.yml",
      workflowSha256: "a".repeat(64),
      artifactId: 456,
      artifactSha256: "b".repeat(64),
    },
  };
  validateRelease(release);
  const ordinary = structuredClone(release);
  delete ordinary.recovery;
  assert.throws(() => validateRelease(ordinary), /Incompatible/);
  for (const change of ["null", "extra", "case", "image"]) {
    const invalid = structuredClone(release);
    if (change === "null") invalid.recovery = null;
    if (change === "extra") invalid.recovery.force = true;
    if (change === "case") invalid.recovery.lifecycleRunId = "other";
    if (change === "image") invalid.baseline.image = invalid.candidate.image;
    assert.throws(() => validateRelease(invalid));
  }
  const schema = JSON.parse(
    await readFile(new URL("./release.schema.json", import.meta.url)),
  );
  assert.deepEqual(schema.properties.recovery.const, BOUNDED_RECOVERY);
  assert.equal(
    schema.allOf[0].then.properties.baseline.properties.image.const,
    RECOVERY_BASELINE_IMAGE,
  );
});

test("recovery crosses exact legacy fence and requires durable watch before resume", async () => {
  const h = setup();
  const result = await deployRecoveryRunner(h.options);
  assert.deepEqual(h.calls, [
    "drain",
    "authorize",
    "image",
    "deploy",
    "recover",
    "resume",
  ]);
  assert.equal(result.finalState.verified, true);
  assert.equal(result.recovery.providerFinality, "unknown");
  assert.equal(result.recovery.originalStatus, "failed");
  assert.equal(result.recovery.deadlineExceeded, true);
});

for (const failure of [
  "case",
  "baseline",
  "volume",
  "active",
  "busy",
  "blocked",
  "owner",
])
  test(`rejects ${failure} mismatch before provider mutations`, async () => {
    const h = setup();
    if (failure === "case")
      h.options.release.recovery.intentSha256 = "0".repeat(64);
    if (failure === "baseline")
      h.options.release.baseline.runtimeIdentity.sourceRevision = "0".repeat(
        40,
      );
    if (failure === "volume") h.provider.volumeId = "wrong";
    if (failure === "active") h.state.active = "other-run";
    if (failure === "busy") h.state.busy = true;
    if (failure === "blocked") h.state.blocked = false;
    if (failure === "owner") {
      h.state.phase = "draining";
      h.state.operation = { operationId: "other" };
    }
    await assert.rejects(deployRecoveryRunner(h.options));
    assert.deepEqual(h.calls, []);
  });

test("lost legacy drain response requires an exact durable fence", async () => {
  const h = setup(),
    drain = h.runner.drain;
  h.runner.drain = async (body) => {
    await drain(body);
    throw new Error("lost response");
  };
  await deployRecoveryRunner(h.options);
  const rejected = setup();
  rejected.runner.drain = async () => {
    throw new Error("not accepted");
  };
  await assert.rejects(deployRecoveryRunner(rejected.options));
  assert.deepEqual(rejected.calls, []);
});

test("failed candidate remains fenced and never rolls back to code without watch support", async () => {
  const h = setup();
  h.railway.deployment = async (id) => ({ id, status: "FAILED" });
  await assert.rejects(deployRecoveryRunner(h.options));
  assert.deepEqual(h.calls, ["drain", "authorize", "image", "deploy"]);
  assert.equal(h.receipts.at(-1).finalState.verified, false);
});

test("lost successful deploy response is adopted on retry without another mutation", async () => {
  const h = setup(),
    deploy = h.railway.deploy;
  h.railway.deploy = async () => {
    await deploy();
    throw new Error("lost response");
  };
  await assert.rejects(deployRecoveryRunner(h.options));
  const checkpoint = h.receipts.at(-1).checkpoint;
  h.calls.length = 0;
  const result = await deployRecoveryRunner({
    ...h.options,
    previousCheckpoint: checkpoint,
  });
  assert.deepEqual(h.calls, ["recover", "resume"]);
  assert.equal(result.checkpoint.candidateDeploymentId, "new");
});

test("unknown deploy outcome with old runtime cannot cause a second deployment", async () => {
  const h = setup();
  h.railway.deploy = async () => {
    h.calls.push("deploy");
    throw new Error("unknown");
  };
  await assert.rejects(deployRecoveryRunner(h.options));
  const checkpoint = h.receipts.at(-1).checkpoint;
  h.calls.length = 0;
  await assert.rejects(
    deployRecoveryRunner({ ...h.options, previousCheckpoint: checkpoint }),
    /unresolved/,
  );
  assert.deepEqual(h.calls, []);
});

for (const failure of [
  "watch",
  "original",
  "deadline",
  "finality",
  "inventory",
])
  test(`refuses resume without ${failure} evidence`, async () => {
    const h = setup(),
      recover = h.runner.recover;
    h.runner.recover = async () => {
      await recover();
      if (failure === "watch") h.state.recovery.watchSha256 = undefined;
      if (failure === "original") h.state.recovery.originalStatus = "passed";
      if (failure === "deadline") h.state.recovery.deadlineExceeded = false;
      if (failure === "finality")
        h.state.recovery.providerFinality = "cancelled";
      if (failure === "inventory") h.state.blocked = true;
    };
    await assert.rejects(deployRecoveryRunner(h.options));
    assert.ok(!h.calls.includes("resume"));
  });

test("lost resume response is read back on retry without another resume", async () => {
  const h = setup(),
    resume = h.runner.resume;
  h.runner.resume = async () => {
    await resume();
    throw new Error("lost");
  };
  await assert.rejects(deployRecoveryRunner(h.options));
  h.calls.length = 0;
  await deployRecoveryRunner({
    ...h.options,
    previousCheckpoint: h.receipts.at(-1).checkpoint,
  });
  assert.deepEqual(h.calls, []);
});

test("authorization adapter only writes fixed scoped variable with deployment suppressed", async () => {
  const h = setup(),
    requests = [];
  const railway = createRailway({
    token: "fake",
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ data: { variableUpsert: true } }));
    },
  });
  const authorization = recoveryAuthorization(
    h.options.release,
    h.options.operationId,
    h.state.templateSha256,
  );
  await railway.setRecoveryAuthorization(authorization);
  const input = requests[0].variables.input;
  assert.deepEqual(
    { ...input, value: undefined },
    {
      projectId: STAGING.projectId,
      environmentId: STAGING.environmentId,
      serviceId: STAGING.serviceId,
      name: "RICH_RECOVERY_AUTHORIZATION_JSON",
      value: undefined,
      skipDeploys: true,
    },
  );
  assert.deepEqual(JSON.parse(input.value), authorization);
  await assert.rejects(
    railway.setRecoveryAuthorization({ ...authorization, projectId: "other" }),
  );
  assert.equal(requests.length, 1);
});
