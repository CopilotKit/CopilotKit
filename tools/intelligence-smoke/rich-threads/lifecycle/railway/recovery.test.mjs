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

async function fixture(t) {
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
      volumeId: "permanent-volume",
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
    sourceRevision: "d".repeat(40),
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
