import { describe, it, expect, vi } from "vitest";
import {
  createPbRetention,
  DEFAULT_RETENTION_TARGETS,
  PB_MAX_PAGE_SIZE,
  resolveRetentionConfig,
  retentionCutoffLiteral,
} from "./pb-retention.js";
import type { RetentionTarget } from "./pb-retention.js";
import { PbHttpError } from "./pb-client.js";
import type { ListOpts, ListResult, PbClient } from "./pb-client.js";
import type { Logger } from "../types/index.js";

const DAY = 24 * 3600_000;
const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function silentLogger(): Logger & {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

interface Row {
  id: string;
  [field: string]: string;
}

/**
 * In-memory PB fake that honors the ONE filter/sort shape the retention pass
 * builds — `<field> < "<literal>"`, sorted ascending on `<field>` — the way
 * PB/SQLite would (lexicographic string compare), so tests exercise real
 * row selection rather than capturing filter strings. `&& id != "<id>"`
 * exclusions are honored too, and like PB it serves at most 500 rows a page
 * whatever `perPage` asks for.
 */
function fakePb(collections: Record<string, Row[]>) {
  const lists: Array<{ collection: string; opts: ListOpts }> = [];
  const deletes: Array<{ collection: string; id: string }> = [];
  const pb: Pick<PbClient, "list" | "delete"> = {
    async list<T>(
      collection: string,
      opts: ListOpts = {},
    ): Promise<ListResult<T>> {
      lists.push({ collection, opts });
      const [head, ...exclusions] = (opts.filter ?? "").split(" && ");
      const match = head?.match(/^(\w+) < ("(?:[^"\\]|\\.)*")$/);
      if (!match)
        throw new Error(`fake list: unexpected filter ${opts.filter}`);
      const field = match[1]!;
      const literal = JSON.parse(match[2]!) as string;
      const excluded = new Set(
        exclusions.map((clause) => {
          const ex = clause.match(/^id != ("(?:[^"\\]|\\.)*")$/);
          if (!ex) throw new Error(`fake list: unexpected clause ${clause}`);
          return JSON.parse(ex[1]!) as string;
        }),
      );
      if (opts.sort !== field)
        throw new Error(`fake list: unexpected sort ${opts.sort}`);
      const rows = (collections[collection] ?? [])
        .filter((r) => r[field]! < literal && !excluded.has(r.id))
        .sort((a, b) => (a[field]! < b[field]! ? -1 : 1))
        .slice(0, Math.min(opts.perPage ?? 30, PB_MAX_PAGE_SIZE));
      const items = rows.map((r) => (opts.fields === "id" ? { id: r.id } : r));
      return {
        page: 1,
        perPage: Math.min(opts.perPage ?? 30, PB_MAX_PAGE_SIZE),
        totalItems: -1,
        totalPages: -1,
        items: items as unknown as T[],
      };
    },
    async delete(collection: string, id: string): Promise<void> {
      deletes.push({ collection, id });
      const rows = collections[collection] ?? [];
      const at = rows.findIndex((r) => r.id === id);
      if (at !== -1) rows.splice(at, 1);
    },
  };
  return { pb, lists, deletes, collections };
}

function pbDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ");
}

function seed(
  collection: string,
  field: string,
  format: (ms: number) => string,
  ages: Array<[label: string, count: number, ageMs: number]>,
): Row[] {
  const rows: Row[] = [];
  for (const [label, count, ageMs] of ages) {
    for (let i = 0; i < count; i++) {
      rows.push({
        id: `${collection}-${label}-${i}`,
        [field]: format(NOW - ageMs + i),
      });
    }
  }
  return rows;
}

const target = (overrides: Partial<RetentionTarget> = {}): RetentionTarget => ({
  collection: "status_history",
  field: "created",
  fieldKind: "pb-date",
  maxAgeMs: 30 * DAY,
  ...overrides,
});

const httpError = (statusCode: number, id: string) =>
  new PbHttpError({
    statusCode,
    bodyText: "{}",
    path: `/api/collections/x/records/${id}`,
  });

/** Resolve after pending microtasks and one timer turn. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe("pb-retention", () => {
  it("defaults every collection to a 30-day window on a server-stamped PB date field", () => {
    expect(
      DEFAULT_RETENTION_TARGETS.map((t) => [
        t.collection,
        t.field,
        t.fieldKind,
        t.maxAgeMs / DAY,
      ]),
    ).toEqual([
      // `created`, not the writer-supplied free-text `ts`.
      ["cvdiag_events", "created", "pb-date", 30],
      ["diag_events", "created", "pb-date", 30],
      ["status_history", "created", "pb-date", 30],
      ["probe_runs", "started_at", "pb-date", 30],
    ]);
  });

  it("formats the cutoff in the stored shape of the field", () => {
    expect(retentionCutoffLiteral(NOW, "pb-date")).toBe(
      "2026-10-12 12:00:00.000Z",
    );
    expect(retentionCutoffLiteral(NOW, "iso-text")).toBe(
      "2026-10-12T12:00:00.000Z",
    );
  });

  it("deletes expired rows in batches, oldest first, and keeps rows inside the window", async () => {
    const fake = fakePb({
      status_history: seed("status_history", "created", pbDate, [
        ["old", 450, 45 * DAY],
        ["boundary", 20, 29 * DAY],
        ["recent", 30, DAY],
      ]),
    });
    const retention = createPbRetention({
      pb: fake.pb,
      logger: silentLogger(),
      options: { targets: [target()], batchSize: 200, batchPauseMs: 0 },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW);
    expect(result.collections).toEqual([
      {
        collection: "status_history",
        deleted: 450,
        failed: 0,
        batches: 3,
        drained: true,
      },
    ]);
    expect(
      fake.collections.status_history!.map((r) => r.id.split("-")[1]),
    ).toEqual([...Array(20).fill("boundary"), ...Array(30).fill("recent")]);
    // Every list projects ids only, sorts on the cutoff field, skips the count.
    for (const { opts } of fake.lists) {
      expect(opts).toMatchObject({
        sort: "created",
        fields: "id",
        skipTotal: true,
      });
      expect(opts.perPage).toBeLessThanOrEqual(200);
    }
    // Oldest rows go first.
    expect(fake.deletes[0]!.id).toBe("status_history-old-0");
  });

  it("does not delete a same-day row that is still inside the window (pb-date literal, not ISO)", async () => {
    // 29d23h old is INSIDE a 30d window. An ISO literal ("...T...") would
    // compare GREATER than every PB-shaped ("... ") value on the cutoff's day
    // and wrongly delete it.
    const cutoffDay = NOW - 30 * DAY;
    const fake = fakePb({
      status_history: [
        { id: "inside", created: pbDate(cutoffDay + 3600_000) },
        { id: "outside", created: pbDate(cutoffDay - 3600_000) },
      ],
    });
    const retention = createPbRetention({
      pb: fake.pb,
      logger: silentLogger(),
      options: { targets: [target()], batchPauseMs: 0 },
      now: () => NOW,
    });
    await retention.runPass(NOW);
    expect(fake.collections.status_history!.map((r) => r.id)).toEqual([
      "inside",
    ]);
  });

  it("caps rows per collection per pass so a backlog drains across passes", async () => {
    const fake = fakePb({
      cvdiag_events: seed(
        "cvdiag_events",
        "ts",
        (ms) => new Date(ms).toISOString(),
        [
          ["old", 1000, 60 * DAY],
          ["recent", 10, DAY],
        ],
      ),
    });
    const retention = createPbRetention({
      pb: fake.pb,
      logger: silentLogger(),
      options: {
        targets: [
          target({
            collection: "cvdiag_events",
            field: "ts",
            fieldKind: "iso-text",
          }),
        ],
        batchSize: 200,
        maxRowsPerCollection: 300,
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const deletedPerPass: number[] = [];
    for (let pass = 0; pass < 5; pass++) {
      const result = await retention.runPass(NOW);
      deletedPerPass.push(result.deleted);
    }
    expect(deletedPerPass).toEqual([300, 300, 300, 100, 0]);
    expect(fake.collections.cvdiag_events).toHaveLength(10);
    // The cap also bounds the page size: the second batch of a pass asks for
    // only the 100 rows left under the cap.
    expect(fake.lists.slice(0, 2).map((l) => l.opts.perPage)).toEqual([
      200, 100,
    ]);
  });

  it("stops at the pass deadline and rotates the starting collection", async () => {
    let clock = NOW;
    const make = () => seed("x", "created", pbDate, [["old", 1000, 60 * DAY]]);
    const fake = fakePb({ a: make(), b: make() });
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(collection, id) {
        clock += 10; // each delete costs 10ms of wall clock
        await fake.pb.delete(collection, id);
      },
    };
    const retention = createPbRetention({
      pb,
      logger: silentLogger(),
      options: {
        targets: [target({ collection: "a" }), target({ collection: "b" })],
        batchSize: 100,
        deleteConcurrency: 1,
        passDeadlineMs: 1500, // 150 deletes worth
        batchPauseMs: 0,
      },
      now: () => clock,
    });
    const first = await retention.runPass(NOW);
    expect(first.hitDeadline).toBe(true);
    // The deadline is checked between deletes, not only between batches.
    expect(first.collections.map((c) => [c.collection, c.deleted])).toEqual([
      ["a", 150],
      ["b", 0],
    ]);
    clock = NOW;
    const second = await retention.runPass(NOW);
    // b goes first this time, so a deep backlog in `a` cannot starve it.
    expect(second.collections.map((c) => [c.collection, c.deleted])).toEqual([
      ["b", 150],
      ["a", 0],
    ]);
  });

  it("isolates a failing collection and still prunes the others", async () => {
    const fake = fakePb({
      probe_runs: seed("probe_runs", "started_at", pbDate, [
        ["old", 5, 60 * DAY],
      ]),
    });
    const logger = silentLogger();
    const pb: Pick<PbClient, "list" | "delete"> = {
      async list(collection, opts) {
        if (collection === "diag_events") throw new Error("pb http 500");
        return fake.pb.list(collection, opts);
      },
      delete: fake.pb.delete,
    };
    const retention = createPbRetention({
      pb,
      logger,
      options: {
        targets: [
          target({ collection: "diag_events" }),
          target({ collection: "probe_runs", field: "started_at" }),
        ],
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW);
    expect(result.collections).toEqual([
      {
        collection: "diag_events",
        deleted: 0,
        failed: 0,
        batches: 0,
        drained: false,
        error: "pb http 500",
      },
      {
        collection: "probe_runs",
        deleted: 5,
        failed: 0,
        batches: 1,
        drained: true,
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "pb-retention.collection-failed",
      expect.objectContaining({ collection: "diag_events" }),
    );
  });

  it("on a delete failure stops every worker, awaits them, and counts what was deleted", async () => {
    const fake = fakePb({
      probe_runs: seed("probe_runs", "started_at", pbDate, [
        ["old", 40, 45 * DAY],
      ]),
    });
    const logger = silentLogger();
    let returned = false;
    let lateDeletes = 0;
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(collection, id) {
        if (id === "probe_runs-old-2") throw httpError(500, id);
        await settle();
        if (returned) lateDeletes += 1;
        await fake.pb.delete(collection, id);
      },
    };
    const retention = createPbRetention({
      pb,
      logger,
      options: {
        targets: [target({ collection: "probe_runs", field: "started_at" })],
        batchSize: 40,
        deleteConcurrency: 4,
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW);
    returned = true;
    const removedAtReturn = 40 - fake.collections.probe_runs!.length;
    await settle();
    await settle();
    // Nothing keeps deleting in the background after the pass returns.
    expect(lateDeletes).toBe(0);
    expect(40 - fake.collections.probe_runs!.length).toBe(removedAtReturn);
    // Ids 0, 1 and 3 were in flight with id 2 and finish; nobody takes another.
    expect(removedAtReturn).toBe(3);
    expect(result.collections[0]).toMatchObject({
      deleted: 3,
      batches: 1,
      drained: false,
    });
    expect(result.collections[0]!.error).toContain("pb http 500");
    expect(logger.warn).toHaveBeenCalledWith(
      "pb-retention.collection-failed",
      expect.objectContaining({ collection: "probe_runs", status: 500 }),
    );
  });

  it("keeps the counts of earlier batches when a later batch fails", async () => {
    const fake = fakePb({
      probe_runs: seed("probe_runs", "started_at", pbDate, [
        ["old", 30, 45 * DAY],
      ]),
    });
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(collection, id) {
        if (id === "probe_runs-old-15") throw new Error("socket hang up");
        await fake.pb.delete(collection, id);
      },
    };
    const retention = createPbRetention({
      pb,
      logger: silentLogger(),
      options: {
        targets: [target({ collection: "probe_runs", field: "started_at" })],
        batchSize: 10,
        deleteConcurrency: 1,
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW);
    expect(result.collections[0]).toEqual({
      collection: "probe_runs",
      deleted: 15,
      failed: 0,
      batches: 2,
      drained: false,
      error: "socket hang up",
    });
    expect(result.deleted).toBe(15);
  });

  it("skips a row PB refuses (per-row 4xx) so it cannot block the collection", async () => {
    const fake = fakePb({
      probe_runs: seed("probe_runs", "started_at", pbDate, [
        ["old", 10, 45 * DAY],
      ]),
    });
    const logger = silentLogger();
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(collection, id) {
        // e.g. a required relation still points at the oldest row.
        if (id === "probe_runs-old-0") throw httpError(400, id);
        await fake.pb.delete(collection, id);
      },
    };
    const retention = createPbRetention({
      pb,
      logger,
      options: {
        targets: [target({ collection: "probe_runs", field: "started_at" })],
        batchSize: 5,
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const first = await retention.runPass(NOW);
    expect(first.collections[0]).toEqual({
      collection: "probe_runs",
      deleted: 9,
      failed: 1,
      batches: 2,
      // The refused row is still there, so the collection is not drained.
      drained: false,
    });
    expect(fake.collections.probe_runs!.map((r) => r.id)).toEqual([
      "probe_runs-old-0",
    ]);
    expect(logger.warn).toHaveBeenCalledWith("pb-retention.delete-refused", {
      collection: "probe_runs",
      id: "probe_runs-old-0",
      status: 400,
      err: expect.stringContaining("pb http 400"),
    });
    expect(fake.lists[1]!.opts.filter).toContain('id != "probe_runs-old-0"');
    // The next pass tries it once more and is not blocked by it.
    const second = await retention.runPass(NOW);
    expect(second.collections[0]).toEqual({
      collection: "probe_runs",
      deleted: 0,
      failed: 1,
      batches: 1,
      // The refused row is still there, so the collection is not drained.
      drained: false,
    });
  });

  it("gives up on a collection for the pass after too many refused rows", async () => {
    const fake = fakePb({
      probe_runs: seed("probe_runs", "started_at", pbDate, [
        ["old", 80, 45 * DAY],
      ]),
    });
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(_collection, id) {
        throw httpError(422, id);
      },
    };
    const retention = createPbRetention({
      pb,
      logger: silentLogger(),
      options: {
        targets: [target({ collection: "probe_runs", field: "started_at" })],
        batchSize: 20,
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW);
    expect(result.collections[0]).toMatchObject({
      deleted: 0,
      failed: 60,
      batches: 3,
      drained: false,
    });
    expect(result.collections[0]!.error).toContain("pb refused 60 deletes");
  });

  it("treats 401/403/429 as a failure of the leg, not a per-row refusal", async () => {
    for (const status of [401, 403, 429]) {
      const fake = fakePb({
        probe_runs: seed("probe_runs", "started_at", pbDate, [
          ["old", 5, 45 * DAY],
        ]),
      });
      const pb: Pick<PbClient, "list" | "delete"> = {
        list: fake.pb.list,
        async delete(_collection, id) {
          throw httpError(status, id);
        },
      };
      const retention = createPbRetention({
        pb,
        logger: silentLogger(),
        options: {
          targets: [target({ collection: "probe_runs", field: "started_at" })],
          deleteConcurrency: 1,
          batchPauseMs: 0,
        },
        now: () => NOW,
      });
      const result = await retention.runPass(NOW);
      expect(result.collections[0]).toMatchObject({ failed: 0, deleted: 0 });
      expect(result.collections[0]!.error).toContain(`pb http ${status}`);
    }
  });

  it("stops on the abort signal between deletes, awaits in-flight ones, and skips the rest", async () => {
    const fake = fakePb({
      a: seed("a", "created", pbDate, [["old", 100, 45 * DAY]]),
      b: seed("b", "created", pbDate, [["old", 100, 45 * DAY]]),
    });
    const controller = new AbortController();
    let returned = false;
    let lateDeletes = 0;
    let started = 0;
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(collection, id) {
        started += 1;
        if (started === 10) controller.abort();
        await settle();
        if (returned) lateDeletes += 1;
        await fake.pb.delete(collection, id);
      },
    };
    const logger = silentLogger();
    const retention = createPbRetention({
      pb,
      logger,
      options: {
        targets: [target({ collection: "a" }), target({ collection: "b" })],
        batchSize: 50,
        deleteConcurrency: 4,
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW, controller.signal);
    returned = true;
    await settle();
    expect(lateDeletes).toBe(0);
    expect(result.aborted).toBe(true);
    // The 4 in-flight deletes (7th..10th) finish; nobody starts an 11th.
    expect(fake.deletes).toHaveLength(10);
    expect(result.collections).toEqual([
      expect.objectContaining({ collection: "a", deleted: 10, drained: false }),
      expect.objectContaining({ collection: "b", deleted: 0, batches: 0 }),
    ]);
    expect(fake.collections.b).toHaveLength(100);
    // One list for `a`; no further list once aborted, and none for `b`.
    expect(fake.lists.map((l) => l.collection)).toEqual(["a"]);
    expect(logger.info).toHaveBeenCalledWith(
      "pb-retention.pass-complete",
      expect.objectContaining({ aborted: true }),
    );
  });

  it("does not report a drain when an abort stops a short last page mid-batch", async () => {
    // 20 expired rows, batchSize 50: the first list is already a short page.
    const fake = fakePb({
      a: seed("a", "created", pbDate, [["old", 20, 45 * DAY]]),
    });
    const controller = new AbortController();
    let started = 0;
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(collection, id) {
        started += 1;
        if (started === 5) controller.abort();
        await settle();
        await fake.pb.delete(collection, id);
      },
    };
    const retention = createPbRetention({
      pb,
      logger: silentLogger(),
      options: {
        targets: [target({ collection: "a" })],
        batchSize: 50,
        deleteConcurrency: 1,
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW, controller.signal);
    expect(result.aborted).toBe(true);
    expect(fake.collections.a).toHaveLength(15);
    expect(result.collections[0]).toEqual({
      collection: "a",
      deleted: 5,
      failed: 0,
      batches: 1,
      drained: false,
    });
  });

  it("stops between deletes at the pass deadline and does not report a drain", async () => {
    const fake = fakePb({
      a: seed("a", "created", pbDate, [["old", 20, 45 * DAY]]),
    });
    let clock = NOW;
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(collection, id) {
        // Each delete takes 10 s of pass time; the deadline is 45 s.
        clock += 10_000;
        await fake.pb.delete(collection, id);
      },
    };
    const retention = createPbRetention({
      pb,
      logger: silentLogger(),
      options: {
        targets: [target({ collection: "a" })],
        batchSize: 50,
        deleteConcurrency: 1,
        passDeadlineMs: 45_000,
        batchPauseMs: 0,
      },
      now: () => clock,
    });
    const result = await retention.runPass(NOW);
    expect(result.hitDeadline).toBe(true);
    expect(fake.collections.a).toHaveLength(15);
    expect(result.collections[0]).toMatchObject({
      deleted: 5,
      drained: false,
    });
  });

  it("skips the inter-batch pause once aborted", async () => {
    const fake = fakePb({
      a: seed("a", "created", pbDate, [["old", 20, 45 * DAY]]),
    });
    const controller = new AbortController();
    const sleep = vi.fn(async () => {});
    const pb: Pick<PbClient, "list" | "delete"> = {
      list: fake.pb.list,
      async delete(collection, id) {
        await fake.pb.delete(collection, id);
        // Abort after the last delete of the first full batch.
        if (fake.deletes.length === 5) controller.abort();
      },
    };
    const retention = createPbRetention({
      pb,
      logger: silentLogger(),
      options: {
        targets: [target({ collection: "a" })],
        batchSize: 5,
        deleteConcurrency: 1,
        batchPauseMs: 1000,
      },
      now: () => NOW,
      sleep,
    });
    const result = await retention.runPass(NOW, controller.signal);
    expect(result.aborted).toBe(true);
    expect(fake.deletes).toHaveLength(5);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("clamps batchSize to PB's 500-row page cap so it never reports a false drain", async () => {
    const fake = fakePb({
      diag_events: seed("diag_events", "created", pbDate, [
        ["old", 700, 45 * DAY],
      ]),
    });
    const retention = createPbRetention({
      pb: fake.pb,
      logger: silentLogger(),
      options: {
        targets: [target({ collection: "diag_events" })],
        batchSize: 600,
        batchPauseMs: 0,
      },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW);
    expect(result.collections[0]).toMatchObject({
      deleted: 700,
      batches: 2,
      drained: true,
    });
    expect(fake.collections.diag_events).toHaveLength(0);
  });

  it("is a no-op on an empty or fully-recent collection", async () => {
    const fake = fakePb({
      status_history: seed("status_history", "created", pbDate, [
        ["recent", 5, DAY],
      ]),
    });
    const retention = createPbRetention({
      pb: fake.pb,
      logger: silentLogger(),
      options: { targets: [target()], batchPauseMs: 0 },
      now: () => NOW,
    });
    const result = await retention.runPass(NOW);
    expect(result.deleted).toBe(0);
    expect(result.collections[0]!.drained).toBe(true);
    expect(fake.deletes).toHaveLength(0);
  });
});

describe("resolveRetentionConfig", () => {
  it("defaults to enabled with 30-day windows", () => {
    const cfg = resolveRetentionConfig({}, silentLogger());
    expect(cfg.enabled).toBe(true);
    expect(cfg.options.targets.map((t) => t.maxAgeMs / DAY)).toEqual([
      30, 30, 30, 30,
    ]);
    expect(cfg.options.maxRowsPerCollection).toBeUndefined();
  });

  it("applies per-collection overrides and the kill switch", () => {
    const cfg = resolveRetentionConfig(
      {
        PB_RETENTION_ENABLED: "FALSE",
        PB_RETENTION_STATUS_HISTORY_DAYS: "90",
        PB_RETENTION_CVDIAG_EVENTS_DAYS: "45",
        PB_RETENTION_MAX_ROWS_PER_PASS: "1000",
      },
      silentLogger(),
    );
    expect(cfg.enabled).toBe(false);
    expect(
      Object.fromEntries(
        cfg.options.targets.map((t) => [t.collection, t.maxAgeMs / DAY]),
      ),
    ).toEqual({
      cvdiag_events: 45,
      diag_events: 30,
      status_history: 90,
      probe_runs: 30,
    });
    expect(cfg.options.maxRowsPerCollection).toBe(1000);
  });

  it("ignores unparseable or too-small windows with a warn", () => {
    const logger = silentLogger();
    const cfg = resolveRetentionConfig(
      {
        PB_RETENTION_DIAG_EVENTS_DAYS: "0",
        PB_RETENTION_PROBE_RUNS_DAYS: "abc",
      },
      logger,
    );
    expect(cfg.options.targets.map((t) => t.maxAgeMs / DAY)).toEqual([
      30, 30, 30, 30,
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("ignores a days override above MAX_RETENTION_DAYS, so the cutoff stays a valid date", () => {
    const logger = silentLogger();
    const cfg = resolveRetentionConfig(
      {
        PB_RETENTION_STATUS_HISTORY_DAYS: "999999999",
        PB_RETENTION_PROBE_RUNS_DAYS: "3650",
      },
      logger,
    );
    expect(cfg.options.targets.map((t) => t.maxAgeMs / DAY)).toEqual([
      30, 30, 30, 3650,
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it.each(["false", "0", "no", "off", " OFF "])(
    "PB_RETENTION_ENABLED=%j turns retention off",
    (value) => {
      expect(
        resolveRetentionConfig({ PB_RETENTION_ENABLED: value }, silentLogger())
          .enabled,
      ).toBe(false);
    },
  );
});
