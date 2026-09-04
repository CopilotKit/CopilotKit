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
 * ── WHY THIS SWEEPS IN PASSES ────────────────────────────────────────────────
 * Covering every SCOPE is not the same as covering every ROW, and the header
 * used to conflate the two: it asserted a complete clear on the strength of a
 * pagination guarantee the backend never made. `ListMemoriesResponse` in the
 * platform client is a bare `{ memories }` envelope with no `nextCursor` /
 * `total` (unlike `listThreads`, which does carry a cursor), and the
 * 400-on-query-string rule means `?limit=` / `?cursor=` cannot be used to find
 * out. So "one list saw everything" is an assumption this module is not
 * entitled to make: a default page size would leave rows undeleted while the
 * caller reported success.
 *
 * Rather than guess a pagination parameter, this VERIFIES it saw everything:
 * list → delete what it saw → list again. Deleting a truncated page's rows is
 * what makes the next page's rows visible, so the loop converges on a genuinely
 * empty list, and `complete: true` is only claimed once a pass came back with
 * nothing left to delete. Bounded by `maxPasses` so a backend that keeps
 * re-listing deleted rows cannot spin forever — in which case `complete` is
 * FALSE and `incompleteReason` says which way it fell short. The booth failure
 * all of this guards against: a reset that misses rows, reports a plausible
 * count, reads as success — and leaves beat 6 already taught, so the agent
 * "learns" a procedure it demonstrably already knew.
 *
 * PORTED from the other skins' equivalent rather than imported: a skin's only inbound
 * dependency is the shell's contract, so src/skins/exec/** must never reach
 * into src/skins/banking/** (or any other skin's folder). This file instead
 * mirrors `src/skins/keel/intelligence/forget-memories.ts`, which departs
 * from banking's version for the reason below — exec has the same reason to
 * depart.
 *
 * SERVER-SAFE: no "use client", no JSX, no React.
 */

const LAYER = "[exec/forget-memories]";

/**
 * Per-request timeout, matching keel/commerce/airline/logistics. Several
 * buckets are swept SERIALLY on a presenter reset, so an unbounded `fetch`
 * means the Reset button spins forever against a wedged backend — the one
 * moment a presenter has no time to debug anything.
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
   * Project-scoped rows this deliberately left alone. Returned rather than
   * swallowed, so a non-zero value after an exec-only session is the signal
   * to go investigate.
   */
  skippedProjectScoped: number;
  /** How many list→delete passes ran. */
  passes: number;
  /**
   * TRUE only when a list pass PROVED there was nothing deletable left. False
   * means PARTIAL — the caller must not report the clear as done. See the
   * pagination note in the header.
   */
  complete: boolean;
  /** Set whenever `complete` is false; says which way the sweep fell short. */
  incompleteReason?: string;
}

/**
 * Thrown when a bucket's sweep cannot finish (the list call failed or came
 * back malformed, or a DELETE came back non-OK for a reason other than
 * "already gone"). Carries `forgot` — rows THIS bucket already deleted before
 * the failure — so a `throw` does not discard progress the loop already made:
 * a plain `Error` here used to mean 9-of-10 deletes succeeding and then a
 * single failing 10th made the whole bucket report `forgot: 0` to the caller,
 * understating a nearly-complete wipe as a total failure. `dev/reset`'s
 * per-userId `catch` reads `.forgot` off this to keep that progress in its
 * running total instead of losing it.
 *
 * EVERY failure path out of `forgetAllMemories` is this type — including a
 * malformed 200, which used to escape as a bare `TypeError` ("Cannot read
 * properties of undefined (reading 'filter')"). That slipped straight past
 * `dev/reset`'s `instanceof ForgetMemoriesError` check, so the bucket's
 * partial progress was discarded, and the message named neither this module
 * nor the backend — sending whoever was debugging to the wrong layer entirely.
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
  /** Ids this sweep already confirmed absent — never re-deleted, never re-counted. */
  const confirmedGone = new Set<string>();
  let incompleteReason: string | undefined;

  while (passes < maxPasses) {
    passes += 1;
    const memories = await listMemories(base, headers, timeoutMs, forgot);

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
    for (const row of memories) {
      if (row.scope === "project") skippedProjectIds.add(row.id);
    }

    // Dedup defensively; a clear must be idempotent per id.
    const listed = new Set(
      memories.filter((m) => m.scope !== "project").map((m) => m.id),
    );
    const pending = [...listed].filter((id) => !confirmedGone.has(id));

    if (pending.length === 0) {
      // Nothing new to delete, so this is the last pass. Decide honestly WHY.
      const zombies = [...listed].filter((id) => confirmedGone.has(id));
      if (zombies.length > 0) {
        // The backend still enumerates rows it told us it deleted. Reporting
        // success here is exactly the lie this module exists to stop.
        incompleteReason =
          `the backend still lists ${zombies.length} row(s) this sweep already ` +
          `deleted (first: ${zombies[0]})`;
      }
      break;
    }

    for (const id of pending) {
      // `forgot` is threaded in so a throw from here carries however many of
      // THIS bucket's rows already went, rather than reporting 0.
      const outcome = await deleteMemory(base, headers, id, timeoutMs, forgot);
      if (outcome.kind === "deleted") {
        forgot += 1;
      } else {
        // A 404/410 means the row is gone — a harmless race (a concurrent
        // reset, a backend TTL) that used to THROW and abandon every remaining
        // row in this bucket, including the ones where mid-demo teaching
        // actually lands. The desired end state was already reached.
        alreadyGone += 1;
      }
      confirmedGone.add(id);
    }

    if (passes === maxPasses) {
      incompleteReason =
        `pass budget (${maxPasses}) exhausted with rows still being returned; ` +
        `remaining rows are unverified`;
    }
  }

  if (passes === 0) {
    // maxPasses <= 0. Nothing was even listed, so "clear" is unprovable.
    incompleteReason = `no list pass ran (maxPasses was ${maxPasses})`;
  }

  return {
    forgot,
    alreadyGone,
    skippedProjectScoped: skippedProjectIds.size,
    passes,
    complete: incompleteReason === undefined,
    ...(incompleteReason === undefined ? {} : { incompleteReason }),
  };
}

/**
 * Enumerate one bucket. THROWS on any failure: without a list there is nothing
 * to delete and nothing truthful to report, so aborting is correct here —
 * unlike an already-absent DELETE, which is counted and stepped over.
 */
async function listMemories(
  base: string,
  headers: Record<string, string>,
  timeoutMs: number,
  forgot: number,
): Promise<MemoryRow[]> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/memories`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ForgetMemoriesError(
      `${LAYER} list memories failed after ${timeoutMs}ms or in transport: ${describeError(err)}`,
      { forgot, cause: err },
    );
  }
  if (!res.ok) {
    // On the FIRST pass `forgot` is 0, which is exact rather than a
    // placeholder; on a later pass it is the progress already made.
    throw new ForgetMemoriesError(
      `${LAYER} list memories failed: ${res.status} ${await safeText(res)}`,
      { forgot },
    );
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    throw new ForgetMemoriesError(
      `${LAYER} GET /api/memories returned a body that is not JSON: ${describeError(err)}`,
      { forgot, cause: err },
    );
  }
  return parseMemoryRows(payload, forgot);
}

/**
 * Validate the list envelope instead of casting it.
 *
 * A present-but-non-string `scope` is an ERROR rather than a shrug: the
 * project-scope skip above is a `!== "project"` comparison, so an unreadable
 * scope would sail straight through it and get banking's seeded project rows
 * deleted — a sibling demo destroyed from Vantage's Reset button.
 */
function parseMemoryRows(payload: unknown, forgot: number): MemoryRow[] {
  if (!isRecord(payload) || !Array.isArray(payload.memories)) {
    throw new ForgetMemoriesError(
      `${LAYER} unexpected GET /api/memories envelope: expected ` +
        `{ memories: [{ id, scope? }] }, got ${preview(payload)}`,
      { forgot },
    );
  }
  return payload.memories.map((entry: unknown, index: number) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "") {
      throw new ForgetMemoriesError(
        `${LAYER} unexpected GET /api/memories row ${index}: expected ` +
          `{ id: string }, got ${preview(entry)}`,
        { forgot },
      );
    }
    const { id, scope } = entry;
    if (scope !== undefined && typeof scope !== "string") {
      throw new ForgetMemoriesError(
        `${LAYER} unexpected GET /api/memories row ${index} (id ${id}): ` +
          `scope must be a string when present, got ${preview(scope)}`,
        { forgot },
      );
    }
    return scope === undefined ? { id } : { id, scope };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A DELETE either removed the row or found it already absent. Anything else throws. */
type DeleteOutcome = { kind: "deleted" } | { kind: "absent" };

async function deleteMemory(
  base: string,
  headers: Record<string, string>,
  id: string,
  timeoutMs: number,
  forgot: number,
): Promise<DeleteOutcome> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/memories/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ForgetMemoriesError(
      `${LAYER} delete memory ${id} failed: no response after ${timeoutMs}ms ` +
        `or in transport: ${describeError(err)}`,
      { forgot, cause: err },
    );
  }
  // 204 No Content on success; `ok` covers it.
  if (res.ok) return { kind: "deleted" };
  // Already absent — the desired end state, reached by someone else.
  if (res.status === 404 || res.status === 410) return { kind: "absent" };
  throw new ForgetMemoriesError(
    `${LAYER} delete memory ${id} failed: ${res.status} ${await safeText(res)}`,
    { forgot },
  );
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** Body text for an error message; never throws, never floods the log. */
async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return "<unreadable body>";
  }
}

function preview(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return String(value);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return String(value);
  }
}
