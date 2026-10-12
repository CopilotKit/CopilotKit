import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishSnapshot } from "./snapshot-publisher";
import { DISPOSABLE_LIFECYCLE_POLICY } from "../../showcase/scripts/railway-envs";
import { readRailwayLifecycleEvidence } from "../../showcase/harness/src/shared/railway-lifecycle-records";
import { classifyRailwayInventory } from "../../showcase/harness/src/shared/railway-lifecycle";
import type { RunRecord } from "../../showcase/harness/src/shared/railway-lifecycle";

const now = new Date("2026-10-12T12:00:00Z");
const run: RunRecord = {
  runId: "offline-fixture",
  projectId: DISPOSABLE_LIFECYCLE_POLICY.projectId,
  environmentId: "offline-environment",
  startedAt: now.toISOString(),
  expiresAt: "2026-10-12T13:00:00Z",
  phase: "setup",
  services: [],
  resources: [{ kind: "environment", id: "offline-environment" }],
};

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "railway-publisher-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "runs.json");
}

test("published bytes are accepted by the real PNI607 reader and retain unverified cleanup diagnostics", async (t) => {
  const file = await fixture(t);
  await publishSnapshot(file, { initialize: true }, now);
  const receipt = await publishSnapshot(file, { run }, now);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const evidence = await readRailwayLifecycleEvidence(
    file,
    DISPOSABLE_LIFECYCLE_POLICY,
    now,
  );
  assert.equal(evidence.status, "valid");
  const result = classifyRailwayInventory({
    policy: DISPOSABLE_LIFECYCLE_POLICY,
    evidence,
    now,
    projectId: run.projectId,
    observedEnvironmentIds: [run.environmentId],
    services: [],
  });
  assert.ok(
    result.diagnostics.some(
      (d) => d.code === "non-service-presence-unverified",
    ),
  );
  assert.deepEqual(result.excludedServices, []);
});

test("an unapproved image cannot enter the snapshot and failure preserves prior bytes", async (t) => {
  const file = await fixture(t);
  await publishSnapshot(file, { initialize: true }, now);
  const before = await readFile(file, "utf8");
  await assert.rejects(
    publishSnapshot(
      file,
      {
        run: {
          ...run,
          services: [
            {
              name: "offline-service",
              serviceId: "offline-id",
              expectedImage: `ghcr.io/copilotkit/intelligence/composite@sha256:${"1".repeat(64)}`,
            },
          ],
        },
      },
      now,
    ),
    /Invalid run snapshot/,
  );
  assert.equal(await readFile(file, "utf8"), before);
});

test("terminal records and resource IDs survive updates; lifecycle cannot be silently reset", async (t) => {
  const file = await fixture(t);
  await publishSnapshot(file, { initialize: true }, now);
  await publishSnapshot(file, { run }, now);
  await assert.rejects(
    publishSnapshot(file, { run: { ...run, resources: [] } }, now),
    /must be retained/,
  );
  await publishSnapshot(file, { run: { ...run, phase: "teardown" } }, now);
  await publishSnapshot(file, { run: { ...run, phase: "complete" } }, now);
  await assert.rejects(publishSnapshot(file, { run }, now), /phase transition/);
  const next = {
    ...run,
    runId: "offline-next",
    environmentId: "offline-next-env",
    resources: [{ kind: "environment", id: "offline-next-env" }],
  };
  const receipt = await publishSnapshot(file, { run: next }, now);
  assert.equal(receipt.snapshot.runs.length, 2);
  assert.equal(receipt.snapshot.runs[0].phase, "complete");
});

test("missing and malformed configured evidence never become empty snapshots", async (t) => {
  const file = await fixture(t);
  await assert.rejects(publishSnapshot(file, { run }, now), /ENOENT/);
  await writeFile(file, "broken", { mode: 0o600 });
  await assert.rejects(publishSnapshot(file, { run }, now), SyntaxError);
  await assert.rejects(
    publishSnapshot(file, { initialize: true }, now),
    /already exists/,
  );
  assert.equal(await readFile(file, "utf8"), "broken");
});

test("interrupted writer lock is never stolen and overlapping active runs fail", async (t) => {
  const file = await fixture(t);
  await publishSnapshot(file, { initialize: true }, now);
  await mkdir(`${file}.lock`);
  await assert.rejects(publishSnapshot(file, { run }, now), /EEXIST/);
  await rm(`${file}.lock`, { recursive: true });
  await publishSnapshot(file, { run }, now);
  await assert.rejects(
    publishSnapshot(
      file,
      {
        run: {
          ...run,
          runId: "second",
          environmentId: "second-env",
          resources: [],
        },
      },
      now,
    ),
    /Invalid run snapshot/,
  );
});
