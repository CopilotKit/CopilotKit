/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * Internal helper for the v1 CopilotRuntime shim. Not exported from the
 * package. The v2 path builds its MCP clients per run in `agent/index.ts`.
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { MCPClient, MCPEndpointConfig } from "./mcp-tools-utils";

/**
 * One cached MCP connection and the tool definitions built from it.
 *
 * The tool definitions close over `tool.execute` on this exact client, so the
 * two share a lifetime: dropping the entry has to close the client, and
 * closing the client has to drop the tools.
 */
export interface MCPCacheEntry<TTools> {
  client: MCPClient;
  tools: TTools;
}

/**
 * Cap on live MCP connections. Reached only by runtimes whose endpoint config
 * varies per request — a static `mcpServers` list occupies one slot per
 * server for the life of the process.
 */
const MAX_ENTRIES = 100;

/**
 * Process-wide, not per runtime instance.
 *
 * The documented per-request pattern builds `new CopilotRuntime(...)` inside
 * the request handler, so a cache owned by the instance is a fresh cache on
 * every request: one connection per HTTP request, never closed. Keying the
 * cache on the client factory plus the endpoint config instead means those
 * runtimes share the connection they would otherwise re-open, and the entry
 * count is bounded by the number of distinct credentials in play rather than
 * by traffic.
 *
 * The slot carries a redacted endpoint label beside the connection. The cache
 * *key* cannot be used for that: it contains the serialized config, and the
 * config contains `apiKey`.
 */
interface MCPCacheSlot {
  /** Safe to log. See `describeEndpoint`. */
  label: string;
  entry: Promise<MCPCacheEntry<unknown>>;
}

const cache = new Map<string, MCPCacheSlot>();

/**
 * A form of the endpoint that is safe to write to application logs.
 *
 * Both halves of an endpoint URL can carry a secret: userinfo, and the query
 * string — the #2407 reporter's own workaround appended `?uid=<hash of the
 * API key>`. Only the origin and path survive.
 *
 * Used for anything that leaves this process with an endpoint in it: log
 * lines, and the tool descriptions that go to the model provider.
 */
export function describeEndpoint(endpoint: string | undefined): string {
  if (!endpoint) return "an MCP endpoint";
  try {
    const url = new URL(endpoint);
    // Not `url.origin`: for any scheme other than http(s) that is the opaque
    // origin, the literal string "null", and `pathname` is empty — so a
    // `stdio://` endpoint would render as "null" in a log and in a prompt.
    // Rebuilding from protocol and host keeps every scheme legible while
    // still dropping userinfo, query, and fragment.
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "an MCP endpoint";
  }
}

/**
 * Identity for a `createMCPClient` implementation.
 *
 * Two runtimes that pass the same factory may share a connection. Two that
 * pass different factories must not: the second runtime's factory could wrap
 * the transport, add auth, or point somewhere else entirely, and handing it a
 * client built by the first would silently bypass all of that.
 */
const factoryIds = new WeakMap<object, string>();
let nextFactoryId = 0;

function factoryId(factory: object): string {
  let id = factoryIds.get(factory);
  if (!id) {
    id = `f${++nextFactoryId}`;
    factoryIds.set(factory, id);
  }
  return id;
}

/**
 * Deterministic serialization of an endpoint config, so that two configs that
 * differ only in key order produce one cache entry, and two that differ in
 * `apiKey` produce two.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v !== "function" && v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export function mcpCacheKey(
  createMCPClient: object,
  config: MCPEndpointConfig,
): string {
  return `${factoryId(createMCPClient)}::${stableStringify(config)}`;
}

async function closeQuietly(client: MCPClient, label: string) {
  try {
    await client.close?.();
  } catch (error) {
    console.error(`MCP: Failed to close the client for ${label}:`, error);
  }
}

/** Drop the least recently used entries until the cache is within its cap. */
async function evictDownToCap() {
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    const evicted = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (!evicted) continue;
    try {
      const entry = await evicted.entry;
      if (entry) await closeQuietly(entry.client, evicted.label);
    } catch {
      // A rejected entry has nothing to close.
    }
  }
}

/**
 * Return the cached connection for this factory and config, creating it on
 * first use.
 *
 * A rejected creation is removed rather than cached, so a server that was
 * briefly unreachable is retried on the next request instead of staying
 * toolless for the life of the process.
 */
export function resolveMCPEntry<TTools>(
  createMCPClient: object,
  config: MCPEndpointConfig,
  build: () => Promise<MCPCacheEntry<TTools>>,
): Promise<MCPCacheEntry<TTools>> {
  const key = mcpCacheKey(createMCPClient, config);
  const hit = cache.get(key);
  if (hit) {
    // Re-insert so that Map iteration order stays least-recently-used first.
    cache.delete(key);
    cache.set(key, hit);
    return hit.entry as Promise<MCPCacheEntry<TTools>>;
  }

  const slot: MCPCacheSlot = {
    label: describeEndpoint(config?.endpoint),
    // Assigned below; `build()` cannot run before the slot exists, because the
    // rejection handler compares against it.
    entry: undefined as unknown as Promise<MCPCacheEntry<unknown>>,
  };

  const created = build().catch((error: unknown) => {
    // Only drop our own slot. Eviction can remove this key while `build()` is
    // still in flight, and a later request can insert a replacement under it;
    // an unconditional delete would evict that replacement and leave its
    // client live but outside cache cleanup, which is the leak this file
    // exists to prevent.
    if (cache.get(key) === slot) {
      cache.delete(key);
    }
    throw error;
  });

  slot.entry = created as Promise<MCPCacheEntry<unknown>>;
  cache.set(key, slot);
  void evictDownToCap();
  return created;
}

/**
 * Mark an entry as recently used.
 *
 * Without this, an entry's position is set once, when the agent resolves, and
 * a run that is actively calling tools still ages toward eviction — so a busy
 * process can close a connection out from under a live run. Tool execution is
 * the only signal available that a connection is still wanted: the v1 runtime
 * has no reliable end-of-run hook to lease against (an abandoned SSE run never
 * fires one), so a lease taken at resolution could never be released.
 *
 * A no-op when the key is gone, which is the already-evicted case.
 */
export function touchMCPEntry(
  createMCPClient: object,
  config: MCPEndpointConfig,
): void {
  const key = mcpCacheKey(createMCPClient, config);
  const slot = cache.get(key);
  if (!slot) return;
  cache.delete(key);
  cache.set(key, slot);
}

/** Test seam: close and forget every cached connection. */
export async function __resetMCPClientCache() {
  const slots = Array.from(cache.values());
  cache.clear();
  await Promise.all(
    slots.map(async (slot) => {
      try {
        const entry = await slot.entry;
        await closeQuietly(entry.client, slot.label);
      } catch {
        // Nothing to close.
      }
    }),
  );
}

/** Test seam: how many connections are live. */
export function __mcpClientCacheSize() {
  return cache.size;
}
