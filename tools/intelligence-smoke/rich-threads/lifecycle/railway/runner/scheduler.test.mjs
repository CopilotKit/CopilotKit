import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduler } from "./scheduler.mjs";
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
test("manual-only startup keeps recovery active without scheduling tests", async (t) => {
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
  await scheduler.tick();
  assert.equal(executions, 0);
  assert.equal(recoveries, 2);
  assert.equal(scheduler.status().scheduleEnabled, false);
  const manual = await scheduler.start("single");
  assert.equal(manual.accepted, true);
  await manual.completion;
  assert.equal(executions, 1);
  now += 8 * 60 * 60 * 1000;
  await scheduler.tick();
  assert.equal(executions, 1);
  assert.equal(scheduler.status().scheduleEnabled, false);
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
  let fails = false;
  const { scheduler } = await setup(t, {
    recover: async () => {
      if (fails) throw new Error("cleanup unavailable");
    },
  });
  fails = true;
  await scheduler.tick();
  assert.equal(scheduler.status().blocked, true);
  assert.equal((await scheduler.start("single")).accepted, false);
});
test("permanent scheduler serializes manual/timer runs and retains failed results", async (t) => {
  let finish;
  const { root, scheduler } = await setup(t, {
    execute: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const first = await scheduler.start();
  assert.equal(first.accepted, true);
  assert.equal((await scheduler.start()).accepted, false);
  await scheduler.tick();
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
