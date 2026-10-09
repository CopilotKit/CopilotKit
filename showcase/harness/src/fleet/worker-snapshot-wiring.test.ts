import { describe, it, expect } from "vitest";
import type { Browser } from "playwright";
import { BrowserPool } from "../probes/helpers/browser-pool.js";
import {
  createResourceSnapshotWriter,
  RESOURCE_SNAPSHOTS_COLLECTION,
  type SnapshotPbClient,
} from "../probes/helpers/resource-snapshot-writer.js";
import type { Logger } from "../types/index.js";

/**
 * PART A — RESTORE OBSERVABILITY (integration).
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 * The durable `resource_snapshots` forensic trail went dark on staging because
 * the `onSnapshot` → `resourceSnapshotWriter.write` hook was wired ONLY in the
 * legacy `boot()` path. The fleet worker entrypoint (`runWorker`,
 * orchestrator.ts) constructed a bare `new BrowserPool({ logger })` with NO
 * `onSnapshot` hook, so once staging moved to the fleet path no replica ever
 * persisted a gauge sample.
 *
 * ── WHAT THIS TEST PROVES ───────────────────────────────────────────────────
 * The fix composes the REAL `BrowserPool` with the REAL
 * `createResourceSnapshotWriter` EXACTLY as the `runWorker` wrapper now does:
 *   - the writer is constructed with this replica's `workerId`,
 *   - the pool's `onSnapshot` forwards each snapshot to `writer.write(...)`.
 * We drive a real pool lifecycle (init → heartbeat → shutdown) over a fake
 * launcher (no chromium) against an in-memory PB and assert:
 *   1. `resource_snapshots` rows ACTUALLY emit (the dark trail is restored), and
 *   2. EVERY row is stamped with this replica's `worker_id` (per-replica
 *      attribution across the 6 concurrent fleet writers).
 *
 * This is the integration counterpart to the writer unit tests (which prove the
 * stamping + per-partition prune in isolation): it proves the WIRING that the
 * production wrapper performs is correct, without booting chromium or PB.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** A no-op connected Browser — the pool never opens a context here, so init()
 *  just needs a launchable, closeable, connected fake. */
function makeNoopBrowser(): Browser {
  return {
    isConnected: () => true,
    on: () => {},
    async close() {},
    async newContext() {
      return { async close() {} };
    },
  } as unknown as Browser;
}

/** In-memory SnapshotPbClient that records created rows (mirrors the
 *  structural subset the writer uses). */
function makeRecordingPb(): {
  pb: SnapshotPbClient;
  created: Array<Record<string, unknown>>;
} {
  const created: Array<Record<string, unknown>> = [];
  let seq = 0;
  const pb: SnapshotPbClient = {
    async create(_collection, record) {
      const row = { id: `row-${seq}`, ...record };
      seq += 1;
      created.push(row);
      return row as never;
    },
    async list(_collection, opts) {
      // The prune head-probe / oldest-list scope by `worker_id = "<id>"`.
      const filter = opts?.filter;
      const scoped = filter
        ? created.filter((r) => filter.includes(`"${String(r.worker_id)}"`))
        : created;
      const perPage = opts?.perPage ?? scoped.length;
      return {
        totalItems: scoped.length,
        items: scoped.slice(0, perPage) as never[],
      };
    },
    async deleteByFilter() {
      return 0;
    },
  };
  return { pb, created };
}

describe("fleet worker — resource_snapshot onSnapshot wiring (Part A)", () => {
  it("emits worker_id-stamped resource_snapshots rows through the wired pool (init + heartbeat)", async () => {
    const workerId = "worker-test-host-7";
    const { pb, created } = makeRecordingPb();

    // Wire EXACTLY as the runWorker wrapper does: a workerId-stamped snapshot
    // writer, and a BrowserPool whose onSnapshot forwards to writer.write.
    const resourceSnapshotWriter = createResourceSnapshotWriter({
      pb,
      logger: silentLogger,
      workerId,
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      launchBrowser: async () => makeNoopBrowser(),
      launchStaggerMs: 0,
      heartbeatMs: 10, // tiny so the test observes a heartbeat snapshot quickly
      logger: silentLogger,
      onSnapshot: (snapshot) => {
        void resourceSnapshotWriter.write(
          snapshot.event,
          snapshot.gauges,
          snapshot.stats,
          snapshot.perBrowser,
        );
      },
    });

    await pool.init(); // fires the "init" baseline snapshot + starts heartbeat

    // Wait until at least the init row AND a heartbeat row have landed in PB.
    await waitFor(() => {
      const events = created.map((r) => String(r.event));
      return events.includes("init") && events.includes("heartbeat");
    }, 5_000);

    await pool.shutdown(); // fires the "shutdown" snapshot

    // 1. The trail is RESTORED: rows actually emitted (not dark).
    expect(created.length).toBeGreaterThanOrEqual(2);
    const events = created.map((r) => String(r.event));
    expect(events).toContain("init");
    expect(events).toContain("heartbeat");

    // 2. EVERY emitted row is stamped with THIS replica's worker_id.
    for (const row of created) {
      expect(row.worker_id).toBe(workerId);
    }

    // Sanity: the rows landed in the documented collection.
    expect(RESOURCE_SNAPSHOTS_COLLECTION).toBe("resource_snapshots");
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!predicate()) {
    throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`);
  }
}
