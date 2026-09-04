/**
 * Clear of durable memory via the Intelligence REST endpoints — deliberately
 * NOT scope-complete: project-scoped rows are left alone. See the comment
 * below the list fetch for why.
 *
 * Why a single bare GET and NOT a per-scope `?scope=` fan-out: this backend
 * REJECTS any query string on `/api/memories` with HTTP 400. The bare
 * `GET /api/memories` already enumerates EVERY scope (user + project) in one
 * response, so a single list is inherently complete enough to filter locally —
 * no scope can be silently missed by the fetch itself. (Scope filtering exists
 * only on `POST /api/memories/recall`, which is top-k semantic search rather
 * than enumeration — unfit for a guaranteed-complete clear.)
 *
 * PORTED from the other skins' equivalent rather than imported: a skin's only inbound
 * dependency is the shell's contract, so src/skins/exec/** must never reach
 * into src/skins/banking/** (or any other skin's folder). This file instead
 * mirrors `src/skins/people/intelligence/forget-memories.ts`, which departs
 * from banking's version for the reason below — exec has the same reason to
 * depart.
 *
 * SERVER-SAFE: no "use client", no JSX, no React.
 */

const LAYER = "[exec/forget-memories]";

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
   * Project-scoped rows this deliberately left alone. Returned rather than
   * swallowed, so a non-zero value after an exec-only session is the signal
   * to go investigate.
   */
  skippedProjectScoped: number;
}

/**
 * Thrown when a bucket's sweep cannot finish (the list call failed, or a
 * DELETE came back non-OK). Carries `forgot` — rows THIS bucket already
 * deleted before the failure — so a `throw` does not discard progress the
 * loop already made: a plain `Error` here used to mean 9-of-10 deletes
 * succeeding and then a single failing 10th made the whole bucket report
 * `forgot: 0` to the caller, understating a nearly-complete wipe as a total
 * failure. `dev/reset`'s per-userId `catch` reads `.forgot` off this to keep
 * that progress in its running total instead of losing it.
 */
export class ForgetMemoriesError extends Error {
  /** Rows this bucket deleted before the failure that ended its sweep. */
  readonly forgot: number;

  constructor(message: string, options: { forgot: number; cause?: unknown }) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ForgetMemoriesError";
    this.forgot = options.forgot;
  }
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
    // Nothing has been deleted yet at this point, so `forgot: 0` is exact,
    // not a placeholder — this branch still goes through the same error type
    // as the delete loop below so every throw out of this function carries
    // the same shape for `dev/reset`'s catch to read.
    throw new ForgetMemoriesError(
      `${LAYER} list memories failed: ${listRes.status} ${await listRes.text()}`,
      { forgot: 0 },
    );
  }
  const { memories } = (await listRes.json()) as MemoriesListResponse;

  /**
   * PROJECT-SCOPED ROWS ARE DELIBERATELY LEFT ALONE.
   *
   * Verified against the running Intelligence stack (see
   * `src/skins/people/intelligence/forget-memories.ts` for the fuller writeup):
   * the bare list returns every `scope: "project"` row for ANY user id,
   * because project scope is global to the backend instance rather than
   * partitioned per product. All the skins in this app share one instance
   * locally, and banking seeds a project-scoped procedure memory
   * (`src/skins/banking/intelligence/seed-memories.ts`). A scope-complete
   * delete here would silently destroy banking's stored-procedure demo beat
   * every time a presenter resets exec — deleting data this skin does not
   * own, to solve a problem it does not have.
   *
   * Exec owns nothing at project scope by construction: its seed file
   * (`src/skins/exec/intelligence/seed-memories.ts`) writes only user scope,
   * for the same board-pack-procedure isolation reason people wrote there. So
   * skipping project rows still leaves the invariant that matters intact
   * (learned memory cleared, seeds re-armed). The skipped count is RETURNED
   * rather than swallowed, so a non-zero value after an exec-only session is
   * the signal to investigate.
   */
  const deletable = memories.filter((m) => m.scope !== "project");
  const skippedProjectScoped = memories.length - deletable.length;

  // Dedup defensively; a clear must be idempotent per id.
  const ids = new Set<string>();
  for (const { id } of deletable) ids.add(id);

  let forgot = 0;
  for (const id of ids) {
    const delRes = await fetch(
      `${base}/api/memories/${encodeURIComponent(id)}`,
      { method: "DELETE", headers },
    );
    // DELETE returns 204 on success; response.ok covers it.
    if (!delRes.ok) {
      // `forgot` at this point is however many of THIS bucket's rows already
      // deleted before this one failed — carried on the error rather than
      // lost, so a 9-of-10 bucket reports 9, not 0.
      throw new ForgetMemoriesError(
        `${LAYER} delete memory ${id} failed: ${delRes.status} ${await delRes.text()}`,
        { forgot },
      );
    }
    forgot += 1;
  }
  return { forgot, skippedProjectScoped };
}
