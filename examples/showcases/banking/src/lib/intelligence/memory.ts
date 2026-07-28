/**
 * Reads durable memory via app-api's REST `POST /api/memories/recall` — the same
 * endpoint the deterministic e2e (memory-learning.spec.ts) drives against the
 * real backend. Chosen over the `/mcp recall_memory` JSON-RPC+SSE path; the REST
 * body is clean `{ memories: [...] }` JSON, so no SSE frame parsing is needed.
 *
 * VERIFICATION PENDING (Task 7 Step 0): the REST-vs-/mcp recall id-set diff has
 * NOT been run (the docker memory stack was down at implementation time). The
 * resolved decision is to default to REST unless that diff proves the REST
 * recall returns a divergent set on the running Intelligence version. If it
 * diverges, swap `restRecall` for the /mcp JSON-RPC caller (v1 plan Task 7) —
 * the exported signatures here stay identical, so callers are unaffected.
 *
 * COMPLETENESS: the Memory tab's list uses app-api's `GET /api/memories`, which
 * ENUMERATES every stored memory for the user (all scopes, all kinds) — not a
 * top-k semantic recall. So the tab shows everything that's in there. The search
 * box below it still uses semantic `recall` (top-k by meaning) via restRecall.
 */

import { SEEDED_USER_IDS, DEMO_DEFAULT_USER_ID } from "./user-id";

export type PanelMemory = {
  id: string;
  kind: string;
  scope: string;
  content: string;
  sourceThreadIds: readonly string[];
  score?: number;
  /** Set by the backend when a memory has been superseded/invalidated. Active
   * memories have this null; the list filters invalidated ones out. */
  invalidatedAt?: string | null;
};

/** All three vars must be present for Intelligence (durable memory) mode. */
export function intelligenceEnabled(): boolean {
  return Boolean(
    process.env.INTELLIGENCE_API_URL &&
    process.env.INTELLIGENCE_GATEWAY_WS_URL &&
    process.env.INTELLIGENCE_API_KEY,
  );
}

const RECALL_TIMEOUT_MS = 25_000;
const LIST_CACHE_TTL_MS = 8_000;

/** Pull `memories` out of a REST recall body; tolerant of malformed payloads. Exported for tests. */
export function parseRecallResponse(body: unknown): PanelMemory[] {
  if (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { memories?: unknown }).memories)
  ) {
    return (body as { memories: PanelMemory[] }).memories;
  }
  return [];
}

async function restRecall(
  userId: string,
  query: string,
  scope?: string,
): Promise<PanelMemory[]> {
  const apiUrl = process.env.INTELLIGENCE_API_URL!;
  const apiKey = process.env.INTELLIGENCE_API_KEY!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECALL_TIMEOUT_MS);
  try {
    const resp = await fetch(`${apiUrl}/api/memories/recall`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Cpki-User-Id": userId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(scope ? { query, scope } : { query }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`recall http ${resp.status}`);
    return parseRecallResponse(await resp.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enumerate EVERY stored memory for a user via app-api's `GET /api/memories`
 * (all scopes + kinds; NOT a semantic recall). Passing a `scope` query param to
 * this endpoint returns nothing, so it is called bare. Invalidated/superseded
 * rows are filtered out so only active memories show.
 */
async function restListAll(userId: string): Promise<PanelMemory[]> {
  const apiUrl = process.env.INTELLIGENCE_API_URL!;
  const apiKey = process.env.INTELLIGENCE_API_KEY!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECALL_TIMEOUT_MS);
  try {
    const resp = await fetch(`${apiUrl}/api/memories`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Cpki-User-Id": userId,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`list http ${resp.status}`);
    const memories = parseRecallResponse(await resp.json());
    return memories.filter((m) => !m.invalidatedAt);
  } finally {
    clearTimeout(timer);
  }
}

// Per-user list cache + in-flight de-dup. Refresh is event-driven (Tasks 9/10),
// but a 15s backstop poll still benefits from coalescing so concurrent ticks
// don't double-hit app-api.
const listCache = new Map<string, { memories: PanelMemory[]; ts: number }>();
const listInflight = new Map<string, Promise<PanelMemory[]>>();

/**
 * The Memory tab's list: EVERYTHING stored across the demo's identities, so the
 * inspector never hides a memory just because it landed in a different scope
 * bucket than the active member. Demo memory fragments across a few user ids —
 * the active member's mapped id, the two seeded personas, and the default
 * `northwind-demo-user` bucket (where facts taught before a member is selected
 * land, and which reset never clears). We enumerate all of them (bare
 * `GET /api/memories`, all scopes/kinds) and merge, de-duped by memory id.
 *
 * This trades strict per-viewer isolation in the INSPECTOR for completeness —
 * intentional: the Glass Engine is a debug lens meant to show the whole store.
 * The agent's own recall is still scoped per user (see restRecall / the runtime
 * identifyUser); only this read-only panel aggregates.
 *
 * Name kept for callers/tests; `userId` is the active member's resolved id and
 * is always included in the candidate set.
 */
export async function listRecalledMemories(
  userId: string,
): Promise<PanelMemory[]> {
  const cacheKey = userId;
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LIST_CACHE_TTL_MS)
    return cached.memories;

  const inflight = listInflight.get(cacheKey);
  if (inflight) return inflight;

  const candidateIds = Array.from(
    new Set([userId, ...SEEDED_USER_IDS, DEMO_DEFAULT_USER_ID]),
  );

  const p = (async () => {
    try {
      // One enumeration per candidate scope; tolerate a per-scope failure so one
      // bad id can't blank the whole panel.
      const batches = await Promise.all(
        candidateIds.map((id) => restListAll(id).catch(() => [])),
      );
      const seen = new Set<string>();
      const memories: PanelMemory[] = [];
      for (const m of batches.flat()) {
        if (m?.id && !seen.has(m.id)) {
          seen.add(m.id);
          memories.push(m);
        }
      }
      listCache.set(cacheKey, { memories, ts: Date.now() });
      return memories;
    } catch (err) {
      const prev = listCache.get(cacheKey);
      if (prev) return prev.memories; // serve last good rather than flood/hang
      throw err;
    } finally {
      listInflight.delete(cacheKey);
    }
  })();
  listInflight.set(cacheKey, p);
  return p;
}

/** Semantic recall for the panel's search box (both scopes unless restricted). */
export async function recallMemories(
  userId: string,
  query: string,
  scope?: string,
): Promise<PanelMemory[]> {
  return restRecall(userId, query, scope);
}
