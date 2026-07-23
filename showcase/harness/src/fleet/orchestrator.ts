/**
 * Fleet WORKER entrypoint (BLITZ S7 — the body for S8's `runWorker` stub).
 *
 * `runWorker` is the worker-role boot path: it constructs the worker's own
 * `BrowserPool` (the self-bounded context budget that keeps the worker under
 * the cgroup `pids.max` ceiling), wires the EXISTING per-service d6 driver onto
 * that pool via `createPooledE2eFullLauncher`, and runs the S7 worker LOOP
 * (`startWorkerLoop`) which claims per-service jobs, runs all their cells,
 * heartbeat-renews the lease, and reports the per-service result.
 *
 * It returns the `{ stop, port, bus }` shape the role dispatcher (S8) expects —
 * symmetric with the control-plane's `boot()` return — so the single harness
 * image can `await (role === "worker" ? runWorker(...) : boot(...))` and treat
 * both the same way (await `stop()` on shutdown, read `port` for health checks,
 * subscribe to `bus`).
 *
 * ── INJECTED, NOT HARD-WIRED ───────────────────────────────────────────
 * The queue client (S3) and the payload→driver-input mapping (the service
 * catalog) are passed in via `RunWorkerOptions`, not constructed here:
 *   - the queue client is S3's `FleetQueueClient` impl over PocketBase; the
 *     worker only consumes the interface (`claimNext`/`renewLease`/`report`).
 *   - the payload→input mapping needs the showcase service catalog (backend
 *     URLs, declared demos) which the discovery/control-plane slots own.
 * Keeping both injected makes this entrypoint testable and keeps S7 from
 * reaching into slots it doesn't own.
 */

import { serve } from "@hono/node-server";
import { createEventBus } from "../events/event-bus.js";
import { logger as defaultLogger } from "../logger.js";
import { BrowserPool } from "../probes/helpers/browser-pool.js";
import type {
  LaunchBrowser,
  CgroupPidsReader,
} from "../probes/helpers/browser-pool.js";
import {
  createE2eFullDriver,
  createPooledE2eFullLauncher,
} from "../probes/drivers/d6-all-pills.js";
import type { Logger } from "../types/index.js";
import type { FleetRoleConfig } from "./role-config.js";
import type { FleetQueueClient } from "./contracts.js";
import { buildWorkerHealthServer } from "./worker/worker-health.js";
import {
  startWorkerLoop,
  safeLog,
  type PayloadToDriverInput,
  type ServiceJobDriver,
  type DriverRegistry,
  type WorkerLoopHandle,
} from "./worker/worker-loop.js";
import {
  createD6PayloadToInput,
  E2E_D6_DRIVER_KIND,
} from "./worker/payload-mapper.js";

/** The worker boot handle — symmetric with the control-plane `boot()` shape. */
export interface WorkerHandle {
  /**
   * SYNCHRONOUSLY request the drain (forwards `WorkerLoopHandle.drain()`):
   * fires the loop's abort/abandon signal WITHOUT awaiting teardown, so a
   * caller can deregister the worker's roster row BEFORE the platform kill
   * grace expires and only then spend the drain budget in `stop()`.
   * Idempotent; `stop()` implies it.
   */
  drain: () => void;
  /**
   * Stops the loop, drains the in-flight job, and shuts down the pool. The
   * pool shutdown applies only when THIS entrypoint constructed the pool
   * (the self-contained boot path) — callers that inject their own
   * `budgetSource` + run path own their pool's lifecycle and shut it down
   * themselves. A rejecting loop stop still closes the /health server and
   * shuts the pool down before the rejection re-surfaces to the caller.
   */
  stop: () => Promise<void>;
  /** The port the worker's liveness endpoint binds (for fleet-health probes). */
  port: number;
  /** Event bus — symmetric with `boot()`; reserved for fleet observability. */
  bus: ReturnType<typeof createEventBus>;
}

export interface RunWorkerOptions {
  /** The fleet queue client (S3 impl over the S0 claim endpoints). */
  queue: FleetQueueClient;
  /**
   * The driver REGISTRY: `driverKind` → `{ driver, payloadToInput }`. When
   * supplied the worker dispatches each claimed job by `payload.driverKind`,
   * hosting MULTIPLE browser driver families on one worker. Built by the
   * `runWorker` entrypoint (orchestrator.ts) which wires every pooled driver
   * onto the shared `BrowserPool`. Takes precedence over the legacy single
   * `driver`/`payloadToInput` pair below; when omitted the worker falls back to
   * the single-driver path.
   */
  drivers?: DriverRegistry;
  /**
   * LEGACY single-driver payload mapper. Used only when `drivers` is omitted.
   * Optional now that the registry is the primary path; when both `drivers` and
   * the single `driver` are absent the default pooled d6 driver + this mapper
   * are constructed below.
   */
  payloadToInput?: PayloadToDriverInput;
  /** Stable worker id (the `claimed_by` on every claim). */
  workerId?: string;
  /**
   * Port the worker's `/health` server binds (and carried back on the handle).
   * Default from PORT env or DEFAULT_PORT (8080 — matches EXPOSE/Dockerfile/
   * control-plane; the compose worker sets PORT=8080, so the healthcheck GETs
   * the right port).
   */
  port?: number;
  logger?: Logger;
  /**
   * Reachability probe for the worker's `/health` server: resolves true when
   * PocketBase is reachable. Injected from the entrypoint that owns the PB
   * client (orchestrator.ts). When omitted, /health treats pb as reachable
   * (test path with no PB).
   */
  pbHealth?: () => Promise<boolean>;
  /**
   * Liveness probe for the worker's `/health` server: true once the worker's
   * boot self-register upsert succeeded. Injected from the entrypoint that owns
   * registration. When omitted, /health treats the worker as registered.
   */
  registered?: () => boolean;
  /**
   * Skip binding the `/health` HTTP server (tests that don't need a real
   * socket). Production always binds it so the docker/Railway healthcheck on
   * the resolved port answers and the container isn't restart-looped.
   */
  skipHealthServer?: boolean;
  /** Env snapshot threaded into the driver ctx. Defaults to process.env. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Lease seconds requested per claim/renew. */
  leaseSeconds?: number;
  /** Heartbeat (renew) cadence while a job runs. */
  heartbeatMs?: number;
  /** Idle poll interval when there's no work / no budget. */
  pollIntervalMs?: number;
  /**
   * Fired when the worker's current job changes (claimed jobId, then null when
   * it settles). The entrypoint wires this to the registration heartbeat so
   * `workers.current_job_id` reflects the live job. Best-effort — the loop
   * guards a throwing/rejecting impl.
   */
  onCurrentJobChange?: (currentJobId: string | null) => void;
  /**
   * Override the per-service driver (tests inject a fake). Defaults to the real
   * pooled d6 driver wired onto the constructed `BrowserPool`.
   */
  driver?: ServiceJobDriver;
  /**
   * Skip constructing/initializing the real `BrowserPool` (tests). When a
   * `driver` is also injected, the worker runs entirely on fakes. The injected
   * `budgetSource` then gates claiming.
   */
  budgetSource?: {
    budget(): import("../probes/helpers/browser-pool.js").BrowserPoolBudget;
  };
  /**
   * Test-only seam: injected chromium launcher forwarded to the `BrowserPool`
   * the DEFAULT (self-contained) boot path constructs, so the default-boot
   * equivalence test can exercise that path WITHOUT spawning real chromium.
   * Production omits it → the pool uses the real launcher. Ignored when a
   * `budgetSource` + run path are injected (no pool is constructed).
   */
  launchBrowser?: LaunchBrowser;
  /**
   * Test-only seam: injected cgroup PID reader forwarded to the default-boot
   * `BrowserPool` (powers `budget()`), so the default-boot test reports
   * headroom deterministically. Production omits it → the real reader is used.
   */
  cgroupPidsReader?: CgroupPidsReader;
}

/**
 * Default liveness port. 8080 to match the harness Dockerfile `EXPOSE 8080`,
 * the control-plane boot, and the compose worker's `PORT=8080` healthcheck —
 * a worker MUST bind the port the healthcheck probes or the container
 * restart-loops. (Previously 8090 — the PocketBase port — which never matched
 * the worker healthcheck.)
 */
const DEFAULT_PORT = 8080;

/** Resolve the worker id: explicit > HOSTNAME > a stable random fallback. */
function resolveWorkerId(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const host = env.HOSTNAME?.trim();
  if (host && host.length > 0) return `worker-${host}`;
  return `worker-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Boot the worker role. Constructs the pool + pooled d6 driver, starts the S7
 * loop, and returns `{ stop, port, bus }`.
 *
 * `config` is the resolved fleet role config (S8) — carried for symmetry and
 * diagnostics; the worker doesn't branch on `poolCount` (each worker bounds
 * itself via its own `BrowserPool.budget()`).
 */
export async function runWorker(
  config: FleetRoleConfig,
  opts: RunWorkerOptions,
): Promise<WorkerHandle> {
  const logger = opts.logger ?? defaultLogger;
  const env = opts.env ?? process.env;
  const bus = createEventBus();
  const workerId = resolveWorkerId(opts.workerId, env);
  const port = opts.port ?? (Number(env.PORT ?? DEFAULT_PORT) || DEFAULT_PORT);

  logger.info("fleet.worker.boot", {
    workerId,
    role: config.role,
    poolCount: config.poolCount,
    port,
  });

  // Resolve the worker's drivers. Three shapes, in precedence order:
  //   1. An injected `drivers` registry (the primary path — the entrypoint
  //      wires every pooled driver family onto the shared pool). Paired with an
  //      injected `budgetSource`, the worker runs entirely on the caller's wiring
  //      and this entrypoint constructs NO pool of its own.
  //   2. A legacy single `driver` + `budgetSource` (back-compat test path).
  //   3. Neither → construct the worker's own pool and a DEFAULT REGISTRY holding
  //      the single pooled d6 driver under its `e2e_d6` kind (the self-contained
  //      boot). Building it as a registry entry — not a bare `driver` — means the
  //      self-contained path also routes by driverKind AND carries the d6
  //      payload mapper, so `startWorkerLoop`'s construction guard is satisfied
  //      (equivalence with the pre-registry single-d6 worker).
  // The pool is the self-bounded context budget that gates claiming and keeps the
  // worker under its pids ceiling.
  let pool: BrowserPool | undefined;
  let budgetSource = opts.budgetSource;
  let drivers = opts.drivers;
  let driver = opts.driver;

  // We have all the wiring we need iff a budget source exists AND at least one
  // run path (a registry or a single driver) is supplied. Otherwise build the
  // default pool + d6 registry so the worker is self-contained.
  const haveRunPath = drivers !== undefined || driver !== undefined;
  if (!budgetSource || !haveRunPath) {
    pool = new BrowserPool({
      logger,
      launchBrowser: opts.launchBrowser,
      cgroupPidsReader: opts.cgroupPidsReader,
    });
    await pool.init();
    budgetSource = budgetSource ?? pool;
    if (!haveRunPath) {
      // Default to the single pooled d6 driver registered under its kind, paired
      // with the d6 payload→input mapper, so the self-contained boot routes by
      // driverKind through the registry (equivalence with the pre-registry
      // single-d6 worker) and the loop's construction guard is satisfied.
      drivers = new Map([
        [
          E2E_D6_DRIVER_KIND,
          {
            driver: createE2eFullDriver({
              launcher: createPooledE2eFullLauncher(pool, logger),
            }),
            payloadToInput: createD6PayloadToInput(),
            aggregateSlugKey: (serviceSlug: string) => `d6:${serviceSlug}`,
          },
        ],
      ]);
    }
  }

  let loop: WorkerLoopHandle;
  try {
    loop = startWorkerLoop({
      workerId,
      queue: opts.queue,
      pool: budgetSource,
      drivers,
      driver,
      payloadToInput: opts.payloadToInput,
      logger,
      env,
      leaseSeconds: opts.leaseSeconds,
      heartbeatMs: opts.heartbeatMs,
      pollIntervalMs: opts.pollIntervalMs,
      onCurrentJobChange: opts.onCurrentJobChange,
    });
  } catch (err) {
    // Loop construction is synchronous and shouldn't throw, but if it does,
    // never strand the pool's chromium processes (PID-ceiling compounding).
    // The shutdown is best-effort but LOGGED (consistent with the stop path's
    // pool-shutdown logging below) — an empty catch would hide why chromium
    // processes were left stranded behind the construction failure. The
    // original construction error still rethrows.
    if (pool) {
      // Guarded: a throwing logger inside this .catch handler would reject
      // the awaited chain and mask the construction error being rethrown.
      await pool.shutdown().catch((shutdownErr) =>
        safeLog(logger, "error", "fleet.worker.pool-shutdown-failed", {
          workerId,
          phase: "loop-construction-failed",
          err:
            shutdownErr instanceof Error
              ? shutdownErr.message
              : String(shutdownErr),
        }),
      );
    }
    throw err;
  }

  // Track loop liveness for /health: the loop's `done` promise resolves when
  // the loop exits (clean stop OR an unexpected crash). Until then the loop is
  // alive. A loop that exits WITHOUT a stop() (crash) flips /health to 503 so
  // the healthcheck reflects a dead worker rather than reporting healthy.
  // A REJECTED `done` is a crashed loop: log it loud (message + stack) before
  // flipping /health — a bare `.finally()` chain would re-propagate the
  // rejection as an UNHANDLED rejection with no record of WHY the loop died.
  // DEFENSE-IN-DEPTH: with every log inside the loop's done-IIFE guarded
  // (`safeLog`), a throwing logger can no longer reject `done` — the residual
  // crash vectors are structural (e.g. a poison queue result throwing outside
  // the loop's try/catch blocks), so this catch is kept but nearly
  // unreachable. The crash log itself is guarded too: a throwing logger
  // inside this handler would turn the HANDLED rejection back into an
  // unhandled one on the derived chain.
  let loopAlive = true;
  void loop.done
    .catch((err) => {
      safeLog(logger, "error", "fleet.worker.loop-crashed", {
        workerId,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    })
    .finally(() => {
      loopAlive = false;
    });

  // Bind the worker's /health server on the resolved port. The docker/Railway
  // healthcheck GETs this; without it the container is restart-looped. Bind
  // AFTER the loop is constructed so /health only reports alive once the worker
  // is actually pulling. Tests pass `skipHealthServer` to avoid a real socket.
  let server: ReturnType<typeof serve> | undefined;
  if (!opts.skipHealthServer) {
    const healthApp = buildWorkerHealthServer({
      pb: opts.pbHealth ?? (async () => true),
      loopAlive: () => loopAlive,
      registered: opts.registered ?? (() => true),
      logger,
    });
    try {
      server = serve({ fetch: healthApp.fetch, port });
      logger.info("fleet.worker.health-listening", { workerId, port });
    } catch (err) {
      // A bind failure (EADDRINUSE) must not strand the pool's chromium
      // processes or the loop; tear both down before rethrowing. Both
      // teardown arms are best-effort but LOGGED (consistent with the stop
      // path's pool-shutdown logging below) — empty catches would hide why a
      // bind-failure teardown also failed. The original bind error still
      // rethrows.
      // Both .catch handlers log GUARDED: a throwing logger inside either
      // would reject the awaited chain, skip the teardown arm behind it, and
      // mask the bind error being rethrown.
      await loop.stop().catch((stopErr) =>
        safeLog(logger, "error", "fleet.worker.loop-stop-failed", {
          workerId,
          phase: "health-bind-failed",
          err: stopErr instanceof Error ? stopErr.message : String(stopErr),
        }),
      );
      if (pool) {
        await pool.shutdown().catch((shutdownErr) =>
          safeLog(logger, "error", "fleet.worker.pool-shutdown-failed", {
            workerId,
            phase: "health-bind-failed",
            err:
              shutdownErr instanceof Error
                ? shutdownErr.message
                : String(shutdownErr),
          }),
        );
      }
      throw err;
    }
  }

  return {
    port,
    bus,
    drain(): void {
      loop.drain();
    },
    async stop(): Promise<void> {
      // GUARDED (sits BEFORE the try/finally): in the self-contained path a
      // throwing logger here would skip loop.stop, the /health server close,
      // AND the pool shutdown — the entire teardown — for a forensic line.
      safeLog(logger, "info", "fleet.worker.stopping", { workerId });
      // A REJECTING loop.stop() (the loop's done-promise crashed) must not
      // leak the bound /health server (the port would stay taken and the
      // container healthcheck would keep answering for a dead worker) or
      // strand the pool's chromium processes (PID-ceiling compounding) — both
      // teardown arms ALWAYS run, then the stop rejection re-surfaces to the
      // caller. Neither arm throws in practice (the server-close promise only
      // resolves, and the pool shutdown carries its own .catch) — the one
      // residual is a SYNCHRONOUSLY-throwing `srv.close`, which would reject
      // inside this finally and mask the stop error; vanishingly unlikely for
      // a node server handle, and accepted.
      try {
        await loop.stop();
      } finally {
        if (server) {
          await new Promise<void>((resolve) => {
            const srv = server as unknown as {
              close?: (cb?: () => void) => void;
            };
            if (typeof srv.close === "function") srv.close(() => resolve());
            else resolve();
          });
        }
        if (pool) {
          // Guarded: a throwing logger inside this .catch would reject the
          // finally chain and mask the stop error being re-surfaced.
          await pool.shutdown().catch((err) =>
            safeLog(logger, "error", "fleet.worker.pool-shutdown-failed", {
              workerId,
              err: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
      safeLog(logger, "info", "fleet.worker.stopped", { workerId });
    },
  };
}
