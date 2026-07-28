import { MemoryStore } from "@copilotkit/channels-core";
import type { StateStore } from "@copilotkit/channels-core";
import type { FetchLike } from "./http-transports.js";

/** Minimal transport config the store needs (subset of the adapter's). */
export interface IntelligenceStateStoreConfig {
  /** Intelligence app-api base URL, e.g. `http://localhost:7050`. */
  baseUrl: string;
  /** Project runtime API key (`cpk-…`), sent as `Authorization: Bearer`. */
  apiKey: string;
  /** Injectable fetch (tests); defaults to global `fetch`. */
  fetch?: FetchLike;
}

/**
 * Durable {@link StateStore} for Channel Bots, backed by Intelligence app-api's
 * runtime-authed KV routes (`/api/channels/kv/*`). Only the `kv` facet is durable —
 * that is what the action registry (button/`ck:` snapshots) and thread state
 * use, so a HITL card posted before a Channel-loop restart still re-renders on
 * cold-cache dispatch and can be flipped in place.
 *
 * `list` / `lock` / `dedup` / `queue` delegate to an in-memory
 * {@link MemoryStore}. On the Channel Slack path these are not durability
 * critical: dedup is skipped at ingress (`adapter.skipIngressDedup`), the
 * per-conversation turn lock is process-local (a single Channel runtime; the
 * app-api delivery lease already fences work cross-instance), and list/queue
 * (transcripts/proactive) are unused. // ponytail: promote these to durable KV
 * only if the Channel runtime is ever horizontally scaled.
 */
export class IntelligenceStateStore implements StateStore {
  private readonly local = new MemoryStore();

  constructor(private readonly cfg: IntelligenceStateStoreConfig) {}

  /** Resolve the fetch implementation (injected config, else global), throwing
   * a clear error when neither is available (e.g. old Node without `fetch`). */
  private fetchImpl(): FetchLike {
    const f =
      this.cfg.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!f) {
      throw new Error(
        "IntelligenceStateStore: no fetch available — provide config.fetch or run on Node 18+",
      );
    }
    return f;
  }

  /** POST `body` as JSON to app-api at `path` with the runtime bearer, parsing
   * the JSON response. Throws (fail-loud) on any non-2xx, with the status and a
   * truncated body for diagnosis. */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl()(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(
        `intelligence ${path} -> ${res.status}: ${raw.slice(0, 300)}`,
      );
    }
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  }

  kv = {
    /** Read a durable key, normalizing app-api's `null` (missing/expired) to
     * the StateStore contract's `undefined`. */
    get: async <T>(key: string): Promise<T | undefined> => {
      const { value } = await this.post<{ value: T | null }>(
        "/api/channels/kv/get",
        { key },
      );
      // app-api returns `null` for a missing/expired key; normalize to the
      // StateStore contract's `undefined`. A stored JSON `null` is
      // indistinguishable here — action snapshots are always objects, so this
      // is harmless in practice.
      return value === null ? undefined : value;
    },
    /** Write a durable key, optionally with a TTL in ms (omitted → no expiry). */
    set: async <T>(key: string, value: T, ttlMs?: number): Promise<void> => {
      await this.post("/api/channels/kv/set", {
        key,
        value,
        // `!== undefined` (not truthiness) so an explicit `ttlMs: 0` is still
        // forwarded rather than silently dropped to a no-expiry set.
        ...(ttlMs !== undefined ? { ttlMs } : {}),
      });
    },
    /** Delete a durable key (no-op if absent). */
    delete: async (key: string): Promise<void> => {
      await this.post("/api/channels/kv/delete", { key });
    },
  };

  // Delegated to in-memory — see class doc for why these are not durable.
  list = this.local.list;
  lock = this.local.lock;
  dedup = this.local.dedup;
  queue = this.local.queue;
}
