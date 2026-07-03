import { runStateStoreConformance } from "@copilotkit/bot";
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
