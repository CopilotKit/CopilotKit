/**
 * Fleet WORKER /health server.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────
 * The worker container's docker/Railway healthcheck GETs `/health` on the
 * worker's resolved PORT (8080 in compose/Dockerfile). Without an HTTP server
 * actually listening there, the healthcheck always fails → 3 retries →
 * `unhealthy` → `restart: unless-stopped` restart-loops the container (each
 * restart re-inits a BrowserPool + re-registers — exactly the churn the fleet
 * exists to avoid). `runWorker` (fleet/orchestrator.ts) binds this server so a
 * booted worker answers its own liveness probe.
 *
 * ── WHY NOT `buildServer({ role: "worker" })` ──────────────────────────
 * The role-aware `/health` in `http/server.ts` models the in-process harness:
 * its "worker" role treats probe RULES as the unit of work (`rules > 0` is a
 * hard 503) and REQUIRES a `schedulerJobCount` callback. A FLEET worker owns
 * NO probe rules and NO scheduler — its liveness is "can I reach PocketBase,
 * is my pull-loop alive, did I register?". Reusing that surface would force
 * dishonest stub callbacks (`ruleCount: () => 1`) just to clear the gate. A
 * dedicated, minimal worker health handler reflects the worker's ACTUAL
 * liveness signals instead.
 *
 * ── LIVENESS SEMANTICS ─────────────────────────────────────────────────
 * `GET /health` returns 200 iff ALL of:
 *   - `pb()` resolves true (the worker can reach PocketBase — it can't claim
 *     or report a job without it),
 *   - `loopAlive()` is true (the pull-loop has not exited/crashed), and
 *   - `registered()` is true (the boot self-register upsert succeeded — a
 *     worker that never registered won't appear on the fleet roster).
 * Any false signal returns 503 with a `degraded` body naming the failing leg
 * so an operator (and the restart policy) can see WHY the worker is unhealthy.
 */

import { Hono } from "hono";
import type { Logger } from "../../types/index.js";

/** Liveness probes the worker health surface reflects. Injected so the handler stays pure + unit-testable. */
export interface WorkerHealthDeps {
  /** Resolves true when PocketBase is reachable (the worker's claim/report dependency). */
  pb: () => Promise<boolean>;
  /** True while the worker's pull-loop is alive (has not exited/crashed). */
  loopAlive: () => boolean;
  /** True once the worker's boot self-register upsert succeeded. */
  registered: () => boolean;
  logger: Logger;
}

/**
 * Build the worker's minimal `/health` Hono app. 200 when pb reachable + loop
 * alive + registered; 503 (degraded) otherwise. The body names each leg so the
 * failing signal is visible in the container logs / healthcheck output.
 */
export function buildWorkerHealthServer(deps: WorkerHealthDeps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    // A rejecting pb() probe (connect refused, transport error) is exactly the
    // "PocketBase unreachable" condition `/health` exists to surface — degrade
    // it to `pb:"down"` (503) instead of letting the rejection bubble into a
    // thrown 500, which an operator/restart-policy would misread as a server
    // fault rather than the worker's claim/report dependency being down.
    const pbOk = await deps.pb().catch(() => false);
    const loopOk = deps.loopAlive();
    const registeredOk = deps.registered();
    const ok = pbOk && loopOk && registeredOk;
    return c.json(
      {
        status: ok ? "ok" : "degraded",
        role: "worker",
        pb: pbOk ? "ok" : "down",
        loop: loopOk ? "alive" : "stopped",
        registered: registeredOk,
      },
      ok ? 200 : 503,
    );
  });

  return app;
}
