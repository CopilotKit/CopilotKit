import { describe, expect, it } from "vitest";
import { runStateStoreConformance } from "@copilotkit/channels-core/testing";
import type { RedisStore } from "./redis-store.js";
import { createRedisStore } from "./redis-store.js";
import { createFakeRedisClient } from "./__tests__/fake-redis-client.js";

const uniquePrefix = () => `t:${Math.random().toString(36).slice(2)}:`;

// Hermetic run: the full contract against an in-memory Redis (ioredis-mock,
// which also runs the store's Lua scripts).
runStateStoreConformance("RedisStore (in-memory Redis)", () =>
  createRedisStore({
    client: createFakeRedisClient().client,
    keyPrefix: uniquePrefix(),
  }),
);

// Live run: set TEST_REDIS_URL (e.g. redis://localhost:6379) to run the same
// contract against a real server. Each store gets a unique prefix so repeat
// runs don't collide, and the store closes its own connection on teardown.
const url = process.env.TEST_REDIS_URL;
(url ? describe : describe.skip)("RedisStore (live Redis)", () => {
  runStateStoreConformance(
    "RedisStore",
    () => createRedisStore({ url, keyPrefix: uniquePrefix() }),
    async (s) => {
      await (s as RedisStore).quit();
    },
  );
});

describe("RedisStore", () => {
  it("namespaces every key under keyPrefix", async () => {
    const fake = createFakeRedisClient();
    const store = createRedisStore({ client: fake.client, keyPrefix: "app:" });
    await store.kv.set("k", { n: 1 });
    await store.list.append("l", "x");
    await store.queue.enqueue("q", 1);
    await store.lock.acquire("k");
    await store.dedup.seen("e", 1000);

    expect((await fake.raw.keys("*")).sort()).toEqual([
      "app:dedup:e",
      "app:k",
      "app:l",
      "app:lock:k",
      "app:q",
    ]);
    expect(await fake.raw.get("app:k")).toBe('{"n":1}');
  });

  it("defaults keyPrefix to cpk:", async () => {
    const fake = createFakeRedisClient();
    await createRedisStore({ client: fake.client }).kv.set("k", 1);
    expect(await fake.raw.keys("*")).toEqual(["cpk:k"]);
  });

  it("keeps stores with different prefixes apart on one server", async () => {
    const fake = createFakeRedisClient();
    const a = createRedisStore({ client: fake.client, keyPrefix: "a:" });
    const b = createRedisStore({ client: fake.client, keyPrefix: "b:" });
    await a.kv.set("k", "from-a");
    expect(await b.kv.get("k")).toBeUndefined();
    expect(await b.lock.acquire("k")).not.toBeNull();
    expect(await a.lock.acquire("k")).not.toBeNull();
  });

  it("sets a TTL on the whole list when append gets ttlMs", async () => {
    const fake = createFakeRedisClient();
    const store = createRedisStore({ client: fake.client, keyPrefix: "p:" });
    await store.list.append("l", "a");
    expect(await fake.raw.pttl("p:l")).toBe(-1);
    await store.list.append("l", "b", { ttlMs: 5_000 });
    const ttl = await fake.raw.pttl("p:l");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5_000);
  });

  it("gives a default 30s TTL to a lock acquired without ttlMs", async () => {
    const fake = createFakeRedisClient();
    const store = createRedisStore({ client: fake.client, keyPrefix: "p:" });
    await store.lock.acquire("k");
    const ttl = await fake.raw.pttl("p:lock:k");
    expect(ttl).toBeGreaterThan(29_000);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it("reports the queue length enqueue returns, including when full", async () => {
    const fake = createFakeRedisClient();
    const store = createRedisStore({ client: fake.client, keyPrefix: "p:" });
    expect(await store.queue.enqueue("q", 1, { maxSize: 2 })).toBe(1);
    expect(await store.queue.enqueue("q", 2, { maxSize: 2 })).toBe(2);
    expect(
      await store.queue.enqueue("q", 3, { maxSize: 2, onFull: "drop-newest" }),
    ).toBe(2);
    expect(await store.queue.enqueue("q", 4, { maxSize: 2 })).toBe(2);
    expect(await fake.raw.lrange("p:q", 0, -1)).toEqual(["2", "4"]);
  });

  it("names the key when a stored value is not JSON", async () => {
    const fake = createFakeRedisClient();
    const store = createRedisStore({ client: fake.client, keyPrefix: "p:" });
    await fake.raw.set("p:bad", "{not json");
    await expect(store.kv.get("bad")).rejects.toThrow(
      'channels-store-redis: failed to parse stored value for key "bad"',
    );
    await expect(store.kv.consume("bad")).rejects.toThrow(/key "bad"/);
  });

  it("does not quit a client it did not create", async () => {
    const fake = createFakeRedisClient();
    await createRedisStore({ client: fake.client }).quit();
    expect(fake.quitCalls()).toBe(0);
  });
});
