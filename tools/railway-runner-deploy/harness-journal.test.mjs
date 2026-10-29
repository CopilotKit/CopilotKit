import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  retainedHarnessJournal,
  harnessJournalCommand,
  createRetainedHarnessJournal,
} from "./harness-journal.mjs";
import { STAGING } from "./contract.mjs";
import {
  HARNESS_SCOPE,
  HARNESS_BASELINE,
} from "../../showcase/scripts/rollout-harness-policy.mjs";

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "durable-harness-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = {
    runner: STAGING,
    deploymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    releaseSha256: "e".repeat(64),
    operationId: "github-655515393-123",
    harnessImage: `ghcr.io/copilotkit/showcase-harness@sha256:${"a".repeat(64)}`,
    runnerImage: "candidate-runner",
    runtimeIdentity: { policySha256: "p" },
    templateSha256: "t",
    harnessPolicySha256: "p",
    harnessBaseline: HARNESS_BASELINE,
  };
  const options = {
    root,
    env: {
      RAILWAY_PROJECT_ID: STAGING.projectId,
      RAILWAY_ENVIRONMENT_ID: STAGING.environmentId,
      RAILWAY_SERVICE_ID: STAGING.serviceId,
      RAILWAY_DEPLOYMENT_ID: context.deploymentId,
    },
    mountInfo: "1 2 0:1 / /data rw - ext4 volume rw",
  };
  const receipt = {
    schemaVersion: 1,
    operationId: context.operationId,
    scope: HARNESS_SCOPE,
    baseline: HARNESS_BASELINE,
    baselineConfig: {
      source: { image: "ghcr.io/copilotkit/showcase-harness:latest" },
    },
    targetImage: context.harnessImage,
    phase: "source-requested",
  };
  const call = (action, value = receipt, ctx = context) =>
    retainedHarnessJournal({ action, receipt: value, context: ctx }, options);
  return { root, context, options, receipt, call };
}
test("immutable journal survives new client, records every phase and rejects changes or new operations", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.call("load"), null);
  await f.call("claim");
  for (const phase of ["deploy-requested", "deploy-acknowledged", "verified"])
    await f.call("save", {
      ...f.receipt,
      phase,
      ...(phase === "deploy-requested"
        ? {}
        : { deploymentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    });
  const fresh = await retainedHarnessJournal(
    { action: "load", context: f.context },
    f.options,
  );
  assert.equal(fresh.phase, "verified");
  await assert.rejects(
    f.call("load", undefined, {
      ...f.context,
      operationId: "github-655515393-456",
    }),
    /binding differs/,
  );
  await assert.rejects(f.call("save", fresh), /repeated checkpoint/);
});
test("concurrent claims and checkpoints admit exactly one writer", async (t) => {
  const f = await fixture(t);
  let results = await Promise.allSettled([f.call("claim"), f.call("claim")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const next = { ...f.receipt, phase: "deploy-requested" };
  results = await Promise.allSettled([
    f.call("save", next),
    f.call("save", next),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await f.call("load")).phase, "deploy-requested");
});
test("empty claim, torn checkpoint, and broken chain fail closed", async (t) => {
  for (const mode of ["empty", "torn", "chain"]) {
    const f = await fixture(t);
    const dir = join(f.root, "harness-policy-rollout");
    if (mode === "empty") await mkdir(dir);
    else {
      await f.call("claim");
      const file = join(dir, "0-source-requested.json");
      if (mode === "torn") await writeFile(file, '{"context":');
      else {
        const record = JSON.parse(await readFile(file));
        record.previousSha256 = "foreign";
        await writeFile(file, JSON.stringify(record));
      }
    }
    await assert.rejects(f.call("load"));
    await assert.rejects(f.call("claim"));
  }
});
test("wrong deployment, scope or missing mount is rejected before creating a claim", async (t) => {
  for (const change of [
    (o) => {
      o.env.RAILWAY_DEPLOYMENT_ID = "foreign";
    },
    (o) => {
      o.env.RAILWAY_SERVICE_ID = "foreign";
    },
    (o) => {
      o.mountInfo = "";
    },
  ]) {
    const f = await fixture(t);
    const options = structuredClone(f.options);
    change(options);
    await assert.rejects(
      retainedHarnessJournal(
        { action: "claim", context: f.context, receipt: f.receipt },
        options,
      ),
    );
    assert.equal(await f.call("load"), null);
  }
});
test("out-of-order phase or changed binding cannot advance a claim", async (t) => {
  const f = await fixture(t);
  await f.call("claim");
  await assert.rejects(
    f.call("save", {
      ...f.receipt,
      phase: "verified",
      deploymentId: f.context.deploymentId,
    }),
    /Out-of-order/,
  );
  await assert.rejects(
    f.call("save", {
      ...f.receipt,
      phase: "deploy-requested",
      baselineConfig: {},
    }),
    /binding changed/,
  );
  assert.equal((await f.call("load")).phase, "source-requested");
});
test("SSH transport guards volume/deployment and never retries a lost acknowledgment", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const state = {
    ...STAGING,
    active: {
      id: f.context.deploymentId,
      image: f.context.runnerImage,
      status: "SUCCESS",
    },
    latest: {
      id: f.context.deploymentId,
      image: f.context.runnerImage,
      status: "SUCCESS",
    },
  };
  const journal = createRetainedHarnessJournal({
    context: f.context,
    inspectRunner: async () => state,
    assertCandidateDrained: async () => {},
    env: {
      RAILWAY_TOKEN: "test-secret",
      RAILWAY_SSH_IDENTITY_FILE: "/fixture/identity",
    },
    execute: async (_command, args) => {
      calls++;
      assert.equal(
        args.some((a) => a.includes("test-secret")),
        false,
      );
      throw Error("worker disconnected");
    },
  });
  await assert.rejects(journal.claim(f.receipt), /outcome unknown/);
  assert.equal(calls, 1);
  state.volumeInstanceId = "foreign";
  await assert.rejects(journal.claim(f.receipt));
  assert.equal(calls, 1);
});
test("encoded SSH command treats hostile data as data, not shell code", async (t) => {
  const f = await fixture(t);
  const marker = join(f.root, "injected");
  const command = harnessJournalCommand({
    action: "load",
    context: { ...f.context, operationId: `$(touch ${marker});'` },
  });
  // Guard fails on this local host before filesystem access; command must never
  // execute injected data. This exercises actual shell/Node code reconstruction.
  await assert.rejects(
    promisify(execFile)("/bin/sh", ["-c", command], {
      env: { ...process.env, RAILWAY_PROJECT_ID: "foreign" },
    }),
  );
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});
test("missing explicit SSH identity fails before provider reads or automatic key setup", async () => {
  let calls = 0;
  const journal = createRetainedHarnessJournal({
    context: {},
    env: {},
    inspectRunner: async () => {
      calls++;
    },
    assertCandidateDrained: async () => {
      calls++;
    },
    execute: async () => {
      calls++;
    },
  });
  await assert.rejects(
    journal.load(),
    /Explicit registered Railway SSH identity required/,
  );
  assert.equal(calls, 0);
});
