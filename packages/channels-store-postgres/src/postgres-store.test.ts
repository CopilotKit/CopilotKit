import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { runStateStoreConformance } from "@copilotkit/channels-core/testing";
import type { PostgresStore } from "./postgres-store.js";
import { createPostgresStore, migrate, SCHEMA_SQL } from "./postgres-store.js";
import { PglitePool } from "./__tests__/pglite-pool.js";

// All stores in a run share the same tables, and the conformance suite reuses
// fixed keys ("a", "k", "L", "q", …) across tests. A unique keyPrefix per
// store namespaces those keys so they never collide across tests.
const uniquePrefix = () => `t:${Math.random().toString(36).slice(2)}:`;

// Hermetic run: the full contract against PGlite (real Postgres in WASM). One
// database for the whole file; starting one takes about a second.
let shared: Promise<PglitePool> | undefined;
const sharedPool = () => (shared ??= PglitePool.create());
afterAll(async () => {
  await (await shared)?.end();
});

runStateStoreConformance("PostgresStore (PGlite)", async () =>
  createPostgresStore({
    pool: (await sharedPool()).asPool(),
    autoMigrate: true,
    keyPrefix: uniquePrefix(),
  }),
);

// Live run: set TEST_POSTGRES_URL (e.g. postgres://user:pw@localhost:5432/db)
// to run the same contract against a real server. The store closes its own
// pool on teardown.
const url = process.env.TEST_POSTGRES_URL;
(url ? describe : describe.skip)("PostgresStore (live Postgres)", () => {
  runStateStoreConformance(
    "PostgresStore",
    () =>
      createPostgresStore({
        connectionString: url,
        autoMigrate: true,
        keyPrefix: uniquePrefix(),
      }),
    async (s) => {
      await (s as PostgresStore).end();
    },
  );
});

async function count(pool: PglitePool, table: string, prefix: string) {
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE key LIKE $1`,
    [`${prefix}%`],
  );
  return (res.rows[0] as { n: number }).n;
}

describe("PostgresStore", () => {
  it("keeps schema.sql in sync with the schema migrate() runs", () => {
    const file = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    expect(file.trim()).toBe(SCHEMA_SQL.trim());
  });

  it("migrate() is idempotent", async () => {
    const pool = await sharedPool();
    await migrate(pool.asPool());
    await migrate(pool.asPool());
    const res = await pool.query(
      "SELECT tablename FROM pg_tables WHERE tablename LIKE 'cpk_state_%' ORDER BY tablename",
    );
    expect(res.rows.map((r) => (r as { tablename: string }).tablename)).toEqual(
      ["cpk_state_kv", "cpk_state_list", "cpk_state_queue"],
    );
  });

  it("does not create tables unless autoMigrate is set", async () => {
    const pool = await PglitePool.create();
    try {
      const store = createPostgresStore({ pool: pool.asPool() });
      await expect(store.kv.get("k")).rejects.toThrow(/cpk_state_kv/);
      await migrate(pool.asPool());
      expect(await store.kv.get("k")).toBeUndefined();
    } finally {
      await pool.end();
    }
  });

  it("namespaces every key under keyPrefix", async () => {
    const pool = await sharedPool();
    const prefix = uniquePrefix();
    const store = createPostgresStore({
      pool: pool.asPool(),
      autoMigrate: true,
      keyPrefix: prefix,
    });
    await store.kv.set("k", { n: 1 });
    await store.lock.acquire("k");
    await store.dedup.seen("e", 1000);
    await store.list.append("l", "x");
    await store.queue.enqueue("q", 1);

    const kv = await pool.query(
      "SELECT key, value FROM cpk_state_kv WHERE key LIKE $1 ORDER BY key",
      [`${prefix}%`],
    );
    expect(kv.rows).toEqual([
      { key: `${prefix}dedup:e`, value: 1 },
      { key: `${prefix}k`, value: { n: 1 } },
      { key: `${prefix}lock:k`, value: expect.any(String) },
    ]);
    expect(await count(pool, "cpk_state_list", prefix)).toBe(1);
    expect(await count(pool, "cpk_state_queue", prefix)).toBe(1);
  });

  it("keeps stores with different prefixes apart on one database", async () => {
    const pool = (await sharedPool()).asPool();
    const a = createPostgresStore({ pool, autoMigrate: true, keyPrefix: "a:" });
    const b = createPostgresStore({ pool, autoMigrate: true, keyPrefix: "b:" });
    await a.kv.set("iso", "from-a");
    await a.queue.enqueue("iso", 1);
    expect(await b.kv.get("iso")).toBeUndefined();
    expect(await b.queue.depth("iso")).toBe(0);
    await a.kv.delete("iso");
    await a.queue.dequeue("iso");
  });

  it("gives a default 30s TTL to a lock acquired without ttlMs", async () => {
    const pool = await sharedPool();
    const prefix = uniquePrefix();
    const store = createPostgresStore({
      pool: pool.asPool(),
      autoMigrate: true,
      keyPrefix: prefix,
    });
    const before = Date.now();
    await store.lock.acquire("k");
    const res = await pool.query(
      "SELECT expires_at FROM cpk_state_kv WHERE key = $1",
      [`${prefix}lock:k`],
    );
    const expiresAt = new Date(
      (res.rows[0] as { expires_at: Date }).expires_at,
    ).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(30_000);
    expect(expiresAt - before).toBeLessThan(31_000);
  });

  it("reports the queue length enqueue returns, including when full", async () => {
    const pool = (await sharedPool()).asPool();
    const store = createPostgresStore({
      pool,
      autoMigrate: true,
      keyPrefix: uniquePrefix(),
    });
    expect(await store.queue.enqueue("q", 1, { maxSize: 2 })).toBe(1);
    expect(await store.queue.enqueue("q", 2, { maxSize: 2 })).toBe(2);
    expect(
      await store.queue.enqueue("q", 3, { maxSize: 2, onFull: "drop-newest" }),
    ).toBe(2);
    expect(await store.queue.enqueue("q", 4, { maxSize: 2 })).toBe(2);
    expect(await store.queue.dequeue("q")).toBe(2);
    expect(await store.queue.dequeue("q")).toBe(4);
  });

  it("sweepExpired removes expired kv and list rows and keeps live ones", async () => {
    const pool = await sharedPool();
    const prefix = uniquePrefix();
    const store = createPostgresStore({
      pool: pool.asPool(),
      autoMigrate: true,
      keyPrefix: prefix,
    });
    await store.kv.set("old", 1, 20);
    await store.kv.set("live", 1);
    await store.list.append("old-list", "x", { ttlMs: 20 });
    await store.list.append("live-list", "x");
    await new Promise((r) => setTimeout(r, 40));

    await store.sweepExpired();

    expect(await count(pool, "cpk_state_kv", prefix)).toBe(1);
    expect(await count(pool, "cpk_state_list", prefix)).toBe(1);
    expect(await store.kv.get("live")).toBe(1);
    expect(await store.list.range("live-list")).toEqual(["x"]);
  });

  it("does not end a pool it did not create", async () => {
    const pool = await sharedPool();
    await createPostgresStore({ pool: pool.asPool() }).end();
    expect(pool.ended).toBe(false);
  });
});
