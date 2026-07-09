import { test, expect } from "vitest";
import { runStateStoreConformance } from "@copilotkit/channels/testing";
import { IntelligenceStateStore } from "./intelligence-state-store.js";
import type { FetchLike } from "./http-transports.js";

/**
 * A fake `/api/bots/kv/*` server over an in-memory Map, honoring TTL the same
 * way app-api does (lazy expiry on read). Lets the full StateStore conformance
 * suite run against IntelligenceStateStore: `kv` exercises this HTTP layer;
 * list/lock/dedup/queue exercise the delegated in-memory MemoryStore.
 */
function fakeKvFetch(): FetchLike {
  const map = new Map<string, { value: unknown; expiresAt?: number }>();
  const live = (e?: { expiresAt?: number }): boolean =>
    !!e && (e.expiresAt === undefined || Date.now() <= e.expiresAt);
  return async (url, init) => {
    const body = JSON.parse(init.body) as {
      key: string;
      value?: unknown;
      ttlMs?: number;
    };
    let payload: unknown = { ok: true };
    if (url.endsWith("/api/bots/kv/get")) {
      const e = map.get(body.key);
      if (!live(e)) {
        map.delete(body.key);
        payload = { value: null };
      } else {
        payload = { value: e!.value };
      }
    } else if (url.endsWith("/api/bots/kv/set")) {
      map.set(body.key, {
        value: body.value,
        expiresAt: body.ttlMs ? Date.now() + body.ttlMs : undefined,
      });
    } else if (url.endsWith("/api/bots/kv/delete")) {
      map.delete(body.key);
    }
    const text = JSON.stringify(payload);
    return { ok: true, status: 200, text: async () => text };
  };
}

runStateStoreConformance(
  "IntelligenceStateStore",
  () =>
    new IntelligenceStateStore({
      baseUrl: "http://intelligence.test",
      apiKey: "cpk-test",
      fetch: fakeKvFetch(),
    }),
);

test("kv surfaces a non-2xx app-api response (fail-loud, not swallowed)", async () => {
  const store = new IntelligenceStateStore({
    baseUrl: "http://intelligence.test",
    apiKey: "cpk-test",
    fetch: (async () => ({
      ok: false,
      status: 500,
      text: async () => "upstream boom",
    })) as unknown as FetchLike,
  });

  await expect(store.kv.get("k")).rejects.toThrow(/500/);
});

test("kv.set forwards an explicit ttlMs of 0 rather than dropping it", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const store = new IntelligenceStateStore({
    baseUrl: "http://intelligence.test",
    apiKey: "cpk-test",
    fetch: (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 200, text: async () => "{}" };
    }) as unknown as FetchLike,
  });

  await store.kv.set("k", { v: 1 }, 0);

  expect(bodies[0]).toMatchObject({ key: "k", ttlMs: 0 });
});
