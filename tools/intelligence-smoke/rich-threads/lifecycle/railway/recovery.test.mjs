import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durableJson } from "./journal.mjs";
import { createScheduler } from "./runner/scheduler.mjs";
import {
  intentBinding,
  recoveryCase,
  recoveryDecision,
  prepareRetainedRecovery,
  recoverRetainedIntent,
  reconcileRetainedIntent,
} from "./recovery.mjs";
import { checkStartup, templateDigest } from "./runner/deployment.mjs";

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "retained-watch-"));
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup) await close();
    await rm(root, { recursive: true, force: true });
  });
  const config = {
    projectId: recoveryCase.projectId,
    controlDirectory: join(root, "control"),
    permanentRunner: {
      projectId: recoveryCase.projectId,
      environmentId: "8edfef02-ea09-4a20-8689-261f21cc2849",
      serviceId: "4922b45b-6981-4559-be2f-fbbca9123323",
      volumeId: options.volumeId ?? "permanent-volume",
    },
  };
  for (const path of [
    "control",
    `control/${recoveryCase.lifecycleRunId}`,
    "control/active-run",
    `results/${recoveryCase.runnerRunId}`,
    "private",
  ])
    await mkdir(join(root, path), { recursive: true, mode: 0o700 });
  const intent = {
    serial: 0,
    kind: "createEnvironment",
    name: recoveryCase.name,
    startedAt: recoveryCase.startedAt,
    beforeIds: [
      "8edfef02-ea09-4a20-8689-261f21cc2849",
      "b14919f4-6417-429f-848d-c6ae2201e04f",
    ],
    status: "pending",
  };
  const lease = {
    runId: recoveryCase.lifecycleRunId,
    token: "test-lease",
    pid: 2147483647,
  };
  const journal = {
    version: 1,
    provider: "railway",
    purpose: "acceptance",
    projectId: recoveryCase.projectId,
    runId: recoveryCase.lifecycleRunId,
    lease,
    intents: [intent],
    expiresAt: "2026-10-16T14:32:37.804Z",
    environments: [],
    services: [],
    volumes: [],
    domains: [],
    proxies: [],
    phase: "interrupted",
    cleanup: { status: "failed" },
  };
  const receipt = {
    id: recoveryCase.runnerRunId,
    status: "failed",
    cleanup: "failed",
    deadlineExceeded: false,
  };
  const baselineIdentity = {
    protocolVersion: 1,
    sourceRevision: recoveryCase.baselineRevision,
    sourceManifestSha256: "a".repeat(64),
    compatibilitySha256: "b".repeat(64),
    policySha256: "c".repeat(64),
  };
  const runtimeIdentity = {
    ...baselineIdentity,
    sourceRevision: options.sourceRevision ?? "d".repeat(40),
    compatibilitySha256: "e".repeat(64),
  };
  const authorization = {
    version: 1,
    kind: "bounded-environment-retry",
    operationId: "reviewed-recovery",
    projectId: recoveryCase.projectId,
    runnerRunId: recoveryCase.runnerRunId,
    lifecycleRunId: recoveryCase.lifecycleRunId,
    intentSha256: templateDigest(intentBinding(intent)),
    leaseSha256: templateDigest(lease),
    decision: {
      reference: "ran-2026-10-16-bounded-cli-retry",
      text: recoveryDecision,
    },
    permanentRunner: config.permanentRunner,
    baselineIdentity,
    targetIdentity: structuredClone(runtimeIdentity),
    templateSha256: templateDigest(config),
  };
  const operation = {
    version: 1,
    status: "draining",
    operationId: authorization.operationId,
    baselineIdentity,
    targetIdentity: baselineIdentity,
    templateSha256: templateDigest(config),
  };
  const metadata = {
    runtimeIdentity: baselineIdentity,
    templateSha256: templateDigest(config),
  };
  for (const [path, value] of Object.entries({
    [`control/${journal.runId}/journal.json`]: journal,
    "control/active-run/lease.json": lease,
    "scheduler.json": { active: recoveryCase.runnerRunId, blocked: true },
    [`results/${receipt.id}/run.json`]: receipt,
    "initialized.json": {
      serviceId: config.permanentRunner.serviceId,
      volumeId: config.permanentRunner.volumeId,
    },
    "runtime.json": metadata,
    "deployment.json": operation,
    "private/template.json": config,
  }))
    await durableJson(join(root, path), value);
  const values = [];
  const deleted = [];
  const api = {
    list: async () => structuredClone(values),
    environment: async (id) => ({
      ...values.find((v) => v.id === id),
      isEphemeral: true,
      serviceInstances: [],
      volumeInstances: [],
    }),
    request: async (kind, { id }) => {
      assert.equal(kind, "deleteEnvironment");
      deleted.push(id);
      values.splice(
        values.findIndex((v) => v.id === id),
        1,
      );
    },
  };
  const dependencies = {
    api,
    ownerAlive: async () => false,
    delay: async () => {},
  };
  const prepare = () =>
    prepareRetainedRecovery(
      { root, config, runtimeIdentity, metadata, operation, authorization },
      dependencies,
    );
  const recover = () =>
    recoverRetainedIntent(
      { root, config, operationId: authorization.operationId, runtimeIdentity },
      dependencies,
    );
  const watch = () => reconcileRetainedIntent({ root, config }, dependencies);
  const late = () => ({
    id: "late-owned-env",
    name: recoveryCase.name,
    projectId: recoveryCase.projectId,
    createdAt: recoveryCase.startedAt,
    sourceEnvironment: null,
  });
  const read = async (path) =>
    JSON.parse(await readFile(join(root, path), "utf8"));
  return {
    root,
    cleanup,
    config,
    journal,
    receipt,
    authorization,
    runtimeIdentity,
    metadata,
    operation,
    values,
    deleted,
    dependencies,
    prepare,
    recover,
    watch,
    late,
    read,
  };
}
test("reviewed bridge preserves original evidence, transfers durable watch and cleans late resources", async (t) => {
  const f = await fixture(t);
  await checkStartup({
    root: f.root,
    template: f.config,
    runtimeIdentity: f.runtimeIdentity,
    recoveryAuthorization: f.authorization,
  });
  assert.equal((await f.read("recovery.json")).status, "prepared");
  const result = await f.recover();
  assert.equal(result.providerFinality, "unknown");
  assert.equal(result.status, "watching");
  await assert.rejects(
    readFile(join(f.root, "control/active-run/lease.json")),
    { code: "ENOENT" },
  );
  assert.deepEqual(
    await f.read(`control/${f.journal.runId}/journal.json`),
    f.journal,
  );
  assert.deepEqual((await f.read("recovery.json")).originalReceipt, f.receipt);
  const receipt = await f.read(`results/${f.receipt.id}/run.json`);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.deadlineExceeded, true);
  assert.equal(receipt.cleanup, "retained-watch");
  f.values.push(f.late());
  assert.equal(await f.watch(), f.journal.runId);
  assert.deepEqual(f.deleted, ["late-owned-env"]);
  assert.equal(
    (await f.read("recovery.json")).cleanupEvents[0].status,
    "absence-verified",
  );
  assert.equal((await f.recover()).status, "watching");
});
test("incomplete inventory never releases the lease; durable watch resumes interrupted transfer", async (t) => {
  const f = await fixture(t);
  await f.prepare();
  const list = f.dependencies.api.list;
  f.dependencies.api.list = async () => {
    throw new Error("incomplete page");
  };
  await assert.rejects(f.recover(), /incomplete page/);
  assert.ok(await f.read("control/active-run/lease.json"));
  assert.equal((await f.read("recovery.json")).status, "prepared");
  f.dependencies.api.list = list;
  const state = await f.read("recovery.json");
  state.status = "watching";
  await durableJson(join(f.root, "recovery.json"), state);
  await f.watch();
  await assert.rejects(
    readFile(join(f.root, "control/active-run/lease.json")),
    { code: "ENOENT" },
  );
});
test("matching old resource is reconciled before transfer; lost delete reply requires readback", async (t) => {
  const f = await fixture(t);
  await f.prepare();
  f.values.push(f.late());
  const request = f.dependencies.api.request;
  f.dependencies.api.request = async (...args) => {
    await request(...args);
    throw new Error("reply lost");
  };
  await f.recover();
  assert.equal(f.deleted.length, 1);
  const state = await f.read("recovery.json");
  assert.equal(state.cleanupEvents[0].response, "failed-or-lost");
  assert.equal(state.cleanupEvents[0].status, "absence-verified");
});
test("ownership conflicts, live owners, modified evidence and wrong authorization fail closed", async (t) => {
  for (const scenario of [
    "multiple",
    "shared",
    "old-date",
    "source",
    "populated",
    "live",
    "changed-journal",
    "wrong-lease",
    "wrong-target",
  ])
    await t.test(scenario, async (subtest) => {
      const f = await fixture(subtest);
      if (scenario === "wrong-lease") {
        f.authorization.leaseSha256 = "f".repeat(64);
        await assert.rejects(f.prepare());
        return;
      }
      if (scenario === "wrong-target") {
        f.authorization.targetIdentity.sourceRevision = "f".repeat(40);
        await assert.rejects(f.prepare());
        return;
      }
      await f.prepare();
      const value = f.late();
      if (scenario === "multiple")
        f.values.push(value, { ...value, id: "duplicate" });
      if (scenario === "shared")
        f.values.push({ ...value, id: f.config.permanentRunner.environmentId });
      if (scenario === "old-date")
        f.values.push({ ...value, createdAt: "2020-01-01T00:00:00.000Z" });
      if (scenario === "source")
        f.values.push({ ...value, sourceEnvironment: { id: "unexpected" } });
      if (scenario === "populated") {
        f.values.push(value);
        f.dependencies.api.environment = async () => ({
          ...value,
          isEphemeral: true,
          serviceInstances: [{ serviceId: "shared" }],
          volumeInstances: [],
        });
      }
      if (scenario === "live") f.dependencies.ownerAlive = async () => true;
      if (scenario === "changed-journal") {
        f.journal.phase = "complete";
        await durableJson(
          join(f.root, "control", f.journal.runId, "journal.json"),
          f.journal,
        );
      }
      await assert.rejects(f.recover());
      assert.deepEqual(f.deleted, []);
      assert.ok(await f.read("control/active-run/lease.json"));
    });
});
test("missing or stale reviewed authorization cannot bypass ordinary compatibility checks", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    checkStartup({
      root: f.root,
      template: f.config,
      runtimeIdentity: f.runtimeIdentity,
    }),
    /compatibility/,
  );
  f.operation.status = "drained";
  await durableJson(join(f.root, "deployment.json"), f.operation);
  await assert.rejects(
    checkStartup({
      root: f.root,
      template: f.config,
      runtimeIdentity: f.runtimeIdentity,
      recoveryAuthorization: f.authorization,
    }),
    /durable closed admission fence/,
  );
});

test("real recovery module and scheduler keep watch across restart and fresh admission", async (t) => {
  const f = await fixture(t);
  await f.prepare();
  const options = {
    root: f.root,
    config: f.config,
    runtimeIdentity: f.runtimeIdentity,
    execute: async () => 0,
    recoverRetained: (args) => recoverRetainedIntent(args, f.dependencies),
    reconcileRetained: (args) => reconcileRetainedIntent(args, f.dependencies),
  };
  let scheduler = await createScheduler(options);
  const request = {
    operationId: f.authorization.operationId,
    expectedRuntimeIdentity: f.runtimeIdentity,
  };
  assert.equal((await scheduler.start()).accepted, false);
  await scheduler.recover(request);
  assert.equal(scheduler.deployment().phase, "recovery-ready");
  await scheduler.close();
  await durableJson(join(f.root, "runtime.json"), {
    runtimeIdentity: f.runtimeIdentity,
    templateSha256: templateDigest(f.config),
  });
  await checkStartup({
    root: f.root,
    template: f.config,
    runtimeIdentity: f.runtimeIdentity,
  });
  scheduler = await createScheduler(options);
  f.cleanup.push(() => scheduler.close());
  f.values.push(f.late());
  await scheduler.resume(request);
  assert.equal(f.deleted.length, 1);
  const run = await scheduler.start("single");
  assert.equal(run.accepted, true);
  await run.completion;
  const receipt = await f.read(`results/${run.id}/run.json`);
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.deadlineExceeded, false);
  assert.equal(
    (await f.read(`results/${f.receipt.id}/run.json`)).status,
    "failed",
  );
  await assert.rejects(
    scheduler.drain({
      operationId: "ordinary",
      targetIdentity: f.runtimeIdentity,
    }),
    /Retained recovery/,
  );
});

test("restart closes pending delete evidence only after complete absence readback", async (t) => {
  const f = await fixture(t);
  await f.prepare();
  f.values.push(f.late());
  const request = f.dependencies.api.request;
  const list = f.dependencies.api.list;
  f.dependencies.api.request = async (...args) => {
    await request(...args);
    f.dependencies.api.list = async () => {
      throw new Error("readback interrupted");
    };
  };
  await assert.rejects(f.recover(), /readback interrupted/);
  assert.equal(
    (await f.read("recovery.json")).cleanupEvents[0].status,
    "deleting",
  );
  assert.ok(await f.read("control/active-run/lease.json"));
  f.dependencies.api.list = list;
  await f.recover();
  assert.equal(
    (await f.read("recovery.json")).cleanupEvents[0].status,
    "absence-verified",
  );
  assert.equal(f.deleted.length, 1);
});

test("a previously tracked resource ID reappearing under another name blocks admission", async (t) => {
  const f = await fixture(t);
  await f.prepare();
  f.values.push(f.late());
  await f.recover();
  f.values.push({ ...f.late(), name: "renamed-resource" });
  await assert.rejects(f.watch(), /identity changed/);
  assert.deepEqual(f.deleted, ["late-owned-env"]);
});

test("post-delete inventory also rejects other tracked IDs reappearing renamed", async (t) => {
  const f = await fixture(t);
  await f.prepare();
  f.values.push(f.late());
  await f.recover();
  f.values.push({ ...f.late(), id: "second-late-env" });
  const request = f.dependencies.api.request;
  f.dependencies.api.request = async (...args) => {
    await request(...args);
    f.values.push({ ...f.late(), name: "renamed-resource" });
  };
  await assert.rejects(f.watch(), /deletion not verified/);
  assert.deepEqual(f.deleted, ["late-owned-env", "second-late-env"]);
});

// Second incident tests keep the original source watch active while ownership
// of a distinct recorded source and ambiguous fork transfers to a second watch.
async function repeatedFixture(t) {
  const v2 = await import("./recovery-v2.mjs");
  const f = await fixture(t, {
    volumeId: "2a70e47d-85d4-4a8a-b17b-b6788c91b1c7",
    sourceRevision: v2.repeatedCase.baselineRevision,
  });
  await f.prepare();
  await f.recover();
  const first = await f.read("recovery.json");
  const source = {
    id: v2.repeatedCase.sourceEnvironmentId,
    name: "rich-a9163c157392637bb12-source",
    projectId: f.config.projectId,
    createdAt: "2026-10-19T10:39:46.669Z",
    isEphemeral: true,
    sourceEnvironment: null,
  };
  f.values.push(source);
  const journal = {
    ...structuredClone(f.journal),
    runId: v2.repeatedCase.lifecycleRunId,
    lease: {
      ...f.journal.lease,
      runId: v2.repeatedCase.lifecycleRunId,
      token: "second-lease",
    },
    startedAt: "2026-10-19T10:39:45.428Z",
    expiresAt: "2026-10-19T11:39:45.428Z",
    environmentName: "rich-a9163c157392637bb12",
    environments: [source],
    intents: [
      {
        serial: 0,
        kind: "createEnvironment",
        name: source.name,
        startedAt: "2026-10-19T10:39:46.487Z",
        beforeIds: f.journal.intents[0].beforeIds,
        status: "recorded",
        resultId: source.id,
      },
      {
        serial: 1,
        kind: "createEnvironment",
        name: "rich-a9163c157392637bb12",
        scope: source.id,
        startedAt: "2026-10-19T10:39:48.745Z",
        beforeIds: [...f.journal.intents[0].beforeIds, source.id],
        status: "pending",
      },
    ],
  };
  const operation = {
    ...f.operation,
    kind: "bounded-environment-retry",
    status: "resumed",
    targetIdentity: f.runtimeIdentity,
  };
  const runtimeIdentity = {
    ...f.runtimeIdentity,
    sourceRevision: "f".repeat(40),
  };
  const authorization = {
    ...f.authorization,
    version: 2,
    operationId: "second-recovery",
    baselineIdentity: f.runtimeIdentity,
    targetIdentity: runtimeIdentity,
    runnerRunId: v2.repeatedCase.runnerRunId,
    lifecycleRunId: journal.runId,
    sourceEnvironmentId: source.id,
    decision: {
      ...f.authorization.decision,
      reference: "ran-2026-10-19-second-incident-recovery",
    },
    journalSha256: templateDigest(v2.journalBinding(journal)),
    intentSha256: templateDigest(v2.repeatedIntentBinding(journal.intents[1])),
    leaseSha256: templateDigest(journal.lease),
    originalWatchSha256: templateDigest(v2.originalWatchBinding(first)),
    deploymentOperationSha256: templateDigest(
      v2.deploymentOperationBinding(operation),
    ),
    providerHandoff: {
      deploymentId: v2.repeatedCase.deploymentId,
      imageDigest: v2.repeatedCase.imageDigest,
      volumeInstanceId: v2.repeatedCase.volumeInstanceId,
      deploymentStopped: true,
    },
  };
  await mkdir(join(f.config.controlDirectory, journal.runId));
  await mkdir(join(f.config.controlDirectory, "active-run"));
  await mkdir(join(f.root, "results", authorization.runnerRunId));
  const metadata = {
    runtimeIdentity: f.runtimeIdentity,
    templateSha256: templateDigest(f.config),
  };
  for (const [path, value] of Object.entries({
    [`control/${journal.runId}/journal.json`]: journal,
    "control/active-run/lease.json": journal.lease,
    "scheduler.json": { active: authorization.runnerRunId, blocked: true },
    [`results/${authorization.runnerRunId}/run.json`]: {
      ...f.receipt,
      id: authorization.runnerRunId,
    },
    "runtime.json": metadata,
    "deployment.json": operation,
  }))
    await durableJson(join(f.root, path), value);
  const prepare = async () =>
    prepareRetainedRecovery(
      {
        root: f.root,
        config: f.config,
        runtimeIdentity,
        metadata,
        operation: await f.read("deployment.json"),
        authorization,
      },
      f.dependencies,
    );
  const recover = () =>
    recoverRetainedIntent(
      {
        root: f.root,
        config: f.config,
        runtimeIdentity,
        operationId: authorization.operationId,
      },
      f.dependencies,
    );
  return {
    ...f,
    v2,
    first,
    source,
    secondJournal: journal,
    secondAuthorization: authorization,
    secondRuntime: runtimeIdentity,
    prepareSecond: prepare,
    recoverSecond: recover,
  };
}

test("second incident startup fences admission, preserves both watches and cleans late forks without deleting source", async (t) => {
  const f = await repeatedFixture(t);
  await f.prepareSecond();
  assert.equal((await f.read("deployment.json")).status, "draining");
  assert.deepEqual(await f.read("recovery.json"), f.first);
  await f.prepareSecond(); // replay after checkpoint/fence write
  const receipt = await f.recoverSecond();
  assert.equal(receipt.watches.length, 2);
  assert.equal(receipt.retainedSourceEnvironmentId, f.source.id);
  await assert.rejects(f.read("control/active-run/lease.json"), {
    code: "ENOENT",
  });
  const fork = {
    id: "late-fork",
    name: f.secondJournal.intents[1].name,
    projectId: f.config.projectId,
    createdAt: f.secondJournal.intents[1].startedAt,
    sourceEnvironment: { id: f.source.id },
  };
  f.values.push(f.late(), fork);
  await f.watch();
  assert.deepEqual(f.deleted.sort(), ["late-fork", "late-owned-env"]);
  assert.deepEqual(f.values, [f.source]);
  assert.deepEqual(
    await f.read(`control/${f.journal.runId}/journal.json`),
    f.journal,
  );
  assert.deepEqual(
    await f.read(`control/${f.secondJournal.runId}/journal.json`),
    f.secondJournal,
  );
  for (const id of [
    f.authorization.runnerRunId,
    f.secondAuthorization.runnerRunId,
  ]) {
    const saved = await f.read(`results/${id}/run.json`);
    assert.equal(saved.status, "failed");
    assert.equal(saved.cleanup, "retained-watch");
    assert.equal(
      saved.deadlineExceeded,
      id === f.authorization.runnerRunId ||
        Date.parse(f.secondJournal.expiresAt) < Date.now(),
    );
  }
});

test("second incident rejects changed bindings and preserves lease on unsafe source", async (t) => {
  const f = await repeatedFixture(t);
  f.secondAuthorization.providerHandoff.deploymentStopped = false;
  await assert.rejects(f.prepareSecond());
  f.secondAuthorization.providerHandoff.deploymentStopped = true;
  const hash = f.secondAuthorization.originalWatchSha256;
  f.secondAuthorization.originalWatchSha256 = "0".repeat(64);
  await assert.rejects(f.prepareSecond());
  f.secondAuthorization.originalWatchSha256 = hash;
  await f.prepareSecond();
  f.source.name = "wrong-source";
  await assert.rejects(f.recoverSecond(), /Retained source identity/);
  assert.equal(
    (await f.read("control/active-run/lease.json")).runId,
    f.secondJournal.runId,
  );
  assert.equal((await f.read("recovery-v2.json")).status, "prepared");
});

test("second incident replays interrupted fence and ownership transfer checkpoints", async (t) => {
  const f = await repeatedFixture(t);
  const oldOperation = await f.read("deployment.json");
  await f.prepareSecond();
  const snapshot = await f.read("recovery-v2.json");
  await durableJson(join(f.root, "deployment.json"), oldOperation);
  await f.prepareSecond();
  assert.deepEqual(await f.read("recovery-v2.json"), snapshot);
  assert.equal((await f.read("deployment.json")).status, "draining");
  await f.recoverSecond();
  // Recreate the original lease to model a crash after durable watch promotion
  // but before lease removal. No new authorization or journal rewrite is needed.
  await mkdir(join(f.config.controlDirectory, "active-run"));
  await durableJson(
    join(f.config.controlDirectory, "active-run/lease.json"),
    f.secondJournal.lease,
  );
  await f.recoverSecond();
  await assert.rejects(f.read("control/active-run/lease.json"), {
    code: "ENOENT",
  });
  assert.deepEqual((await f.read("recovery-v2.json")).originalWatch, f.first);
});

test("second incident scheduler requires explicit recover and resume across restart", async (t) => {
  const f = await repeatedFixture(t);
  await f.prepareSecond();
  const options = {
    root: f.root,
    config: f.config,
    runtimeIdentity: f.secondRuntime,
    execute: async () => 0,
    recoverRetained: (args) => recoverRetainedIntent(args, f.dependencies),
    reconcileRetained: (args) => reconcileRetainedIntent(args, f.dependencies),
  };
  let scheduler = await createScheduler(options);
  f.cleanup.push(() => scheduler.close());
  const request = {
    operationId: f.secondAuthorization.operationId,
    expectedRuntimeIdentity: f.secondRuntime,
  };
  assert.equal((await scheduler.start()).accepted, false);
  await scheduler.recover(request);
  assert.equal(scheduler.deployment().phase, "recovery-ready");
  assert.equal(scheduler.deployment().recovery.watches.length, 2);
  await scheduler.close();
  await f.prepareSecond();
  scheduler = await createScheduler(options);
  assert.equal((await scheduler.start()).accepted, false);
  await scheduler.resume(request);
  assert.equal(scheduler.deployment().phase, "running");
  assert.equal(scheduler.status().scheduleEnabled, false);
  await scheduler.tick();
  assert.equal(scheduler.status().blocked, false);
  assert.deepEqual(f.deleted, []);
  const start = await scheduler.start("single");
  assert.equal(start.accepted, true);
  await start.completion;
  assert.equal(scheduler.status().blocked, false);
});

test("second incident refuses wrong fork provenance, corrupt first snapshot and foreign lease", async (t) => {
  for (const scenario of [
    "fork",
    "snapshot",
    "lease",
    "populated-source",
    "version",
  ])
    await t.test(scenario, async (sub) => {
      const f = await repeatedFixture(sub);
      await f.prepareSecond();
      const originalWatch = await f.read("recovery.json");
      if (scenario === "version") {
        const state = await f.read("recovery-v2.json");
        state.version = 1;
        await durableJson(join(f.root, "recovery-v2.json"), state);
      }
      if (scenario === "fork")
        f.values.push({
          id: "unowned-fork",
          name: f.secondJournal.intents[1].name,
          projectId: f.config.projectId,
          createdAt: f.secondJournal.intents[1].startedAt,
          sourceEnvironment: { id: "other" },
        });
      if (scenario === "snapshot") {
        const state = await f.read("recovery-v2.json");
        state.originalWatch.originalJournal.phase = "complete";
        await durableJson(join(f.root, "recovery-v2.json"), state);
      }
      if (scenario === "lease")
        await durableJson(
          join(f.config.controlDirectory, "active-run/lease.json"),
          { ...f.secondJournal.lease, token: "foreign" },
        );
      if (scenario === "populated-source") {
        const original = f.dependencies.api.environment;
        f.dependencies.api.environment = async (id) => ({
          ...(await original(id)),
          serviceInstances: [{ serviceId: "unowned" }],
        });
      }
      await assert.rejects(f.recoverSecond());
      assert.deepEqual(f.deleted, []);
      assert.ok(await f.read("control/active-run/lease.json"));
      const currentWatch = await f.read("recovery.json");
      if (scenario === "fork") {
        assert.deepEqual(
          currentWatch.originalJournal,
          originalWatch.originalJournal,
        );
        assert.deepEqual(
          currentWatch.authorization,
          originalWatch.authorization,
        );
        assert.deepEqual(
          currentWatch.cleanupEvents,
          originalWatch.cleanupEvents,
        );
      } else assert.deepEqual(currentWatch, originalWatch);
      assert.equal((await f.read("recovery-v2.json")).status, "prepared");
    });
});

test("second incident rejects corrupted original watch version without overwriting either file", async (t) => {
  const f = await repeatedFixture(t);
  await f.prepareSecond();
  const first = await f.read("recovery.json");
  first.version = 2;
  await durableJson(join(f.root, "recovery.json"), first);
  const second = await f.read("recovery-v2.json");
  await assert.rejects(f.recoverSecond(), /original recovery version/);
  assert.deepEqual(await f.read("recovery.json"), first);
  assert.deepEqual(await f.read("recovery-v2.json"), second);
  assert.deepEqual(f.deleted, []);
});
