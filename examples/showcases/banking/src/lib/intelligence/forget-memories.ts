/**
 * Scope-complete clear of durable memory via app-api's REST endpoints.
 *
 * Why a single bare GET (and NOT a per-scope `?scope=` fan-out): this backend
 * REJECTS any query string on `/api/memories` with HTTP 400
 * (MEMORY_VALIDATION_ERROR) — verified live against the running Intelligence
 * stack. The bare `GET /api/memories` already enumerates EVERY scope (user +
 * project) in one response, so a single list is inherently scope-complete:
 * no scope can be silently missed. (Scope filtering only exists on the
 * `POST /api/memories/recall` path via a body field, but recall is top-k
 * semantic search, not enumeration — unfit for a guaranteed-complete clear.)
 *
 * The booth failure this guards against is a clear that misses a scope and
 * returns forgot:0 while reading as success. Enumerating once over all scopes
 * and deleting every id eliminates that class of bug at the source.
 */
export interface ForgetMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
}

interface MemoriesListResponse {
  memories: Array<{ id: string }>;
}

export async function forgetAllMemories(
  params: ForgetMemoriesParams,
): Promise<number> {
  const { apiUrl, apiKey, userId } = params;
  const base = apiUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "x-cpki-user-id": userId,
  };

  // Enumerate every scope in one shot (bare GET — no query string allowed).
  const listRes = await fetch(`${base}/api/memories`, { headers });
  if (!listRes.ok) {
    throw new Error(
      `list memories failed: ${listRes.status} ${await listRes.text()}`,
    );
  }
  const { memories } = (await listRes.json()) as MemoriesListResponse;

  // Dedup ids defensively; the API should not repeat them, but a clear must be idempotent per id.
  const ids = new Set<string>();
  for (const { id } of memories) ids.add(id);

  let forgot = 0;
  for (const id of ids) {
    const delRes = await fetch(
      `${base}/api/memories/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers,
      },
    );
    // DELETE returns 204 No Content on success; response.ok covers 204.
    if (!delRes.ok) {
      throw new Error(
        `delete memory ${id} failed: ${delRes.status} ${await delRes.text()}`,
      );
    }
    forgot += 1;
  }
  return forgot;
}
