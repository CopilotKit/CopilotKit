import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { durableJson, recoveryLock } from "../journal.mjs";
import {
  compatibleIdentity,
  sameIdentity,
  templateDigest,
  retainedWatchBinding,
  validateWatchingDeployment,
} from "./deployment.mjs";
import {
  recoveryReceipt,
  effectiveRecovery,
  retainedRunIds,
  recoverRetainedIntent,
  reconcileRetainedIntent,
} from "../recovery.mjs";
import { recoverSupervisor } from "../supervisor.mjs";
import { reconcileVolumeCreateRecovery } from "../volume-create-recovery.mjs";
import {
  recoverRailwayEnvironment,
  reconcileRetainedRailwayVolumes,
} from "../environment.mjs";

function activeCleanupComplete(cleanup) {
  return (
    cleanup?.status === "passed" ||
    (cleanup?.status === "passed-pending-provider-deletion" &&
      cleanup.activeResourcesAbsent === true &&
      cleanup.physicalDeletionComplete === false &&
      cleanup.retainedVolumes?.length > 0)
  );
}
const intervalMs = 4 * 60 * 60 * 1000;
const idleReconciliationMs = 15 * 60 * 1000;
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

export async function reconcile(
  config,
  {
    retainedRunId = null,
    retainedIds = [retainedRunId],
    reconcileVolumes = reconcileRetainedRailwayVolumes,
  } = {},
) {
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
    if (journal?.cleanup?.status === "passed")
      assert.equal(
        journal.retainedVolumes?.length ?? 0,
        0,
        "Passed cleanup has unreconciled retained volumes",
      );
    if (
      journal?.phase === "complete" &&
      journal.cleanup?.status === "passed-pending-provider-deletion" &&
      !retainedIds.includes(journal.runId)
    ) {
      assert.ok(
        journal.retainedVolumes?.length > 0,
        "Missing retained ownership evidence",
      );
      assert.deepEqual(
        journal.cleanup.retainedVolumes,
        journal.retainedVolumes,
        "Retained evidence mismatch",
      );
      await reconcileVolumes({ config, runId: journal.runId });
    }
    if (journal && !retainedIds.includes(journal.runId))
      assert.ok(
        journal.phase === "complete" && activeCleanupComplete(journal.cleanup),
        "Unfinished ownership journal blocks new runs",
      );
  }
}

/** Keep crash recovery active in manual mode; scheduled work requires explicit opt-in. */
export async function createScheduler({
  root,
  config,
  configPath,
  controller,
  execute = runController,
  recover = reconcile,
  recoverRetained = recoverRetainedIntent,
  reconcileRetained = reconcileRetainedIntent,
  recoverVolumeCreate = reconcileVolumeCreateRecovery,
  clock = Date.now,
  scheduleEnabled = false,
  runtimeIdentity,
  persistDeployment = durableJson,
  persistScheduler = durableJson,
}) {
  assert.equal(typeof scheduleEnabled, "boolean");
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
  const deploymentPath = join(root, "deployment.json");
  let operation = await optionalJson(deploymentPath);
  let recovery = await effectiveRecovery(root);
  if (recovery && operation?.recoveryBindingSha256) {
    assert.equal(
      scheduleEnabled,
      false,
      "Retained recovery requires scheduling off",
    );
    validateWatchingDeployment(recovery, operation, runtimeIdentity, config);
  } else if (recovery) {
    assert.equal(
      scheduleEnabled,
      false,
      "Retained recovery requires scheduling off",
    );
    assert.ok([1, 2].includes(recovery.version));
    const auth = recovery.authorization;
    assert.equal(
      operation?.operationId,
      auth.operationId,
      "Recovery owner mismatch",
    );
    assert.ok(sameIdentity(operation.baselineIdentity, auth.baselineIdentity));
    assert.ok(sameIdentity(runtimeIdentity, auth.targetIdentity));
    assert.equal(auth.templateSha256, templateDigest(config));
    assert.ok(["prepared", "watching"].includes(recovery.status));
    if (!operation.kind) {
      assert.equal(operation.status, "draining");
      assert.ok(sameIdentity(operation.targetIdentity, auth.baselineIdentity));
      operation = {
        ...operation,
        kind: "bounded-environment-retry",
        targetIdentity: auth.targetIdentity,
      };
      await persistDeployment(deploymentPath, operation);
    }
    assert.equal(operation.kind, "bounded-environment-retry");
    assert.ok(sameIdentity(operation.targetIdentity, auth.targetIdentity));
  }
  if (operation) {
    assert.equal(operation.version, 1);
    assert.ok(
      ["draining", "drained", "resumed", "recovery-ready"].includes(
        operation.status,
      ),
    );
    if (!recovery) {
      assert.ok(!operation.kind, "Recovery authority missing");
      compatibleIdentity(operation.baselineIdentity, operation.targetIdentity);
    }
    assert.equal(operation.templateSha256, templateDigest(config));
    assert.ok(
      sameIdentity(runtimeIdentity, operation.baselineIdentity) ||
        sameIdentity(runtimeIdentity, operation.targetIdentity),
    );
  }
  let fenced = Boolean(operation && operation.status !== "resumed");
  let deploymentFailure = false;
  let deploymentWrites = Promise.resolve();
  let recoveredForDrain = false;
  const persist = (value) => {
    const write = deploymentWrites.then(() =>
      persistDeployment(deploymentPath, value),
    );
    deploymentWrites = write.catch(() => {
      deploymentFailure = true;
      fenced = true;
    });
    return write;
  };
  let busy = false;
  let lastReconciledAt;
  let closing = false;
  let unlocked = false;
  let abort;
  const deploymentTransitions = new Set();
  /** Retain shutdown ownership until every admitted deployment transition settles. */
  function trackTransition(promise) {
    deploymentTransitions.add(promise);
    promise.then(
      () => deploymentTransitions.delete(promise),
      () => deploymentTransitions.delete(promise),
    );
    return promise;
  }
  const save = () => persistScheduler(statePath, state);
  const deployment = () => ({
    protocolVersion: 1,
    runtimeIdentity,
    templateSha256: templateDigest(config),
    operation: operation ? structuredClone(operation) : null,
    recovery: recoveryReceipt(recovery),
    phase: deploymentFailure
      ? "failed"
      : !fenced
        ? "running"
        : operation?.status === "recovery-ready" && !busy && !state.blocked
          ? "recovery-ready"
          : operation?.status === "drained" &&
              recoveredForDrain &&
              !busy &&
              !state.active &&
              !state.blocked
            ? "drained"
            : "draining",
    busy,
    active: state.active,
    blocked: state.blocked,
    lastRecovery: state.lastRecovery,
    ...(state.volumeCreateRecovery
      ? { volumeCreateRecovery: state.volumeCreateRecovery }
      : {}),
  });
  /** Persist readiness only after fresh recovery has proved ownership is clear. */
  async function certifyDrain() {
    if (
      (recovery && operation?.kind === "bounded-environment-retry") ||
      !fenced ||
      closing ||
      resuming ||
      deploymentFailure ||
      busy ||
      state.active ||
      state.blocked ||
      !recoveredForDrain
    )
      return;
    const next = { ...operation, status: "drained" };
    await persist(next);
    operation = next;
  }
  /** Claim a durable deployment owner and fence admissions before yielding. */
  async function drain({ operationId, targetIdentity }) {
    assert.ok(!closing, "Runner stopping; deployment transition refused");
    assert.ok(
      !recovery || recovery.status === "watching",
      "Established recovery watch required",
    );
    assert.match(operationId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
    compatibleIdentity(runtimeIdentity, targetIdentity);
    if (operation?.operationId === operationId) {
      assert.ok(
        sameIdentity(operation.targetIdentity, targetIdentity),
        "Deployment target identity conflict",
      );
      await deploymentWrites;
      assert.ok(!deploymentFailure, "Deployment persistence failed");
      return deployment();
    }
    assert.ok(!fenced, "Deployment owner conflict");
    // Fence synchronously: an admitted start may already be awaiting preflight or disk.
    fenced = true;
    recoveredForDrain = false;
    operation = {
      version: 1,
      status: "draining",
      operationId,
      baselineIdentity: structuredClone(runtimeIdentity),
      targetIdentity: structuredClone(targetIdentity),
      templateSha256: templateDigest(config),
      requestedAt: new Date(clock()).toISOString(),
      ...(recovery
        ? { recoveryBindingSha256: retainedWatchBinding(recovery) }
        : {}),
    };
    await persist(operation);
    await recoverIdle();
    return deployment();
  }
  let resuming = false;
  let recovering = false;
  async function recoverBounded({ operationId, expectedRuntimeIdentity }) {
    assert.ok(
      !closing && !busy && !resuming && !recovering,
      "Recovery transition busy or stopping",
    );
    assert.ok(
      fenced && recovery && !deploymentFailure,
      "Recovery fence required",
    );
    assert.equal(operation.operationId, operationId, "Recovery owner mismatch");
    assert.ok(
      sameIdentity(expectedRuntimeIdentity, runtimeIdentity),
      "Runtime identity mismatch",
    );
    recovering = true;
    busy = true;
    try {
      await recoverRetained({ root, config, operationId, runtimeIdentity });
      recovery = await effectiveRecovery(root);
      assert.equal(recovery?.status, "watching");
      assert.ok(
        !state.active || state.active === recovery.authorization.runnerRunId,
        "Unexpected active run",
      );
      state.active = null;
      await reconcileOwnership();
      state.blocked = false;
      state.lastRecovery = {
        status: "watching",
        at: new Date(clock()).toISOString(),
      };
      await save();
      const next = { ...operation, status: "recovery-ready" };
      await persist(next);
      operation = next;
      recoveredForDrain = true;
    } catch (error) {
      state.blocked = true;
      await save();
      throw error;
    } finally {
      busy = false;
      recovering = false;
    }
    return deployment();
  }
  async function reconcileOwnership() {
    const volumeWatch = await recoverVolumeCreate(
      {
        root,
        config,
        operation,
        expectedBinding: state.volumeCreateRecoveryBindingSha256,
      },
      {
        beforeTransfer: async (binding) => {
          if (state.volumeCreateRecoveryBindingSha256 !== undefined)
            assert.equal(state.volumeCreateRecoveryBindingSha256, binding);
          else {
            state.volumeCreateRecoveryBindingSha256 = binding;
            await save();
          }
        },
      },
    );
    if (volumeWatch) {
      state.volumeCreateRecovery = volumeWatch;
      if (state.active === volumeWatch.runnerRunId) state.active = null;
    }
    if (recovery)
      assert.equal(recovery.status, "watching", "Explicit recovery required");
    const retainedRunId = await reconcileRetained({ root, config });
    if (recovery)
      assert.equal(retainedRunId, recovery.authorization.lifecycleRunId);
    else assert.equal(retainedRunId, null);
    recovery = await effectiveRecovery(root);
    const retainedIds = [
      ...retainedRunIds(recovery),
      ...(volumeWatch ? [volumeWatch.lifecycleRunId] : []),
    ];
    await recover(config, { retainedRunId, retainedIds });
    if (config.controlDirectory) {
      for (const path of [
        "active-run/lease.json",
        "supervisor-lock/owner.json",
      ])
        assert.equal(
          await optionalJson(join(config.controlDirectory, path)),
          null,
          "Unfinished ownership blocks deployment",
        );
      for (const run of await ownershipEvidence(config))
        if (!retainedIds.includes(run.runId))
          assert.ok(
            run.phase === "complete" && activeCleanupComplete(run.cleanup),
            "Unfinished ownership blocks deployment",
          );
    }
    state.retainedVolumes = (await ownershipEvidence(config)).flatMap((run) =>
      (run.cleanup?.retainedVolumes ?? []).map((volume) => ({
        ...volume,
        runId: run.runId,
      })),
    );
    state.retentionOverdue = state.retainedVolumes.some(
      (volume) => volume.overdue,
    );
    lastReconciledAt = clock();
    return retainedRunId;
  }
  /** Restore admission only for the same owner and the verified running image. */
  async function resume({ operationId, expectedRuntimeIdentity }) {
    assert.ok(!closing, "Runner stopping; deployment transition refused");
    assert.equal(
      operation?.operationId,
      operationId,
      "Deployment owner mismatch",
    );
    assert.ok(
      sameIdentity(expectedRuntimeIdentity, runtimeIdentity),
      "Runtime identity mismatch",
    );
    assert.ok(
      sameIdentity(runtimeIdentity, operation.baselineIdentity) ||
        sameIdentity(runtimeIdentity, operation.targetIdentity),
      "Unexpected runtime identity",
    );
    assert.ok(
      !deploymentFailure && !resuming && !recovering,
      "Deployment persistence failed or resume in progress",
    );
    if (!fenced) return deployment();
    if (recovery && operation.kind === "bounded-environment-retry")
      assert.equal(
        operation.status,
        "recovery-ready",
        "Explicit recovery required",
      );
    resuming = true;
    try {
      assert.ok(
        !busy && !state.active,
        "Clean recovery required before resume",
      );
      assert.ok(await recoverIdle(), "Clean recovery required before resume");
      assert.ok(
        recoveredForDrain && !busy && !state.active && !state.blocked,
        "Clean recovery required before resume",
      );
      const next = {
        ...operation,
        status: "resumed",
        resumedAt: new Date(clock()).toISOString(),
      };
      await persist(next);
      operation = next;
      fenced = false;
      return deployment();
    } finally {
      resuming = false;
    }
  }
  async function recoverIdle() {
    if (
      busy ||
      recovery?.status === "prepared" ||
      (recovery && state.active === recovery.authorization.runnerRunId)
    )
      return false;
    busy = true;
    recoveredForDrain = false;
    try {
      const before = state.active
        ? (await ownershipEvidence(config)).filter(
            (run) => !retainedRunIds(recovery).includes(run.runId),
          )
        : [];
      await reconcileOwnership();
      if (state.active) {
        const file = join(root, "results", state.active, "run.json");
        const prior = await optionalJson(file);
        assert.ok(prior, "Interrupted run evidence missing");
        const lifecycleIds = prior.lifecycleBaselineRunIds
          ? new Set(
              (await ownershipEvidence(config))
                .filter(
                  (run) => !prior.lifecycleBaselineRunIds.includes(run.runId),
                )
                .map((run) => run.runId),
            )
          : new Set(
              before
                .filter((run) => run.phase !== "complete")
                .map((run) => run.runId),
            );
        const after = (await ownershipEvidence(config)).filter(
          (run) =>
            !retainedRunIds(recovery).includes(run.runId) &&
            lifecycleIds.has(run.runId),
        );
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
          cleanup: after.some(
            (run) => run.cleanup?.status === "passed-pending-provider-deletion",
          )
            ? "passed-pending-provider-deletion"
            : "passed",
          cleanupEvidence: after.map((run) => ({
            runId: run.runId,
            ...run.cleanup,
          })),
          deadlineExceeded: after.some(
            (run) =>
              before.some(
                (old) => old.runId === run.runId && old.phase !== "complete",
              ) && run.cleanup?.deadlineExceeded,
          ),
        });
        state.active = null;
      }
      recoveredForDrain = fenced;
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
      await certifyDrain();
    }
  }
  async function start(mode = "single", crashStage = "recorded-volume") {
    assert.ok(["single", "acceptance", "crash-recovery"].includes(mode));
    assert.ok(["recorded-volume", "ambiguous-create"].includes(crashStage));
    if (fenced) return { accepted: false, reason: "deployment-draining" };
    if (busy || state.active || closing)
      return { accepted: false, reason: "busy-or-recovery-required" };
    busy = true;
    try {
      await reconcileOwnership();
      state.blocked = false;
    } catch {
      state.blocked = true;
      await save();
      busy = false;
      return { accepted: false, reason: "cleanup-blocked" };
    }
    if (closing || fenced) {
      busy = false;
      return { accepted: false, reason: "runner-stopping" };
    }
    try {
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
      if (fenced) {
        await durableJson(join(directory, "run.json"), {
          ...receipt,
          status: "cancelled",
          diagnostic: "Deployment drain before execution",
        });
        state.active = null;
        await save();
        busy = false;
        return { accepted: false, reason: "deployment-draining" };
      }
      const completion = (async () => {
        const previousRuns = new Set(
          (await ownershipEvidence(config)).map((run) => run.runId),
        );
        receipt.lifecycleBaselineRunIds = [...previousRuns];
        await durableJson(join(directory, "run.json"), receipt);
        let exitCode = null;
        let failure = null;
        try {
          assert.ok(!fenced, "Deployment drain before execution");
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
          await reconcileOwnership();
          cleanup = "passed";
        } catch {
          failure = "Cleanup failed; new runs blocked";
        }
        const cleanupEvidence = (await ownershipEvidence(config))
          .filter((run) => !previousRuns.has(run.runId))
          .map((run) => ({ runId: run.runId, ...run.cleanup }));
        if (
          cleanup === "passed" &&
          cleanupEvidence.some(
            (e) => e.status === "passed-pending-provider-deletion",
          )
        )
          cleanup = "passed-pending-provider-deletion";
        const deadlineExceeded = (await ownershipEvidence(config)).some(
          (run) =>
            !previousRuns.has(run.runId) && run.cleanup?.deadlineExceeded,
        );
        if (deadlineExceeded)
          failure = "Owned cleanup exceeded the 60-minute lifetime";
        await durableJson(join(directory, "run.json"), {
          ...receipt,
          status: failure ? "failed" : "passed",
          exitCode,
          cleanup,
          cleanupEvidence,
          deadlineExceeded,
          diagnostic: failure,
          finishedAt: new Date(clock()).toISOString(),
        });
        state.blocked = ![
          "passed",
          "passed-pending-provider-deletion",
        ].includes(cleanup);
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
    } catch (error) {
      state.blocked = true;
      busy = false;
      throw error;
    }
  }
  if (
    recovery?.status === "prepared" ||
    (recovery && state.active === recovery.authorization.runnerRunId)
  ) {
    state.blocked = true;
    await save();
  } else await recoverIdle();
  return {
    status: () => ({ ...state, busy, scheduleEnabled }),
    start,
    deployment,
    drain: (request) => trackTransition(drain(request)),
    recover: (request) => trackTransition(recoverBounded(request)),
    resume: (request) => trackTransition(resume(request)),
    async tick() {
      if (
        busy ||
        closing ||
        resuming ||
        recovering ||
        recovery?.status === "prepared" ||
        (recovery && state.active === recovery.authorization.runnerRunId)
      )
        return;
      const elapsed = clock() - lastReconciledAt;
      // Passive watches and detached volumes can wait; admission and unfinished
      // cleanup always require fresh ownership evidence. Restart checks eagerly.
      if (
        !state.active &&
        !state.blocked &&
        !fenced &&
        !(scheduleEnabled && clock() >= state.nextRunAt) &&
        elapsed >= 0 &&
        elapsed < idleReconciliationMs
      )
        return;
      if (!(await recoverIdle())) return;
      if (!fenced && scheduleEnabled && clock() >= state.nextRunAt)
        await start("single");
    },
    async close() {
      closing = true;
      abort?.abort();
      await Promise.allSettled(deploymentTransitions);
      await deploymentWrites;
      if (!busy && !unlocked) {
        unlocked = true;
        await unlock();
      }
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
