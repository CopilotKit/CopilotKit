import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reconcileVolumeCreateRecovery,
  volumeCreateCase,
} from "./volume-create-recovery.mjs";
import { durableJson } from "./journal.mjs";
import { journalBinding } from "./recovery-v2.mjs";
import { templateDigest } from "./runner/deployment.mjs";
import { publishSnapshot } from "./contract.mts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "volume-create-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const c = volumeCreateCase;
  const config = {
    projectId: c.projectId,
    controlDirectory: join(root, "control"),
    recordsFile: join(root, "records.json"),
    consumers: [],
    permanentRunner: {
      projectId: c.projectId,
      serviceId: "4922b45b-6981-4559-be2f-fbbca9123323",
      environmentId: "8edfef02-ea09-4a20-8689-261f21cc2849",
      volumeId: "2a70e47d-85d4-4a8a-b17b-b6788c91b1c7",
    },
  };
  for (const path of [
    config.controlDirectory,
    join(config.controlDirectory, c.lifecycleRunId),
    join(config.controlDirectory, "active-run"),
    join(root, "results", c.runnerRunId),
  ])
    await mkdir(path, { recursive: true, mode: 0o700 });
  const intent = {
    kind: "createVolume",
    name: "rich-29fa2bf7831c268d19f-1-data",
    scope: c.redisServiceId,
    mountPath: c.mountPath,
    startedAt: c.startedAt,
    status: "pending",
    beforeIds: [config.permanentRunner.volumeId],
    failure: {
      version: 1,
      operation: "createVolume",
      outcome: "unknown",
      codes: ["BAD_USER_INPUT"],
    },
  };
  const environments = [
    {
      id: c.sourceEnvironmentId,
      name: "rich-29fa2bf7831c268d19f-source",
      projectId: c.projectId,
      createdAt: "2026-10-22T20:50:15.532Z",
      isEphemeral: true,
      sourceEnvironment: null,
    },
    {
      id: c.environmentId,
      name: "rich-29fa2bf7831c268d19f",
      projectId: c.projectId,
      createdAt: "2026-10-22T20:50:51.831Z",
      isEphemeral: true,
      sourceEnvironment: { id: c.sourceEnvironmentId },
    },
  ];
  const journal = {
    version: 1,
    provider: "railway",
    purpose: "acceptance",
    runId: c.lifecycleRunId,
    projectId: c.projectId,
    lease: {
      runId: c.lifecycleRunId,
      token: "private-fixture",
      pid: 2147483647,
    },
    startedAt: "2026-10-22T20:49:50.000Z",
    expiresAt: "2026-10-22T21:49:50.000Z",
    environmentName: "rich-29fa2bf7831c268d19f",
    environmentId: c.environmentId,
    environments,
    services: [{ id: c.redisServiceId }],
    volumes: [],
    domains: [],
    proxies: [],
    intents: [intent],
    phase: "interrupted",
    cleanup: { status: "failed" },
  };
  const receipt = {
    id: c.runnerRunId,
    status: "failed",
    cleanup: "failed",
    deadlineExceeded: false,
  };
  const authorization = {
    version: 1,
    kind: "redis-volume-create-retained-watch",
    decision: "operator-2026-10-22-one-time-recovery",
    journalBindingSha256: templateDigest(journalBinding(journal)),
    intentSha256: templateDigest(intent),
    leaseSha256: templateDigest(journal.lease),
    originalReceiptSha256: templateDigest(receipt),
  };
  const operation = {
    operationId: "volume-test-upgrade",
    kind: "retained-watch-upgrade",
    status: "draining",
    templateSha256: templateDigest(config),
    baselineIdentity: { sourceRevision: c.baselineRevision },
    removalProof: {
      method: "deploymentRemove",
      status: "REMOVED",
      ...config.permanentRunner,
    },
    volumeRecovery: authorization,
  };
  const journalPath = join(
    config.controlDirectory,
    c.lifecycleRunId,
    "journal.json",
  );
  await durableJson(journalPath, journal);
  await durableJson(
    join(config.controlDirectory, "active-run/lease.json"),
    journal.lease,
  );
  await durableJson(join(root, "results", c.runnerRunId, "run.json"), receipt);
  await publishSnapshot(config.recordsFile, { initialize: true });
  const record = {
    runId: c.lifecycleRunId,
    projectId: c.projectId,
    environmentId: c.environmentId,
    startedAt: journal.startedAt,
    expiresAt: journal.expiresAt,
    phase: "teardown",
    services: [],
    resources: [
      { kind: "environment", id: c.environmentId },
      { kind: "source-environment", id: c.sourceEnvironmentId },
    ],
  };
  await publishSnapshot(config.recordsFile, { run: record });
  const state = {
    volumes: [],
    services: [],
    environments: environments.map((e) => ({
      ...e,
      serviceInstances: [],
      volumeInstances: [],
    })),
    calls: [],
    savedBinding: null,
  };
  const dependencies = {
    api: {
      list: async (kind) => {
        state.calls.push(kind);
        return structuredClone(state[kind]);
      },
      environment: async (id) =>
        structuredClone(state.environments.find((e) => e.id === id)),
      request: async () => {
        throw Error("Unexpected provider mutation");
      },
    },
    ownerAlive: async () => false,
    distribute: async () => {},
    beforeTransfer: async (binding) => {
      assert.ok(await readFile(join(root, "volume-create-recovery.json")));
      state.savedBinding = binding;
    },
  };
  return {
    root,
    config,
    operation,
    journal,
    journalPath,
    state,
    dependencies,
    args: { root, config, operation },
  };
}

test("exact recovery persists ownership before releasing lease and preserves failed evidence", async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.journalPath, "utf8");
  const result = await reconcileVolumeCreateRecovery(f.args, f.dependencies);
  assert.equal(result.lifecycleRunId, volumeCreateCase.lifecycleRunId);
  assert.equal(result.bindingSha256, f.state.savedBinding);
  await assert.rejects(
    readFile(join(f.config.controlDirectory, "active-run/lease.json")),
    { code: "ENOENT" },
  );
  assert.equal(await readFile(f.journalPath, "utf8"), before);
  const receipt = JSON.parse(
    await readFile(
      join(f.root, "results", volumeCreateCase.runnerRunId, "run.json"),
    ),
  );
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.cleanup, "retained-watch");
  assert.equal(receipt.deadlineExceeded, true);
  assert.equal(result.providerFinality, "unknown");
  assert.equal(
    JSON.parse(await readFile(f.config.recordsFile)).runs[0].phase,
    "complete",
  );
  const restarted = await reconcileVolumeCreateRecovery(
    { ...f.args, operation: {}, expectedBinding: result.bindingSha256 },
    f.dependencies,
  );
  assert.equal(restarted.bindingSha256, result.bindingSha256);
});

for (const mode of [
  "unremoved",
  "changed-intent",
  "live-owner",
  "inventory-failure",
  "late-volume",
  "missing-environment",
  "foreign-service",
])
  test(`volume recovery refuses ${mode} without releasing ownership`, async (t) => {
    const f = await fixture(t);
    if (mode === "unremoved") f.operation.removalProof.status = "SUCCESS";
    if (mode === "changed-intent") {
      f.journal.intents[0].mountPath = "/other";
      await durableJson(f.journalPath, f.journal);
    }
    if (mode === "live-owner") f.dependencies.ownerAlive = async () => true;
    if (mode === "inventory-failure")
      f.dependencies.api.list = async () => {
        throw Error("incomplete inventory");
      };
    if (mode === "late-volume")
      f.state.volumes.push({
        id: "late-volume",
        projectId: volumeCreateCase.projectId,
        createdAt: volumeCreateCase.startedAt,
        volumeInstances: {
          pageInfo: { hasNextPage: false },
          edges: [
            {
              node: {
                environmentId: volumeCreateCase.environmentId,
                serviceId: volumeCreateCase.redisServiceId,
                mountPath: volumeCreateCase.mountPath,
              },
            },
          ],
        },
      });
    if (mode === "missing-environment") f.state.environments.pop();
    if (mode === "foreign-service")
      f.state.environments[1].serviceInstances.push({
        serviceId: "unexpected",
      });
    await assert.rejects(reconcileVolumeCreateRecovery(f.args, f.dependencies));
    assert.ok(
      await readFile(join(f.config.controlDirectory, "active-run/lease.json")),
    );
  });

test("missing watch after transfer cannot silently reopen admission", async (t) => {
  const f = await fixture(t);
  const result = await reconcileVolumeCreateRecovery(f.args, f.dependencies);
  await rm(join(f.root, "volume-create-recovery.json"));
  await assert.rejects(
    reconcileVolumeCreateRecovery(
      { ...f.args, operation: {}, expectedBinding: result.bindingSha256 },
      f.dependencies,
    ),
  );
});

test("no authorized volume recovery makes no provider requests", async (t) => {
  const f = await fixture(t);
  assert.equal(
    await reconcileVolumeCreateRecovery(
      { ...f.args, operation: {} },
      f.dependencies,
    ),
    null,
  );
  assert.deepEqual(f.state.calls, []);
});

test("late volume after completed transfer blocks further ownership reconciliation", async (t) => {
  const f = await fixture(t);
  const result = await reconcileVolumeCreateRecovery(f.args, f.dependencies);
  f.state.volumes.push({
    id: "late-unattached",
    projectId: volumeCreateCase.projectId,
    createdAt: volumeCreateCase.startedAt,
    volumeInstances: { pageInfo: { hasNextPage: false }, edges: [] },
  });
  await assert.rejects(
    reconcileVolumeCreateRecovery(
      { ...f.args, operation: {}, expectedBinding: result.bindingSha256 },
      f.dependencies,
    ),
    /ambiguous ownership/,
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(f.root, "results", volumeCreateCase.runnerRunId, "run.json"),
      ),
    ).status,
    "failed",
  );
});

test("failed registry distribution keeps the exact active lease", async (t) => {
  const f = await fixture(t);
  f.dependencies.distribute = async () => {
    throw Error("reader unavailable");
  };
  await assert.rejects(
    reconcileVolumeCreateRecovery(f.args, f.dependencies),
    /reader unavailable/,
  );
  assert.ok(
    await readFile(join(f.config.controlDirectory, "active-run/lease.json")),
  );
  assert.equal(f.state.savedBinding, null);
});
