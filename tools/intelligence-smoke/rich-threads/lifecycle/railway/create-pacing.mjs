import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { durableJson, recoveryLock } from "./journal.mjs";

const limits = {
  createEnvironment: "environmentCreate",
  createVolume: "volumeCreate",
};
const cushionMs = 2000;

/** A conservative one-request-per-window gate, not a retry mechanism. Each
 * invocation waits a full window, including after restart or a missing ledger.
 * A shared authority must still sequence writers using other credentials/tools.
 */
export function creationPacer({
  directory,
  projectId,
  api,
  clock = Date.now,
  monotonic = () => performance.now(),
  sleep = delay,
}) {
  return async function paced(operation, { check, deadline }, send) {
    const key = limits[operation];
    if (!key) return send();
    await check();
    const project = await api.request("creationLimits", { id: projectId });
    assert.equal(project.id, projectId);
    assert.match(project.workspaceId, /^[a-f0-9-]{36}$/);
    const limit = project.subscriptionPlanLimit?.rateLimits?.[key];
    assert.ok(
      Number.isSafeInteger(limit?.max) && limit.max > 0,
      "Missing creation rate limit",
    );
    assert.ok(
      Number.isSafeInteger(limit?.windowSeconds) &&
        limit.windowSeconds > 0 &&
        limit.windowSeconds <= 3600,
      "Invalid creation rate window",
    );
    // Even when max > 1, one per full window is conservatively within the limit.
    const interval = limit.windowSeconds * 1000 + cushionMs;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stem = join(directory, `${project.workspaceId}-${key}`);
    const unlock = await recoveryLock(`${stem}.lock`);
    try {
      let previous;
      try {
        previous = JSON.parse(await readFile(`${stem}.json`, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (previous !== undefined) {
        assert.ok(
          previous && typeof previous === "object" && !Array.isArray(previous),
        );
        assert.equal(previous.version, 1);
        assert.equal(previous.workspaceId, project.workspaceId);
        assert.equal(previous.operation, operation);
        assert.ok(
          Number.isSafeInteger(previous.referenceAt) &&
            previous.referenceAt >= 0,
        );
        assert.ok(["reserved", "settled"].includes(previous.status));
      }
      const entered = clock();
      const monotonicStart = monotonic();
      const referenceAt = Math.max(entered, previous?.referenceAt ?? 0);
      assert.ok(Number.isSafeInteger(referenceAt) && Number.isFinite(deadline));
      assert.ok(
        referenceAt + interval < deadline,
        "Insufficient lifetime for creation pacing",
      );
      const state = {
        version: 1,
        workspaceId: project.workspaceId,
        projectId,
        operation,
        limit: { max: limit.max, windowSeconds: limit.windowSeconds },
        cushionMs,
        referenceAt,
        status: "reserved",
      };
      // A crash during the wait or send leaves this reservation. A fresh process
      // must wait a full window again; it never resumes or repeats the old send.
      await durableJson(`${stem}.json`, state);
      while (true) {
        await check();
        const now = clock();
        const elapsed = monotonic() - monotonicStart;
        assert.ok(
          Number.isFinite(elapsed) && elapsed >= 0,
          "Monotonic clock regressed",
        );
        assert.ok(now < deadline, "Creation pacing deadline exceeded");
        const remaining = Math.max(
          referenceAt + interval - now,
          interval - elapsed,
        );
        if (remaining <= 0) break;
        assert.ok(
          now + remaining < deadline,
          "Insufficient lifetime for creation pacing",
        );
        await sleep(Math.min(1000, remaining));
      }
      await check();
      state.referenceAt = Math.max(referenceAt, clock());
      await durableJson(`${stem}.json`, state);
      // Caller writes its operation intent only after this gate admits it.
      try {
        return await send();
      } finally {
        state.referenceAt = Math.max(state.referenceAt, clock());
        state.status = "settled"; // Timing only; not provider outcome/finality.
        await durableJson(`${stem}.json`, state);
      }
    } finally {
      await unlock();
    }
  };
}
