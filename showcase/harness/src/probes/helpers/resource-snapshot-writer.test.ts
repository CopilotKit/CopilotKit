import { describe, it, expect } from "vitest";
import {
  createResourceSnapshotWriter,
  RESOURCE_SNAPSHOTS_COLLECTION,
} from "./resource-snapshot-writer.js";
import type { SnapshotPbClient } from "./resource-snapshot-writer.js";
import type { ResourceGauges } from "./resource-gauges.js";
import type { BrowserPoolStats } from "./browser-pool.js";

function makeGauges(overrides?: Partial<ResourceGauges>): ResourceGauges {
  return {
    ts: "2026-06-04T00:00:00.000Z",
    selfFdCount: 42,
    treeThreadCount: 850,
    treeProcCount: 60,
    zombieCount: 0,
    selfRssMb: 120,
    treeRssMb: 900,
    cgroupPidsCurrent: 850,
    cgroupPidsMax: 1000,
    devShmUsedPct: 12,
    tmpInodeUsedPct: 3,
    tmpInodesUsed: 100,
    tmpInodesFree: 9000,
    tmpSpaceUsedPct: 20,
    tmpSpaceFreeMb: 5000,
    playwrightTmpDirs: 2,
    ...overrides,
  };
}

const STATS: BrowserPoolStats = {
  size: 24,
  available: 20,
  inUse: 4,
  totalRecycles: 1,
};

interface LogEntry {
  level: "info" | "warn" | "error";
  event: string;
  meta?: Record<string, unknown>;
}

function makeLogger(): {
  logger: {
    info: (e: string, m?: Record<string, unknown>) => void;
    warn: (e: string, m?: Record<string, unknown>) => void;
    error: (e: string, m?: Record<string, unknown>) => void;
  };
  logs: LogEntry[];
} {
  const logs: LogEntry[] = [];
  return {
    logger: {
      info: (event, meta) => logs.push({ level: "info", event, meta }),
      warn: (event, meta) => logs.push({ level: "warn", event, meta }),
      error: (event, meta) => logs.push({ level: "error", event, meta }),
    },
    logs,
  };
}

/** In-memory PB fake recording creates + supporting list/deleteByFilter for the
 *  retention path. */
function makeFakePb(): {
  pb: SnapshotPbClient;
  created: Array<Record<string, unknown>>;
} {
  const created: Array<Record<string, unknown>> = [];
  const pb: SnapshotPbClient = {
    async create(_collection, record) {
      created.push(record);
      return record as never;
    },
    async list(_collection, opts) {
      // Sort newest-first by observed_at for the boundary lookup.
      const sorted = [...created].sort((a, b) =>
        String(b.observed_at).localeCompare(String(a.observed_at)),
      );
      const perPage = opts?.perPage ?? 30;
      const page = opts?.page ?? 1;
      const start = (page - 1) * perPage;
      const items = sorted.slice(start, start + perPage);
      return { totalItems: created.length, items: items as never[] };
    },
    async deleteByFilter(_collection, filter) {
      // filter is `observed_at < "<cutoff>"`.
      const m = filter.match(/observed_at < "(.+)"/);
      if (!m) return 0;
      const cutoff = m[1];
      const before = created.length;
      for (let i = created.length - 1; i >= 0; i--) {
        if (String(created[i].observed_at) < cutoff) created.splice(i, 1);
      }
      return before - created.length;
    },
  };
  return { pb, created };
}

describe("resource-snapshot-writer", () => {
  it("persists a snapshot row with the gauge + stats fields", async () => {
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({ pb, logger });

    await writer.write("degraded", makeGauges(), STATS, [
      { index: 0, liveContexts: 2, servedContexts: 10, recycling: false },
    ]);

    expect(created).toHaveLength(1);
    const row = created[0];
    expect(row.event).toBe("degraded");
    expect(row.observed_at).toBe("2026-06-04T00:00:00.000Z");
    expect(row.pids_current).toBe(850);
    expect(row.pids_max).toBe(1000);
    expect(row.threads).toBe(850);
    expect(row.contexts_in_use).toBe(4);
    expect(row.contexts_available).toBe(20);
    expect(row.browsers).toBe(1);
    expect(Array.isArray(row.per_browser)).toBe(true);
  });

  it("BEST-EFFORT: a throwing PB create is swallowed (write resolves, does not reject) and logged", async () => {
    const throwingPb: SnapshotPbClient = {
      async create() {
        throw new Error("pb create failed: 400 missing collection");
      },
      async list() {
        return { totalItems: 0, items: [] };
      },
      async deleteByFilter() {
        return 0;
      },
    };
    const { logger, logs } = makeLogger();
    const writer = createResourceSnapshotWriter({ pb: throwingPb, logger });

    // MUST NOT reject — the pool's lifecycle paths call this and a throw would
    // break the pool (the prior incident: an unrun-migration 400 broke the
    // caller).
    await expect(
      writer.write("unrecoverable", makeGauges(), STATS),
    ).resolves.toBeUndefined();

    const failLog = logs.find(
      (l) => l.event === "resource-snapshot.write-failed",
    );
    expect(failLog).toBeDefined();
    expect(failLog?.level).toBe("warn");
  });

  it("RETENTION: prunes oldest rows beyond maxRows (ring-style)", async () => {
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    // Tiny cap + pruneIntervalMs:0 so every write prunes deterministically.
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxRows: 3,
      pruneIntervalMs: 0,
    });

    // Write 6 snapshots with strictly-increasing timestamps.
    for (let i = 0; i < 6; i++) {
      const ts = `2026-06-04T00:00:0${i}.000Z`;
      await writer.write("heartbeat", makeGauges({ ts }), STATS);
    }

    // Ring cap is 3 — only the 3 newest survive.
    expect(created).toHaveLength(3);
    const tss = created.map((r) => r.observed_at).sort();
    expect(tss).toEqual([
      "2026-06-04T00:00:03.000Z",
      "2026-06-04T00:00:04.000Z",
      "2026-06-04T00:00:05.000Z",
    ]);
  });

  it("RETENTION: does not prune when under cap", async () => {
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxRows: 100,
      pruneIntervalMs: 0,
    });
    for (let i = 0; i < 5; i++) {
      await writer.write("heartbeat", makeGauges({ ts: `t${i}` }), STATS);
    }
    expect(created).toHaveLength(5);
  });

  it("uses the documented collection name", () => {
    expect(RESOURCE_SNAPSHOTS_COLLECTION).toBe("resource_snapshots");
  });
});
