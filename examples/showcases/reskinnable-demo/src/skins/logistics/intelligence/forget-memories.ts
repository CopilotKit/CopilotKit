/**
 * Scope-complete clear of durable memory via the Intelligence REST endpoints.
 * Server-safe plain .ts.
 *
 * A BARE `GET /api/memories` (no query string) is the only enumeration this
 * backend offers. It rejects ANY query string on that path with 400
 * MEMORY_VALIDATION_ERROR, and the bare GET already enumerates every scope
 * (user + project) in one response — so one list is inherently scope-complete
 * and no scope can be silently missed. Scope filtering only exists on
 * `POST /api/memories/recall`, which is top-k semantic search rather than
 * enumeration and is therefore unfit for a guaranteed clear.
 *
 * ── WHY THIS SWEEPS IN PASSES ────────────────────────────────────────────────
 * The list endpoint's pagination contract is UNKNOWN, and it cannot be probed:
 * `ListMemoriesResponse` in the platform client
 * (`packages/runtime/src/v2/runtime/intelligence-platform/client.ts`) is a bare
 * `{ memories }` envelope with no `nextCursor`/`total` — unlike `listThreads`,
 * which does carry a cursor — and the 400-on-query-string rule means we cannot
 * pass `?limit=`/`?cursor=` to find out. Assuming ONE list is exhaustive is
 * therefore an assumption we are not entitled to: a default page size would
 * leave rows undeleted while the caller reports success.
 *
 * So instead of guessing a pagination parameter, this VERIFIES it saw
 * everything: list → delete what it saw → list again. Deleting a truncated
 * page's rows is what makes the next page's rows visible, so the loop converges
 * on a genuinely empty list, and the sweep only claims `complete: true` when a
 * list pass came back with nothing left to delete. Bounded by `maxPasses` so a
 * backend that keeps re-listing deleted rows cannot spin forever.
 *
 * The booth failure all of this guards against: a reset that misses rows,
 * reports a plausible count, reads as success — and leaves beat 6 already
 * taught, so the agent "learns" a procedure it demonstrably already knew.
 *
 * This is a deliberate SIBLING of `src/skins/commerce/intelligence/
 * forget-memories.ts`, not an import of it. The two are byte-similar today and
 * that is fine: this module is reached only through the server-only agent
 * registry and a skin's own reset route, and the whole point of the skin
 * contract is that a skin depends on nothing outside `src/skins/<id>/` except
 * `src/shell/skin-contract.ts`. Hoisting it into the shell would put an
 * Intelligence REST client into skin-agnostic code that has no business knowing
 * memory exists.
 */

/** Prefixes every thrown message so a failure names THIS layer, not its caller. */
const LAYER = "[logistics/forget-memories]";

/**
 * Per-request timeout. Several buckets are swept SERIALLY on a presenter reset,
 * so an unbounded fetch means the Reset button spins forever against a wedged
 * backend — the one moment a presenter has no time to debug anything.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Bound on list→delete passes. See the pagination note in the header. */
const DEFAULT_MAX_PASSES = 10;

export interface ForgetMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
  /** Per-request timeout in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Max list→delete passes. Defaults to {@link DEFAULT_MAX_PASSES}. */
  maxPasses?: number;
}

interface MemoryRow {
  id: string;
  scope?: string;
}

/** One row this sweep could NOT confirm gone. */
export interface ForgetFailure {
  id: string;
  reason: string;
}

export interface ForgetResult {
  /** Rows this sweep deleted (2xx). */
  forgot: number;
  /**
   * Rows that were ALREADY gone when the DELETE landed (404/410). Counted as
   * success — the row is absent either way, which is the only thing the reset
   * cares about — but reported separately so `forgot` stays literally true.
   */
  alreadyGone: number;
  /**
   * Project-scoped rows this deliberately left alone. Surfaced in the reset
   * response so a presenter can SEE that something project-scoped is present —
   * see the skip note below for why that matters.
   */
  skippedProjectScoped: number;
  /**
   * Rows that failed to delete for a reason other than "already gone". These do
   * NOT abort the sweep: one 500 on one row would otherwise abandon this bucket
   * AND every remaining bucket.
   */
  failed: ForgetFailure[];
  /** How many list→delete passes ran. */
  passes: number;
  /**
   * TRUE only when a list pass proved there was nothing deletable left. False
   * means PARTIAL: the caller must not report the clear as done.
   */
  complete: boolean;
  /** Set whenever `complete` is false; says which way it fell short. */
  incompleteReason?: string;
}

export async function forgetAllMemories(
  params: ForgetMemoriesParams,
): Promise<ForgetResult> {
  const {
    apiUrl,
    apiKey,
    userId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxPasses = DEFAULT_MAX_PASSES,
  } = params;
  const base = apiUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "x-cpki-user-id": userId,
  };

  let forgot = 0;
  let alreadyGone = 0;
  let passes = 0;
  /**
   * Project-scoped ids seen across ALL passes, as a union rather than a
   * last-pass count: a paginated list can split them across pages, and the
   * point of this number is that a presenter can trust it.
   */
  const skippedProjectIds = new Set<string>();
  const failed: ForgetFailure[] = [];
  const failedIds = new Set<string>();
  /** Ids this sweep already confirmed absent — never re-deleted, never re-counted. */
  const confirmedGone = new Set<string>();
  let incompleteReason: string | undefined;

  while (passes < maxPasses) {
    passes += 1;
    const memories = await listMemories(base, headers, timeoutMs);

    /**
     * PROJECT-SCOPED ROWS ARE DELIBERATELY LEFT ALONE.
     *
     * Verified against the running Intelligence stack: the bare list returns
     * every `scope: "project"` row for ANY user id, because project scope is
     * global to the backend instance rather than partitioned per product. All
     * the skins in this app share one instance locally. So a scope-complete
     * delete here would silently destroy banking's seeded procedure every time a
     * presenter resets Meridian — deleting data this skin does not own, to solve
     * a problem it does not have.
     *
     * Meridian owns nothing at project scope BY CONSTRUCTION: its seed file
     * writes user scope, and its prompt instructs `save_memory` to use user
     * scope. So skipping project rows still leaves beat 6 unlearned after a
     * reset, which is the invariant that matters.
     *
     * The residual risk is a model that ignores the scope instruction and saves
     * project-scoped anyway — reset would then miss it and beat 6 would start
     * out already taught. That is why the count is RETURNED rather than
     * swallowed: `dev/reset` reports it, so a non-zero number after a
     * Meridian-only session is the signal to go look.
     */
    const deletable = memories.filter((m) => m.scope !== "project");
    for (const row of memories) {
      if (row.scope === "project") skippedProjectIds.add(row.id);
    }

    // Dedup defensively — the API should not repeat ids, but a clear has to be
    // idempotent per id regardless.
    const listed = new Set(deletable.map((m) => m.id));
    const pending = [...listed].filter(
      (id) => !failedIds.has(id) && !confirmedGone.has(id),
    );

    if (pending.length === 0) {
      // Nothing new to delete, so this is the last pass. Decide honestly WHY.
      const zombies = [...listed].filter((id) => confirmedGone.has(id));
      if (zombies.length > 0) {
        // The backend still enumerates rows it told us it deleted. Reporting
        // success here is exactly the lie this module exists to stop.
        incompleteReason =
          `the backend still lists ${zombies.length} row(s) this sweep already ` +
          `deleted (first: ${zombies[0]})`;
      } else if (failedIds.size > 0) {
        incompleteReason = `${failedIds.size} row(s) failed to delete`;
      }
      break;
    }

    for (const id of pending) {
      const outcome = await deleteMemory(base, headers, id, timeoutMs);
      if (outcome.kind === "deleted") {
        forgot += 1;
        confirmedGone.add(id);
      } else if (outcome.kind === "absent") {
        // A 404 means the row is gone — a harmless race (a concurrent reset, a
        // backend TTL) that must not abandon every remaining bucket.
        alreadyGone += 1;
        confirmedGone.add(id);
      } else {
        failed.push({ id, reason: outcome.reason });
        failedIds.add(id);
      }
    }

    // Loop: a truncated page hides rows behind the ones just deleted, so only a
    // list that comes back with nothing pending proves the bucket is clear.
    if (passes === maxPasses) {
      incompleteReason =
        `pass budget (${maxPasses}) exhausted with rows still being returned; ` +
        `remaining rows are unverified`;
    }
  }

  if (failed.length > 0 && !incompleteReason) {
    incompleteReason = `${failed.length} row(s) failed to delete`;
  }
  if (passes === 0) {
    // maxPasses <= 0. Nothing was even listed, so "clear" is unprovable.
    incompleteReason = `no list pass ran (maxPasses was ${maxPasses})`;
  }

  return {
    forgot,
    alreadyGone,
    skippedProjectScoped: skippedProjectIds.size,
    failed,
    passes,
    complete: incompleteReason === undefined,
    ...(incompleteReason === undefined ? {} : { incompleteReason }),
  };
}

/**
 * Enumerate one bucket. THROWS on any failure: without a list there is nothing
 * to delete and nothing truthful to report, so aborting is correct here — unlike
 * a single failed DELETE, which is counted and stepped over.
 */
async function listMemories(
  base: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<MemoryRow[]> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/memories`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(
      `${LAYER} list memories failed after ${timeoutMs}ms or in transport: ${describeError(err)}`,
      { cause: err },
    );
  }
  if (!res.ok) {
    throw new Error(
      `${LAYER} list memories failed: ${res.status} ${await safeText(res)}`,
    );
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    throw new Error(
      `${LAYER} GET /api/memories returned a body that is not JSON: ${describeError(err)}`,
      { cause: err },
    );
  }
  return parseMemoryRows(payload);
}

/**
 * Validate the list envelope instead of casting it.
 *
 * An unchecked `as MemoriesListResponse` turns an envelope change into "Cannot
 * read properties of undefined (reading 'filter')" thrown from the middle of a
 * reset — a message that names neither this module nor the backend, so it sends
 * whoever is debugging to the wrong layer entirely.
 *
 * A present-but-non-string `scope` is an ERROR rather than a shrug: the
 * project-scope skip above is a `!== "project"` comparison, so an unreadable
 * scope could get a sibling skin's seeded project rows deleted.
 */
function parseMemoryRows(payload: unknown): MemoryRow[] {
  if (!isRecord(payload) || !Array.isArray(payload.memories)) {
    throw new Error(
      `${LAYER} unexpected GET /api/memories envelope: expected ` +
        `{ memories: [{ id, scope? }] }, got ${preview(payload)}`,
    );
  }
  return payload.memories.map((entry: unknown, index: number) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "") {
      throw new Error(
        `${LAYER} unexpected GET /api/memories row ${index}: expected ` +
          `{ id: string }, got ${preview(entry)}`,
      );
    }
    const { id, scope } = entry;
    if (scope !== undefined && typeof scope !== "string") {
      throw new Error(
        `${LAYER} unexpected GET /api/memories row ${index} (id ${id}): ` +
          `scope must be a string when present, got ${preview(scope)}`,
      );
    }
    return scope === undefined ? { id } : { id, scope };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type DeleteOutcome =
  | { kind: "deleted" }
  | { kind: "absent" }
  | { kind: "failed"; reason: string };

async function deleteMemory(
  base: string,
  headers: Record<string, string>,
  id: string,
  timeoutMs: number,
): Promise<DeleteOutcome> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/memories/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      kind: "failed",
      reason: `no response after ${timeoutMs}ms or in transport: ${describeError(err)}`,
    };
  }
  // 204 No Content on success; `ok` covers it.
  if (res.ok) return { kind: "deleted" };
  // Already absent — the desired end state, reached by someone else.
  if (res.status === 404 || res.status === 410) return { kind: "absent" };
  return {
    kind: "failed",
    reason: `HTTP ${res.status} ${await safeText(res)}`,
  };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** Body text for an error message; never throws, never floods the log. */
async function safeText(res: Response): Promise<string> {
  try {
    return truncate(await res.text());
  } catch {
    return "<unreadable body>";
  }
}

function preview(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return truncate(JSON.stringify(value) ?? String(value));
  } catch {
    return `<unserializable ${typeof value}>`;
  }
}

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
