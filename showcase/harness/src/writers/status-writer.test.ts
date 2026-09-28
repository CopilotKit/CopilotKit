import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  classifyWriterError,
  createStatusWriter,
  errorInfo,
  serializeErr,
} from "./status-writer.js";
import type { WriterErrorInfo } from "./status-writer.js";
import { createEventBus } from "../events/event-bus.js";
import type { PbClient } from "../storage/pb-client.js";
import { logger } from "../logger.js";
import type { ProbeResult, StatusRecord } from "../types/index.js";

function fakePb(): {
  pb: PbClient;
  rows: Map<string, StatusRecord>;
  history: unknown[];
} {
  const rows = new Map<string, StatusRecord>();
  const history: unknown[] = [];
  // Round-9 #8d: monotonic — `r-${rows.size + 1}` re-issued an existing id
  // after any row deletion (e.g. TOCTOU tests deleting from `rows`).
  let nextRowId = 0;
  const pb: PbClient = {
    async getOne() {
      return null;
    },
    async getFirst<T>(collection: string, filter: string): Promise<T | null> {
      if (collection !== "status") return null;
      // Round-9 #8b (supersedes A5(vi)'s `([^"]*)` capture): the writer
      // builds its filter as `key = ${JSON.stringify(key)}`, so the quoted
      // segment may carry JSON escapes (\" and \\) — recover the key by
      // JSON.parsing the quoted segment (same pattern as
      // dimensions.test.ts), instead of a naive capture that either threw
      // on an embedded quote or silently matched the ESCAPED form for
      // backslashes (modelling row-not-found for a row that exists).
      // A6(iii): still FAIL LOUD on any filter shape this fake can't
      // evaluate — returning null would silently model "row not found"
      // for e.g. a compound filter, masking a writer change.
      const match = filter.match(/^key = (".*")$/s);
      if (!match) {
        throw new Error(
          `fakePb.getFirst: unrecognized filter shape (expected 'key = "<key>"'): ${filter}`,
        );
      }
      let key: string;
      try {
        key = JSON.parse(match[1]!) as string;
      } catch {
        throw new Error(
          `fakePb.getFirst: unparseable quoted key segment: ${filter}`,
        );
      }
      const r = rows.get(key);
      return (r as unknown as T) ?? null;
    },
    async list() {
      return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
    },
    async create<T>(
      collection: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      if (collection === "status") {
        const r = record as unknown as StatusRecord;
        const id = `r-${++nextRowId}`;
        rows.set(r.key, { ...r, id });
        return rows.get(r.key) as unknown as T;
      }
      history.push(record);
      return record as unknown as T;
    },
    async update<T>(
      collection: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      if (collection === "status") {
        const existing = [...rows.values()].find((r) => r.id === id);
        if (existing) {
          const merged = { ...existing, ...(record as Partial<StatusRecord>) };
          rows.set(merged.key, merged);
          return merged as unknown as T;
        }
      }
      // Round-9 #8c: real PB 404s an update against a missing row —
      // resolving with the record fabricated success and made the fake
      // immune to TOCTOU-class writer bugs.
      throw Object.assign(new Error("The requested resource wasn't found."), {
        statusCode: 404,
        data: {},
      });
    },
    async upsertByField<T>(
      collection: string,
      field: string,
      value: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const existing = await pb.getFirst<StatusRecord>(
        collection,
        `${field} = ${JSON.stringify(value)}`,
      );
      if (existing?.id) {
        return pb.update<T>(collection, existing.id, record);
      }
      return pb.create<T>(collection, { ...record, [field]: value });
    },
    async delete() {},
    async deleteByFilter() {
      return 0;
    },
    async health() {
      return true;
    },
    async createBackup() {},
    async downloadBackup() {
      return new Uint8Array();
    },
    async deleteBackup() {},
  };
  return { pb, rows, history };
}

/**
 * A1 (round 5) / round-8 #1: wrap a fakePb so date-field writes reject
 * non-PB-shaped values the way real PocketBase does. PB's date validation
 * accepts ISO-8601/RFC3339-style strings ONLY, while V8's Date.parse is far
 * more lenient ("Sun Apr 20 2026" and "04/20/2026" parse fine but PB 400s
 * them) — so a fixture that models PB validation AS Date.parse is circular
 * and structurally can't catch a writer guard that makes the same mistake.
 * The previous Date.parse-based version of this fixture was exactly that
 * (and was how the round-3 "guard below the history create" regression
 * stayed green in tests while throwing against real PB).
 *
 * Validation covers BOTH persistence routes — `create`/`update` AND
 * `upsertByField` — because fakePb's `upsertByField` closes over the
 * ORIGINAL inner `pb`, so a spread-only `create` override would be silently
 * bypassed if the writer ever routed a date-bearing record through
 * upsertByField (the same aliasing hazard annotated on the overlay F2g
 * tests below).
 */
// Round-9 #8a — ACKNOWLEDGED CIRCULARITY: this is a hand-copy of the shape
// family in status-writer.ts, so a shared mistake in both copies stays
// green (exactly how the round-3 regression survived). Two mitigations:
// (1) this fixture copy models PB ACCEPTANCE (zone optional — PB accepts
// zone-less literals as UTC) while the source copy models verbatim
// PASSTHROUGH (zone required, round-9 #2) — they are intentionally
// different predicates; (2) the "round-9 #8a divergence canary" test below
// pins a LITERAL known-PB-rejected string (colonless offset), independent
// of either regex.
const PB_DATE_SHAPE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function dateValidatingPb(env: ReturnType<typeof fakePb>): PbClient {
  const DATE_FIELDS = [
    "observed_at",
    "transitioned_at",
    "first_failure_at",
    "state_written_at",
  ] as const;
  function assertPbDates(record: Record<string, unknown>): void {
    for (const field of DATE_FIELDS) {
      const value = record[field];
      // Unset/cleared optional date fields arrive as null/""/undefined —
      // PB accepts those; only a present, non-PB-shaped string 400s.
      if (value == null || value === "") continue;
      if (typeof value !== "string" || !PB_DATE_SHAPE.test(value)) {
        const err = new Error("Failed to create record.") as Error & {
          statusCode: number;
          data: Record<string, unknown>;
        };
        err.statusCode = 400;
        err.data = {
          [field]: {
            code: "validation_invalid_date",
            message: "Invalid date.",
          },
        };
        throw err;
      }
    }
  }
  return {
    ...env.pb,
    async create<T>(
      collection: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      assertPbDates(record);
      return env.pb.create<T>(collection, record);
    },
    async update<T>(
      collection: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      assertPbDates(record);
      return env.pb.update<T>(collection, id, record);
    },
    async upsertByField<T>(
      collection: string,
      field: string,
      value: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      // Validate HERE (not via the create/update overrides above): fakePb's
      // upsertByField delegates to the inner, unvalidated pb.
      assertPbDates(record);
      return env.pb.upsertByField<T>(collection, field, value, record);
    },
  };
}

function probeResult(
  state: "green" | "red" | "degraded" | "error",
): ProbeResult<unknown> {
  return {
    key: "smoke:mastra",
    state,
    signal: { slug: "mastra" },
    observedAt: "2026-04-20T00:00:00Z",
  };
}

describe("status-writer", () => {
  let env: ReturnType<typeof fakePb>;
  beforeEach(() => {
    env = fakePb();
  });

  it("records 'first' transition on initial green observation", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write(probeResult("green"));
    expect(out.transition).toBe("first");
    expect(out.newState).toBe("green");
    expect(out.failCount).toBe(0);
    expect(out.firstFailureAt).toBeNull();
    expect(env.rows.get("smoke:mastra")?.state).toBe("green");
  });

  it("green_to_red sets first_failure_at, fail_count=1", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write(probeResult("green"));
    const r = { ...probeResult("red"), observedAt: "2026-04-20T00:05:00Z" };
    const out = await writer.write(r);
    expect(out.transition).toBe("green_to_red");
    expect(out.firstFailureAt).toBe("2026-04-20T00:05:00Z");
    expect(out.failCount).toBe(1);
  });

  it("sustained_red increments fail_count, preserves first_failure_at", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    const out = await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(out.transition).toBe("sustained_red");
    expect(out.firstFailureAt).toBe("2026-04-20T00:00:00Z");
    expect(out.failCount).toBe(2);
  });

  it("red_to_green clears first_failure_at and fail_count", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write(probeResult("red"));
    const out = await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T01:00:00Z",
    });
    expect(out.transition).toBe("red_to_green");
    expect(out.firstFailureAt).toBeNull();
    expect(out.failCount).toBe(0);
  });

  it("error transition does NOT mutate status row, appends history", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write(probeResult("red"));
    const before = { ...env.rows.get("smoke:mastra")! };
    const out = await writer.write(probeResult("error"));
    const after = env.rows.get("smoke:mastra")!;
    expect(out.transition).toBe("error");
    // HF13-B2: newState is literal "error" so downstream consumers
    // branching on `newState === "error"` fire. The prior State (red in
    // this case) is carried on errorStatePrev for dashboards that want
    // to keep rendering the last-known colour.
    expect(out.newState).toBe("error");
    expect(out.errorStatePrev).toBe("red");
    expect(after.state).toBe(before.state);
    expect(after.fail_count).toBe(before.fail_count);
    expect(
      env.history.some(
        (h) => (h as { transition: string }).transition === "error",
      ),
    ).toBe(true);
  });

  it("emits status.changed with outcome + result", async () => {
    const bus = createEventBus();
    const received: Array<{ outcome: { transition: string } }> = [];
    bus.on("status.changed", (p) => received.push(p));
    const writer = createStatusWriter({ pb: env.pb, bus, logger });
    await writer.write(probeResult("green"));
    expect(received).toHaveLength(1);
    expect(received[0]!.outcome.transition).toBe("first");
  });

  it("serializes concurrent writes to the same key", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const r1 = { ...probeResult("red"), observedAt: "2026-04-20T00:00:00Z" };
    const r2 = { ...probeResult("red"), observedAt: "2026-04-20T00:05:00Z" };
    const r3 = { ...probeResult("red"), observedAt: "2026-04-20T00:10:00Z" };
    const [o1, o2, o3] = await Promise.all([
      writer.write(r1),
      writer.write(r2),
      writer.write(r3),
    ]);
    expect([o1.failCount, o2.failCount, o3.failCount]).toEqual([1, 2, 3]);
  });

  it("error on first-ever observation does NOT seed a status row (F2.1)", async () => {
    // Regression: an earlier version seeded a synthesized status row
    // with `state: "green"` on first-ever error observation so the
    // transition detector would stop reporting "first" on every tick.
    // That seed was a lie — the next real red observation would fire a
    // `green_to_red` transition despite never having observed green.
    //
    // Fix (F2.1): skip the seed entirely. The first real, non-error
    // observation establishes the baseline. Persistent error ticks are
    // still captured in status_history and remain visible to operators.
    const bus = createEventBus();
    const statusChanged: unknown[] = [];
    bus.on("status.changed", (p) => statusChanged.push(p));
    const writer = createStatusWriter({ pb: env.pb, bus, logger });
    const out = await writer.write(probeResult("error"));
    expect(out.transition).toBe("error");
    // No status row was created — first real observation will establish baseline.
    expect(env.rows.get("smoke:mastra")).toBeUndefined();
    // status.changed is NOT emitted when nothing was persisted (F2.2).
    expect(statusChanged).toHaveLength(0);
    // History row for the error tick IS written so the audit trail stays intact.
    expect(
      env.history.some(
        (h) => (h as { transition: string }).transition === "error",
      ),
    ).toBe(true);
  });

  it("first-ever error followed by red emits 'first' (not green_to_red) — F2.1 regression", async () => {
    // Concrete demonstration of the F2.1 bug: before the fix, the
    // error-seed created a synthetic green prev, so the next red tick
    // incorrectly reported `green_to_red` and would have fired an alert
    // for a cell that was never observed green.
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write(probeResult("error"));
    const out = await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(out.transition).toBe("first");
    expect(out.previousState).toBeNull();
  });

  it("first-ever error still writes a history row; its state is a schema placeholder (F2b)", async () => {
    // F2b pin: the history row on a first-ever error CANNOT be skipped —
    // the no-data contract (result-aggregator comm-error routing)
    // relies on the error-state
    // write() path persisting the tick to status_history ONLY, making
    // this row the sole trace of the error — and its `state` CANNOT be
    // null (status_history.state is a required select in migration
    // 1776789100_recreate_collections_v2). So the row carries a "green"
    // placeholder that satisfies the schema but is NOT a baseline: the
    // status row stays absent (F2.1) and errorStatePrev is null (F2a).
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write(probeResult("error"));
    expect(env.history).toHaveLength(1);
    const h = env.history[0] as Record<string, unknown>;
    expect(h.transition).toBe("error");
    expect(h.state).toBe("green"); // schema placeholder, never observed
    // The placeholder must not leak into anything baseline-bearing:
    expect(env.rows.get("smoke:mastra")).toBeUndefined();
    expect(out.errorStatePrev).toBeNull();
  });

  it("error transition refreshes status.observed_at to show latest probe attempt", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    const row = env.rows.get("smoke:mastra")!;
    expect(row.observed_at).toBe("2026-04-20T00:10:00Z");
    // State / fail_count preserved.
    expect(row.state).toBe("red");
  });

  it("error tick does NOT rewind observed_at when the incoming timestamp is stale (A4 monotonic guard)", async () => {
    // Red-green (round-3 A4): aggregateCommError's no-data fallback feeds a
    // reclaim-time observedAt into the error-state write() path; that value
    // can be STALE (captured before a fresher tick already refreshed the
    // row). The overlay path got a monotonic guard in F2f; the error
    // branch's observed_at refresh lacked it and could rewind a live row.
    const bus = createEventBus();
    const statusChanged: unknown[] = [];
    bus.on("status.changed", (p) => statusChanged.push(p));
    const writer = createStatusWriter({ pb: env.pb, bus, logger });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    statusChanged.length = 0;
    // Stale error tick: observedAt BEFORE the row's current 00:10.
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(out.transition).toBe("error");
    // Timestamp NOT rewound.
    expect(env.rows.get("smoke:mastra")?.observed_at).toBe(
      "2026-04-20T00:10:00Z",
    );
    // Nothing was persisted, so status.changed must not fire (F2.2).
    expect(statusChanged).toHaveLength(0);
    // The history row still landed (audit trail is unconditional).
    expect(
      env.history.some(
        (h) => (h as { transition: string }).transition === "error",
      ),
    ).toBe(true);
  });

  it("error tick skips the observed_at refresh (with a warn) when the incoming timestamp is unparseable (A4)", async () => {
    // Same unparseable posture as the overlay path (A3): patching a
    // garbage string into PB's observed_at date field would 400.
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    await writer.write(probeResult("green"));
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "not-a-timestamp",
    });
    expect(out.transition).toBe("error");
    // The garbage string was NOT patched into the date field.
    expect(env.rows.get("smoke:mastra")?.observed_at).toBe(
      "2026-04-20T00:00:00Z",
    );
    const skips = warnCalls.filter(
      (c) => c.msg === "status-writer.error-unparseable-observed-at",
    );
    expect(skips).toHaveLength(1);
    expect((skips[0]!.obj as { observedAt: string }).observedAt).toBe(
      "not-a-timestamp",
    );
  });

  it("error tick with unparseable observedAt does NOT throw — history lands with a substituted timestamp (A1 round 5)", async () => {
    // Red-green (round-5 A1): the round-3 guard sat BELOW the history
    // create, but status_history.observed_at is a required PB date field —
    // the raw garbage value 400'd the history create FIRST, the whole
    // error tick threw, and the guard was dead code. The guard must be
    // hoisted above the create and a safe timestamp substituted into the
    // history row (the row's current observed_at when parseable).
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger: customLogger,
    });
    await writer.write(probeResult("green"));
    // Must RESOLVE — the old code threw out of the history create here.
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "not-a-timestamp",
    });
    expect(out.transition).toBe("error");
    expect(out.persisted).toBe(false);
    // The history row landed, with the row's current observed_at
    // substituted for the garbage value.
    const errHistory = env.history.filter(
      (h) => (h as { transition: string }).transition === "error",
    );
    expect(errHistory).toHaveLength(1);
    expect((errHistory[0] as Record<string, unknown>).observed_at).toBe(
      "2026-04-20T00:00:00Z",
    );
    // The garbage string was NOT patched into the status row.
    expect(env.rows.get("smoke:mastra")?.observed_at).toBe(
      "2026-04-20T00:00:00Z",
    );
    // The skip warn fired as designed.
    expect(
      warnCalls.filter(
        (c) => c.msg === "status-writer.error-unparseable-observed-at",
      ),
    ).toHaveLength(1);
  });

  it("first-ever error tick with unparseable observedAt lands history with a now() timestamp (A1 round 5)", async () => {
    // No existing row → no current observed_at to substitute; fall back to
    // a freshly generated timestamp so the audit row still satisfies the
    // schema.
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "not-a-timestamp",
    });
    expect(out.transition).toBe("error");
    expect(env.history).toHaveLength(1);
    const h = env.history[0] as Record<string, unknown>;
    expect(Number.isFinite(Date.parse(String(h.observed_at)))).toBe(true);
    // Still no fabricated status row (F2.1).
    expect(env.rows.size).toBe(0);
  });

  it("dedupes the unparseable-observedAt warn per key — a persistently broken probe warns once, not per tick (A6 round 5)", async () => {
    // Red-green (round-5 A6i): the unparseable-observedAt warns fired on
    // EVERY tick for a persistent condition, drowning operators. Routed
    // through the B4-style bounded-set dedup machinery: once per key while
    // resident (eviction churn re-warns).
    const warnCalls: Array<{ msg: string }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string) => warnCalls.push({ msg }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write(probeResult("green"));
    // NB: V8's lenient Date.parse accepts surprising strings (e.g.
    // "garbage-1" parses as Jan 2001) — these two are verified NaN.
    await writer.write({
      ...probeResult("error"),
      observedAt: "not-a-timestamp",
    });
    await writer.write({
      ...probeResult("error"),
      observedAt: "also-not-a-timestamp",
    });
    expect(
      warnCalls.filter(
        (c) => c.msg === "status-writer.error-unparseable-observed-at",
      ),
    ).toHaveLength(1);
  });

  it("logs a deduped warn when a first-ever-error tick skips the status row (A6 round 5 — F2.1 observability)", async () => {
    // Red-green (round-5 A6ii): the F2.1 first-ever-error skip left NO log
    // line — a key whose first observations are persistent errors was an
    // alerting blind spot (no row, no status.changed, nothing in logs).
    // Now a deduped warn makes the blind spot observable without per-tick
    // spam.
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write(probeResult("error"));
    await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    const skips = warnCalls.filter(
      (c) => c.msg === "status-writer.error-first-ever-skip",
    );
    // Fired (observable) but deduped (once per key, not per tick).
    expect(skips).toHaveLength(1);
    expect((skips[0]!.obj as Record<string, unknown>).key).toBe("smoke:mastra");
  });

  it("error tick against an existing row WITHOUT an id does not fire the first-ever-skip warn (round-8 #6)", async () => {
    // Red-green (round-8 #6): the warn gate was `!existing?.id`, so an
    // existing row missing its (optional) id — which skips the observed_at
    // refresh because there is nothing to update — ALSO fired
    // status-writer.error-first-ever-skip, whose hint claims "first-ever
    // observation of this key". That's a lie: a row exists. The warn must
    // gate on `!existing`.
    const warnCalls: Array<{ msg: string }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string) => warnCalls.push({ msg }),
      error: () => {},
      debug: () => {},
    };
    env.rows.set("smoke:mastra", {
      // no `id` — StatusRecord.id is optional.
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 1,
      first_failure_at: "2026-04-20T00:00:00Z",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    // The refresh is still skipped (no id to update) and nothing persisted…
    expect(out.persisted).toBe(false);
    expect(env.rows.get("smoke:mastra")?.observed_at).toBe(
      "2026-04-20T00:00:00Z",
    );
    // …but the "first-ever observation" warn must NOT fire — a row exists.
    expect(
      warnCalls.filter((c) => c.msg === "status-writer.error-first-ever-skip"),
    ).toHaveLength(0);
  });

  it("durable write with unparseable observedAt skips the upsert with a warn — history lands, persisted stays false (A5 round 5)", async () => {
    // Red-green (round-5 A5): the durable success upsert wrote
    // result.observedAt into observed_at/transitioned_at/state_written_at
    // unconditionally — an unparseable value 400s in PB's date fields, so
    // the whole tick threw. Same skip-and-warn posture as the error and
    // overlay paths: the history row lands (substituted timestamp), the
    // durable upsert is skipped, `persisted` stays honest (false) and
    // status.changed is not emitted (F2.2).
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const bus = createEventBus();
    const statusChanged: unknown[] = [];
    bus.on("status.changed", (p) => statusChanged.push(p));
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus,
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write(probeResult("green"));
    statusChanged.length = 0;
    // Must RESOLVE — the old code threw out of the history create (and,
    // with a guard only there, would still have thrown out of the upsert).
    const out = await writer.write({
      ...probeResult("red"),
      observedAt: "not-a-timestamp",
    });
    expect(out.persisted).toBe(false);
    // Durable row untouched — the garbage value never reached a date field.
    const row = env.rows.get("smoke:mastra")!;
    expect(row.state).toBe("green");
    expect(row.observed_at).toBe("2026-04-20T00:00:00Z");
    // The tick stays auditable: history landed with a substituted timestamp.
    const last = env.history.at(-1) as Record<string, unknown>;
    expect(last.observed_at).toBe("2026-04-20T00:00:00Z");
    // Loud skip, honest emit gate.
    expect(
      warnCalls.filter(
        (c) => c.msg === "status-writer.durable-unparseable-observed-at",
      ),
    ).toHaveLength(1);
    expect(statusChanged).toHaveLength(0);
  });

  it("durable-skip history rows record transition 'error', not the computed transition (A3 round 6)", async () => {
    // Red-green (round-6 A3): the unparseable-observedAt durable-skip path
    // wrote a history row carrying the COMPUTED transition (green_to_red
    // etc.) while the durable row never changed — a PHANTOM transition.
    // Repeated identical "transitions" accumulate per tick and auditors
    // counting status_history flips see flaps that never happened. The
    // non-persisted posture (F2e) is transition:"error".
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      writtenBy: "fleet-cp",
    });
    await writer.write(probeResult("green"));
    // Two identical broken red ticks: the durable row stays green both
    // times, so NEITHER history row may claim a green_to_red transition.
    for (let i = 0; i < 2; i++) {
      const out = await writer.write({
        ...probeResult("red"),
        observedAt: "not-a-timestamp",
      });
      expect(out.persisted).toBe(false);
      // A2 (round 7): the OUTCOME must match its own history row — the
      // durable row never transitioned, so returning the COMPUTED
      // transition (green_to_red here) described a flip that never
      // happened. transition:"error" is the non-persisted posture (F2e).
      expect(out.transition).toBe("error");
    }
    expect(env.rows.get("smoke:mastra")!.state).toBe("green");
    const skipRows = env.history.slice(1) as Array<Record<string, unknown>>;
    expect(skipRows).toHaveLength(2);
    for (const row of skipRows) {
      expect(row.transition).toBe("error");
    }
  });

  it("durable-skip outcome stamps errorStatePrev like the error-state path (round-9 #4)", async () => {
    // Red-green (round-9 #4): the durable-skip exit (unparseable
    // observedAt) emits transition:"error" with newState = the observed
    // colour but stamped NO errorStatePrev, while the error-state path
    // stamps it — so consumers branching on the HF13-B2 convention
    // ("transition error → read errorStatePrev for the last-known colour")
    // missed the durable-skip case entirely.
    env.rows.set("smoke:mastra", {
      id: "row-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 2,
      first_failure_at: "2026-04-20T00:00:00Z",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    const out = await writer.write({
      ...probeResult("green"),
      observedAt: "not-a-timestamp",
    });
    expect(out.transition).toBe("error");
    expect(out.persisted).toBe(false);
    expect(out.errorStatePrev).toBe("red");
    // First-ever durable-skip: no prior observation → null, never a
    // fabricated colour (same F2a posture as the error-state path).
    const first = await writer.write({
      ...probeResult("green"),
      key: "smoke:never-seen",
      observedAt: "not-a-timestamp",
    });
    expect(first.transition).toBe("error");
    expect(first.errorStatePrev).toBeNull();
  });

  it("durable write with a parseable-but-non-ISO observedAt is normalized to ISO before the upsert, not 400'd (round-8 #1)", async () => {
    // Red-green (round-8 #1): the durable guard defined PB-safe as
    // `Number.isFinite(Date.parse(v))`, but V8's Date.parse accepts shapes
    // PB's date validation rejects (RFC-1123 "Sun, 20 Apr 2026 …", US
    // "04/20/2026"). Those passed the guard and 400'd the real upsert —
    // recreating exactly the failure class the guard exists to prevent.
    // Such values must be normalized to ISO before reaching a PB date field.
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.write(probeResult("green"));
    // Parseable by V8 (deterministically, via the explicit GMT zone) but
    // NOT a PB-accepted date shape.
    const out = await writer.write({
      ...probeResult("red"),
      observedAt: "Sun, 20 Apr 2026 00:05:00 GMT",
    });
    expect(out.persisted).toBe(true);
    expect(out.transition).toBe("green_to_red");
    const row = env.rows.get("smoke:mastra")!;
    expect(row.state).toBe("red");
    expect(row.observed_at).toBe("2026-04-20T00:05:00.000Z");
    expect(row.state_written_at).toBe("2026-04-20T00:05:00.000Z");
    expect(row.first_failure_at).toBe("2026-04-20T00:05:00.000Z");
    expect(out.firstFailureAt).toBe("2026-04-20T00:05:00.000Z");
    const last = env.history.at(-1) as Record<string, unknown>;
    expect(last.observed_at).toBe("2026-04-20T00:05:00.000Z");
  });

  it("error tick with a parseable-but-non-ISO observedAt refreshes observed_at with the normalized ISO form (round-8 #1)", async () => {
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.write(probeResult("green"));
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "Sun, 20 Apr 2026 00:10:00 GMT",
    });
    // The refresh PERSISTED (would have 400'd un-normalized)…
    expect(out.persisted).toBe(true);
    expect(env.rows.get("smoke:mastra")?.observed_at).toBe(
      "2026-04-20T00:10:00.000Z",
    );
    // …and the history row carries the same normalized timestamp.
    const last = env.history.at(-1) as Record<string, unknown>;
    expect(last.observed_at).toBe("2026-04-20T00:10:00.000Z");
  });

  it("a colonless-offset observedAt (+0230) is normalized before the upsert, not passed through verbatim (round-9 #1)", async () => {
    // Red-green (round-9 #1): PB_DATE_SHAPE's offset arm made the colon
    // OPTIONAL (`[+-]\d{2}:?\d{2}`), so "…+0230" — V8-parseable but rejected
    // by PB's date validation (which requires the RFC-3339 colon form) —
    // passed the shape test and went through VERBATIM, 400'ing the real
    // upsert: the exact round-8 #1 failure class the shape exists to
    // prevent. Colonless offsets must fall into the toISOString branch.
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    const out = await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T02:30:00+0230",
    });
    expect(out.persisted).toBe(true);
    const row = env.rows.get("smoke:mastra")!;
    expect(row.observed_at).toBe("2026-04-20T00:00:00.000Z");
    expect(row.state_written_at).toBe("2026-04-20T00:00:00.000Z");
    const last = env.history.at(-1) as Record<string, unknown>;
    expect(last.observed_at).toBe("2026-04-20T00:00:00.000Z");
  });

  it("zone-less observedAt shapes are normalized to the instant Date.parse resolves — never persisted verbatim (round-9 #2)", async () => {
    // Red-green (round-9 #2): zone-less date-times ("2026-04-20 12:00:00",
    // "2026-04-20T12:00:00") matched PB_DATE_SHAPE and passed through
    // VERBATIM — but V8's Date.parse reads a zone-less date-time as HOST
    // LOCAL time while PB stores and compares the literal as UTC. Every
    // Date.parse-based comparison in the writer (error-path stale guard,
    // overlay monotonic guard, cross-writer flip window) therefore used an
    // instant skewed from the persisted one by the host's UTC offset, and
    // the persisted instant differed from the one compared. Only Z/offset-
    // bearing shapes may pass through verbatim; zone-less shapes normalize
    // via toISOString so the persisted instant IS the compared instant.
    //
    // Host-TZ-shaped on purpose: `expected` is computed exactly the way the
    // writer must (local interpretation of the zone-less literal). On a
    // non-UTC host the verbatim string denotes an instant offset from
    // `expected`; on ANY host (UTC included) the Z-form equality fails
    // verbatim passthrough.
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    const cases: Array<[key: string, zoneless: string]> = [
      ["smoke:space-form", "2026-04-20 12:00:00"],
      ["smoke:t-form", "2026-04-20T12:00:00"],
    ];
    for (const [key, zoneless] of cases) {
      const out = await writer.write({
        ...probeResult("green"),
        key,
        observedAt: zoneless,
      });
      expect(out.persisted).toBe(true);
      const expected = new Date(Date.parse(zoneless)).toISOString();
      const row = env.rows.get(key)!;
      expect(row.observed_at).toBe(expected);
      expect(row.state_written_at).toBe(expected);
      const last = env.history.at(-1) as Record<string, unknown>;
      expect(last.observed_at).toBe(expected);
    }
  });

  it("error tick refreshes observed_at when the row's current value is unparseable but the incoming one is valid (A4)", async () => {
    // Repair direction: a corrupt CURRENT row value must not pin the row.
    env.rows.set("smoke:mastra", {
      id: "corrupt-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "not-a-timestamp",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 1,
      first_failure_at: "2026-04-20T00:00:00Z",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(env.rows.get("smoke:mastra")?.observed_at).toBe(
      "2026-04-20T00:05:00Z",
    );
  });

  it("sustained_red leaves first_failure_at null on legacy row — does NOT fabricate observedAt", async () => {
    // Regression: previously we adopted `result.observedAt` as the
    // first_failure_at on legacy rows that were already red but missing
    // the column. That understated the real duration — the failure
    // actually started on some earlier tick. Now we leave null and
    // log so operators can spot the orphaned legacy row.
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 5,
      first_failure_at: null,
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(out.transition).toBe("sustained_red");
    expect(out.firstFailureAt).toBeNull();
  });

  it("warns (once per key) on legacy-null-first_failure_at path (F2.7)", async () => {
    // F2.7: the sustained_red branch logs a warn when a legacy row is
    // missing first_failure_at — operators need to see orphaned rows so
    // they can be cleaned up. Previously there was no test coverage for
    // this warn, so a refactor could silently drop it. Assert that the
    // warn fires on the first legacy tick and is de-duped on subsequent
    // ones (long-lived legacy rows would otherwise flood the log).
    const warnCalls: Array<{ msg: string; obj: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 5,
      first_failure_at: null,
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    const legacyWarns = warnCalls.filter(
      (w) => w.msg === "status-writer.legacy-missing-first-failure",
    );
    expect(legacyWarns).toHaveLength(1);
    expect((legacyWarns[0]!.obj as { key: string }).key).toBe("smoke:mastra");
    expect((legacyWarns[0]!.obj as { observedAt: string }).observedAt).toBe(
      "2026-04-20T00:05:00Z",
    );
  });

  it("a REJECTED green recovery does not clear the legacy warn gate (round-9 #5)", async () => {
    // Red-green (round-9 #5): legacyWarnGate.clear fired on the recovery
    // tick BEFORE the durable upsert — so a recovery write that PB
    // rejected still re-armed the warn, and the next sustained_red tick
    // re-warned within the TTL (extra re-warn noise, inverting this
    // file's warn-after-persist discipline: a rejected write is not a
    // recovery). The clear must follow confirmed persistence.
    const warnCalls: string[] = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string) => warnCalls.push(msg),
      error: () => {},
      debug: () => {},
    };
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 5,
      first_failure_at: null,
    });
    // Reject ONLY the green recovery's durable upsert; reds persist.
    const pb: PbClient = {
      ...env.pb,
      async upsertByField(collection, field, value, record) {
        if ((record as { state?: string }).state === "green") {
          throw Object.assign(new Error("boom"), { statusCode: 500 });
        }
        return env.pb.upsertByField(collection, field, value, record);
      },
    };
    const writer = createStatusWriter({
      pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    // Legacy sustained_red tick → warn #1.
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    // Green recovery whose upsert is REJECTED — not a recovery.
    await expect(
      writer.write({
        ...probeResult("green"),
        observedAt: "2026-04-20T00:10:00Z",
      }),
    ).rejects.toThrow("boom");
    // Row is still legacy-red; the next sustained_red tick is within the
    // TTL, so it must NOT re-warn.
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:15:00Z",
    });
    expect(
      warnCalls.filter(
        (m) => m === "status-writer.legacy-missing-first-failure",
      ),
    ).toHaveLength(1);
  });

  it("treats a corrupt durable state read-back as no prior observation, with a warn (A4)", async () => {
    // Red-green (round-4 A4): doWrite fed the RAW `existing.state` into
    // detectTransition. A corrupt/legacy PB value (anything outside
    // green|red|degraded) flowed through as a bogus baseline instead of
    // degrading. asKnownState-style validation: unknown state → undefined
    // prior (transition "first") + a warn so the corrupt row is visible.
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    env.rows.set("smoke:mastra", {
      id: "corrupt-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "blue" as unknown as StatusRecord["state"], // corrupt PB value
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 2,
      first_failure_at: null,
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    const out = await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    // Corrupt prior degrades to "no prior observation" — never a bogus
    // red_to_green / sustained_* off a garbage baseline.
    expect(out.transition).toBe("first");
    expect(out.previousState).toBeNull();
    expect(
      warnCalls.filter((w) => w.msg === "status-writer.corrupt-state-read"),
    ).toHaveLength(1);
    expect(
      (
        warnCalls.find((w) => w.msg === "status-writer.corrupt-state-read")!
          .obj as Record<string, unknown>
      ).state,
    ).toBe("blue");
  });

  it("fires the legacy warn and returns null when first_failure_at is an empty string (A1 — PB unset-date serialization)", async () => {
    // Red-green (round-4 A1): PocketBase serializes an UNSET date field as
    // "" (never null) — the exact bug already fixed for state_written_at.
    // The B8 legacy-row detection guarded on `firstFailureAt === null`, so
    // a real post-migration legacy row (first_failure_at: "") NEVER fired
    // the warn in production, and the outcome surfaced "" in violation of
    // WriteOutcome.firstFailureAt's documented null sentinel.
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 5,
      first_failure_at: "" as unknown as string | null, // PB's unset-date shape
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    const out = await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(out.transition).toBe("sustained_red");
    // "" normalizes to the documented null sentinel — never surfaces raw.
    expect(out.firstFailureAt).toBeNull();
    expect(
      warnCalls.filter(
        (w) => w.msg === "status-writer.legacy-missing-first-failure",
      ),
    ).toHaveLength(1);
  });

  it("sustained tick does not propagate a legacy transitioned_at:'' forward (A2 round 5 — PB unset-date serialization)", async () => {
    // Red-green (round-5 A2): third instance of the `""` PB-date class —
    // `existing?.transitioned_at ?? result.observedAt` kept "" on sustained
    // ticks for a legacy row whose transitioned_at was never set (PB
    // serializes an unset date as "", never null), propagating the empty
    // string forward indefinitely. Truthiness (`||`) falls back to the
    // tick's observedAt instead.
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "", // PB's unset-date shape
      fail_count: 1,
      first_failure_at: "2026-04-20T00:00:00Z",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(out.transition).toBe("sustained_red");
    // "" must not survive the write — the row repairs to a real timestamp.
    expect(env.rows.get("smoke:mastra")?.transitioned_at).toBe(
      "2026-04-20T00:05:00Z",
    );
  });

  it("error-path outcome carries null (not '') when the row's first_failure_at is an empty string (A1)", async () => {
    // Red-green (round-4 A1, error branch read site): the error path's
    // outcome read `existing?.first_failure_at ?? null`, so PB's ""
    // leaked into WriteOutcome.firstFailureAt, violating its null
    // sentinel contract for consumers (e.g. alert duration rendering).
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 5,
      first_failure_at: "" as unknown as string | null, // PB's unset-date shape
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(out.transition).toBe("error");
    expect(out.firstFailureAt).toBeNull();
  });

  it("writes the durable status upsert BEFORE history (A1 round 7: upsert-first ordering)", async () => {
    // Red-green (round-7 A1): under the old history-first ordering, a
    // persistent upsert failure re-landed one history row per caller retry
    // (the reject-and-retry contract) — each retry created a history row
    // claiming a transition the durable row never made (a phantom flip),
    // unbounded. Same class A4 (round 6) fixed for the overlay path.
    const writeOrder: string[] = [];
    const pb: PbClient = {
      async getOne() {
        return null;
      },
      async getFirst() {
        return null;
      },
      async list() {
        return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
      },
      async create<T>(collection: string, record: unknown): Promise<T> {
        writeOrder.push(`create:${collection}`);
        return record as T;
      },
      async update<T>(collection: string, _id: string, r: unknown): Promise<T> {
        writeOrder.push(`update:${collection}`);
        return r as T;
      },
      async upsertByField<T>(
        collection: string,
        _f: string,
        _v: string,
        record: unknown,
      ): Promise<T> {
        writeOrder.push(`upsert:${collection}`);
        return record as T;
      },
      async delete() {},
      async deleteByFilter() {
        return 0;
      },
      async health() {
        return true;
      },
      async createBackup() {},
      async downloadBackup() {
        return new Uint8Array();
      },
      async deleteBackup() {},
    };
    const writer = createStatusWriter({
      pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write(probeResult("green"));
    // The status upsert must come before status_history.
    const historyIdx = writeOrder.indexOf("create:status_history");
    const statusIdx = writeOrder.indexOf("upsert:status");
    expect(historyIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeLessThan(historyIdx);
  });

  it("emits writer.failed when status upsert throws — and persists NO history row (A1 round 7)", async () => {
    // Red-green (round-7 A1): with upsert-first ordering, a failed upsert
    // persists NOTHING — so a caller retry of a persistently failing upsert
    // cannot accumulate duplicate phantom-transition history rows.
    const created: string[] = [];
    const pb: PbClient = {
      async getOne() {
        return null;
      },
      async getFirst() {
        return null;
      },
      async list() {
        return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
      },
      async create<T>(c: string, r: unknown): Promise<T> {
        created.push(c);
        return r as T;
      },
      async update() {
        throw new Error("pb update boom");
      },
      async upsertByField(): Promise<never> {
        throw new Error("pb upsert boom");
      },
      async delete() {},
      async deleteByFilter() {
        return 0;
      },
      async health() {
        return true;
      },
      async createBackup() {},
      async downloadBackup() {
        return new Uint8Array();
      },
      async deleteBackup() {},
    };
    const bus = createEventBus();
    const failed: Array<{ phase: string; key: string }> = [];
    bus.on("writer.failed", (e) => {
      failed.push({ phase: e.phase, key: e.key });
    });
    const writer = createStatusWriter({ pb, bus, logger });
    await expect(writer.write(probeResult("green"))).rejects.toThrow(
      /upsert boom/,
    );
    expect(failed).toEqual([{ phase: "status_upsert", key: "smoke:mastra" }]);
    // Upsert-first ordering: NO audit row landed for the failed write — a
    // retry starts from a clean slate instead of stacking phantom flips.
    expect(created).not.toContain("status_history");
  });

  it("error tick returns outcome.newState === 'error' (HF13-B2)", async () => {
    // Red-green (HF13-B2): the error branch used to return
    // `newState: carriedState` (the prior State), which caused
    // downstream consumers branching on `outcome.newState === "error"`
    // to silently miss live-write errors — only dispatchCronAlert's
    // synthesized outcomes ever reached them. Fix: error branch returns
    // literal `"error"`, with the prior State carried on errorStatePrev
    // so dashboards can still render the last-known colour.
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    // Seed a red baseline so we can verify the prior State carries over
    // in errorStatePrev (and NOT as newState).
    await writer.write(probeResult("red"));
    const out = await writer.write(probeResult("error"));
    expect(out.newState).toBe("error");
    expect(out.errorStatePrev).toBe("red");
    expect(out.transition).toBe("error");
  });

  it("first-ever error tick has errorStatePrev null — never a fabricated green (F2a)", async () => {
    // Red-green (F2a): the WriteOutcome contract (types/index.ts) says
    // errorStatePrev is "null when there was no prior observation
    // (first-ever tick is an error)", and the CLI bestEffortWriter
    // honors that. The writer used to set `errorStatePrev: carriedState`
    // (prevState ?? "green"), fabricating a green that was never
    // observed. errorStatePrev must be null when previousState is null.
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write(probeResult("error"));
    expect(out.newState).toBe("error");
    expect(out.previousState).toBeNull();
    expect(out.errorStatePrev).toBeNull();
  });

  it("error-path observed_at update failure does NOT emit status.changed (F2.2)", async () => {
    // Regression (F2.2): previously, when the existing status row's
    // observed_at refresh failed on an error tick, we still emitted
    // `status.changed` — the alert engine treated the transition as
    // persisted despite the DB write failing, causing bus/DB divergence.
    //
    // Fix: only emit status.changed when the DB write actually
    // persisted. writer.failed still fires so ops see the failure; the
    // error is swallowed (not re-thrown) because observed_at is a
    // non-critical field.
    const pb: PbClient = {
      async getOne() {
        return null;
      },
      async getFirst<T>(): Promise<T | null> {
        // Existing row so we hit the update path (not the first-ever-error skip).
        return {
          id: "row-1",
          key: "smoke:mastra",
          dimension: "smoke",
          state: "red",
          signal: {},
          observed_at: "2026-04-20T00:00:00Z",
          transitioned_at: "2026-04-20T00:00:00Z",
          fail_count: 3,
          first_failure_at: "2026-04-20T00:00:00Z",
        } as unknown as T;
      },
      async list() {
        return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
      },
      async create<T>(_c: string, r: unknown): Promise<T> {
        return r as T; // history_create succeeds
      },
      async update(): Promise<never> {
        // observed_at refresh fails.
        throw new Error("update boom");
      },
      async upsertByField<T>(
        _c: string,
        _f: string,
        _v: string,
        r: unknown,
      ): Promise<T> {
        return r as T;
      },
      async delete() {},
      async deleteByFilter() {
        return 0;
      },
      async health() {
        return true;
      },
      async createBackup() {},
      async downloadBackup() {
        return new Uint8Array();
      },
      async deleteBackup() {},
    };
    const bus = createEventBus();
    const statusChangedEvents: unknown[] = [];
    const writerFailedPhases: string[] = [];
    bus.on("status.changed", (p) => statusChangedEvents.push(p));
    bus.on("writer.failed", (p) => writerFailedPhases.push(p.phase));
    const writer = createStatusWriter({ pb, bus, logger });
    // Error path swallows the update error (best-effort field refresh).
    const out = await writer.write(probeResult("error"));
    expect(out.transition).toBe("error");
    // F2.2: NO status.changed emit when persistence failed.
    expect(statusChangedEvents).toHaveLength(0);
    // writer.failed still fires so operators see the persistence failure.
    expect(writerFailedPhases).toEqual(["status_upsert"]);
    // A2 (round 4): the swallowed pb.update failure is a NON-persisted exit
    // — the outcome must say so truthfully instead of omitting the field
    // (the old `persisted?: false` doc claimed "absence = persisted",
    // which this very path violated).
    expect(out.persisted).toBe(false);
  });

  it("stamps persisted:true on a durable upsert success (A2)", async () => {
    // Red-green (round-4 A2): `persisted` is now REQUIRED on WriteOutcome
    // and the real writer stamps it truthfully everywhere — true when the
    // durable status-row upsert landed.
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write(probeResult("green"));
    expect(out.persisted).toBe(true);
  });

  it("stamps persisted:true when the error-path observed_at refresh lands (A2)", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write(probeResult("red"));
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(out.transition).toBe("error");
    expect(out.persisted).toBe(true);
  });

  it("stamps persisted:false on the first-ever-error exit (no row touched) (A2)", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    const out = await writer.write(probeResult("error"));
    expect(out.transition).toBe("error");
    expect(out.persisted).toBe(false);
  });

  it("stamps persisted:false on the stale/unparseable error-tick skip (A2)", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    // Stale error tick: observedAt BEFORE the row's current 00:10 — the
    // monotonic guard skips the refresh, so nothing was persisted.
    const out = await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(out.transition).toBe("error");
    expect(out.persisted).toBe(false);
  });

  it("error-path observed_at update success DOES emit status.changed (F2.2 happy path)", async () => {
    // Complement to the F2.2 fail test: when the update succeeds, the
    // emit must still fire. We test this explicitly because our fix
    // introduced a branch that could easily be wrong in the other
    // direction (silently dropping emits in the common case).
    const bus = createEventBus();
    const statusChanged: unknown[] = [];
    bus.on("status.changed", (p) => statusChanged.push(p));
    const writer = createStatusWriter({ pb: env.pb, bus, logger });
    // Seed an existing row by writing green first.
    await writer.write(probeResult("green"));
    statusChanged.length = 0;
    // Now an error tick should update observed_at and still emit.
    await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(statusChanged).toHaveLength(1);
    expect(env.rows.get("smoke:mastra")?.observed_at).toBe(
      "2026-04-20T00:10:00Z",
    );
  });

  it("warns (once per key) when key lacks ':' separator and derives dimension=unknown", async () => {
    const warnCalls: Array<{ msg: string; obj: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj: obj! }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    const malformed: ProbeResult<unknown> = {
      key: "noColonHere",
      state: "green",
      signal: {},
      observedAt: "2026-04-20T00:00:00Z",
    };
    await writer.write(malformed);
    await writer.write(malformed); // second call should NOT re-warn
    const malformedWarns = warnCalls.filter(
      (w) => w.msg === "status-writer.malformed-key",
    );
    expect(malformedWarns).toHaveLength(1);
    expect((malformedWarns[0]!.obj as { key: string }).key).toBe("noColonHere");
  });

  it("warnedMalformedKeys is bounded — drop-oldest on overflow (B4)", async () => {
    // Regression (B4): `warnedMalformedKeys` was an unbounded Set. A
    // probe emitting a stream of distinct malformed keys (>10k) would
    // grow it without limit → slow OOM over process lifetime. The fix
    // caps at MAX_WARNED_KEYS (1024) and drops the oldest entry on
    // overflow. We can't observe the internal Set directly, but we CAN
    // observe that the first-inserted key re-warns after being evicted
    // (the dedupe forgot about it).
    const warnCalls: string[] = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => {
        if (msg === "status-writer.malformed-key") {
          warnCalls.push((obj as { key: string }).key);
        }
      },
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    // First write — "firstKey" should warn once.
    await writer.write({
      key: "firstKey",
      state: "green",
      signal: {},
      observedAt: "2026-04-20T00:00:00Z",
    });
    expect(warnCalls).toContain("firstKey");
    warnCalls.length = 0;
    // Now flood with 1024 distinct malformed keys → fills the cap and
    // evicts firstKey (FIFO drop-oldest).
    for (let i = 0; i < 1024; i += 1) {
      await writer.write({
        key: `floodKey${i}`,
        state: "green",
        signal: {},
        observedAt: "2026-04-20T00:00:00Z",
      });
    }
    // Each new flood key warned exactly once.
    expect(warnCalls.length).toBe(1024);
    warnCalls.length = 0;
    // Re-observe "firstKey" — it was evicted, so it re-warns.
    await writer.write({
      key: "firstKey",
      state: "green",
      signal: {},
      observedAt: "2026-04-20T00:00:00Z",
    });
    expect(warnCalls).toContain("firstKey");
  });

  it("writer.failed carries structured PB validation error (B7)", async () => {
    // Regression (B7): PB rejects invalid payloads with
    // `{ message, status, data: { field: { code, message } } }`. The old
    // code did `String(err)` which collapsed the object to
    // "[object Object]" — the reason for the failure was erased before
    // it reached the bus. Now errorInfo() extracts message/status/data
    // and the emitted err payload preserves the validation shape.
    class PbError extends Error {
      status = 400;
      data = {
        key: { code: "validation_required", message: "Missing required value" },
      };
    }
    const pb: PbClient = {
      async getOne() {
        return null;
      },
      async getFirst() {
        return null;
      },
      async list() {
        return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
      },
      async create<T>(_c: string, r: unknown): Promise<T> {
        return r as T;
      },
      async update<T>(_c: string, _i: string, r: unknown): Promise<T> {
        return r as T;
      },
      async upsertByField(): Promise<never> {
        throw new PbError("Failed to create record.");
      },
      async delete() {},
      async deleteByFilter() {
        return 0;
      },
      async health() {
        return true;
      },
      async createBackup() {},
      async downloadBackup() {
        return new Uint8Array();
      },
      async deleteBackup() {},
    };
    const bus = createEventBus();
    const failed: Array<{
      err: string;
      reason?: string;
      status?: number;
    }> = [];
    bus.on("writer.failed", (e) =>
      failed.push({ err: e.err, reason: e.reason, status: e.status }),
    );
    const writer = createStatusWriter({ pb, bus, logger });
    await expect(writer.write(probeResult("green"))).rejects.toThrow();
    expect(failed).toHaveLength(1);
    // err is a JSON payload — parse and confirm it carries the PB shape.
    const parsed = JSON.parse(failed[0]!.err) as {
      message: string;
      status: number;
      data: { key: { code: string; message: string } };
    };
    expect(parsed.message).toBe("Failed to create record.");
    expect(parsed.status).toBe(400);
    expect(parsed.data.key.code).toBe("validation_required");
    expect(failed[0]!.status).toBe(400);
    expect(failed[0]!.reason).toBe("pb_schema_error");
  });

  it("writer.failed carries reason classification (B6)", async () => {
    // Regression (B6): auth/schema/permission failures all collapsed
    // into a single "warn + continue" with no classification — alert
    // routing couldn't distinguish transient (auth blip) from
    // structural (schema drift). The fix attaches a WriterFailureReason
    // to every emit. Verify the 401 branch → "pb_auth_error".
    class AuthError extends Error {
      status = 401;
    }
    const pb: PbClient = {
      async getOne() {
        return null;
      },
      async getFirst<T>(): Promise<T | null> {
        // Existing row — error path hits the observed_at update branch.
        return {
          id: "row-1",
          key: "smoke:mastra",
          dimension: "smoke",
          state: "red",
          signal: {},
          observed_at: "2026-04-20T00:00:00Z",
          transitioned_at: "2026-04-20T00:00:00Z",
          fail_count: 1,
          first_failure_at: "2026-04-20T00:00:00Z",
        } as unknown as T;
      },
      async list() {
        return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
      },
      async create<T>(_c: string, r: unknown): Promise<T> {
        return r as T;
      },
      async update(): Promise<never> {
        throw new AuthError("invalid token");
      },
      async upsertByField<T>(
        _c: string,
        _f: string,
        _v: string,
        r: unknown,
      ): Promise<T> {
        return r as T;
      },
      async delete() {},
      async deleteByFilter() {
        return 0;
      },
      async health() {
        return true;
      },
      async createBackup() {},
      async downloadBackup() {
        return new Uint8Array();
      },
      async deleteBackup() {},
    };
    const bus = createEventBus();
    const failed: Array<{ reason?: string; status?: number }> = [];
    bus.on("writer.failed", (e) =>
      failed.push({ reason: e.reason, status: e.status }),
    );
    const writer = createStatusWriter({ pb, bus, logger });
    // Error path swallows the update error — no throw to the caller.
    await writer.write(probeResult("error"));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.status).toBe(401);
    expect(failed[0]!.reason).toBe("pb_auth_error");
  });

  it("legacy-missing-first_failure_at warn re-fires after TTL (B8)", async () => {
    // Regression (B8): the warn dedupe was a process-lifetime Set —
    // a red→green→red cycle on a legacy row would warn on the first
    // red, go silent forever. Ops would never see a recurrence. Fix:
    // TTL-evict the warn entry and clear-on-green so the second red
    // re-warns. Verified here via a red tick that clears the warn via
    // a subsequent green, then a second red tick re-fires.
    const warnCalls: Array<{ key: string }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => {
        if (msg === "status-writer.legacy-missing-first-failure") {
          warnCalls.push(obj as { key: string });
        }
      },
      error: () => {},
      debug: () => {},
    };
    // Seed a legacy row (red, no first_failure_at).
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 5,
      first_failure_at: null,
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    // First red tick against the legacy row — warns once.
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(warnCalls).toHaveLength(1);
    warnCalls.length = 0;
    // Green tick (recovery) — should clear the legacy-warn entry and
    // also clear `first_failure_at`.
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:06:00Z",
    });
    // Set the row back to a legacy (null first_failure_at) state to
    // simulate a second red after the green — the green path above
    // cleared the warn entry, so the next red must re-warn.
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:07:00Z",
      transitioned_at: "2026-04-20T00:07:00Z",
      fail_count: 1,
      first_failure_at: null,
    });
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:08:00Z",
    });
    // Re-warned after the green cleared the entry.
    expect(warnCalls).toHaveLength(1);
  });

  it("legacy warn dedupe is TTL-bounded — re-fires after 1h (B8)", async () => {
    // Complement to the clear-on-green test: when green never arrives
    // (persistent legacy row), the TTL ensures we still re-warn every
    // hour rather than warning exactly once per process lifetime.
    const warnCalls: number[] = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string) => {
        if (msg === "status-writer.legacy-missing-first-failure") {
          warnCalls.push(Date.now());
        }
      },
      error: () => {},
      debug: () => {},
    };
    env.rows.set("smoke:mastra", {
      id: "legacy-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 5,
      first_failure_at: null,
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    let simulatedNow = 1_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);
    try {
      await writer.write({
        ...probeResult("red"),
        observedAt: "2026-04-20T00:00:00Z",
      });
      expect(warnCalls).toHaveLength(1);
      // Advance < 1h → still dedupes.
      simulatedNow += 30 * 60 * 1000;
      await writer.write({
        ...probeResult("red"),
        observedAt: "2026-04-20T00:30:00Z",
      });
      expect(warnCalls).toHaveLength(1);
      // Advance past 1h → re-warns.
      simulatedNow += 35 * 60 * 1000;
      await writer.write({
        ...probeResult("red"),
        observedAt: "2026-04-20T01:05:00Z",
      });
      expect(warnCalls).toHaveLength(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("legacy warn cap eviction does not evict a freshly re-warned key (A5 delete-then-set)", async () => {
    // Red-green (round-3 A5): Map.set on an EXISTING key keeps its original
    // insertion position. A TTL-expired re-warn therefore left the key at
    // its old (oldest) position, so the drop-oldest cap eviction could
    // evict the MOST-RECENTLY-re-warned key — and the next write inside
    // the TTL would spuriously re-warn (the dedupe forgot it). The fix
    // deletes before setting so a re-warned key moves to the back of the
    // eviction order.
    const warnedKeys: string[] = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => {
        if (msg === "status-writer.legacy-missing-first-failure") {
          warnedKeys.push((obj as { key: string }).key);
        }
      },
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    function seedLegacyRow(key: string): void {
      env.rows.set(key, {
        id: `legacy-${key}`,
        key,
        dimension: "smoke",
        state: "red",
        signal: {},
        observed_at: "2026-04-20T00:00:00Z",
        transitioned_at: "2026-04-20T00:00:00Z",
        fail_count: 1,
        first_failure_at: null,
      });
    }
    async function redTick(key: string): Promise<void> {
      await writer.write({
        key,
        state: "red",
        signal: {},
        observedAt: "2026-04-20T00:05:00Z",
      });
    }
    let simulatedNow = 1_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);
    try {
      // t0: warn "smoke:victim" first (oldest insertion position), then
      // fill to ONE BELOW the 1024 cap with distinct legacy keys.
      seedLegacyRow("smoke:victim");
      await redTick("smoke:victim");
      expect(warnedKeys).toEqual(["smoke:victim"]);
      for (let i = 0; i < 1022; i += 1) {
        seedLegacyRow(`smoke:fill${i}`);
        await redTick(`smoke:fill${i}`);
      }
      warnedKeys.length = 0;
      // t1 (past the 1h TTL): re-warn the victim — it must move to the
      // BACK of the eviction order.
      simulatedNow += 61 * 60 * 1000;
      await redTick("smoke:victim");
      expect(warnedKeys).toEqual(["smoke:victim"]);
      warnedKeys.length = 0;
      // Two new keys push the map through the cap → one eviction. The
      // eviction must take the stalest fill key, NOT the just-re-warned
      // victim.
      seedLegacyRow("smoke:overflow0");
      await redTick("smoke:overflow0");
      seedLegacyRow("smoke:overflow1");
      await redTick("smoke:overflow1");
      warnedKeys.length = 0;
      // Still inside the victim's fresh TTL: a red tick must stay deduped.
      // (Pre-fix the victim was evicted, so this spuriously re-warned.)
      await redTick("smoke:victim");
      expect(warnedKeys).toEqual([]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("errorInfo extracts PB validation payload + HTTP status (B7)", () => {
    class PbError extends Error {
      status = 400;
      data = { key: { code: "validation_required" } };
    }
    const info = errorInfo(new PbError("boom"));
    expect(info.message).toBe("boom");
    expect(info.status).toBe(400);
    expect(info.data).toEqual({ key: { code: "validation_required" } });
  });

  it("errorInfo handles string errors", () => {
    const info = errorInfo("plain string");
    expect(info.message).toBe("plain string");
    expect(info.status).toBeUndefined();
    expect(info.data).toBeUndefined();
  });

  it("classifyWriterError does not over-match 'econn'/'abort' substrings (A5)", () => {
    // Red-green (round-4 A5i): bare `includes("econn")` / `includes("abort")`
    // matched unrelated words — "preconnect" contains "econn" and
    // "abortive" contains "abort" — misrouting them to network_error.
    expect(classifyWriterError({ message: "preconnect hint rejected" })).toBe(
      "unknown",
    );
    expect(
      classifyWriterError({ message: "abortive negotiation detected" }),
    ).toBe("unknown");
    // The genuine tokens still classify as network errors.
    expect(classifyWriterError({ message: "read ECONNRESET" })).toBe(
      "network_error",
    );
    expect(classifyWriterError({ message: "connect ECONNREFUSED" })).toBe(
      "network_error",
    );
    expect(
      classifyWriterError({ message: "AbortError: operation was aborted" }),
    ).toBe("network_error");
  });

  it("classifyWriterError abort routing matches abort ERROR shapes, not the bare word (A6(i) round 7)", () => {
    // Red-green (round-7 A6i): the `\babort(ed|error)?\b` word-boundary
    // check still matched the bare word "aborted" in unrelated prose (e.g.
    // a probe's own "deploy aborted by operator" message), misrouting
    // domain messages into network_error. Only the actual error shapes —
    // the AbortError name and the node/undici abort phrasings — classify.
    expect(classifyWriterError({ message: "AbortError: boom" })).toBe(
      "network_error",
    );
    expect(classifyWriterError({ message: "This operation was aborted" })).toBe(
      "network_error",
    );
    // undici's RequestAbortedError message.
    expect(classifyWriterError({ message: "Request aborted" })).toBe(
      "network_error",
    );
    // Bare-word "abort(ed)" in domain prose must NOT classify as network.
    expect(classifyWriterError({ message: "deploy aborted by operator" })).toBe(
      "unknown",
    );
    expect(classifyWriterError({ message: "request abort" })).toBe("unknown");
  });

  it("classifies a DOMException-style AbortError by its NAME, not just its message (round-8 #4)", () => {
    // Red-green (round-8 #4): the A6(i) comment claimed DOMException NAME
    // coverage via /\baborterror\b/, but errorInfo only captured
    // err.message — so a real fetch-abort DOMException (name "AbortError",
    // message "The user aborted a request.") matched NONE of the abort
    // patterns and fell through to "unknown". errorInfo must carry
    // err.name and classification must consider name+message.
    const err = new Error("The user aborted a request.");
    err.name = "AbortError";
    const info = errorInfo(err);
    expect(info.name).toBe("AbortError");
    expect(classifyWriterError(info)).toBe("network_error");
    // Same shape arriving as a plain object (non-Error throw).
    expect(
      classifyWriterError(
        errorInfo({
          name: "AbortError",
          message: "The user aborted a request.",
        }),
      ),
    ).toBe("network_error");
    // The name haystack must not over-match: an unrelated name plus an
    // unrelated message still classifies as unknown.
    const other = new Error("deploy aborted by operator");
    other.name = "DeployError";
    expect(classifyWriterError(errorInfo(other))).toBe("unknown");
  });

  it("serializeErr round-trips the error NAME (round-9 #3)", () => {
    // Red-green (round-9 #3): serializeErr's doc promises a structured
    // round-trip ("consumers that need the structure can re-parse this
    // JSON"), but it dropped info.name — the one field round-8 #4 added so
    // abort shapes whose MESSAGE carries no signal (DOMException
    // AbortError) stay classifiable. A consumer re-parsing the serialized
    // err could therefore never re-classify an abort.
    const serialized = serializeErr({
      message: "The user aborted a request.",
      name: "AbortError",
      status: 0,
    });
    const reparsed = JSON.parse(serialized) as WriterErrorInfo;
    expect(reparsed.name).toBe("AbortError");
    expect(reparsed.message).toBe("The user aborted a request.");
    expect(classifyWriterError(reparsed)).toBe("network_error");
    // Absent name stays absent — no `name: undefined` noise in the JSON.
    expect(
      JSON.parse(serializeErr({ message: "plain" })) as WriterErrorInfo,
    ).not.toHaveProperty("name");
  });

  it("classifyWriterError recognizes the full node network-error token family (A5 round 6)", () => {
    // Red-green (round-6 A5): real node/undici network failures surface as
    // ETIMEDOUT / EAI_AGAIN / EPIPE / EHOSTUNREACH / "socket hang up" —
    // none of which classified as network_error, so retry/alert routing
    // treated genuine connectivity loss as "unknown".
    expect(classifyWriterError({ message: "connect ETIMEDOUT 1.2.3.4" })).toBe(
      "network_error",
    );
    expect(classifyWriterError({ message: "getaddrinfo EAI_AGAIN pb" })).toBe(
      "network_error",
    );
    expect(classifyWriterError({ message: "write EPIPE" })).toBe(
      "network_error",
    );
    expect(
      classifyWriterError({ message: "connect EHOSTUNREACH 10.0.0.1" }),
    ).toBe("network_error");
    expect(classifyWriterError({ message: "socket hang up" })).toBe(
      "network_error",
    );
    // The bare `includes("network")` substring is replaced with a
    // word-boundary check: "network error" still matches, but words merely
    // CONTAINING the token do not.
    expect(classifyWriterError({ message: "network error" })).toBe(
      "network_error",
    );
    expect(
      classifyWriterError({ message: "networking subsystem misconfigured" }),
    ).toBe("unknown");
  });

  it("classifyWriterError routes 404 to pb_not_found (A3)", () => {
    // Red-green (round-4 A3): classifyWriterError had no 404 branch, so a
    // row deleted between read and update classified as "unknown".
    expect(classifyWriterError({ message: "Not Found.", status: 404 })).toBe(
      "pb_not_found",
    );
  });

  it("classifyWriterError maps status codes to reasons (B6)", () => {
    expect(classifyWriterError({ message: "", status: 401 })).toBe(
      "pb_auth_error",
    );
    expect(classifyWriterError({ message: "", status: 403 })).toBe(
      "pb_permission",
    );
    expect(classifyWriterError({ message: "", status: 429 })).toBe(
      "pb_rate_limited",
    );
    expect(classifyWriterError({ message: "", status: 503 })).toBe(
      "pb_server_error",
    );
    expect(classifyWriterError({ message: "", status: 400 })).toBe(
      "pb_schema_error",
    );
    expect(classifyWriterError({ message: "fetch failed" })).toBe(
      "network_error",
    );
    expect(classifyWriterError({ message: "" })).toBe("unknown");
  });

  it("HF-B1: classifyWriterError routes 400s to pb_schema_error with or without data", () => {
    // Red-green: the previous implementation had a dead branch on `data`
    // (both arms returned pb_schema_error). Confirm both paths still
    // collapse to pb_schema_error so no 400 silently falls through to
    // "unknown".
    expect(
      classifyWriterError({
        message: "validation failed",
        status: 400,
        data: { data: { url: { code: "validation_required" } } },
      }),
    ).toBe("pb_schema_error");
    expect(classifyWriterError({ message: "bad request", status: 400 })).toBe(
      "pb_schema_error",
    );
  });

  it("R21-a: errorInfo reads PbHttpError.statusCode so classifyWriterError routes 401/403/429/400 correctly", async () => {
    // PbHttpError (storage/pb-client.ts) exposes `statusCode`, but the
    // historical PB SDK error shape used `status`. Pre-fix errorInfo only
    // read `status`, so a retry-exhausted PbHttpError with statusCode=429
    // fell through to the `unknown` bucket instead of `pb_rate_limited`.
    const { PbHttpError } = await import("../storage/pb-client.js");
    const cases: Array<[number, ReturnType<typeof classifyWriterError>]> = [
      [401, "pb_auth_error"],
      [403, "pb_permission"],
      [429, "pb_rate_limited"],
      [400, "pb_schema_error"],
    ];
    for (const [code, expected] of cases) {
      const err = new PbHttpError({
        statusCode: code,
        bodyText: "body",
        path: "/api/collections/status/records",
      });
      const info = errorInfo(err);
      expect(info.status).toBe(code);
      expect(classifyWriterError(info)).toBe(expected);
    }
  });

  it("R21-a: errorInfo prefers statusCode over status when both are present", () => {
    // Paranoia: if some future wrapper shape sets both fields, prefer the
    // newer `statusCode` — pb-client.ts is the typed source of truth.
    class HybridErr extends Error {
      status = 418;
      statusCode = 429;
    }
    const info = errorInfo(new HybridErr("boom"));
    expect(info.status).toBe(429);
    expect(classifyWriterError(info)).toBe("pb_rate_limited");
  });

  it("history_create failure AFTER a successful upsert resolves — writer.failed + warn, no rethrow (A1 round 7)", async () => {
    // Red-green (round-7 A1): upsert-first ordering. When the history
    // create fails after the durable upsert already persisted, rethrowing
    // would invite a caller retry that re-writes an identical durable row
    // just to chase the audit row. Instead: loud on both channels
    // (writer.failed + warn), the outcome stays persisted:true, and
    // status.changed still fires (the durable transition DID happen).
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const pb: PbClient = {
      async getOne() {
        return null;
      },
      async getFirst() {
        return null;
      },
      async list() {
        return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
      },
      async create(): Promise<never> {
        throw new Error("history boom");
      },
      async update<T>(_c: string, _i: string, r: unknown): Promise<T> {
        return r as T;
      },
      async upsertByField<T>(
        _c: string,
        _f: string,
        _v: string,
        r: unknown,
      ): Promise<T> {
        return r as T;
      },
      async delete() {},
      async deleteByFilter() {
        return 0;
      },
      async health() {
        return true;
      },
      async createBackup() {},
      async downloadBackup() {
        return new Uint8Array();
      },
      async deleteBackup() {},
    };
    const bus = createEventBus();
    const failed: Array<{ phase: string }> = [];
    const statusChanged: unknown[] = [];
    bus.on("writer.failed", (e) => {
      failed.push({ phase: e.phase });
    });
    bus.on("status.changed", (p) => statusChanged.push(p));
    const writer = createStatusWriter({ pb, bus, logger: customLogger });
    // Must RESOLVE (no rethrow): the durable upsert persisted.
    const out = await writer.write(probeResult("green"));
    expect(out.persisted).toBe(true);
    expect(out.transition).toBe("first");
    // The audit gap is loud on both channels…
    expect(failed).toEqual([{ phase: "history_create" }]);
    expect(
      warnCalls.filter((c) => c.msg === "status-writer.history-create-failed"),
    ).toHaveLength(1);
    // …and the persisted transition still reaches the bus (F2.2: emit
    // exactly what was persisted — the durable row DID change).
    expect(statusChanged).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Writer identity stamping (anti-dual-writer hardening). Every durable
// status-row write carries `written_by` so a second writer fighting over the
// same key is attributable from the data instead of invisible.
// ---------------------------------------------------------------------------
describe("status-writer writer identity (written_by)", () => {
  let env: ReturnType<typeof fakePb>;
  beforeEach(() => {
    env = fakePb();
  });

  function seedRow(partial: Partial<StatusRecord> = {}): void {
    env.rows.set("smoke:mastra", {
      id: "seed-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "green",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 0,
      first_failure_at: null,
      ...partial,
    });
  }

  it("stamps written_by from deps on the status row", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.write(probeResult("green"));
    expect(env.rows.get("smoke:mastra")?.written_by).toBe("fleet-cp");
  });

  it("defaults written_by to the sanitized host-derived 'unknown-<host>' and warns once at construction", async () => {
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    try {
      // Round-8 #8b: stub HOSTNAME explicitly (the previous version ran
      // against the machine's real hostname, so the lowercase-only pattern
      // assertion never exercised sanitization). Uppercase + an
      // out-of-class character pin the sanitization rules: lowercase,
      // non-[a-z0-9.-] runs collapse to "-".
      vi.stubEnv("HOSTNAME", "Fleet_CP-01.Example");
      const writer = createStatusWriter({
        pb: env.pb,
        bus: createEventBus(),
        logger: customLogger,
      });
      await writer.write(probeResult("green"));
      // Greppable "unknown" prefix + stable HOSTNAME-derived suffix (A6(iv)
      // round 7) so an unwired writer keeps the same identity across
      // restarts (no fabricated self-fights) while unwired writers on
      // DIFFERENT hosts stay mutually visible to flip detection.
      expect(env.rows.get("smoke:mastra")?.written_by).toBe(
        "unknown-fleet-cp-01.example",
      );
      // One-time construction WARN flags the wiring mistake.
      expect(
        warnCalls.filter((c) => c.msg === "status-writer.default-written-by"),
      ).toHaveLength(1);
      // A6(iv): discriminate once-at-CONSTRUCTION from once-per-WRITE — a
      // second write must produce ZERO new default-written-by warns.
      await writer.write({
        ...probeResult("green"),
        observedAt: "2026-04-20T00:05:00Z",
      });
      expect(
        warnCalls.filter((c) => c.msg === "status-writer.default-written-by"),
      ).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("routes an empty/whitespace writtenBy through the fallback identity + construction warn (A4 round 5)", async () => {
    // Red-green (round-5 A4): `deps.writtenBy ?? makeDefaultWrittenBy()`
    // only caught nullish — `writtenBy: ""` (e.g. an unset env var
    // interpolated into config) stamped EMPTY attribution silently, and
    // the cross-writer-flip guard then treated those rows as
    // unattributable. Empty and whitespace-only values must route through
    // the same fallback + warn as undefined.
    for (const blank of ["", "   "]) {
      const env2 = fakePb();
      const warnCalls: Array<{ msg: string }> = [];
      const customLogger = {
        info: () => {},
        warn: (msg: string) => warnCalls.push({ msg }),
        error: () => {},
        debug: () => {},
      };
      const writer = createStatusWriter({
        pb: env2.pb,
        bus: createEventBus(),
        logger: customLogger,
        writtenBy: blank,
      });
      await writer.write(probeResult("green"));
      expect(env2.rows.get("smoke:mastra")?.written_by).toMatch(
        /^unknown-[a-z0-9][a-z0-9.-]*$/,
      );
      expect(
        warnCalls.filter((c) => c.msg === "status-writer.default-written-by"),
      ).toHaveLength(1);
    }
  });

  it("gives unwired writers on DIFFERENT hosts distinct default identities (A6(iv) round 7)", async () => {
    // The default identity is HOST-derived (stable per host — see the
    // restart test in the flip-detection suite), so distinctness holds
    // ACROSS hosts, not across instances on one host.
    try {
      vi.stubEnv("HOSTNAME", "host-a");
      const writerA = createStatusWriter({
        pb: env.pb,
        bus: createEventBus(),
        logger,
      });
      await writerA.write(probeResult("green"));
      const stampA = env.rows.get("smoke:mastra")?.written_by;
      vi.stubEnv("HOSTNAME", "host-b");
      const writerB = createStatusWriter({
        pb: env.pb,
        bus: createEventBus(),
        logger,
      });
      await writerB.write({
        ...probeResult("green"),
        observedAt: "2026-04-20T00:05:00Z",
      });
      const stampB = env.rows.get("smoke:mastra")?.written_by;
      expect(stampA).toBe("unknown-host-a");
      expect(stampB).toBe("unknown-host-b");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not restamp written_by on an error tick (observed_at-only update)", async () => {
    seedRow({ written_by: "legacy" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    const row = env.rows.get("smoke:mastra");
    // The error tick refreshes observed_at but the durable state (and its
    // writer attribution) is unchanged.
    expect(row?.observed_at).toBe("2026-04-20T00:05:00Z");
    expect(row?.written_by).toBe("legacy");
  });

  it("stamps state_written_at on durable state writes", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.write(probeResult("green"));
    expect(env.rows.get("smoke:mastra")?.state_written_at).toBe(
      "2026-04-20T00:00:00Z",
    );
  });

  it("does not touch state_written_at on an error tick", async () => {
    seedRow({
      written_by: "legacy",
      state_written_at: "2026-04-20T00:00:00Z",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:05:00Z",
    });
    const row = env.rows.get("smoke:mastra");
    // observed_at moves ("we tried at this time"); the durable-state write
    // timestamp must NOT — error ticks are observations, not state writes.
    expect(row?.observed_at).toBe("2026-04-20T00:05:00Z");
    expect(row?.state_written_at).toBe("2026-04-20T00:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// Cross-writer flip detection: a green<->red flip by a DIFFERENT writer than
// the one that wrote the previous durable state, within the fight window,
// emits a structured WARN (observability only — never blocks the write).
// ---------------------------------------------------------------------------
describe("status-writer cross-writer flip detection", () => {
  let env: ReturnType<typeof fakePb>;
  let warnCalls: Array<{ msg: string; obj?: unknown }>;
  let customLogger: {
    info: () => void;
    warn: (msg: string, obj?: unknown) => void;
    error: () => void;
    debug: () => void;
  };
  beforeEach(() => {
    env = fakePb();
    warnCalls = [];
    customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
  });
  afterEach(() => {
    // vi.stubEnv (HOSTNAME stubs in the default-identity tests) is NOT
    // undone by restoreAllMocks — unstub explicitly so a leaked stub can't
    // poison unrelated files under worker reuse.
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function seedRow(partial: Partial<StatusRecord> = {}): void {
    // Red seeds carry a first_failure_at so these fixtures exercise ONLY
    // the cross-writer flip concern — a red row with a null
    // first_failure_at would also trip the unrelated legacy-row warn path.
    const state = partial.state ?? "green";
    env.rows.set("smoke:mastra", {
      id: "seed-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state,
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: state === "red" ? 1 : 0,
      first_failure_at: state === "red" ? "2026-04-20T00:00:00Z" : null,
      ...partial,
    });
  }

  function flipWarns(): Array<{ msg: string; obj?: unknown }> {
    return warnCalls.filter((c) => c.msg === "status-writer.cross-writer-flip");
  }

  it("warns when a different writer flips state within the window", async () => {
    seedRow({ state: "red", written_by: "legacy" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(flipWarns()).toHaveLength(1);
    const obj = flipWarns()[0]!.obj as Record<string, unknown>;
    expect(obj.key).toBe("smoke:mastra");
    expect(obj.previousWriter).toBe("legacy");
    expect(obj.currentWriter).toBe("fleet-cp");
    expect(obj.previousState).toBe("red");
    expect(obj.newState).toBe("green");
  });

  it("does not warn when the same writer flips state", async () => {
    seedRow({ state: "red", written_by: "fleet-cp" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(flipWarns()).toHaveLength(0);
  });

  it("does not warn when the previous write is outside the window", async () => {
    seedRow({ state: "red", written_by: "legacy" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    // Default window is 30min; previous write was 45min before this one.
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:45:00Z",
    });
    expect(flipWarns()).toHaveLength(0);
  });

  it("honors a configured crossWriterFlipWindowMs", async () => {
    seedRow({ state: "red", written_by: "legacy" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
      crossWriterFlipWindowMs: 60 * 60 * 1000, // 1h
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:45:00Z",
    });
    expect(flipWarns()).toHaveLength(1);
  });

  it("falls back to the default window (with a one-time warn) when crossWriterFlipWindowMs is NaN/zero/negative (round-8 #3)", async () => {
    // Red-green (round-8 #3): the configured window was used unvalidated —
    // `deltaMs <= NaN` is always false and `deltaMs <= 0` (zero/negative
    // windows) only holds for a zero delta, so a bad config value SILENTLY
    // disabled flip detection entirely. Construction must reject non-finite
    // and non-positive windows: fall back to the default and warn once.
    for (const bad of [Number.NaN, 0, -5]) {
      warnCalls.length = 0;
      const env2 = fakePb();
      env2.rows.set("smoke:mastra", {
        id: "seed-1",
        key: "smoke:mastra",
        dimension: "smoke",
        state: "red",
        signal: {},
        observed_at: "2026-04-20T00:00:00Z",
        transitioned_at: "2026-04-20T00:00:00Z",
        fail_count: 1,
        first_failure_at: "2026-04-20T00:00:00Z",
        written_by: "legacy",
      });
      const writer = createStatusWriter({
        pb: env2.pb,
        bus: createEventBus(),
        logger: customLogger,
        writtenBy: "fleet-cp",
        crossWriterFlipWindowMs: bad,
      });
      // One-time construction warn makes the misconfiguration loud.
      const configWarns = warnCalls.filter(
        (c) => c.msg === "status-writer.invalid-cross-writer-flip-window",
      );
      expect(configWarns).toHaveLength(1);
      expect(
        (configWarns[0]!.obj as Record<string, unknown>).configuredWindowMs,
      ).toBe(bad);
      // Flip detection runs on the DEFAULT 30min window, not disabled: a
      // cross-writer flip 10min after the previous durable write warns.
      await writer.write({
        ...probeResult("green"),
        observedAt: "2026-04-20T00:10:00Z",
      });
      expect(flipWarns()).toHaveLength(1);
      expect((flipWarns()[0]!.obj as Record<string, unknown>).windowMs).toBe(
        30 * 60 * 1000,
      );
    }
  });

  it("does not warn on a cross-writer non-flip (sustained) write", async () => {
    seedRow({ state: "red", written_by: "legacy" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(flipWarns()).toHaveLength(0);
  });

  it("does not warn when a recent error tick refreshed observed_at over a months-old durable state", async () => {
    // The fabricated-fight regression: writer A's durable red is months
    // old (state_written_at), but an error tick recently refreshed
    // observed_at WITHOUT restamping written_by. Writer B's green flip
    // must stay silent — the window must measure the age of the last
    // DURABLE STATE write, not the last observation.
    seedRow({
      state: "red",
      written_by: "legacy",
      observed_at: "2026-01-20T00:00:00Z",
      state_written_at: "2026-01-20T00:00:00Z",
      transitioned_at: "2026-01-20T00:00:00Z",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    // Error tick: refreshes observed_at to "now", leaves state/written_by.
    await writer.write({
      ...probeResult("error"),
      observedAt: "2026-04-20T00:08:00Z",
    });
    expect(env.rows.get("smoke:mastra")?.observed_at).toBe(
      "2026-04-20T00:08:00Z",
    );
    // Cross-writer green flip 2min later — months-stale handoff, no fight.
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(flipWarns()).toHaveLength(0);
  });

  it("warns on a genuine cross-writer flip over a recent durable state write", async () => {
    // Positive control for the regression above: when the previous
    // DURABLE state write is recent, the cross-writer flip still warns.
    seedRow({
      state: "red",
      written_by: "legacy",
      state_written_at: "2026-04-20T00:00:00Z",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(flipWarns()).toHaveLength(1);
  });

  it("does not warn when the flip's observedAt is backdated before the previous durable write", async () => {
    // Negative delta (clock skew / replayed probe): a backdated
    // observation always satisfied `delta <= window` before the explicit
    // `>= 0` lower bound. It must not count as a fight.
    seedRow({
      state: "red",
      written_by: "legacy",
      observed_at: "2026-04-20T00:10:00Z",
      state_written_at: "2026-04-20T00:10:00Z",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    expect(flipWarns()).toHaveLength(0);
  });

  it("warns when two unwired writers on DIFFERENT hosts flip the same key within the window (A6(iv) round 7)", async () => {
    // Cross-host visibility: two unwired writers on different hosts derive
    // different `unknown-<host>` identities, so the flip detector still
    // catches them fighting.
    vi.stubEnv("HOSTNAME", "host-a");
    const writerA = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    await writerA.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    vi.stubEnv("HOSTNAME", "host-b");
    const writerB = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    await writerB.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(flipWarns()).toHaveLength(1);
    const obj = flipWarns()[0]!.obj as Record<string, unknown>;
    expect(obj.previousWriter).toMatch(/^unknown-/);
    expect(obj.currentWriter).toMatch(/^unknown-/);
    expect(obj.previousWriter).not.toBe(obj.currentWriter);
  });

  it("derives a STABLE per-host default identity — restarts keep the same fallback stamp (A6(iv) round 7)", async () => {
    // Red-green (round-7 A6iv): the per-construction RANDOM suffix changed
    // on every restart, so an unwired writer flipping its own key across a
    // restart looked like TWO writers fighting (fabricated flip warn) and
    // broke the foreign-write heuristic's written_by === self premise.
    // HOSTNAME-derived suffix: stable across restarts on the same host.
    vi.stubEnv("HOSTNAME", "fleet-cp-1");
    const writerA = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    await writerA.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    const stamped = env.rows.get("smoke:mastra")?.written_by;
    expect(stamped).toBe("unknown-fleet-cp-1");
    // "Restart": a fresh writer instance on the same host flips its own
    // key — same identity, so NO fabricated cross-writer-flip warn.
    const writerB = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
    });
    await writerB.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(env.rows.get("smoke:mastra")?.written_by).toBe(stamped);
    expect(flipWarns()).toHaveLength(0);
  });

  it("warns (with the failed value) when a flip candidate's timestamp is unparseable", async () => {
    // Round-3 A2: an unparseable timestamp silently disables flip detection
    // for this write — that disablement must be loud. logger.debug is
    // filtered in prod, so the silent disablement stayed silent; the branch
    // only fires on cross-writer flip CANDIDATES (different writer +
    // green<->red flip), so a warn is naturally rate-limited. The payload
    // must carry previousStateWrittenAt — the value that actually failed to
    // parse — not just the observed_at pair.
    seedRow({
      state: "red",
      written_by: "legacy",
      observed_at: "not-a-timestamp",
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(flipWarns()).toHaveLength(0);
    const skips = warnCalls.filter(
      (c) => c.msg === "status-writer.cross-writer-flip-unparseable-timestamp",
    );
    expect(skips).toHaveLength(1);
    const obj = skips[0]!.obj as Record<string, unknown>;
    expect(obj.key).toBe("smoke:mastra");
    // The value that failed to parse (state_written_at unset → fell back
    // to the row's observed_at).
    expect(obj.previousStateWrittenAt).toBe("not-a-timestamp");
    expect(obj.previousObservedAt).toBe("not-a-timestamp");
    expect(obj.observedAt).toBe("2026-04-20T00:10:00Z");
  });

  it("dedupes the flip-unparseable-timestamp warn per key with the 1h TTL — sustained fights re-warn (round-8 #2)", async () => {
    // Red-green (round-8 #2): the warn had NO dedup — in a sustained
    // dual-writer fight over a row with an unparseable timestamp (the exact
    // scenario it targets) it fired on every flip tick indefinitely. It now
    // routes through the same TTL'd dedup as the legacy/foreign-write warns:
    // suppressed within the TTL, re-warns once it lapses while the fight
    // persists.
    const t0 = Date.parse("2026-04-20T00:00:00Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(t0);
    const reseed = (): void =>
      seedRow({
        state: "red",
        written_by: "legacy",
        observed_at: "not-a-timestamp",
      });
    const skips = (): unknown[] =>
      warnCalls.filter(
        (c) =>
          c.msg === "status-writer.cross-writer-flip-unparseable-timestamp",
      );
    reseed();
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(skips()).toHaveLength(1);
    // The foreign writer re-reddens the row with the same garbage
    // timestamp; our next flip is within the TTL → suppressed.
    reseed();
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:20:00Z",
    });
    expect(skips()).toHaveLength(1);
    // TTL lapses while the fight persists → visible again.
    nowSpy.mockReturnValue(t0 + 61 * 60 * 1000);
    reseed();
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T01:10:00Z",
    });
    expect(skips()).toHaveLength(2);
  });

  it("falls back to observed_at when state_written_at is an empty string (post-migration legacy row)", async () => {
    // Red-green (round-3 A1): PocketBase serializes UNSET date fields as ""
    // (never null/undefined), so every legacy row that predates the
    // status_add_state_written_at migration comes back with
    // `state_written_at: ""` after migration. `"" ?? observed_at` is "" —
    // nullish coalescing never falls back — so Date.parse("") = NaN routed
    // EXACTLY the legacy-row population the fallback targets into the
    // unparseable branch, silently disabling flip detection for them. The
    // fix uses truthiness (`||`) so "" falls back to observed_at and the
    // flip is windowed against it.
    const debugCalls: string[] = [];
    const emptyTsLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: (msg: string) => debugCalls.push(msg),
    };
    seedRow({
      state: "red",
      written_by: "legacy",
      observed_at: "2026-04-20T00:00:00Z",
      state_written_at: "", // PB's serialization of an unset date field
    });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: emptyTsLogger,
      writtenBy: "fleet-cp",
    });
    // Cross-writer flip 10min after observed_at — inside the 30min window.
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    // Took the observed_at-windowed path: the flip warns…
    expect(flipWarns()).toHaveLength(1);
    const obj = flipWarns()[0]!.obj as Record<string, unknown>;
    expect(obj.previousStateWrittenAt).toBe("2026-04-20T00:00:00Z");
    // …and the unparseable-timestamp branch never fired.
    expect(
      warnCalls.filter(
        (c) =>
          c.msg === "status-writer.cross-writer-flip-unparseable-timestamp",
      ),
    ).toHaveLength(0);
    expect(
      debugCalls.filter(
        (m) => m === "status-writer.cross-writer-flip-unparseable-timestamp",
      ),
    ).toHaveLength(0);
  });

  it("does not warn when the previous row has no written_by (pre-migration row)", async () => {
    seedRow({ state: "red" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(flipWarns()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A1 (round 6): foreign-write detection — the old-image blind spot. An
// old-image legacy writer's PARTIAL update mutates `state` without
// restamping `written_by`, so the next new-image write sees
// written_by === self and the cross-writer flip detector never fires.
// The writer's bounded in-memory self-write map (last durably-written
// state per key) catches the mutation within a process lifetime.
// ---------------------------------------------------------------------------
describe("status-writer foreign-write detection (A1 round 6)", () => {
  let env: ReturnType<typeof fakePb>;
  let warnCalls: Array<{ msg: string; obj?: unknown }>;
  let customLogger: {
    info: () => void;
    warn: (msg: string, obj?: unknown) => void;
    error: () => void;
    debug: () => void;
  };
  beforeEach(() => {
    env = fakePb();
    warnCalls = [];
    customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function foreignWarns(): Array<{ msg: string; obj?: unknown }> {
    return warnCalls.filter(
      (c) => c.msg === "status-writer.foreign-write-detected",
    );
  }

  it("warns when the row's state was mutated under our own stamp (foreign overwrite)", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    // Our durable write: green, stamped fleet-cp, remembered in the map.
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    // Old-image partial update: state flips to red, written_by NOT
    // restamped (PB updates only the fields provided) — our stale stamp
    // stays on a state we never wrote.
    const row = env.rows.get("smoke:mastra")!;
    env.rows.set("smoke:mastra", {
      ...row,
      state: "red",
      fail_count: 1,
      first_failure_at: "2026-04-20T00:05:00Z",
    });
    // Our next durable write sees written_by === self but a state that
    // differs from what we remember writing → foreign-write warn. The
    // cross-writer flip detector stays silent (same identity) — this
    // heuristic is the ONLY signal for the old-image scenario.
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(foreignWarns()).toHaveLength(1);
    const obj = foreignWarns()[0]!.obj as Record<string, unknown>;
    expect(obj.key).toBe("smoke:mastra");
    expect(obj.writtenBy).toBe("fleet-cp");
    expect(obj.rememberedState).toBe("green");
    expect(obj.foundState).toBe("red");
    expect(
      warnCalls.filter((c) => c.msg === "status-writer.cross-writer-flip"),
    ).toHaveLength(0);
  });

  it("does not warn on our own rewrite (self flip, memory matches)", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    // Our own genuine flip: the row reads back exactly as we last wrote it.
    await writer.write({
      ...probeResult("red"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:20:00Z",
    });
    expect(foreignWarns()).toHaveLength(0);
  });

  it("a CORRUPT state under our own stamp emits only the corrupt-state warn — not a foreign-write warn with a non-State foundState (round-8 #5)", async () => {
    // Red-green (round-8 #5): the heuristic compared the RAW unvalidated
    // existing.state, so a corrupt value under our own stamp double-warned
    // (corrupt-state-read AND foreign-write) and leaked a non-State value
    // into foundState. Degrade-don't-trust posture: the comparison routes
    // through the validated read (readValidatedState), which treats a
    // corrupt value as "no prior observation" — only the corrupt-state
    // warn fires.
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    // Corruption lands under our own stamp (written_by untouched).
    const row = env.rows.get("smoke:mastra")!;
    env.rows.set("smoke:mastra", {
      ...row,
      state: "blue" as unknown as StatusRecord["state"],
    });
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(
      warnCalls.filter((c) => c.msg === "status-writer.corrupt-state-read"),
    ).toHaveLength(1);
    expect(foreignWarns()).toHaveLength(0);
  });

  it("re-warns on sustained foreign fighting after the TTL lapses (A6(iv) round 7)", async () => {
    // Red-green (round-7 A6iv): warnDeduped fired ONCE per key for the
    // process lifetime, so a foreign writer CONTINUOUSLY fighting a key was
    // visible exactly once and then invisible forever. TTL'd dedup (same
    // posture as shouldWarnLegacy): suppressed within the TTL, re-warns
    // once it lapses while the fighting persists.
    const t0 = Date.parse("2026-04-20T00:00:00Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(t0);
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    const foreignMutate = (): void => {
      const row = env.rows.get("smoke:mastra")!;
      env.rows.set("smoke:mastra", { ...row, state: "red" });
    };
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    foreignMutate();
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(foreignWarns()).toHaveLength(1);
    // The hint covers the OTHER way a row mutates under our own stamp:
    // another replica configured with the SAME writtenBy identity.
    expect(
      String((foreignWarns()[0]!.obj as Record<string, unknown>).hint),
    ).toContain("replica");
    // Still fighting within the TTL — suppressed.
    foreignMutate();
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:20:00Z",
    });
    expect(foreignWarns()).toHaveLength(1);
    // TTL lapses — sustained fighting becomes visible again.
    nowSpy.mockReturnValue(t0 + 61 * 60 * 1000);
    foreignMutate();
    await writer.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T01:10:00Z",
    });
    expect(foreignWarns()).toHaveLength(2);
  });

  it("warns ONCE when the self-write memory starts evicting — cap blindness is observable (A6(v) round 7)", async () => {
    // Red-green (round-7 A6v): past MAX_WARNED_KEYS distinct keys the
    // bounded self-write map silently evicts, and evicted keys become
    // foreign-write-detection blind with no signal that the cap was the
    // cause. One warn on first eviction makes the blindness diagnosable
    // without per-eviction spam.
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    const write = (key: string): Promise<unknown> =>
      writer.write({
        key,
        state: "green",
        signal: {},
        observedAt: "2026-04-20T00:00:00Z",
      });
    // Fill to the cap (1024) — no eviction yet.
    for (let i = 0; i < 1024; i++) await write(`smoke:k${i}`);
    const evictions = (): unknown[] =>
      warnCalls.filter(
        (c) => c.msg === "status-writer.durable-state-memory-evicting",
      );
    expect(evictions()).toHaveLength(0);
    // The 1025th key evicts — exactly one warn…
    await write("smoke:overflow-1");
    expect(evictions()).toHaveLength(1);
    // …and further evictions stay silent (one-time, not per-eviction).
    await write("smoke:overflow-2");
    expect(evictions()).toHaveLength(1);
  });

  it("stays silent on a memory miss (process restart — empty map, no false positives)", async () => {
    const writerA = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writerA.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:00:00Z",
    });
    // Foreign partial update under our stamp…
    const row = env.rows.get("smoke:mastra")!;
    env.rows.set("smoke:mastra", {
      ...row,
      state: "red",
      fail_count: 1,
      first_failure_at: "2026-04-20T00:05:00Z",
    });
    // …but the process restarted (fresh writer instance, SAME identity):
    // the self-write map is empty, so the heuristic must stay silent.
    const writerB = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: customLogger,
      writtenBy: "fleet-cp",
    });
    await writerB.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(foreignWarns()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// H1 overlay path: writeOverlay attaches signal-overlay fields onto an
// EXISTING status row without re-writing its durable state — preserving
// state / written_by / fail_count / first_failure_at / transitioned_at, not
// classifying a transition, and not emitting status.changed. Modelled on the
// error path's discipline (observed_at refreshes as "we tried at this time").
// ---------------------------------------------------------------------------
describe("status-writer writeOverlay (H1 overlay path)", () => {
  let env: ReturnType<typeof fakePb>;
  beforeEach(() => {
    env = fakePb();
  });

  function seedRedRow(partial: Partial<StatusRecord> = {}): void {
    env.rows.set("smoke:mastra", {
      id: "seed-1",
      key: "smoke:mastra",
      dimension: "smoke",
      state: "red",
      signal: { prior: true },
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-19T23:00:00Z",
      fail_count: 3,
      first_failure_at: "2026-04-19T23:00:00Z",
      written_by: "legacy",
      state_written_at: "2026-04-20T00:00:00Z",
      ...partial,
    });
  }

  it("merges the overlay over the existing signal, refreshes observed_at, and preserves everything else", async () => {
    seedRedRow();
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });

    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { commError: { kind: "worker-crashed-mid-job" } },
      observedAt: "2026-04-20T00:05:00Z",
    });

    expect(outcome.applied).toBe(true);
    expect(outcome.state).toBe("red");
    const row = env.rows.get("smoke:mastra")!;
    // Overlay merged over the preserved base signal.
    expect((row.signal as Record<string, unknown>).prior).toBe(true);
    expect((row.signal as Record<string, unknown>).commError).toEqual({
      kind: "worker-crashed-mid-job",
    });
    // "We tried at this time" — same as the error path.
    expect(row.observed_at).toBe("2026-04-20T00:05:00Z");
    // Durable state, attribution and counters are untouched.
    expect(row.state).toBe("red");
    expect(row.written_by).toBe("legacy");
    expect(row.fail_count).toBe(3);
    expect(row.first_failure_at).toBe("2026-04-19T23:00:00Z");
    expect(row.transitioned_at).toBe("2026-04-19T23:00:00Z");
    // A1×A2 composition: an overlay is NOT a durable state write, so it must
    // not restamp state_written_at — the cross-writer flip window is measured
    // against it.
    expect(row.state_written_at).toBe("2026-04-20T00:00:00Z");
  });

  it("appends a status_history row (transition 'error') so the overlay stays auditable", async () => {
    seedRedRow();
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(env.history).toHaveLength(1);
    const h = env.history[0] as Record<string, unknown>;
    expect(h.transition).toBe("error");
    expect(h.state).toBe("red");
    expect((h.signal as Record<string, unknown>).overlaid).toBe(true);
  });

  it("does not move observed_at BACKWARDS on a stale overlay (F2f monotonicity guard)", async () => {
    // Red-green (F2f): a reclaim-time observedAt can be STALE — captured
    // before a fresher probe tick already refreshed the row. Without a
    // monotonicity guard the overlay rewound observed_at, making the
    // dashboard report an older "we tried at this time" than reality.
    // The overlay signal still lands; only the timestamp is guarded.
    seedRedRow({ observed_at: "2026-04-20T00:10:00Z" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z", // stale: before the row's 00:10
    });
    expect(outcome).toEqual({
      applied: true,
      state: "red",
      historyPersisted: true,
    });
    const row = env.rows.get("smoke:mastra")!;
    // Timestamp NOT rewound.
    expect(row.observed_at).toBe("2026-04-20T00:10:00Z");
    // Overlay signal still merged.
    expect((row.signal as Record<string, unknown>).overlaid).toBe(true);
    expect((row.signal as Record<string, unknown>).prior).toBe(true);
  });

  it("still refreshes observed_at when the overlay's timestamp equals the row's (F2f boundary)", async () => {
    // A6(i): equal-value refresh vs no-refresh are observationally
    // IDENTICAL by row value (the row already holds the equal timestamp),
    // so asserting on the row was vacuous — a `>=` → `>` regression
    // passed. Observe the pb.update PAYLOAD instead: the boundary
    // behavior is "the patch still INCLUDES observed_at".
    seedRedRow({ observed_at: "2026-04-20T00:05:00Z" });
    const statusPatches: Array<Record<string, unknown>> = [];
    const pb: PbClient = {
      ...env.pb,
      async update<T>(
        collection: string,
        id: string,
        record: Record<string, unknown>,
      ): Promise<T> {
        if (collection === "status") statusPatches.push(record);
        return env.pb.update<T>(collection, id, record);
      },
    };
    const writer = createStatusWriter({
      pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z", // equal: >= passes the guard
    });
    expect(statusPatches).toHaveLength(1);
    // The equal timestamp was actually PATCHED, not silently skipped.
    expect(statusPatches[0]!.observed_at).toBe("2026-04-20T00:05:00Z");
  });

  it("lands the signal but skips the observed_at patch when the INCOMING timestamp is unparseable (A3)", async () => {
    // Red-green (round-3 A3): F2f's original posture for an unparseable
    // incoming observedAt was "skip the guard and refresh" — which patched
    // the garbage string into PB's `observed_at` DATE field. Real PB
    // rejects that with a 400, so writer.failed fired, the throw bubbled,
    // and the caller's whole overlay attempt was lost. Correct posture:
    // the signal merge lands, the observed_at patch is skipped, and the
    // skip is loud (warn).
    seedRedRow();
    const warns: Array<{ msg: string; obj?: unknown }> = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warns.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "not-a-timestamp",
    });
    expect(outcome).toEqual({
      applied: true,
      state: "red",
      historyPersisted: true,
    });
    const row = env.rows.get("smoke:mastra")!;
    // The overlay signal landed…
    expect((row.signal as Record<string, unknown>).overlaid).toBe(true);
    expect((row.signal as Record<string, unknown>).prior).toBe(true);
    // …but the garbage string was NOT patched into the date field.
    expect(row.observed_at).toBe("2026-04-20T00:00:00Z");
    const skips = warns.filter(
      (c) => c.msg === "status-writer.overlay-unparseable-observed-at",
    );
    expect(skips).toHaveLength(1);
    const obj = skips[0]!.obj as Record<string, unknown>;
    expect(obj.key).toBe("smoke:mastra");
    expect(obj.observedAt).toBe("not-a-timestamp");
  });

  it("overlay with unparseable observedAt does NOT lose the overlay — history lands with a substituted timestamp (A1 round 5)", async () => {
    // Red-green (round-5 A1): same dead-guard regression as the error
    // path — the round-3 guard sat BELOW the history create, but
    // status_history.observed_at is a required PB date field, so the raw
    // garbage value 400'd the history create FIRST and the whole overlay
    // attempt was lost (exactly what the A3 fix claimed to prevent).
    seedRedRow();
    const warns: Array<{ msg: string; obj?: unknown }> = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warns.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    // Must RESOLVE applied:true — the old code threw out of the history
    // create here and the caller lost the whole overlay.
    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "not-a-timestamp",
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.state).toBe("red");
    // The history row landed with the row's current observed_at
    // substituted for the garbage value.
    expect(env.history).toHaveLength(1);
    expect((env.history[0] as Record<string, unknown>).observed_at).toBe(
      "2026-04-20T00:00:00Z",
    );
    // The signal merge landed; the observed_at patch was skipped.
    const row = env.rows.get("smoke:mastra")!;
    expect((row.signal as Record<string, unknown>).overlaid).toBe(true);
    expect(row.observed_at).toBe("2026-04-20T00:00:00Z");
    expect(
      warns.filter(
        (c) => c.msg === "status-writer.overlay-unparseable-observed-at",
      ),
    ).toHaveLength(1);
  });

  it("overlay with a parseable-but-non-ISO observedAt lands normalized to ISO, not 400'd (round-8 #1)", async () => {
    // Red-green (round-8 #1): same V8-vs-PB leniency gap as the durable and
    // error paths — RFC-1123 passed the Date.parse guard, then 400'd the
    // real observed_at patch/history create.
    seedRedRow();
    const writer = createStatusWriter({
      pb: dateValidatingPb(env),
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "Sun, 20 Apr 2026 00:10:00 GMT",
    });
    expect(outcome).toEqual({
      applied: true,
      state: "red",
      historyPersisted: true,
    });
    const row = env.rows.get("smoke:mastra")!;
    expect(row.observed_at).toBe("2026-04-20T00:10:00.000Z");
    const last = env.history.at(-1) as Record<string, unknown>;
    expect(last.observed_at).toBe("2026-04-20T00:10:00.000Z");
  });

  it("refreshes observed_at when the ROW's current value is unparseable but the incoming one is valid (A3)", async () => {
    // The other direction: a corrupt CURRENT row value must not pin the
    // row to garbage forever — a valid incoming observation repairs it.
    seedRedRow({ observed_at: "not-a-timestamp" });
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(outcome).toEqual({
      applied: true,
      state: "red",
      historyPersisted: true,
    });
    const row = env.rows.get("smoke:mastra")!;
    expect(row.observed_at).toBe("2026-04-20T00:05:00Z");
    expect((row.signal as Record<string, unknown>).overlaid).toBe(true);
  });

  it("does NOT emit status.changed (no transition was classified)", async () => {
    seedRedRow();
    const bus = createEventBus();
    const changed: unknown[] = [];
    bus.on("status.changed", (e) => changed.push(e));
    const writer = createStatusWriter({
      pb: env.pb,
      bus,
      logger,
      writtenBy: "fleet-cp",
    });
    await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(changed).toHaveLength(0);
  });

  it("emits writer.failed (phase history_create) and resolves applied:true/historyPersisted:false when the history append fails (F2g, reshaped by A4 round 6)", async () => {
    // A4 (round 6): update-first ordering means the overlay has ALREADY
    // landed on the live row when the audit-row append fails. The failure
    // surfaces as writer.failed + a warn, but the outcome RESOLVES — the
    // comm error lives on the row's signal (not silently dropped) and
    // historyPersisted:false reports the audit gap truthfully.
    seedRedRow();
    // ALIASING HAZARD (A6ii): this spread overrides `create` on the NEW
    // object only — fakePb's `upsertByField` closes over the ORIGINAL
    // `pb` const, so a code path that reached PB via upsertByField would
    // bypass this override and the injected failure would never fire.
    // The override works HERE because doWriteOverlay calls pb.create /
    // pb.update directly. If the writer ever routes the overlay through
    // upsertByField, inject the failure into fakePb itself instead.
    const pb: PbClient = {
      ...env.pb,
      async create(): Promise<never> {
        throw new Error("history boom");
      },
    };
    const bus = createEventBus();
    const failed: Array<{ phase: string; key: string; observedAt: string }> =
      [];
    bus.on("writer.failed", (e) =>
      failed.push({ phase: e.phase, key: e.key, observedAt: e.observedAt }),
    );
    const warns: string[] = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string) => warns.push(msg),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb,
      bus,
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(outcome).toEqual({
      applied: true,
      state: "red",
      historyPersisted: false,
    });
    expect(failed).toEqual([
      {
        phase: "history_create",
        key: "smoke:mastra",
        observedAt: "2026-04-20T00:05:00Z",
      },
    ]);
    expect(
      warns.filter((m) => m === "status-writer.overlay-history-create-failed"),
    ).toHaveLength(1);
    // The overlay DID land on the live row (update-first).
    const row = env.rows.get("smoke:mastra")!;
    expect((row.signal as Record<string, unknown>).overlaid).toBe(true);
    expect(env.history).toHaveLength(0);
  });

  it("emits writer.failed (phase status_upsert) and rethrows when the row update fails — persisting NOTHING (F2g + A4 round 6)", async () => {
    // A4 (round 6): update-first ordering. A non-404 update failure
    // rethrows (as before) but now persists NOTHING — under the old
    // history-first ordering every consumer retry of a persistently
    // failing update re-landed a duplicate audit history row, unbounded.
    seedRedRow();
    // ALIASING HAZARD (A6ii): see the history_create F2g test above —
    // this spread override is bypassed by fakePb's upsertByField (which
    // closes over the original pb). Correct here only because
    // doWriteOverlay calls pb.update directly.
    const pb: PbClient = {
      ...env.pb,
      async update(): Promise<never> {
        throw new Error("overlay update boom");
      },
    };
    const bus = createEventBus();
    const failed: Array<{ phase: string; key: string }> = [];
    bus.on("writer.failed", (e) => failed.push({ phase: e.phase, key: e.key }));
    const writer = createStatusWriter({
      pb,
      bus,
      logger,
      writtenBy: "fleet-cp",
    });
    await expect(
      writer.writeOverlay({
        key: "smoke:mastra",
        signal: { overlaid: true },
        observedAt: "2026-04-20T00:05:00Z",
      }),
    ).rejects.toThrow(/overlay update boom/);
    expect(failed).toEqual([{ phase: "status_upsert", key: "smoke:mastra" }]);
    // Update-first ordering: NO audit row landed for the failed overlay.
    expect(env.history).toHaveLength(0);
  });

  it("does NOT accumulate duplicate history rows when a persistent non-404 update failure is retried (A4 round 6)", async () => {
    // Red-green (round-6 A4): history-first ordering created the audit row
    // BEFORE the update, so a persistent non-404 pb.update failure
    // re-landed one history row per consumer retry, unbounded. With
    // update-first, retries persist nothing until the update succeeds.
    seedRedRow();
    const pb: PbClient = {
      ...env.pb,
      async update(): Promise<never> {
        const err = new Error("PB 5xx") as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      },
    };
    const writer = createStatusWriter({
      pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        writer.writeOverlay({
          key: "smoke:mastra",
          signal: { overlaid: true },
          observedAt: "2026-04-20T00:05:00Z",
        }),
      ).rejects.toThrow(/PB 5xx/);
    }
    // Zero audit rows across all retries — not one per attempt.
    expect(env.history).toHaveLength(0);
  });

  it("validates the row's state before the history create — corrupt state gets a schema placeholder, not a PB 400 (A4)", async () => {
    // Red-green (round-4 A4): doWriteOverlay wrote the RAW `existing.state`
    // into the status_history create. status_history.state is a required
    // select (green|red|degraded), so a corrupt row value made PB 400 the
    // history create, writer.failed fired, the throw bubbled, and the
    // whole overlay was lost. Fix: validate; unknown state → "green"
    // schema placeholder in the history row (same F2b posture as the
    // error path) + warn, outcome.state degrades to null.
    seedRedRow({ state: "blue" as unknown as StatusRecord["state"] });
    const warns: Array<{ msg: string; obj?: unknown }> = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warns.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });
    // The overlay still lands (the whole point of the fix)…
    expect(outcome.applied).toBe(true);
    // …but the unvalidatable state is not echoed back as a State.
    expect(outcome.state).toBeNull();
    const row = env.rows.get("smoke:mastra")!;
    expect((row.signal as Record<string, unknown>).overlaid).toBe(true);
    // The history row carries the schema placeholder, never the corrupt
    // value (which real PB would 400 on).
    expect(env.history).toHaveLength(1);
    expect((env.history[0] as Record<string, unknown>).state).toBe("green");
    expect(
      warns.filter((w) => w.msg === "status-writer.corrupt-state-read"),
    ).toHaveLength(1);
  });

  it("dedupes the corrupt-state-read warn per key across repeated overlays (A6 round 5)", async () => {
    // Red-green (round-5 A6i): an overlay never repairs the row's durable
    // state, so a corrupt value re-warned on EVERY overlay tick
    // indefinitely. Routed through the bounded-set dedup machinery.
    seedRedRow({ state: "blue" as unknown as StatusRecord["state"] });
    const warns: Array<{ msg: string }> = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string) => warns.push({ msg }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: 1 },
      observedAt: "2026-04-20T00:05:00Z",
    });
    await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: 2 },
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(
      warns.filter((w) => w.msg === "status-writer.corrupt-state-read"),
    ).toHaveLength(1);
  });

  it("degrades to applied:false when the row is deleted between read and update (A3 TOCTOU)", async () => {
    // Red-green (round-4 A3): a row deleted between getFirst and pb.update
    // made the update throw a 404 — classifyWriterError had no 404 branch
    // (→ "unknown") and doWriteOverlay rethrew, rejecting the WHOLE
    // overlay instead of degrading to the documented row-miss fallback
    // ({ applied: false, state: null }, which routes the caller through
    // the error-state write() path).
    seedRedRow();
    class PbNotFoundError extends Error {
      statusCode = 404;
    }
    const pb: PbClient = {
      ...env.pb,
      async update(): Promise<never> {
        // Simulate the concurrent delete: the row read by getFirst is gone
        // by the time the field-scoped update lands.
        env.rows.delete("smoke:mastra");
        throw new PbNotFoundError("The requested resource wasn't found.");
      },
    };
    const bus = createEventBus();
    const failed: unknown[] = [];
    bus.on("writer.failed", (e) => failed.push(e));
    const warns: Array<{ msg: string; obj?: unknown }> = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warns.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const writer = createStatusWriter({
      pb,
      bus,
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    // Must RESOLVE with the documented row-miss fallback, not reject.
    const outcome = await writer.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });
    // A4 (round 6, supersedes the round-5 A3 shape): update-first ordering
    // means NOTHING persisted on the vanished-404 leg — no history row
    // landed before the failed update, so historyPersisted is false and
    // the caller's fallback error-write now legitimately records the tick
    // (exactly ONE history row, written by the caller).
    expect(outcome).toEqual({
      applied: false,
      state: null,
      historyPersisted: false,
    });
    expect(env.history).toHaveLength(0);
    // The vanished row is loud (warn), but it is the documented fallback
    // path — not a writer failure.
    expect(
      warns.filter((w) => w.msg === "status-writer.overlay-row-vanished"),
    ).toHaveLength(1);
    expect(failed).toHaveLength(0);
  });

  it("returns applied:false and persists NOTHING for a never-observed key", async () => {
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    const outcome = await writer.writeOverlay({
      key: "smoke:never-seen",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });
    expect(outcome).toEqual({
      applied: false,
      state: null,
      historyPersisted: false,
    });
    // A4 (round 6): genuine row-miss — NO history row was written;
    // historyPersisted is stamped false (truthful, no absence-encoding) so
    // the caller's fallback history write proceeds.
    expect(env.rows.size).toBe(0);
    expect(env.history).toHaveLength(0);
  });

  it("does not transfer attribution: the original writer's later genuine flip stays warn-free", async () => {
    // The wrong-baseline corruption: pre-H1, a cross-writer overlay re-write
    // restamped written_by, so the ORIGINAL writer's next genuine flip read as
    // a cross-writer fight. With writeOverlay the attribution never moves.
    seedRedRow();
    const warns: string[] = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string) => warns.push(msg),
      error: () => {},
      debug: () => {},
    };
    const fleetWriter = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    await fleetWriter.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });

    const legacyWriter = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: capturingLogger,
      writtenBy: "legacy",
    });
    await legacyWriter.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(
      warns.filter((m) => m === "status-writer.cross-writer-flip"),
    ).toHaveLength(0);
  });

  it("windows a post-overlay cross-writer flip against the durable write, not the overlay (A1×A2)", async () => {
    // Composition of the flip-window fix (state_written_at) with the H1
    // overlay path: a recent overlay refreshes observed_at but must not
    // refresh state_written_at, so a cross-writer flip over a months-old
    // durable state stays warn-free even when an overlay landed minutes ago.
    const warns: string[] = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string) => warns.push(msg),
      error: () => {},
      debug: () => {},
    };
    seedRedRow({
      observed_at: "2026-01-20T00:00:00Z",
      state_written_at: "2026-01-20T00:00:00Z",
      transitioned_at: "2026-01-20T00:00:00Z",
    });
    const fleetWriter = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    // Overlay minutes before the flip: refreshes observed_at only.
    await fleetWriter.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:08:00Z",
    });
    // Cross-writer green flip 2min after the overlay, months after the
    // durable write — stale handoff, not a fight.
    await fleetWriter.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(
      warns.filter((m) => m === "status-writer.cross-writer-flip"),
    ).toHaveLength(0);
  });

  it("still warns on a cross-writer flip soon after a recent durable write, overlay or not (A1×A2 positive control)", async () => {
    const warns: string[] = [];
    const capturingLogger = {
      info: () => {},
      warn: (msg: string) => warns.push(msg),
      error: () => {},
      debug: () => {},
    };
    seedRedRow(); // durable write (state_written_at) at 00:00
    const fleetWriter = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger: capturingLogger,
      writtenBy: "fleet-cp",
    });
    await fleetWriter.writeOverlay({
      key: "smoke:mastra",
      signal: { overlaid: true },
      observedAt: "2026-04-20T00:05:00Z",
    });
    await fleetWriter.write({
      ...probeResult("green"),
      observedAt: "2026-04-20T00:10:00Z",
    });
    expect(
      warns.filter((m) => m === "status-writer.cross-writer-flip"),
    ).toHaveLength(1);
  });
});

describe("fakePb test-infra invariants (round-9 #8)", () => {
  let env: ReturnType<typeof fakePb>;
  beforeEach(() => {
    env = fakePb();
  });

  it("dateValidatingPb rejects a known-PB-rejected colonless-offset literal (round-9 #8a divergence canary)", async () => {
    // LITERAL canary, deliberately not derived from any regex: real PB is
    // known to 400 a colonless RFC-822-style offset. If either PB_DATE_SHAPE
    // copy (source passthrough or fixture acceptance) regresses to accepting
    // it, this fails — breaking the fixture/source circularity for at least
    // this known-divergent input.
    await expect(
      dateValidatingPb(env).create("status_history", {
        key: "smoke:mastra",
        observed_at: "2026-04-20T02:30:00+0230",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("fakePb.getFirst resolves keys whose JSON filter literal carries escapes (round-9 #8b)", async () => {
    // Red-green (round-9 #8b): the writer's filter is
    // `key = ${JSON.stringify(key)}`, so keys containing `"` or `\` arrive
    // JSON-escaped — the old `([^"]*)` capture either threw "unrecognized
    // filter" (embedded quote) or matched the ESCAPED form (backslash),
    // silently modelling row-not-found for a row that exists. Same
    // JSON.parse-the-quoted-segment pattern as dimensions.test.ts.
    const writer = createStatusWriter({
      pb: env.pb,
      bus: createEventBus(),
      logger,
      writtenBy: "fleet-cp",
    });
    const key = 'smoke:we"ird\\slug';
    await writer.write({ ...probeResult("green"), key });
    const out = await writer.write({ ...probeResult("green"), key });
    // The second write must SEE the first row — verbatim-escape capture
    // missed it and reported "first" again.
    expect(out.transition).toBe("sustained_green");
    expect(env.rows.get(key)?.state).toBe("green");
  });

  it("fakePb.update rejects 404-shaped for unknown ids instead of fabricating success (round-9 #8c)", async () => {
    // Real PB 404s an update against a missing row; silently resolving made
    // the fake immune to TOCTOU-class writer bugs.
    await expect(
      env.pb.update("status", "no-such-id", { signal: {} }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("fakePb.create ids stay unique after a row delete (round-9 #8d)", async () => {
    // `r-${rows.size + 1}` re-issues an existing id after any delete; the
    // counter must be monotonic.
    await env.pb.create("status", { key: "smoke:a" });
    const b = (await env.pb.create("status", {
      key: "smoke:b",
    })) as StatusRecord;
    env.rows.delete("smoke:a");
    const c = (await env.pb.create("status", {
      key: "smoke:c",
    })) as StatusRecord;
    expect(c.id).not.toBe(b.id);
  });
});
