import { describe, it, expect, vi } from "vitest";
import net from "node:net";
import type { Browser } from "playwright";
import { runWorker } from "./orchestrator.js";
import type { FleetRoleConfig } from "./role-config.js";
import type {
  FleetQueueClient,
  ClaimedJob,
  JobLease,
  JobView,
  ServiceJobPayload,
  ServiceJobResult,
} from "./contracts.js";
import type { Logger } from "../types/index.js";
import { BrowserPool } from "../probes/helpers/browser-pool.js";
import type {
  LaunchBrowser,
  CgroupPidsReader,
} from "../probes/helpers/browser-pool.js";

/**
 * Fleet WORKER entrypoint (`runWorker`, fleet/orchestrator.ts) — DEFAULT
 * (self-contained) boot equivalence.
 *
 * REGRESSION: the default boot path (neither a `drivers` registry nor a legacy
 * `driver` injected) USED to set a bare `driver = d6Driver` WITHOUT a
 * `payloadToInput`, so `startWorkerLoop`'s construction guard threw "Fleet
 * worker has no drivers" and the worker could never boot self-contained. The fix
 * builds the default d6 as a REGISTRY entry (`e2e_d6 → { driver, payloadToInput,
 * aggregateSlugKey }`), so the self-contained boot SUCCEEDS and routes an
 * `e2e_d6` job through the d6 driver.
 *
 * The d6 driver is the REAL pooled one; we feed it an input with NO declared
 * features so it returns its green "no D5 features declared" aggregate WITHOUT
 * touching chromium (the BrowserPool's launcher is a no-op fake injected via the
 * test-only `launchBrowser` seam, so no real browser ever spawns).
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** A no-op connected Browser — the d6 driver never opens a context in this
 *  test (zero features), so `init()` just needs a launchable fake. */
function makeNoopLauncher(): LaunchBrowser {
  return async () =>
    ({
      isConnected: () => true,
      on: () => {},
      async close() {},
      async newContext() {
        return { async close() {} };
      },
    }) as unknown as Browser;
}

/** Always reports plenty of headroom so the claim gate never blocks. */
const headroomPidsReader: CgroupPidsReader = () => ({ current: 10, max: 1000 });

function makeJobView(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "job-1",
    probe_key: "d6:langgraph-python",
    status: "claimed",
    claimed_by: "worker-test",
    lease_expires_at: "2026-06-04T00:05:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makePayload(
  overrides: Partial<ServiceJobPayload> = {},
): ServiceJobPayload {
  return {
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    driverKind: "e2e_d6",
    // A runnable d6 input with NO declared features → the d6 driver returns its
    // green "no D5 features declared" aggregate without acquiring a browser.
    driverInputs: {
      key: "e2e_d6:langgraph-python",
      backendUrl: "https://lg.example.com",
    },
    meta: {
      runId: "run-42",
      triggered: false,
      enqueuedAt: "2026-06-04T00:00:00.000Z",
    },
    ...overrides,
  };
}

function makeLease(payload?: Partial<ServiceJobPayload>): JobLease {
  return {
    job: makeJobView(),
    payload: makePayload(payload),
    leaseExpiresAt: "2026-06-04T00:05:00.000Z",
  };
}

interface RecordingQueue extends FleetQueueClient {
  reports: ServiceJobResult[];
}

/** A queue fake that hands out a fixed sequence of claims, then idles. */
function makeQueue(claims: ClaimedJob[]): RecordingQueue {
  const reports: ServiceJobResult[] = [];
  let i = 0;
  return {
    reports,
    async enqueue() {
      throw new Error("enqueue not used by worker");
    },
    async claimNext(): Promise<ClaimedJob> {
      const next = claims[i] ?? { claimed: false };
      if (i < claims.length) i++;
      return next;
    },
    async renewLease(): Promise<JobLease | null> {
      return makeLease();
    },
    async report({ result }): Promise<void> {
      reports.push(result);
    },
    async sweepExpired() {
      return { reclaimed: 0, commErrors: [] };
    },
  };
}

const config: FleetRoleConfig = { role: "worker", poolCount: 1 };

describe("runWorker default (self-contained) boot", () => {
  it("boots WITHOUT an injected registry or driver and routes an e2e_d6 job through the d6 driver", async () => {
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);

    // No `drivers`, no `driver`, no `budgetSource` → the default boot path
    // constructs its own pool + the default d6 REGISTRY entry. Pre-fix this
    // threw "Fleet worker has no drivers"; post-fix it boots and routes.
    const worker = await runWorker(config, {
      queue,
      workerId: "worker-test",
      logger: silentLogger,
      env: {},
      skipHealthServer: true,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
      pollIntervalMs: 1,
      // Test-only seams so the default-boot BrowserPool never spawns chromium.
      launchBrowser: makeNoopLauncher(),
      cgroupPidsReader: headroomPidsReader,
    });

    try {
      await vi.waitFor(() => expect(queue.reports).toHaveLength(1), {
        timeout: 5000,
      });
    } finally {
      await worker.stop();
    }

    const result = queue.reports[0]!;
    // The e2e_d6 job was routed to the REAL d6 driver (not a protocol
    // violation): the d6 driver's green "no D5 features declared" aggregate.
    expect(result.commError).toBeUndefined();
    expect(result.aggregateState).toBe("green");
    expect(result.aggregateKey).toBe("e2e_d6:langgraph-python");
  });
});

/** Bind-then-release an ephemeral port for the worker /health server. */
async function pickPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

describe("runWorker loop-crash surfacing", () => {
  it("logs fleet.worker.loop-crashed (with stack), flips /health to 503, and a throwing stop-path logger still tears everything down", async () => {
    // B4: `loop.done` rejecting is a CRASHED worker loop. Pre-fix the handle
    // wiring was `void loop.done.finally(...)` — the rejection propagated
    // through the derived chain as an UNHANDLED rejection and nothing logged
    // why the loop died; /health flipped silently. The crash must be logged
    // loud (message + stack) and /health must report loop:"stopped" (503).
    //
    // Rejection vector: with every IIFE log guarded (`safeLog`), a throwing
    // logger no longer crashes the loop — the residual seam is a
    // structurally POISON queue result whose `.claimed` getter throws
    // outside the loop's claimNext try/catch.
    //
    // STOP-PATH GUARD (extends the teardown contract below): the logger ALSO
    // throws on `fleet.worker.stopping`/`fleet.worker.stopped`. Pre-guard,
    // `fleet.worker.stopping` sat unguarded BEFORE stop()'s try/finally, so
    // the logger throw escaped stop() FIRST — loop.stop was never awaited,
    // the /health server stayed bound, and the pool's chromium processes
    // stranded. Post-guard, stop() surfaces the loop-crash error and both
    // teardown arms still run.
    const queueBase = makeQueue([]);
    const queue: FleetQueueClient = {
      ...queueBase,
      async claimNext(): Promise<ClaimedJob> {
        return {
          get claimed(): boolean {
            throw new Error("poison claim");
          },
        } as ClaimedJob;
      },
    };
    const errors: Array<[string, Record<string, unknown> | undefined]> = [];
    const logger: Logger = {
      ...silentLogger,
      info: (msg) => {
        if (msg === "fleet.worker.stopping" || msg === "fleet.worker.stopped") {
          throw new Error("logger exploded on stop path");
        }
      },
      error: (msg, meta) => {
        errors.push([msg, meta]);
      },
    };
    const port = await pickPort();
    // Spy on the pool the DEFAULT (self-contained) boot path constructs so the
    // stop() teardown contract below is observable: a rejecting loop.stop()
    // must still shut the pool down (PID-ceiling compounding otherwise).
    const shutdownSpy = vi.spyOn(BrowserPool.prototype, "shutdown");
    try {
      const worker = await runWorker(config, {
        queue,
        workerId: "worker-crash",
        logger,
        env: {},
        port,
        // Default-boot seams (no injected budgetSource/driver) so runWorker
        // constructs its OWN pool — the one stop() must shut down. The crash
        // fires on the poison claim, before the d6 driver ever runs.
        launchBrowser: makeNoopLauncher(),
        cgroupPidsReader: headroomPidsReader,
        pollIntervalMs: 1,
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });

      // The crash is LOGGED — message and stack both carried.
      await vi.waitFor(() =>
        expect(errors.map((e) => e[0])).toContain("fleet.worker.loop-crashed"),
      );
      const crash = errors.find((e) => e[0] === "fleet.worker.loop-crashed")!;
      expect(crash[1]).toMatchObject({
        workerId: "worker-crash",
        err: "poison claim",
      });
      expect(String((crash[1] as { stack?: string }).stack)).toContain(
        "poison claim",
      );

      // …and /health reflects the dead loop (503, loop:"stopped").
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { loop: string };
      expect(body.loop).toBe("stopped");

      // stop() re-awaits the rejected done: the rejection SURFACES to the
      // caller — but the /health server is closed and the pool is shut down
      // anyway. Pre-fix the rejection escaped BEFORE either teardown arm,
      // leaking the bound port and stranding the pool's chromium processes.
      // The LOOP-CRASH error surfaces — NOT "logger exploded on stop path":
      // the guarded `fleet.worker.stopping` log cannot preempt the teardown.
      await expect(worker.stop()).rejects.toThrow("poison claim");
      expect(shutdownSpy).toHaveBeenCalledTimes(1);
      // The port no longer accepts connections — the health server really
      // closed (a still-bound server would answer this fetch).
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    } finally {
      shutdownSpy.mockRestore();
    }
  });
});
