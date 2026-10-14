import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { durableJson, recoveryLock } from "../journal.mjs";
import { recoverSupervisor } from "../supervisor.mjs";
import { recoverRailwayEnvironment } from "../environment.mjs";

const intervalMs = 4 * 60 * 60 * 1000;
async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function ownershipEvidence(config) {
  if (!config.controlDirectory) return [];
  const records = [];
  for (const entry of await readdir(config.controlDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const journal = await optionalJson(
      join(config.controlDirectory, entry.name, "journal.json"),
    );
    if (journal)
      records.push({
        runId: journal.runId,
        phase: journal.phase,
        expiresAt: journal.expiresAt,
        services: journal.services,
        volumes: journal.volumes,
        environments: journal.environments,
        intents: journal.intents.map(({ kind, status, resultId }) => ({
          kind,
          status,
          resultId,
        })),
        cleanup: journal.cleanup,
        withinLifetime: journal.withinLifetime,
        crashControl: await optionalJson(
          join(config.controlDirectory, entry.name, "crash-control.json"),
        ),
      });
  }
  return records;
}

export async function reconcile(config) {
  const supervisor = await optionalJson(
    join(config.controlDirectory, "supervisor-lock/owner.json"),
  );
  if (supervisor) await recoverSupervisor(config);
  const lease = await optionalJson(
    join(config.controlDirectory, "active-run/lease.json"),
  );
  if (lease) await recoverRailwayEnvironment({ config, runId: lease.runId });
  assert.equal(
    await optionalJson(join(config.controlDirectory, "active-run/lease.json")),
    null,
    "Cleanup remains incomplete",
  );
  // A missing active lease must never hide an unfinished journal.
  for (const entry of await readdir(config.controlDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const journal = await optionalJson(
      join(config.controlDirectory, entry.name, "journal.json"),
    );
    if (journal)
      assert.ok(
        journal.phase === "complete" && journal.cleanup?.status === "passed",
        "Unfinished ownership journal blocks new runs",
      );
  }
}

export async function createScheduler({
  root,
  config,
  configPath,
  controller,
  execute = runController,
  recover = reconcile,
  clock = Date.now,
}) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(join(root, "results"), { recursive: true, mode: 0o700 });
  const unlock = await recoveryLock(join(root, "scheduler-lock"));
  const statePath = join(root, "scheduler.json");
  let state = (await optionalJson(statePath)) ?? {
    version: 1,
    nextRunAt: clock(),
    active: null,
    blocked: true,
  };
  let busy = false;
  let closing = false;
  let abort;
  const save = () => durableJson(statePath, state);
  async function recoverIdle() {
    if (busy) return false;
    busy = true;
    try {
      const before = state.active ? await ownershipEvidence(config) : [];
      await recover(config);
      if (state.active) {
        const file = join(root, "results", state.active, "run.json");
        const prior = await optionalJson(file);
        assert.ok(prior, "Interrupted run evidence missing");
        const after = await ownershipEvidence(config);
        await durableJson(
          join(root, "results", state.active, "recovery.json"),
          { before, after, recoveredAt: new Date(clock()).toISOString() },
        );
        const crashReached =
          prior.mode !== "crash-recovery" ||
          before.some(
            (run) =>
              run.phase !== "complete" &&
              run.crashControl?.runId === run.runId &&
              run.crashControl.stage ===
                (prior.crashStage === "ambiguous-create"
                  ? "ambiguous-create"
                  : "recorded-owned-volume"),
          );
        await durableJson(file, {
          ...prior,
          status: crashReached ? "interrupted-cleaned" : "failed",
          crashReached,
          recoveredAt: new Date(clock()).toISOString(),
          cleanup: "passed",
          deadlineExceeded: after.some(
            (run) =>
              before.some(
                (old) => old.runId === run.runId && old.phase !== "complete",
              ) && run.cleanup?.deadlineExceeded,
          ),
        });
        state.active = null;
      }
      state.blocked = false;
      state.lastRecovery = {
        status: "passed",
        at: new Date(clock()).toISOString(),
      };
      await save();
      return true;
    } catch {
      state.blocked = true;
      state.lastRecovery = {
        status: "failed",
        at: new Date(clock()).toISOString(),
        diagnostic: "Ownership reconciliation failed; new runs blocked",
      };
      await save();
      return false;
    } finally {
      busy = false;
    }
  }
  async function start(mode = "single", crashStage = "recorded-volume") {
    assert.ok(["single", "acceptance", "crash-recovery"].includes(mode));
    assert.ok(["recorded-volume", "ambiguous-create"].includes(crashStage));
    if (busy || state.active || closing)
      return { accepted: false, reason: "busy-or-recovery-required" };
    busy = true;
    try {
      await recover(config);
      state.blocked = false;
    } catch {
      state.blocked = true;
      await save();
      busy = false;
      return { accepted: false, reason: "cleanup-blocked" };
    }
    if (closing) {
      busy = false;
      return { accepted: false, reason: "runner-stopping" };
    }
    const id = `run-${randomUUID()}`;
    const directory = join(root, "results", id);
    await mkdir(directory, { mode: 0o700 });
    const receipt = {
      id,
      mode,
      status: "running",
      crashStage: mode === "crash-recovery" ? crashStage : undefined,
      startedAt: new Date(clock()).toISOString(),
    };
    await durableJson(join(directory, "run.json"), receipt);
    state.active = id;
    state.nextRunAt = clock() + intervalMs;
    await save();
    abort = new AbortController();
    if (closing) abort.abort();
    const completion = (async () => {
      const previousRuns = new Set(
        (await ownershipEvidence(config)).map((run) => run.runId),
      );
      let exitCode = null;
      let failure = null;
      try {
        exitCode = await execute({
          controller,
          configPath,
          output: join(directory, "evidence"),
          mode,
          crashStage,
          signal: abort.signal,
        });
        if (exitCode !== 0) failure = "Test controller failed";
      } catch {
        failure = "Test controller interrupted or failed";
      }
      let cleanup = "failed";
      try {
        await recover(config);
        cleanup = "passed";
      } catch {
        failure = "Cleanup failed; new runs blocked";
      }
      const deadlineExceeded = (await ownershipEvidence(config)).some(
        (run) => !previousRuns.has(run.runId) && run.cleanup?.deadlineExceeded,
      );
      if (deadlineExceeded)
        failure = "Owned cleanup exceeded the 60-minute lifetime";
      await durableJson(join(directory, "run.json"), {
        ...receipt,
        status: failure ? "failed" : "passed",
        exitCode,
        cleanup,
        deadlineExceeded,
        diagnostic: failure,
        finishedAt: new Date(clock()).toISOString(),
      });
      state.blocked = cleanup !== "passed";
      if (!state.blocked) state.active = null;
      await save();
    })().finally(() => {
      busy = false;
      abort = undefined;
    });
    // Retain unexpected disk failures as a blocking state, never an unhandled rejection.
    completion.catch(() => {
      state.blocked = true;
      console.error(
        "Durable runner result publication failed; reconciliation required",
      );
    });
    return { accepted: true, id, completion };
  }
  await recoverIdle();
  return {
    status: () => ({ ...state, busy }),
    start,
    async tick() {
      if (busy || closing) return;
      if (!(await recoverIdle())) return;
      if (clock() >= state.nextRunAt) await start("single");
    },
    async close() {
      closing = true;
      abort?.abort();
      if (!busy) await unlock();
    },
  };
}

export async function runController({
  controller,
  configPath,
  output,
  mode,
  crashStage,
  signal,
}) {
  signal?.throwIfAborted();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      controller,
      `--mode=${mode === "crash-recovery" ? "single" : mode}`,
      `--config=${configPath}`,
      `--output=${output}`,
    ],
    {
      detached: true,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(mode === "crash-recovery"
          ? {
              RICH_CRASH_AFTER_RESOURCE: "1",
              RICH_CRASH_STAGE: crashStage,
              RICH_RUNNER_PID: String(process.pid),
            }
          : {}),
      },
    },
  );
  let killTimer,
    stopped = false,
    terminationError;
  const stop = () => {
    stopped = true;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") terminationError = error;
    }
    killTimer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH")
          console.error("Runner process-group termination failed");
      }
    }, 10_000);
  };
  signal?.addEventListener("abort", stop, { once: true });
  // Each attempt's supervisor enforces 50m + cleanup. Acceptance contains three attempts.
  const timer = setTimeout(
    stop,
    mode === "acceptance" ? 180 * 60_000 : 60 * 60_000,
  );
  let result, failure;
  try {
    if (signal?.aborted) stop();
    result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
  } catch (error) {
    failure = error;
  } finally {
    // A wrapper exiting does not prove its descendants stopped. Kill the whole
    // owned process group before reconciliation, even if the wrapper exited first.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") terminationError = error;
    }
    clearTimeout(timer);
    clearTimeout(killTimer);
    signal?.removeEventListener("abort", stop);
  }
  if (failure || terminationError) throw failure ?? terminationError;
  assert.ok(!stopped, "Controller timed out or was cancelled");
  return result;
}
