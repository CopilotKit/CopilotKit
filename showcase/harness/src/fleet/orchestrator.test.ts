import { describe, it, expect, vi } from "vitest";
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
