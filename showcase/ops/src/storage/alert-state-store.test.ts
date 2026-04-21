/**
 * Tests for the alert-state-store. Exercises the TOCTOU race path where
 * two concurrent record() calls both see no existing row and both try to
 * create — the loser must recover via update, not throw.
 */
import { describe, it, expect } from "vitest";
import { createAlertStateStore } from "./alert-state-store.js";
import type { PbClient } from "./pb-client.js";
import type { AlertStateRecord } from "../types/index.js";

function makeFakePb(overrides: Partial<PbClient> = {}): PbClient {
  const base: PbClient = {
    getOne: async () => null,
    getFirst: async () => null,
    list: async () => ({
      page: 1,
      perPage: 200,
      totalPages: 1,
      totalItems: 0,
      items: [],
    }),
    create: async () => ({}) as never,
    update: async () => ({}) as never,
    upsertByField: async () => ({}) as never,
    delete: async () => {},
    deleteByFilter: async () => 0,
    health: async () => true,
  };
  return { ...base, ...overrides };
}

describe("alert-state-store.record", () => {
  it("recovers from TOCTOU race by updating when create hits unique constraint", async () => {
    // Simulate the race: getFirst returns null (no row), we try to
    // create, PB rejects with the unique-index error because another
    // worker beat us, we re-read and see the racer's row, then update.
    let getFirstCalls = 0;
    let createCalls = 0;
    let updateCalls = 0;
    const racer: AlertStateRecord = {
      id: "row-1",
      rule_id: "rule-a",
      dedupe_key: "key-a",
      last_alert_at: "2026-04-20T00:00:00Z",
      last_alert_hash: "old",
      payload_preview: "old",
    };
    const pb = makeFakePb({
      async getFirst<T>() {
        getFirstCalls += 1;
        // First call (before create): no row.
        // Second call (after unique-constraint error): the racer's row.
        return (getFirstCalls === 1 ? null : (racer as unknown as T)) as T;
      },
      async create() {
        createCalls += 1;
        throw new Error(
          'validation_not_unique: {"data":{"rule_id":{"code":"validation_not_unique"}}}',
        );
      },
      async update<T>(_collection: string, id: string, record: unknown) {
        updateCalls += 1;
        expect(id).toBe("row-1");
        return { id, ...(record as object) } as T;
      },
    });
    const store = createAlertStateStore(pb);
    await expect(
      store.record("rule-a", "key-a", {
        at: "2026-04-20T00:01:00Z",
        hash: "new",
        preview: "preview",
      }),
    ).resolves.toBeUndefined();
    expect(getFirstCalls).toBe(2);
    expect(createCalls).toBe(1);
    expect(updateCalls).toBe(1);
  });

  it("propagates non-unique errors from create", async () => {
    const pb = makeFakePb({
      async getFirst() {
        return null;
      },
      async create() {
        throw new Error("pb create failed: 500 something unrelated");
      },
    });
    const store = createAlertStateStore(pb);
    await expect(
      store.record("rule-a", "key-a", {
        at: "2026-04-20T00:00:00Z",
        hash: "h",
        preview: "p",
      }),
    ).rejects.toThrow(/500 something unrelated/);
  });

  it("truncates preview to 500 chars", async () => {
    let createdPreview: string | null = null;
    const pb = makeFakePb({
      async getFirst() {
        return null;
      },
      async create<T>(_c: string, record: Record<string, unknown>) {
        createdPreview = (record as { payload_preview: string })
          .payload_preview;
        return { id: "new" } as T;
      },
    });
    const store = createAlertStateStore(pb);
    await store.record("r", "k", {
      at: "2026-04-20T00:00:00Z",
      hash: "h",
      preview: "x".repeat(1000),
    });
    expect(createdPreview).not.toBeNull();
    expect(createdPreview!.length).toBe(500);
  });

  it("putSet stores under the __set__ dedupe key", async () => {
    const seen: Array<{ filter: string }> = [];
    const pb = makeFakePb({
      async getFirst(_c, filter) {
        seen.push({ filter });
        return null;
      },
      async create<T>() {
        return { id: "new" } as T;
      },
    });
    const store = createAlertStateStore(pb);
    await store.putSet("rule-x", "hash-x", "2026-04-20T00:00:00Z");
    expect(seen[0]!.filter).toContain('dedupe_key = "__set__"');
  });
});
