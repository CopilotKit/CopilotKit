import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  reconcileVolumeCreateRecovery,
  volumeCreateCase,
} from "./volume-create-recovery.mjs";
import { durableJson } from "./journal.mjs";

import { volumeCreateFixture as fixture } from "./volume-create-fixture.mjs";

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
