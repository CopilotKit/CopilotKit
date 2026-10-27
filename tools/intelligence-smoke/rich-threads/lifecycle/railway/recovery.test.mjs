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
    ...(options.inspectorImage
      ? {
          services: [
            {
              key: "inspector",
              roles: ["inspection-worker"],
              image: options.inspectorImage,
            },
          ],
        }
      : {}),
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
  const drained = await scheduler.drain({
    operationId: "ordinary",
    targetIdentity: f.runtimeIdentity,
  });
  assert.equal(drained.phase, "drained");
  assert.equal(drained.recovery.originalStatus, "failed");
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
async function repeatedFixture(t, options = {}) {
  const v2 = await import("./recovery-v2.mjs");
  const f = await fixture(t, {
    volumeId: "2a70e47d-85d4-4a8a-b17b-b6788c91b1c7",
    sourceRevision: v2.repeatedCase.baselineRevision,
    ...options,
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
      version: 1,
      method: "deploymentRemove",
      deploymentId: v2.repeatedCase.deploymentId,
      imageDigest: v2.repeatedCase.imageDigest,
      volumeInstanceId: v2.repeatedCase.volumeInstanceId,
      deploymentStatus: "REMOVED",
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

const image = (c) =>
  `ghcr.io/copilotkit/rich-thread-inspector@sha256:${c === "1" ? "e9404c9c986b73d0d980495f4bf0a63b174591770abeff80b9a4cb30c680d981" : "1c5249083985cde25d8422ebc6a7ca7007d8eb92477daa5b854fe10c7ed2dd71"}`;

for (const [second, drained] of [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])
  test(`established ${second ? "two" : "one"} watch upgrade from ${drained ? "same-image drain" : "resumed recovery"} preserves evidence and supports ordinary drain/resume`, async (t) => {
    const f = await (second ? repeatedFixture : fixture)(t, {
      inspectorImage: image("1"),
    });
    if (second) {
      await f.prepareSecond();
      await f.recoverSecond();
    } else {
      await f.prepare();
      await f.recover();
    }
    const path = second ? "recovery-v2.json" : "recovery.json";
    const state = await f.read(path);
    const baseline = second ? f.secondRuntime : f.runtimeIdentity;
    const auth = second ? f.secondAuthorization : f.authorization;
    const operation = {
      version: 1,
      kind: "bounded-environment-retry",
      status: "resumed",
      operationId: auth.operationId,
      baselineIdentity: auth.baselineIdentity,
      targetIdentity: baseline,
      templateSha256: templateDigest(f.config),
    };
    await durableJson(join(f.root, "deployment.json"), operation);
    await durableJson(join(f.root, "runtime.json"), {
      runtimeIdentity: baseline,
      templateSha256: templateDigest(f.config),
    });
    await durableJson(join(f.root, "scheduler.json"), {
      version: 1,
      active: null,
      blocked: false,
    });
    const template = structuredClone(f.config);
    template.services[0].image = image("2");
    const target = {
      ...baseline,
      sourceRevision: "2".repeat(40),
      compatibilitySha256: "3".repeat(64),
      policySha256: "4".repeat(64),
    };
    const upgradeAuthorization = {
      operationId: "reviewed-watch-upgrade",
      baselineIdentity: baseline,
      targetIdentity: target,
      baselineTemplateSha256: templateDigest(f.config),
      targetTemplateSha256: templateDigest(template),
      recoveryBindingSha256: templateDigest({
        operationId: auth.operationId,
        lifecycleRunId: auth.lifecycleRunId,
        runnerRunId: auth.runnerRunId,
        oldJournalSha256: state.oldJournalSha256,
        authorizationSha256: templateDigest(state.authorization),
        originalReceiptSha256: state.originalReceiptSha256,
        originalWatchSnapshotSha256: state.originalWatch
          ? templateDigest(state.originalWatch)
          : undefined,
      }),
      removalProof: {
        version: 1,
        method: "deploymentRemove",
        status: "REMOVED",
        deploymentId: "old-deployment",
        image: `ghcr.io/copilotkit/rich-thread-runner@sha256:${"1".repeat(64)}`,
        ...f.config.permanentRunner,
        volumeInstanceId: second
          ? f.v2.repeatedCase.volumeInstanceId
          : "retained-attachment",
        mountPath: "/data",
        observedAt: new Date().toISOString(),
      },
    };
    if (drained) {
      await durableJson(join(f.root, "deployment.json"), {
        version: 1,
        operationId: upgradeAuthorization.operationId,
        baselineIdentity: baseline,
        targetIdentity: baseline,
        templateSha256: templateDigest(f.config),
        recoveryBindingSha256: upgradeAuthorization.recoveryBindingSha256,
        requestedAt: new Date().toISOString(),
        status: "drained",
      });
      const drain = await f.read("deployment.json");
      for (const patch of [
        { status: "draining" },
        { status: "resumed" },
        { targetIdentity: target },
        { baselineIdentity: target },
        { templateSha256: "0".repeat(64) },
        { recoveryBindingSha256: "0".repeat(64) },
        { operationId: "other-drain" },
      ]) {
        const invalid = { ...drain, ...patch };
        await durableJson(join(f.root, "deployment.json"), invalid);
        await assert.rejects(
          checkStartup({
            root: f.root,
            template,
            runtimeIdentity: target,
            upgradeAuthorization,
          }),
        );
        assert.deepEqual(await f.read("deployment.json"), invalid);
        assert.deepEqual(await f.read(path), state);
        assert.deepEqual(await f.read("private/template.json"), f.config);
      }
      await durableJson(join(f.root, "deployment.json"), drain);
    }
    await assert.rejects(
      checkStartup({ root: f.root, template, runtimeIdentity: target }),
    );
    for (const mutate of [
      (a) => {
        a.recoveryBindingSha256 = "0".repeat(64);
      },
      (a) => {
        a.baselineIdentity = target;
      },
      (a) => {
        a.removalProof.status = "SUCCESS";
      },
      (a) => {
        a.removalProof.volumeId = "other-volume";
      },
      (a) => {
        a.targetTemplateSha256 = "0".repeat(64);
      },
    ]) {
      const bad = structuredClone(upgradeAuthorization);
      mutate(bad);
      await assert.rejects(
        checkStartup({
          root: f.root,
          template,
          runtimeIdentity: target,
          upgradeAuthorization: bad,
        }),
      );
      assert.deepEqual(await f.read(path), state);
      assert.deepEqual(await f.read("private/template.json"), f.config);
    }
    const changed = structuredClone(template);
    changed.controlDirectory += "-other";
    await assert.rejects(
      checkStartup({
        root: f.root,
        template: changed,
        runtimeIdentity: target,
        upgradeAuthorization: {
          ...upgradeAuthorization,
          targetTemplateSha256: templateDigest(changed),
        },
      }),
    );
    const unapproved = structuredClone(template);
    unapproved.services[0].image = `ghcr.io/copilotkit/rich-thread-inspector@sha256:${"0".repeat(64)}`;
    await assert.rejects(
      checkStartup({
        root: f.root,
        template: unapproved,
        runtimeIdentity: target,
        upgradeAuthorization: {
          ...upgradeAuthorization,
          targetTemplateSha256: templateDigest(unapproved),
        },
      }),
      /registry approval/,
    );
    const marker = await f.read("initialized.json");
    await durableJson(join(f.root, "initialized.json"), {
      ...marker,
      volumeId: "foreign",
    });
    await assert.rejects(
      checkStartup({
        root: f.root,
        template,
        runtimeIdentity: target,
        upgradeAuthorization,
      }),
    );
    await durableJson(join(f.root, "initialized.json"), marker);
    const { processOwner } = await import("./process-owner.mjs");
    await mkdir(join(f.root, "scheduler-lock"));
    await durableJson(
      join(f.root, "scheduler-lock/owner.json"),
      await processOwner(),
    );
    await assert.rejects(
      checkStartup({
        root: f.root,
        template,
        runtimeIdentity: target,
        upgradeAuthorization,
      }),
      /alive/,
    );
    await rm(join(f.root, "scheduler-lock"), { recursive: true });
    const metadata = await checkStartup({
      root: f.root,
      template,
      runtimeIdentity: target,
      upgradeAuthorization,
    });
    // Replay both crash boundaries: operation written, then current template written,
    // while runtime metadata still belongs to the previous deployment.
    for (const current of [f.config, template]) {
      await durableJson(join(f.root, "private/template.json"), current);
      await checkStartup({
        root: f.root,
        template,
        runtimeIdentity: target,
        upgradeAuthorization,
      });
      assert.equal((await f.read("deployment.json")).status, "draining");
    }
    await durableJson(join(f.root, "runtime.json"), metadata);
    assert.deepEqual(await f.read(path), state);
    assert.deepEqual(await f.read("private/recovery-template.json"), f.config);
    assert.deepEqual(await f.read("private/template.json"), template);
    await checkStartup({ root: f.root, template, runtimeIdentity: target });
    for (const alter of [
      (s) => {
        s.authorization.targetIdentity.sourceRevision = "0".repeat(40);
      },
      (s) => {
        s.originalReceipt.status = "passed";
      },
      (s) => {
        s.originalJournal.lease.token = "changed";
      },
    ]) {
      const corrupt = structuredClone(state);
      alter(corrupt);
      await durableJson(join(f.root, path), corrupt);
      await assert.rejects(
        checkStartup({ root: f.root, template, runtimeIdentity: target }),
      );
      await durableJson(join(f.root, path), state);
    }
    const watch = (args) => reconcileRetainedIntent(args, f.dependencies);
    const scheduler = await createScheduler({
      root: f.root,
      config: template,
      runtimeIdentity: target,
      recover: async () => {},
      reconcileRetained: watch,
    });
    assert.equal(scheduler.deployment().phase, "drained");
    assert.equal(scheduler.deployment().recovery.originalStatus, "failed");
    await scheduler.resume({
      operationId: upgradeAuthorization.operationId,
      expectedRuntimeIdentity: target,
    });
    assert.equal(scheduler.deployment().phase, "running");
    const next = { ...target, sourceRevision: "5".repeat(40) };
    await scheduler.drain({
      operationId: "next-branch-image",
      targetIdentity: next,
    });
    assert.equal(scheduler.deployment().phase, "drained");
    await scheduler.close();
    const nextOperation = await f.read("deployment.json");
    await durableJson(join(f.root, "deployment.json"), {
      ...nextOperation,
      status: "draining",
    });
    await assert.rejects(
      checkStartup({ root: f.root, template, runtimeIdentity: next }),
    );
    await durableJson(join(f.root, "deployment.json"), nextOperation);
    await checkStartup({
      root: f.root,
      template,
      runtimeIdentity: next,
      upgradeAuthorization,
    });
    const restarted = await createScheduler({
      root: f.root,
      config: template,
      runtimeIdentity: next,
      recover: async () => {},
      reconcileRetained: watch,
    });
    f.cleanup.push(() => restarted.close());
    await restarted.resume({
      operationId: "next-branch-image",
      expectedRuntimeIdentity: next,
    });
    assert.equal(restarted.deployment().phase, "running");
    assert.equal(restarted.deployment().recovery.providerFinality, "unknown");
    const after = await f.read(path);
    assert.deepEqual(after.authorization, state.authorization);
    assert.deepEqual(after.originalJournal, state.originalJournal);
    assert.deepEqual(after.originalReceipt, state.originalReceipt);
  });

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
  f.secondAuthorization.providerHandoff.deploymentStatus = "STOPPED";
  await assert.rejects(f.prepareSecond());
  f.secondAuthorization.providerHandoff.deploymentStatus = "REMOVED";
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

for (const [field, value] of [
  ["deploymentStatus", "STOPPING"],
  ["deploymentStatus", "CANCELLED"],
  ["deploymentStatus", null],
  ["deploymentStatus", undefined],
  ["version", 2],
  ["method", "deploymentStop"],
  ["deploymentId", "other-deployment"],
  ["imageDigest", "sha256:" + "0".repeat(64)],
  ["volumeInstanceId", "other-volume-instance"],
])
  test(`removed deployment handoff rejects ${field}=${value}`, async (t) => {
    const f = await repeatedFixture(t);
    f.secondAuthorization.providerHandoff[field] = value;
    await assert.rejects(f.prepareSecond());
    await assert.rejects(f.read("recovery-v2.json"), { code: "ENOENT" });
    assert.equal(
      (await f.read("control/active-run/lease.json")).runId,
      f.secondJournal.runId,
    );
  });
function legacyHandoff(value) {
  const { deploymentId, imageDigest, volumeInstanceId } = value;
  return {
    deploymentId,
    imageDigest,
    volumeInstanceId,
    deploymentStopped: true,
  };
}
test("legacy stopped assertion cannot prepare or activate a new recovery", async (t) => {
  const f = await repeatedFixture(t);
  f.secondAuthorization.providerHandoff = legacyHandoff(
    f.secondAuthorization.providerHandoff,
  );
  await assert.rejects(f.prepareSecond());
  await assert.rejects(f.read("recovery-v2.json"), { code: "ENOENT" });
});
test("persisted legacy prepared handoff stays blocked without rewriting evidence", async (t) => {
  const f = await repeatedFixture(t);
  await f.prepareSecond();
  const state = await f.read("recovery-v2.json");
  state.authorization.providerHandoff = legacyHandoff(
    state.authorization.providerHandoff,
  );
  await durableJson(join(f.root, "recovery-v2.json"), state);
  const original = await readFile(join(f.root, "recovery-v2.json"), "utf8");
  await assert.rejects(f.recoverSecond());
  assert.equal(
    await readFile(join(f.root, "recovery-v2.json"), "utf8"),
    original,
  );
  assert.equal(
    (await f.read("control/active-run/lease.json")).runId,
    f.secondJournal.runId,
  );
});
test("established legacy watch remains readable with its authorization unchanged", async (t) => {
  const f = await repeatedFixture(t);
  await f.prepareSecond();
  await f.recoverSecond();
  const state = await f.read("recovery-v2.json");
  state.authorization.providerHandoff = legacyHandoff(
    state.authorization.providerHandoff,
  );
  await durableJson(join(f.root, "recovery-v2.json"), state);
  const original = structuredClone(state.authorization);
  await f.watch();
  assert.deepEqual((await f.read("recovery-v2.json")).authorization, original);
  assert.deepEqual(
    await f.read(`control/${f.secondJournal.runId}/journal.json`),
    f.secondJournal,
  );
  await assert.rejects(f.prepareSecond());
  assert.deepEqual((await f.read("recovery-v2.json")).authorization, original);
});
