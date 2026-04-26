import { describe, it, expect, beforeEach } from "vitest";
import {
  PROBE_RUNS_COLLECTION,
  createProbeRunWriter,
  type ProbeRunRecord,
} from "./run-history.js";
import type { PbClient, ListOpts, ListResult } from "../storage/pb-client.js";

/**
 * Fake PbClient that stores rows in-memory and supports the subset of
 * methods run-history.ts uses. Mirrors the pattern in
 * status-writer.test.ts's `fakePb()` so reviewers don't have to context-
 * switch between two unrelated test fixtures.
 */
function fakePb(): {
  pb: PbClient;
  rows: Map<string, Record<string, unknown> & { id: string }>;
  createCalls: Array<{ collection: string; record: Record<string, unknown> }>;
  updateCalls: Array<{
    collection: string;
    id: string;
    record: Record<string, unknown>;
  }>;
  listCalls: Array<{ collection: string; opts?: ListOpts }>;
} {
  const rows = new Map<string, Record<string, unknown> & { id: string }>();
  const createCalls: Array<{
    collection: string;
    record: Record<string, unknown>;
  }> = [];
  const updateCalls: Array<{
    collection: string;
    id: string;
    record: Record<string, unknown>;
  }> = [];
  const listCalls: Array<{ collection: string; opts?: ListOpts }> = [];
  let nextId = 1;
  const pb: PbClient = {
    async getOne<T>(_collection: string, id: string): Promise<T | null> {
      const r = rows.get(id);
      return (r as unknown as T) ?? null;
    },
    async getFirst<T>(): Promise<T | null> {
      return null;
    },
    async list<T>(
      collection: string,
      opts?: ListOpts,
    ): Promise<ListResult<T>> {
      listCalls.push({ collection, opts });
      // Honor filter (`probe_id = "..."`) and sort (`-started_at`) plus perPage.
      let items = [...rows.values()];
      if (opts?.filter) {
        const m = opts.filter.match(/probe_id\s*=\s*"([^"]+)"/);
        if (m) {
          items = items.filter((r) => r.probe_id === m[1]);
        }
      }
      if (opts?.sort) {
        // Only the inverted-started_at sort is exercised in tests.
        const desc = opts.sort.startsWith("-");
        const field = desc ? opts.sort.slice(1) : opts.sort;
        items.sort((a, b) => {
          const av = String(a[field] ?? "");
          const bv = String(b[field] ?? "");
          if (av < bv) return desc ? 1 : -1;
          if (av > bv) return desc ? -1 : 1;
          return 0;
        });
      }
      const perPage = opts?.perPage ?? items.length;
      const sliced = items.slice(0, perPage);
      return {
        page: 1,
        perPage,
        totalPages: 1,
        totalItems: sliced.length,
        items: sliced as unknown as T[],
      };
    },
    async create<T>(
      collection: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      createCalls.push({ collection, record });
      const id = `r-${nextId++}`;
      const row = { ...record, id };
      rows.set(id, row);
      return row as unknown as T;
    },
    async update<T>(
      collection: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      updateCalls.push({ collection, id, record });
      const existing = rows.get(id);
      if (!existing) throw new Error(`fake-pb: missing row ${id}`);
      const merged = { ...existing, ...record };
      rows.set(id, merged);
      return merged as unknown as T;
    },
    async upsertByField() {
      throw new Error("not used");
    },
    async delete() {},
    async deleteByFilter() {
      return 0;
    },
    async createBackup() {},
    async downloadBackup() {
      return new Uint8Array();
    },
    async deleteBackup() {},
    async health() {
      return true;
    },
  };
  return { pb, rows, createCalls, updateCalls, listCalls };
}

describe("run-history", () => {
  it("exports the canonical collection name", () => {
    // Stable contract — B3 (status route) and B7 (probe-invoker hook)
    // both import this constant, so the literal must not drift.
    expect(PROBE_RUNS_COLLECTION).toBe("probe_runs");
  });

  describe("start()", () => {
    let fake: ReturnType<typeof fakePb>;
    beforeEach(() => {
      fake = fakePb();
    });

    it("inserts a row with state='running' and no finished_at", async () => {
      const writer = createProbeRunWriter(fake.pb);
      const startedAtMs = Date.UTC(2026, 3, 25, 12, 0, 0);
      const result = await writer.start({
        probeId: "smoke",
        startedAt: startedAtMs,
        triggered: false,
      });
      expect(result.id).toBe("r-1");
      expect(fake.createCalls).toHaveLength(1);
      const call = fake.createCalls[0]!;
      expect(call.collection).toBe(PROBE_RUNS_COLLECTION);
      expect(call.record).toMatchObject({
        probe_id: "smoke",
        started_at: new Date(startedAtMs).toISOString(),
        state: "running",
        triggered: false,
      });
      expect(call.record.finished_at).toBeNull();
      expect(call.record.duration_ms).toBeNull();
      expect(call.record.summary).toBeNull();
    });

    it("threads the triggered flag through to the row", async () => {
      const writer = createProbeRunWriter(fake.pb);
      await writer.start({
        probeId: "e2e",
        startedAt: 1_700_000_000_000,
        triggered: true,
      });
      expect(fake.createCalls[0]!.record.triggered).toBe(true);
    });
  });

  describe("finish()", () => {
    let fake: ReturnType<typeof fakePb>;
    beforeEach(() => {
      fake = fakePb();
    });

    it("updates the row with finished_at, duration_ms, state and summary", async () => {
      const writer = createProbeRunWriter(fake.pb);
      const startedAtMs = Date.UTC(2026, 3, 25, 12, 0, 0);
      const finishedAtMs = startedAtMs + 4321;
      const { id } = await writer.start({
        probeId: "smoke",
        startedAt: startedAtMs,
        triggered: true,
      });
      await writer.finish({
        id,
        finishedAt: finishedAtMs,
        state: "completed",
        summary: { total: 17, passed: 16, failed: 1, services: ["a", "b"] },
      });
      expect(fake.updateCalls).toHaveLength(1);
      const u = fake.updateCalls[0]!;
      expect(u.collection).toBe(PROBE_RUNS_COLLECTION);
      expect(u.id).toBe(id);
      expect(u.record).toMatchObject({
        finished_at: new Date(finishedAtMs).toISOString(),
        state: "completed",
        duration_ms: 4321,
        summary: { total: 17, passed: 16, failed: 1, services: ["a", "b"] },
      });
    });

    it("supports state='failed' with summary", async () => {
      const writer = createProbeRunWriter(fake.pb);
      const { id } = await writer.start({
        probeId: "smoke",
        startedAt: 1000,
        triggered: false,
      });
      await writer.finish({
        id,
        finishedAt: 1500,
        state: "failed",
        summary: { total: 3, passed: 0, failed: 3 },
      });
      const u = fake.updateCalls[0]!;
      expect(u.record.state).toBe("failed");
      expect(u.record.duration_ms).toBe(500);
    });

    it("computes duration_ms from finishedAt - startedAt of the row", async () => {
      // The writer must read the persisted started_at when computing
      // duration so that the contract holds even if the caller passes a
      // finishedAt clock that drifted from the started_at clock (the
      // happy-path uses the same monotonic source, but the contract must
      // be defined off the row, not off a parameter the caller could
      // forget). Spec: duration_ms = finishedAt - row.started_at.
      const writer = createProbeRunWriter(fake.pb);
      const startedAtMs = 10_000;
      const { id } = await writer.start({
        probeId: "smoke",
        startedAt: startedAtMs,
        triggered: false,
      });
      await writer.finish({
        id,
        finishedAt: 13_500,
        state: "completed",
        summary: { total: 1, passed: 1, failed: 0 },
      });
      expect(fake.updateCalls[0]!.record.duration_ms).toBe(3500);
    });
  });

  describe("recent()", () => {
    it("filters by probe_id, sorts started_at desc, and caps at limit", async () => {
      const fake = fakePb();
      const writer = createProbeRunWriter(fake.pb);
      // Seed three smoke runs at distinct times + one e2e run.
      await writer.start({
        probeId: "smoke",
        startedAt: 1000,
        triggered: false,
      });
      await writer.start({
        probeId: "smoke",
        startedAt: 3000,
        triggered: false,
      });
      await writer.start({
        probeId: "smoke",
        startedAt: 2000,
        triggered: false,
      });
      await writer.start({
        probeId: "e2e",
        startedAt: 9999,
        triggered: false,
      });
      const recent = await writer.recent("smoke", 2);
      expect(recent).toHaveLength(2);
      expect(recent[0]!.probeId).toBe("smoke");
      expect(recent[1]!.probeId).toBe("smoke");
      // started_at desc — newest first.
      expect(recent[0]!.startedAt).toBe(new Date(3000).toISOString());
      expect(recent[1]!.startedAt).toBe(new Date(2000).toISOString());
      // The list call must escape the probe_id filter value to defend
      // against probe ids that contain quotes (PB filter syntax accepts
      // string-quoted literals). We assert the filter shape below.
      const lastList = fake.listCalls.at(-1)!;
      expect(lastList.collection).toBe(PROBE_RUNS_COLLECTION);
      expect(lastList.opts?.filter).toBe('probe_id = "smoke"');
      expect(lastList.opts?.sort).toBe("-started_at");
      expect(lastList.opts?.perPage).toBe(2);
    });

    it("returns ProbeRunRecord shape (camelCase fields)", async () => {
      const fake = fakePb();
      const writer = createProbeRunWriter(fake.pb);
      const { id } = await writer.start({
        probeId: "smoke",
        startedAt: 5_000,
        triggered: true,
      });
      await writer.finish({
        id,
        finishedAt: 5_750,
        state: "completed",
        summary: { total: 4, passed: 4, failed: 0 },
      });
      const [row] = await writer.recent("smoke", 5);
      const expected: ProbeRunRecord = {
        id,
        probeId: "smoke",
        startedAt: new Date(5_000).toISOString(),
        finishedAt: new Date(5_750).toISOString(),
        durationMs: 750,
        triggered: true,
        state: "completed",
        summary: { total: 4, passed: 4, failed: 0 },
      };
      expect(row).toEqual(expected);
    });

    it("returns empty array when no rows match", async () => {
      const fake = fakePb();
      const writer = createProbeRunWriter(fake.pb);
      const recent = await writer.recent("never-ran", 10);
      expect(recent).toEqual([]);
    });
  });
});
