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
  type PayloadToDriverInput,
  type ServiceJobDriver,
  type WorkerLoopHandle,
} from "./worker/worker-loop.js";

/** The worker boot handle — symmetric with the control-plane `boot()` shape. */
export interface WorkerHandle {
  /** Stops the loop, drains the in-flight job, and shuts down the pool. */
  stop: () => Promise<void>;
  /** The port the worker's liveness endpoint binds (for fleet-health probes). */
  port: number;
  /** Event bus — symmetric with `boot()`; reserved for fleet observability. */
  bus: ReturnType<typeof createEventBus>;
}

export interface RunWorkerOptions {
  /** The fleet queue client (S3 impl over the S0 claim endpoints). */
  queue: FleetQueueClient;
  /** Maps a claimed per-service payload to the d6 driver's per-service input. */
  payloadToInput: PayloadToDriverInput;
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

  // Construct the worker's own pool unless a budget source + driver are
  // injected (test path). The pool is the self-bounded context budget that
  // gates claiming and keeps the worker under its pids ceiling.
  let pool: BrowserPool | undefined;
  let budgetSource = opts.budgetSource;
  let driver = opts.driver;

  if (!budgetSource || !driver) {
    pool = new BrowserPool({ logger });
    await pool.init();
    budgetSource = budgetSource ?? pool;
    driver =
      driver ??
      createE2eFullDriver({
        launcher: createPooledE2eFullLauncher(pool, logger),
      });
  }

  let loop: WorkerLoopHandle;
  try {
    loop = startWorkerLoop({
      workerId,
      queue: opts.queue,
      pool: budgetSource,
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
    if (pool) await pool.shutdown().catch(() => {});
    throw err;
  }

  // Track loop liveness for /health: the loop's `done` promise resolves when
  // the loop exits (clean stop OR an unexpected crash). Until then the loop is
  // alive. A loop that exits WITHOUT a stop() (crash) flips /health to 503 so
  // the healthcheck reflects a dead worker rather than reporting healthy.
  let loopAlive = true;
  void loop.done.finally(() => {
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
      // processes or the loop; tear both down before rethrowing.
      await loop.stop().catch(() => {});
      if (pool) await pool.shutdown().catch(() => {});
      throw err;
    }
  }

  return {
    port,
    bus,
    async stop(): Promise<void> {
      logger.info("fleet.worker.stopping", { workerId });
      await loop.stop();
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
        await pool.shutdown().catch((err) =>
          logger.error("fleet.worker.pool-shutdown-failed", {
            workerId,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      logger.info("fleet.worker.stopped", { workerId });
    },
  };
}
