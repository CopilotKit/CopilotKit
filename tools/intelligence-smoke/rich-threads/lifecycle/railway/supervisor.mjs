import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { authority, durableJson, recoveryLock } from "./journal.mjs";
import { recoverRailwayEnvironment } from "./environment.mjs";

async function pendingLease(config) {
  try {
    return JSON.parse(
      await readFile(
        join(config.controlDirectory, "active-run", "lease.json"),
        "utf8",
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
/** Run on the single durable controller host. CI invokes this host, never its own local lock. */
export async function supervise(
  { config, command, expectedWorkerExit = 0 },
  dependencies = {},
) {
  assert.ok(command?.length);
  assert.ok(expectedWorkerExit === 0 || expectedWorkerExit === 1);
  await authority(config.controlDirectory);
  const lock = join(config.controlDirectory, "supervisor-lock");
  await mkdir(lock, { mode: 0o700 });
  const owner = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
    workerDeadline: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
  };
  await durableJson(join(lock, "owner.json"), owner);
  const recover = dependencies.recover ?? recoverRailwayEnvironment;
  let child,
    timer,
    killTimer,
    cancelled = false;
  const stop = () => {
    cancelled = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 10_000);
    }
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const previous = await pendingLease(config);
    if (previous) await recover({ config, runId: previous.runId });
    assert.ok(
      !cancelled,
      "Supervisor cancelled during recovery; no worker started",
    );
    child = spawn(command[0], command.slice(1), {
      stdio: "inherit",
      env: { ...process.env, RICH_RAILWAY_SUPERVISOR_TOKEN: owner.token },
    });
    timer = setTimeout(
      stop,
      Math.max(1, Date.parse(owner.workerDeadline) - Date.now()),
    );
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
    } finally {
      clearTimeout(timer);
      clearTimeout(killTimer);
      const lease = await pendingLease(config);
      if (lease) await recover({ config, runId: lease.runId });
      assert.ok(
        !(await pendingLease(config)),
        "Supervisor reconciliation retained active lease",
      );
    }
    assert.ok(
      !cancelled && code === expectedWorkerExit,
      "Supervised acceptance worker failed or exceeded 50-minute budget",
    );
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await rm(lock, { recursive: true });
  }
}
/** Explicit post-crash reconciliation; original supervisor AND worker must be absent. */
export async function recoverSupervisor(config) {
  await authority(config.controlDirectory);
  const release = await recoveryLock(
    join(config.controlDirectory, "supervisor-recovery-lock"),
  );
  try {
    const lock = join(config.controlDirectory, "supervisor-lock");
    const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
    try {
      process.kill(owner.pid, 0);
      throw new Error("Supervisor is still alive");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    const lease = await pendingLease(config);
    if (lease) await recoverRailwayEnvironment({ config, runId: lease.runId });
    await rm(lock, { recursive: true });
  } finally {
    await release();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, file, ...command] = process.argv.slice(2);
    const config = JSON.parse(await readFile(file, "utf8"));
    if (mode === "recover") await recoverSupervisor(config);
    else {
      assert.equal(mode, "run");
      const expectedWorkerExit =
        command[0] === "--expected-worker-exit=1" ? (command.shift(), 1) : 0;
      assert.equal(command.shift(), "--");
      await supervise({ config, command, expectedWorkerExit });
    }
  } catch {
    console.error(
      "Railway supervisor failed; retain durable journal and reconcile ownership before another run",
    );
    process.exitCode = 1;
  }
}
