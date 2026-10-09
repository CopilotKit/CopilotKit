import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

/** Own a process from creation. Never accept external PIDs or discover global services. */
export function ownedProcess({
  owner,
  service,
  role,
  store,
  file,
  args = [],
  cwd,
  env,
  ready,
  timeoutMs = 30_000,
}) {
  assert.ok(owner && service && store && store !== "memory");
  assert.equal(typeof ready, "function");
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0);
  let child;
  let incarnation;
  let output = "";
  let failure;
  const identity = () => ({ instance: incarnation, store });
  async function stop() {
    if (!child) return;
    const owned = child;
    if (owned.pid && owned.exitCode === null && owned.signalCode === null) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // Only the exact spawned child is signaled; never a discovered PID.
          owned.kill("SIGKILL");
          reject(new Error(`${service}: graceful stop timed out`));
        }, timeoutMs);
        owned.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        owned.kill("SIGTERM");
      });
    }
    child = undefined;
  }
  async function start() {
    assert.ok(!child, `${service}: already started`);
    failure = undefined;
    child = spawn(file, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", (error) => {
      failure = error;
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-16_384);
      });
    incarnation = randomUUID();
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        if (failure) throw failure;
        assert.ok(
          child.exitCode === null && child.signalCode === null,
          `${service}: process exited before readiness`,
        );
        let readinessTimer;
        let healthy;
        try {
          healthy = await Promise.race([
            ready({ pid: child.pid, instance: incarnation }),
            new Promise((_, reject) => {
              readinessTimer = setTimeout(
                () => reject(new Error(`${service}: readiness timed out`)),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
        } finally {
          clearTimeout(readinessTimer);
        }
        if (healthy) return identity();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`${service}: readiness timed out`);
    } catch (error) {
      await stop();
      throw error;
    }
  }
  return {
    owner,
    service,
    role,
    start,
    stop,
    // Callers must redact known secrets before retaining diagnostic output.
    diagnostics: () => output,
    async restart() {
      assert.ok(
        child && child.exitCode === null && child.signalCode === null,
        `${service}: not running`,
      );
      const before = identity();
      await stop();
      const after = await start();
      return { owner, service, role, before, after, ready: true };
    },
  };
}
