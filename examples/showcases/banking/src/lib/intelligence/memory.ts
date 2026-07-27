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
 * NOTE on completeness: recall is top-k semantic search, NOT an enumeration.
 * `listRecalledMemories` is therefore "the most relevant memories", not "all
 * memories" — the Memory tab labels it accordingly and shows no absolute count.
 */

export type PanelMemory = {
  id: string;
  kind: string;
  scope: string;
  content: string;
  sourceThreadIds: readonly string[];
  score?: number;
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
const LIST_RECALL_QUERY =
  "everything stored for this user and team — all facts, preferences, and operational procedures";

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

// Per-user list cache + in-flight de-dup. Refresh is event-driven (Tasks 9/10),
// but a 15s backstop poll plus the user+project parallel fan-out still benefit
// from coalescing so concurrent ticks don't double-hit app-api.
const listCache = new Map<string, { memories: PanelMemory[]; ts: number }>();
const listInflight = new Map<string, Promise<PanelMemory[]>>();

/**
 * The "Recalled memories" view: merge user + project scopes, de-duped by id.
 * This is top-k recall, not an enumeration — see the file-level NOTE.
 */
export async function listRecalledMemories(
  userId: string,
): Promise<PanelMemory[]> {
  const cached = listCache.get(userId);
  if (cached && Date.now() - cached.ts < LIST_CACHE_TTL_MS)
    return cached.memories;

  const inflight = listInflight.get(userId);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const [userMems, projectMems] = await Promise.all([
        restRecall(userId, LIST_RECALL_QUERY, "user"),
        restRecall(userId, LIST_RECALL_QUERY, "project"),
      ]);
      const seen = new Set<string>();
      const memories: PanelMemory[] = [];
      for (const m of [...userMems, ...projectMems]) {
        if (m?.id && !seen.has(m.id)) {
          seen.add(m.id);
          memories.push(m);
        }
      }
      listCache.set(userId, { memories, ts: Date.now() });
      return memories;
    } catch (err) {
      const prev = listCache.get(userId);
      if (prev) return prev.memories; // serve last good rather than flood/hang
      throw err;
    } finally {
      listInflight.delete(userId);
    }
  })();
  listInflight.set(userId, p);
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
