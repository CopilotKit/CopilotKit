/**
 * Scope-complete clear of durable memory via the Intelligence REST endpoints.
 * Server-safe plain .ts. Mirrors `src/skins/banking/intelligence/forget-memories.ts`
 * — including the reason for its shape, which is worth restating because it is
 * counter-intuitive:
 *
 * A single BARE `GET /api/memories` (no query string). The backend rejects ANY
 * query string on that path with 400 MEMORY_VALIDATION_ERROR, and the bare GET
 * already enumerates every scope (user + project) in one response — so one list
 * is inherently scope-complete and no scope can be silently missed. Scope
 * filtering only exists on `POST /api/memories/recall`, which is top-k semantic
 * search rather than enumeration and is therefore unfit for a guaranteed clear.
 *
 * The booth failure this guards against: a reset that misses a scope, returns
 * `forgot: 0`, reads as success — and leaves beat 6 already taught, so the
 * agent "learns" a procedure it demonstrably already knew.
 */
export interface ForgetMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
}

interface MemoriesListResponse {
  memories: Array<{ id: string; scope?: string }>;
}

export interface ForgetResult {
  forgot: number;
  /**
   * Project-scoped rows this deliberately left alone. Surfaced in the reset
   * response so a presenter can SEE that something project-scoped is present —
   * see the `skipProjectScope` note below for why that matters.
   */
  skippedProjectScoped: number;
}

export async function forgetAllMemories(
  params: ForgetMemoriesParams,
): Promise<ForgetResult> {
  const { apiUrl, apiKey, userId } = params;
  const base = apiUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "x-cpki-user-id": userId,
  };

  const listRes = await fetch(`${base}/api/memories`, { headers });
  if (!listRes.ok) {
    throw new Error(
      `list memories failed: ${listRes.status} ${await listRes.text()}`,
    );
  }
  const { memories } = (await listRes.json()) as MemoriesListResponse;

  /**
   * PROJECT-SCOPED ROWS ARE DELIBERATELY LEFT ALONE, and this is the one place
   * Rowan departs from banking's otherwise-identical helper.
   *
   * Verified against the running Intelligence stack: the bare list returns
   * every `scope: "project"` row for ANY user id, because project scope is
   * global to the backend instance rather than partitioned per product. All the
   * skins in this app share one instance locally. So a scope-complete delete
   * here would silently destroy banking's seeded procedure every time a
   * presenter resets Rowan — deleting data this skin does not own, to solve a
   * problem it does not have.
   *
   * Rowan owns nothing at project scope BY CONSTRUCTION: its seed file writes
   * user scope, and its prompt and teach-mode tools all instruct `save_memory`
   * to use user scope. So skipping project rows still leaves beat 6 unlearned
   * after a reset, which is the invariant that matters.
   *
   * The residual risk is a model that ignores the scope instruction and saves
   * project-scoped anyway — reset would then miss it and beat 6 would start out
   * already taught. That is why the count is RETURNED rather than swallowed:
   * `dev/reset` reports it, so a non-zero number after a Rowan-only session is
   * the signal to go look.
   */
  const deletable = memories.filter((m) => m.scope !== "project");
  const skippedProjectScoped = memories.length - deletable.length;

  // Dedup defensively — the API should not repeat ids, but a clear has to be
  // idempotent per id regardless.
  const ids = new Set<string>();
  for (const { id } of deletable) ids.add(id);

  let forgot = 0;
  for (const id of ids) {
    const delRes = await fetch(
      `${base}/api/memories/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers,
      },
    );
    // 204 No Content on success; `ok` covers it.
    if (!delRes.ok) {
      throw new Error(
        `delete memory ${id} failed: ${delRes.status} ${await delRes.text()}`,
      );
    }
    forgot += 1;
  }
  return { forgot, skippedProjectScoped };
}
