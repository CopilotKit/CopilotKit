import { describe, it, expect, beforeEach } from "vitest";
import { createStatusWriter } from "./status-writer.js";
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
  const pb: PbClient = {
    async getOne() {
      return null;
    },
    async getFirst<T>(collection: string, filter: string): Promise<T | null> {
      if (collection !== "status") return null;
      const match = filter.match(/key = "(.+)"/);
      if (!match) return null;
      const r = rows.get(match[1]!);
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
        const id = `r-${rows.size + 1}`;
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
      return record as unknown as T;
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
    expect(out.newState).toBe("red"); // carried forward
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

  it("writes history BEFORE status (history-first ordering)", async () => {
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
    // status_history must come before status.
    const historyIdx = writeOrder.indexOf("create:status_history");
    const statusIdx = writeOrder.indexOf("upsert:status");
    expect(historyIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(historyIdx).toBeLessThan(statusIdx);
  });

  it("emits writer.failed when status upsert throws", async () => {
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
      async update<T>() {
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

  it("emits writer.failed when history_create throws (non-error path)", async () => {
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
    bus.on("writer.failed", (e) => {
      failed.push({ phase: e.phase });
    });
    const writer = createStatusWriter({ pb, bus, logger });
    await expect(writer.write(probeResult("green"))).rejects.toThrow(
      /history boom/,
    );
    expect(failed).toEqual([{ phase: "history_create" }]);
  });
});
