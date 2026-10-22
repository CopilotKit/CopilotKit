import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduler, reconcile } from "./scheduler.mjs";
import { durableJson } from "../journal.mjs";
async function setup(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "railway-runner-test-"));
  const scheduler = await createScheduler({
    root,
    config: {},
    recover: async () => {},
    execute: async () => 0,
    clock: () => 100,
    ...overrides,
  });
  t.after(async () => {
    await scheduler.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, scheduler };
}
test("healthy idle ticks reconcile every 15 minutes without scheduling tests", async (t) => {
  let now = 100;
  let recoveries = 0;
  let executions = 0;
  const { scheduler } = await setup(t, {
    clock: () => now,
    recover: async () => {
      recoveries++;
    },
    execute: async () => {
      executions++;
      return 0;
    },
  });
  now += 30_000;
  await scheduler.tick();
  assert.equal(executions, 0);
  assert.equal(recoveries, 1);
  now = 100 + 15 * 60_000 - 1;
  await scheduler.tick();
  assert.equal(recoveries, 1);
  now++;
  await scheduler.tick();
  assert.equal(recoveries, 2);
  assert.equal(scheduler.status().scheduleEnabled, false);
  const manual = await scheduler.start("single");
  assert.equal(manual.accepted, true);
  await manual.completion;
  assert.equal(
    recoveries,
    4,
    "Manual admission and completion need fresh checks",
  );
  assert.equal(executions, 1);
  now += 8 * 60 * 60 * 1000;
  await scheduler.tick();
  assert.equal(executions, 1);
  assert.equal(scheduler.status().scheduleEnabled, false);
});

test("manual admission checks ownership even within the idle cooldown", async (t) => {
  let fails = false;
  const { scheduler } = await setup(t, {
    recover: async () => {
      if (fails) throw new Error("ownership changed while idle");
    },
  });
  fails = true;
  assert.deepEqual(await scheduler.start(), {
    accepted: false,
    reason: "cleanup-blocked",
  });
  assert.equal(scheduler.status().blocked, true);
});

test("clock rollback cannot postpone healthy idle reconciliation", async (t) => {
  let now = 100;
  let recoveries = 0;
  const { scheduler } = await setup(t, {
    clock: () => now,
    recover: async () => {
      recoveries++;
    },
  });
  now--;
  await scheduler.tick();
  assert.equal(recoveries, 2);
});

test(
  "explicitly enabled scheduling starts a due run",
  { timeout: 5000 },
  async (t) => {
    let finish;
    let started;
    const execution = new Promise((resolve) => {
      started = resolve;
    });
    const { scheduler } = await setup(t, {
      scheduleEnabled: true,
      execute: () =>
        new Promise((resolve) => {
          finish = resolve;
          started();
        }),
    });
    await scheduler.tick();
    await execution;
    assert.equal(scheduler.status().scheduleEnabled, true);
    assert.equal(scheduler.status().busy, true);
    finish(0);
    while (scheduler.status().busy)
      await new Promise((resolve) => setTimeout(resolve, 5));
  },
);

test("manual-only ticks still block runs when cleanup fails", async (t) => {
  let now = 100;
  let fails = false;
  let recoveries = 0;
  const { scheduler } = await setup(t, {
    clock: () => now,
    recover: async () => {
      recoveries++;
      if (fails) throw new Error("cleanup unavailable");
    },
  });
  fails = true;
  now += 15 * 60_000;
  await scheduler.tick();
  assert.equal(scheduler.status().blocked, true);
  assert.equal((await scheduler.start("single")).accepted, false);
  const before = recoveries;
  fails = false;
  now += 30_000;
  await scheduler.tick();
  assert.equal(
    recoveries,
    before + 1,
    "Blocked recovery keeps the fast cadence",
  );
  assert.equal(scheduler.status().blocked, false);
});
test("permanent scheduler serializes manual/timer runs and retains failed results", async (t) => {
  let finish, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const { root, scheduler } = await setup(t, {
    execute: () =>
      new Promise((resolve) => {
        finish = resolve;
        entered();
      }),
  });
  const first = await scheduler.start();
  assert.equal(first.accepted, true);
  assert.equal((await scheduler.start()).accepted, false);
  await scheduler.tick();
  await started;
  finish(1);
  await first.completion;
  const receipt = JSON.parse(
    await readFile(join(root, "results", first.id, "run.json")),
  );
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.cleanup, "passed");
  assert.equal(scheduler.status().nextRunAt, 100 + 4 * 60 * 60 * 1000);
});
test("failed startup/periodic recovery blocks new runs", async (t) => {
  let recoveryFails = true,
    executed = false;
  const { scheduler } = await setup(t, {
    recover: async () => {
      if (recoveryFails) throw new Error("provider outage");
    },
    execute: async () => {
      executed = true;
      return 0;
    },
  });
  assert.equal(scheduler.status().blocked, true);
  assert.equal((await scheduler.start()).accepted, false);
  await scheduler.tick();
  assert.equal(executed, false);
  recoveryFails = false;
  const run = await scheduler.start();
  await run.completion;
  assert.equal(executed, true);
});
test("startup resumes interrupted journal before retaining recovery result", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "railway-runner-restart-"));
  const id = "run-11111111-1111-4111-8111-111111111111";
  await mkdir(join(root, "results", id), { recursive: true });
  await durableJson(join(root, "results", id, "run.json"), {
    id,
    status: "running",
  });
  await durableJson(join(root, "scheduler.json"), {
    version: 1,
    active: id,
    nextRunAt: 500,
    blocked: false,
  });
  let recovered = false;
  const scheduler = await createScheduler({
    root,
    config: {},
    recover: async () => {
      recovered = true;
    },
    clock: () => 100,
  });
  t.after(async () => {
    await scheduler.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(recovered, true);
  const receipt = JSON.parse(
    await readFile(join(root, "results", id, "run.json")),
  );
  assert.equal(receipt.status, "interrupted-cleaned");
  assert.equal(receipt.cleanup, "passed");
  assert.equal(scheduler.status().active, null);
});

test("shutdown during pending recovery cannot start a worker", async (t) => {
  let release;
  let entered;
  let recoveries = 0,
    executed = false;
  const pending = new Promise((resolve) => {
    entered = resolve;
  });
  const { scheduler } = await setup(t, {
    recover: async () => {
      if (++recoveries === 2) {
        entered();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
    },
    execute: async () => {
      executed = true;
      return 0;
    },
  });
  const start = scheduler.start();
  await pending;
  await scheduler.close();
  release();
  assert.equal((await start).accepted, false);
  assert.equal(executed, false);
});

test("late verified cleanup fails only its owning attempt", async (t) => {
  const control = await mkdtemp(join(tmpdir(), "railway-deadline-test-"));
  t.after(() => rm(control, { recursive: true, force: true }));
  let calls = 0;
  const { root, scheduler } = await setup(t, {
    config: { controlDirectory: control },
    execute: async () => {
      const runId = `attempt-${++calls}`;
      await mkdir(join(control, runId));
      await durableJson(join(control, runId, "journal.json"), {
        runId,
        phase: "complete",
        intents: [],
        cleanup: { status: "passed", deadlineExceeded: calls === 1 },
      });
      return 0;
    },
  });
  const first = await scheduler.start();
  await first.completion;
  const firstResult = JSON.parse(
    await readFile(join(root, "results", first.id, "run.json")),
  );
  assert.equal(firstResult.status, "failed");
  assert.equal(firstResult.deadlineExceeded, true);
  const second = await scheduler.start();
  await second.completion;
  const secondResult = JSON.parse(
    await readFile(join(root, "results", second.id, "run.json")),
  );
  assert.equal(secondResult.status, "passed");
  assert.equal(secondResult.deadlineExceeded, false);
});

test("restart before crash-control checkpoint does not certify hosted crash proof", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "railway-crash-proof-"));
  const id = "run-11111111-1111-4111-8111-111111111111";
  await mkdir(join(root, "results", id), { recursive: true });
  await durableJson(join(root, "results", id, "run.json"), {
    id,
    mode: "crash-recovery",
    crashStage: "recorded-volume",
    status: "running",
  });
  await durableJson(join(root, "scheduler.json"), {
    version: 1,
    active: id,
    nextRunAt: 500,
    blocked: false,
  });
  const scheduler = await createScheduler({
    root,
    config: {},
    recover: async () => {},
    clock: () => 100,
  });
  t.after(async () => {
    await scheduler.close();
    await rm(root, { recursive: true, force: true });
  });
  const receipt = JSON.parse(
    await readFile(join(root, "results", id, "run.json")),
  );
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.crashReached, false);
});

const identity = {
  protocolVersion: 1,
  sourceRevision: "a".repeat(40),
  sourceManifestSha256: "a".repeat(64),
  compatibilitySha256: "b".repeat(64),
  policySha256: "c".repeat(64),
};
const targetIdentity = {
  ...identity,
  sourceRevision: "d".repeat(40),
  sourceManifestSha256: "d".repeat(64),
};
const drainRequest = { operationId: "deploy-test-1", targetIdentity };

test("drain fences manual and scheduled admission synchronously and survives restart", async (t) => {
  let executions = 0;
  const { root, scheduler } = await setup(t, {
    runtimeIdentity: identity,
    scheduleEnabled: true,
    execute: async () => {
      executions++;
      return 0;
    },
  });
  const pending = scheduler.drain(drainRequest);
  assert.equal((await scheduler.start()).accepted, false);
  await pending;
  await scheduler.tick();
  assert.equal(executions, 0);
  assert.equal(scheduler.deployment().phase, "drained");
  await assert.rejects(
    scheduler.drain({ ...drainRequest, operationId: "other" }),
    /owner/,
  );
  await scheduler.close();
  const restarted = await createScheduler({
    root,
    config: {},
    runtimeIdentity: targetIdentity,
    recover: async () => {},
  });

  assert.equal(restarted.deployment().phase, "drained");
  assert.equal((await restarted.start()).accepted, false);
  await assert.rejects(
    restarted.resume({
      operationId: "other",
      expectedRuntimeIdentity: targetIdentity,
    }),
    /owner/,
  );
  await assert.rejects(
    restarted.resume({
      operationId: drainRequest.operationId,
      expectedRuntimeIdentity: identity,
    }),
    /identity/,
  );
  await restarted.resume({
    operationId: drainRequest.operationId,
    expectedRuntimeIdentity: targetIdentity,
  });
  assert.equal(restarted.deployment().phase, "running");
  assert.equal(
    (
      await restarted.resume({
        operationId: drainRequest.operationId,
        expectedRuntimeIdentity: targetIdentity,
      })
    ).phase,
    "running",
  );
  await restarted.close();
});

test("drain cancels admission already waiting in preflight", async (t) => {
  let release,
    entered,
    recoveries = 0,
    executions = 0;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const { scheduler } = await setup(t, {
    runtimeIdentity: identity,
    recover: async () => {
      if (++recoveries === 2) {
        entered();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
    },
    execute: async () => {
      executions++;
      return 0;
    },
  });
  const admission = scheduler.start();
  await waiting;
  await scheduler.drain(drainRequest);
  assert.equal(scheduler.deployment().phase, "draining");
  release();
  assert.equal((await admission).accepted, false);
  await scheduler.tick();
  assert.equal(scheduler.deployment().phase, "drained");
  assert.equal(executions, 0);
});

test("drain lets active work and cleanup finish without abort", async (t) => {
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let finish,
    signal,
    recoveries = 0;
  const { scheduler } = await setup(t, {
    runtimeIdentity: identity,
    recover: async () => {
      recoveries++;
    },
    execute: async (args) => {
      signal = args.signal;
      return new Promise((resolve) => {
        finish = resolve;
        entered();
      });
    },
  });
  const run = await scheduler.start();
  await started;
  await scheduler.drain(drainRequest);
  assert.equal(signal.aborted, false);
  assert.equal(scheduler.deployment().phase, "draining");
  await assert.rejects(
    scheduler.resume({
      operationId: drainRequest.operationId,
      expectedRuntimeIdentity: identity,
    }),
    /Clean/,
  );
  finish(0);
  await run.completion;
  await scheduler.tick();
  assert.equal(scheduler.deployment().phase, "drained");
  assert.ok(recoveries >= 4);
});

test("failed reconciliation and failed deployment persistence cannot resume admissions", async (t) => {
  let failed = false;
  const { scheduler } = await setup(t, {
    runtimeIdentity: identity,
    recover: async () => {
      if (failed) throw Error("blocked");
    },
  });
  failed = true;
  await scheduler.drain(drainRequest);
  assert.equal(scheduler.deployment().phase, "draining");
  await assert.rejects(
    scheduler.resume({
      operationId: drainRequest.operationId,
      expectedRuntimeIdentity: identity,
    }),
    /Clean/,
  );
  const second = await setup(t, {
    runtimeIdentity: identity,
    persistDeployment: async () => {
      throw Error("disk full");
    },
  });
  await assert.rejects(second.scheduler.drain(drainRequest), /disk full/);
  assert.equal(second.scheduler.deployment().phase, "failed");
  assert.equal((await second.scheduler.start()).accepted, false);
});

test("drain waits out a start writing its durable admission before refusing execution", async (t) => {
  let entered,
    release,
    writes = 0,
    executions = 0;
  const writing = new Promise((resolve) => {
    entered = resolve;
  });
  const { scheduler } = await setup(t, {
    runtimeIdentity: identity,
    persistScheduler: async (path, value) => {
      if (++writes === 2) {
        entered("writing");
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      await durableJson(path, value);
    },
    execute: async () => {
      executions++;
      return 0;
    },
  });
  const start = scheduler.start();
  const phase = await Promise.race([
    writing,
    start.then(async (run) => {
      await run.completion;
      return "admitted";
    }),
  ]);
  assert.equal(phase, "writing");
  await scheduler.drain(drainRequest);
  release();
  assert.equal((await start).accepted, false);
  await scheduler.tick();
  assert.equal(scheduler.deployment().phase, "drained");
  assert.equal(executions, 0);
});

test("drain cannot certify unfinished ownership even if recovery returns", async (t) => {
  const control = await mkdtemp(join(tmpdir(), "runner-owner-"));
  t.after(() => rm(control, { recursive: true, force: true }));
  await mkdir(join(control, "attempt"));
  await durableJson(join(control, "attempt/journal.json"), {
    runId: "attempt",
    phase: "setup",
    intents: [],
    cleanup: { status: "failed" },
  });
  const { scheduler } = await setup(t, {
    runtimeIdentity: identity,
    config: { controlDirectory: control },
  });
  await scheduler.drain(drainRequest);
  assert.equal(scheduler.deployment().phase, "draining");
  assert.equal(scheduler.deployment().blocked, true);
});

test("same owner cannot retarget and a later operation needs a distinct owner", async (t) => {
  const { scheduler } = await setup(t, { runtimeIdentity: identity });
  await scheduler.drain(drainRequest);
  await assert.rejects(
    scheduler.drain({ ...drainRequest, targetIdentity: identity }),
    /identity conflict/,
  );
  await scheduler.resume({
    operationId: drainRequest.operationId,
    expectedRuntimeIdentity: identity,
  });
  await assert.rejects(
    scheduler.drain({ ...drainRequest, targetIdentity: identity }),
    /identity conflict/,
  );
  await scheduler.drain({ ...drainRequest, operationId: "deploy-next" });
  assert.equal(scheduler.deployment().operation.operationId, "deploy-next");
});

test("recovery tick cannot publish stale drained state while resume is being persisted", async (t) => {
  let pendingResume,
    releaseResume,
    recoveringDuringResume,
    holding = false;
  const resumedWrite = new Promise((resolve) => {
    pendingResume = resolve;
  });
  const recoveryEntered = new Promise((resolve) => {
    recoveringDuringResume = resolve;
  });
  const { root, scheduler } = await setup(t, {
    runtimeIdentity: identity,
    recover: async () => {
      if (holding) recoveringDuringResume();
    },
    persistDeployment: async (path, value) => {
      if (value.status === "resumed") {
        holding = true;
        pendingResume();
        await new Promise((resolve) => {
          releaseResume = resolve;
        });
      }
      await durableJson(path, value);
    },
  });
  await scheduler.drain(drainRequest);
  const resumed = scheduler.resume({
    operationId: drainRequest.operationId,
    expectedRuntimeIdentity: identity,
  });
  await resumedWrite;
  const tick = scheduler.tick();
  await Promise.race([recoveryEntered, tick]);
  while (scheduler.status().busy)
    await new Promise((resolve) => setImmediate(resolve));
  releaseResume();
  await resumed;
  await tick;
  assert.equal(
    JSON.parse(await readFile(join(root, "deployment.json"))).status,
    "resumed",
  );
  assert.equal(scheduler.deployment().operation.status, "resumed");
  assert.equal(scheduler.deployment().phase, "running");
});

for (const pendingStatus of ["draining", "resumed"]) {
  test(`shutdown retains ownership while ${pendingStatus} is being persisted`, async (t) => {
    let entered, release;
    const writing = new Promise((resolve) => {
      entered = resolve;
    });
    const { root, scheduler } = await setup(t, {
      runtimeIdentity: identity,
      persistDeployment: async (path, value) => {
        if (value.status === pendingStatus) {
          entered();
          await new Promise((resolve) => {
            release = resolve;
          });
        }
        await durableJson(path, value);
      },
    });
    if (pendingStatus === "resumed") await scheduler.drain(drainRequest);
    const mutation =
      pendingStatus === "draining"
        ? scheduler.drain(drainRequest)
        : scheduler.resume({
            operationId: drainRequest.operationId,
            expectedRuntimeIdentity: identity,
          });
    await writing;
    const stopping = scheduler.close();
    try {
      const nextTransition = scheduler.drain(drainRequest).then(
        () => "accepted",
        (error) => {
          assert.match(error.message, /stopping/);
          return "refused";
        },
      );
      assert.equal(
        await Promise.race([stopping.then(() => "closed"), nextTransition]),
        "refused",
      );
      await assert.rejects(
        createScheduler({
          root,
          config: {},
          runtimeIdentity: identity,
          recover: async () => {},
        }),
        /owner is still alive/,
      );
    } finally {
      release();
      await mutation;
      await stopping;
    }
    const restarted = await createScheduler({
      root,
      config: {},
      runtimeIdentity: identity,
      recover: async () => {},
    });
    assert.equal(
      restarted.deployment().phase,
      pendingStatus === "draining" ? "drained" : "running",
    );
    await restarted.close();
  });
}

async function recoverySetup(t, overrides = {}) {
  const { templateDigest } = await import("./deployment.mjs");
  const root = await mkdtemp(join(tmpdir(), "runner-retained-"));
  const config = { controlDirectory: join(root, "control") };
  await mkdir(join(config.controlDirectory, "retained"), { recursive: true });
  await durableJson(join(config.controlDirectory, "retained/journal.json"), {
    runId: "retained",
    phase: "cleanup",
    intents: [],
    cleanup: { status: "failed", deadlineExceeded: true },
  });
  const candidate = { ...targetIdentity, compatibilitySha256: "e".repeat(64) };
  const authorization = {
    operationId: "bounded-retry",
    baselineIdentity: identity,
    targetIdentity: candidate,
    templateSha256: templateDigest(config),
    runnerRunId: "old-run",
    lifecycleRunId: "retained",
  };
  await durableJson(join(root, "deployment.json"), {
    version: 1,
    status: "draining",
    ...authorization,
    targetIdentity: identity,
  });
  await durableJson(join(root, "recovery.json"), {
    version: 1,
    authorization,
    status: "prepared",
  });
  await durableJson(join(root, "scheduler.json"), {
    version: 1,
    active: "old-run",
    blocked: true,
  });
  let watches = 0;
  const options = {
    root,
    config,
    runtimeIdentity: candidate,
    recover: async (_config, { retainedRunId }) =>
      assert.equal(retainedRunId, "retained"),
    recoverRetained: async () => {
      await durableJson(join(root, "recovery.json"), {
        version: 1,
        authorization,
        status: "watching",
      });
    },
    reconcileRetained: async () => {
      watches++;
      return "retained";
    },
    execute: async () => 0,
    ...overrides,
  };
  const scheduler = await createScheduler(options);
  t.after(async () => {
    await scheduler.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    scheduler,
    options,
    request: {
      operationId: authorization.operationId,
      expectedRuntimeIdentity: candidate,
    },
    watches: () => watches,
  };
}

test("healthy idle watches wait 15 minutes and still check every admission", async (t) => {
  let now = 100;
  const { scheduler, request, watches } = await recoverySetup(t, {
    clock: () => now,
  });
  await scheduler.recover(request);
  await scheduler.resume(request);
  const before = watches();
  now += 30_000;
  await scheduler.tick();
  assert.equal(watches(), before);
  now = 100 + 15 * 60_000;
  await scheduler.tick();
  assert.equal(watches(), before + 1);
  const run = await scheduler.start();
  assert.equal(run.accepted, true);
  await run.completion;
  assert.equal(watches(), before + 3);
});

test("bounded recovery retains its journal, fences restart, and watches every admission and completion", async (t) => {
  let now = 100;
  const { root, scheduler, request, options, watches } = await recoverySetup(
    t,
    {
      clock: () => now,
    },
  );
  assert.equal(watches(), 0);
  await scheduler.tick();
  assert.equal(watches(), 0);
  assert.equal((await scheduler.start()).accepted, false);
  await assert.rejects(scheduler.resume(request), /Explicit recovery/);
  await assert.rejects(
    scheduler.recover({ ...request, operationId: "other" }),
    /owner/,
  );
  assert.equal((await scheduler.recover(request)).phase, "recovery-ready");
  await assert.rejects(
    scheduler.drain({
      operationId: "ordinary",
      targetIdentity: options.runtimeIdentity,
    }),
    /Deployment owner conflict/,
  );
  await scheduler.close();
  const restarted = await createScheduler(options);
  t.after(() => restarted.close());
  assert.equal(restarted.deployment().phase, "recovery-ready");
  await restarted.resume(request);
  const before = watches();
  const run = await restarted.start();
  assert.equal(run.accepted, true);
  await run.completion;
  assert.equal(watches(), before + 2);
  assert.equal(
    JSON.parse(await readFile(join(root, "control/retained/journal.json")))
      .cleanup.status,
    "failed",
  );
  await restarted.tick();
  assert.equal(watches(), before + 2);
  now += 15 * 60_000;
  await restarted.tick();
  assert.equal(watches(), before + 3);
  await restarted.close();
});

test("bounded recovery serializes transitions and incomplete inventory blocks resume and admission", async (t) => {
  let release,
    entered,
    fail = false;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const { scheduler, request, root } = await recoverySetup(t, {
    recoverRetained: async ({ root: recoveryRoot }) => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      const path = join(recoveryRoot, "recovery.json");
      const value = JSON.parse(await readFile(path));
      await durableJson(path, { ...value, status: "watching" });
    },
    reconcileRetained: async () => {
      if (fail) throw Error("incomplete inventory");
      return "retained";
    },
  });
  const recovering = scheduler.recover(request);
  await started;
  await assert.rejects(scheduler.recover(request), /busy/);
  await assert.rejects(scheduler.resume(request), /in progress/);
  assert.equal((await scheduler.start()).accepted, false);
  release();
  await recovering;
  fail = true;
  await assert.rejects(scheduler.resume(request), /Clean recovery/);
  assert.equal(scheduler.deployment().blocked, true);
  fail = false;
  await scheduler.resume(request);
  fail = true;
  assert.equal((await scheduler.start()).reason, "cleanup-blocked");
  assert.equal(
    JSON.parse(await readFile(join(root, "deployment.json"))).status,
    "resumed",
  );
});

test("recovery skips only its watched journal and rejects unrelated unfinished ownership", async (t) => {
  const { scheduler, root, request } = await recoverySetup(t);
  const directory = join(root, "control", "unrelated");
  await mkdir(directory);
  await durableJson(join(directory, "journal.json"), {
    runId: "unrelated",
    phase: "setup",
    intents: [],
    cleanup: { status: "failed" },
  });
  await assert.rejects(scheduler.recover(request), /Unfinished ownership/);
  assert.equal(scheduler.deployment().blocked, true);
  assert.equal((await scheduler.start()).accepted, false);
  assert.equal(
    JSON.parse(await readFile(join(root, "control/retained/journal.json")))
      .phase,
    "cleanup",
  );
});

test("deployment recovery receipt refreshes the durable watch hash after reconciliation", async (t) => {
  const { templateDigest } = await import("./deployment.mjs");
  const { scheduler, root, request } = await recoverySetup(t, {
    reconcileRetained: async ({ root: recoveryRoot }) => {
      const path = join(recoveryRoot, "recovery.json");
      const state = JSON.parse(await readFile(path));
      state.observationCount = (state.observationCount ?? 0) + 1;
      state.lastVerifiedAt = new Date().toISOString();
      state.oldJournalSha256 = "a".repeat(64);
      await durableJson(path, state);
      return "retained";
    },
  });
  await scheduler.recover(request);
  const receipt = scheduler.deployment().recovery;
  const durable = JSON.parse(await readFile(join(root, "recovery.json")));
  assert.equal(receipt.watchSha256, templateDigest(durable));
  assert.equal(receipt.observationCount, 1);
  assert.equal(receipt.lastVerifiedAt, durable.lastVerifiedAt);
  assert.equal(receipt.operationId, request.operationId);
  assert.equal(receipt.runnerRunId, "old-run");
  assert.equal(receipt.providerFinality, "unknown");
  assert.equal(receipt.originalStatus, "failed");
  assert.equal(receipt.deadlineExceeded, true);
  await scheduler.tick();
  assert.notEqual(
    scheduler.deployment().recovery.watchSha256,
    receipt.watchSha256,
  );
});

for (const mode of ["missing", "mismatch", "passed-retained", "valid"])
  test(`retained volume admission ${mode}`, async (t) => {
    const controlDirectory = await mkdtemp(
      join(tmpdir(), "retention-admission-"),
    );
    t.after(() => rm(controlDirectory, { recursive: true, force: true }));
    const retained = [
      { volumeId: "owned", evidence: { state: "pending-detached" } },
    ];
    const journal = {
      runId: "retained",
      phase: "complete",
      retainedVolumes: mode === "missing" ? [] : retained,
      cleanup: {
        status:
          mode === "passed-retained"
            ? "passed"
            : "passed-pending-provider-deletion",
        activeResourcesAbsent: true,
        physicalDeletionComplete: false,
        retainedVolumes: mode === "mismatch" ? [] : retained,
      },
    };
    await mkdir(join(controlDirectory, "retained"));
    await durableJson(join(controlDirectory, "retained/journal.json"), journal);
    let calls = 0;
    const run = () =>
      reconcile(
        { controlDirectory },
        {
          reconcileVolumes: async ({ runId }) => {
            assert.equal(runId, "retained");
            calls++;
          },
        },
      );
    if (mode === "valid") {
      await run();
      assert.equal(calls, 1);
    } else {
      await assert.rejects(run());
      assert.equal(calls, 0);
    }
  });

test("restart exports cleanup only for the interrupted run's lifecycle IDs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "retained-receipt-scope-"));
  const control = join(root, "control"),
    id = "run-current";
  await mkdir(join(root, "results", id), { recursive: true });
  for (const runId of ["historical", "current"]) {
    await mkdir(join(control, runId), { recursive: true });
    await durableJson(join(control, runId, "journal.json"), {
      runId,
      phase: "complete",
      intents: [],
      cleanup: { status: "passed", deadlineExceeded: runId === "historical" },
    });
  }
  await durableJson(join(root, "results", id, "run.json"), {
    id,
    status: "running",
    lifecycleBaselineRunIds: ["historical"],
  });
  await durableJson(join(root, "scheduler.json"), {
    version: 1,
    active: id,
    blocked: false,
    nextRunAt: 500,
  });
  const scheduler = await createScheduler({
    root,
    config: { controlDirectory: control },
    recover: async () => {},
    clock: () => 100,
  });
  t.after(async () => {
    await scheduler.close();
    await rm(root, { recursive: true, force: true });
  });
  const receipt = JSON.parse(
    await readFile(join(root, "results", id, "run.json"), "utf8"),
  );
  assert.deepEqual(
    receipt.cleanupEvidence.map((e) => e.runId),
    ["current"],
  );
  assert.equal(receipt.deadlineExceeded, false);
});
