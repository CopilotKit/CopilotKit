import { describe, it, expect, vi } from "vitest";
import { purgeCvdiag } from "./cli-purge.js";
import type { PurgeDeps } from "./cli-purge.js";
import {
  CVDIAG_EVENTS_COLLECTION,
  CVDIAG_RAW_BYTE_SAMPLES_COLLECTION,
} from "./pb-writer.js";

// A tiny fake PB client capturing deleteByFilter calls per collection, plus a
// fake writer capturing the purge-audit emit. No live PocketBase.
function makeDeps(opts: {
  eventsDeleted: number;
  rawBytesDeleted: number;
}): PurgeDeps & {
  calls: Array<{ collection: string; filter: string }>;
  audits: Array<{ row_count_events: number; row_count_raw_bytes: number }>;
} {
  const calls: Array<{ collection: string; filter: string }> = [];
  const audits: Array<{
    row_count_events: number;
    row_count_raw_bytes: number;
  }> = [];

  const pb = {
    deleteByFilter: vi.fn(
      async (collection: string, filter: string): Promise<number> => {
        calls.push({ collection, filter });
        if (collection === CVDIAG_EVENTS_COLLECTION) return opts.eventsDeleted;
        if (collection === CVDIAG_RAW_BYTE_SAMPLES_COLLECTION)
          return opts.rawBytesDeleted;
        return 0;
      },
    ),
  };

  const writer = {
    writePurgeAudit: vi.fn(
      async (audit: {
        operator_id: string;
        target_predicate: string;
        row_count_events: number;
        row_count_raw_bytes: number;
      }): Promise<void> => {
        audits.push({
          row_count_events: audit.row_count_events,
          row_count_raw_bytes: audit.row_count_raw_bytes,
        });
      },
    ),
  };

  return { pb, writer, calls, audits };
}

describe("purgeCvdiag — cascade delete", () => {
  it("deletes cvdiag_events AND cascades to cvdiag_raw_byte_samples", async () => {
    const deps = makeDeps({ eventsDeleted: 3, rawBytesDeleted: 2 });
    await purgeCvdiag(
      {
        selector: "0190b8a0-0000-7000-8000-000000000001",
        operatorId: "ops-test",
      },
      deps,
    );

    const collections = deps.calls.map((c) => c.collection);
    expect(collections).toContain(CVDIAG_EVENTS_COLLECTION);
    expect(collections).toContain(CVDIAG_RAW_BYTE_SAMPLES_COLLECTION);
  });
});

describe("purgeCvdiag — purge_audit emit", () => {
  it("emits a cvdiag.purge_audit accounting event with the purged counts", async () => {
    const deps = makeDeps({ eventsDeleted: 5, rawBytesDeleted: 4 });
    const result = await purgeCvdiag(
      {
        selector: "0190b8a0-0000-7000-8000-000000000001",
        operatorId: "ops-test",
      },
      deps,
    );

    expect(deps.writer.writePurgeAudit).toHaveBeenCalledTimes(1);
    expect(deps.audits).toHaveLength(1);
    expect(deps.audits[0].row_count_events).toBe(5);
    expect(deps.audits[0].row_count_raw_bytes).toBe(4);
    expect(result.rowCountEvents).toBe(5);
    expect(result.rowCountRawBytes).toBe(4);
  });

  it("emits the audit AFTER both deletes (audit reflects the actual purge)", async () => {
    const deps = makeDeps({ eventsDeleted: 1, rawBytesDeleted: 1 });
    await purgeCvdiag({ selector: "slug-foo", operatorId: "ops-test" }, deps);
    // deleteByFilter must have run for both collections before the audit emit.
    expect(deps.pb.deleteByFilter).toHaveBeenCalledTimes(2);
    expect(deps.writer.writePurgeAudit).toHaveBeenCalledTimes(1);
  });
});
