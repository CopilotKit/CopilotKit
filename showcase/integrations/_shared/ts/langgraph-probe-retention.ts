// Both production entrypoints run the LangGraph agent in this container.
const AGENT_URL = "http://127.0.0.1:8123";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROBE_ID = /^d[456]-[a-z0-9-]+$/i;
const EXPIRY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
let lastSweepAt = 0;

type Thread = {
  thread_id: string;
  status: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

function isOwned(thread: Thread, testId?: string): boolean {
  return (
    thread.metadata?.showcase_probe === true &&
    typeof thread.metadata.showcase_probe_id === "string" &&
    (testId === undefined || thread.metadata.showcase_probe_id === testId)
  );
}

function isFinished(thread: Thread): boolean {
  return thread.status === "idle" || thread.status === "error";
}

async function deleteIfEligible(
  threadId: string,
  testId?: string,
): Promise<boolean> {
  const url = `${AGENT_URL}/threads/${threadId}`;
  const threadResponse = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(3_000),
  });
  if (threadResponse.status === 404) return false;
  if (!threadResponse.ok)
    throw new Error(`thread read: HTTP ${threadResponse.status}`);
  const thread = (await threadResponse.json()) as Thread;
  if (
    thread.thread_id !== threadId ||
    !isOwned(thread, testId) ||
    !isFinished(thread)
  )
    return false;
  const deleteResponse = await fetch(url, {
    method: "DELETE",
    signal: AbortSignal.timeout(3_000),
  });
  if (deleteResponse.status === 404) return false;
  if (!deleteResponse.ok)
    throw new Error(`thread delete: HTTP ${deleteResponse.status}`);
  return true;
}

async function sweepExpired(now: number): Promise<number> {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return 0;
  lastSweepAt = now;
  let deleted = 0;
  // The pinned in-memory runtime scans all threads for search and all runs
  // for each delete. Two old threads per sweep caps work on the event loop.
  for (const status of ["idle", "error"]) {
    if (deleted >= 2) break;
    const response = await fetch(`${AGENT_URL}/threads/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        metadata: { showcase_probe: true },
        status,
        sort_by: "updated_at",
        sort_order: "asc",
        limit: 2,
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`thread search: HTTP ${response.status}`);
    const threads = (await response.json()) as Thread[];
    if (!Array.isArray(threads))
      throw new Error("invalid thread search response");
    for (const thread of threads) {
      if (deleted >= 2) break;
      if (
        !UUID.test(thread.thread_id) ||
        !isOwned(thread) ||
        !isFinished(thread)
      )
        continue;
      const updatedAt = Date.parse(thread.updated_at);
      if (!Number.isFinite(updatedAt) || now - updatedAt < EXPIRY_MS) continue;
      if (await deleteIfEligible(thread.thread_id)) deleted++;
    }
  }
  return deleted;
}

/** Delete exact probe-owned threads and expire abandoned idle/error threads. */
export async function cleanupProbeThreadRequest(
  request: Request,
): Promise<Response> {
  let payload: { testId?: unknown; threadIds?: unknown } | null;
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.testId !== "string" ||
    !PROBE_ID.test(payload.testId) ||
    !Array.isArray(payload.threadIds) ||
    payload.threadIds.length > 20 ||
    payload.threadIds.some((id) => typeof id !== "string" || !UUID.test(id))
  ) {
    return Response.json(
      { error: "invalid probe cleanup request" },
      { status: 400 },
    );
  }

  try {
    let deleted = 0;
    const failures: string[] = [];
    for (const threadId of new Set(payload.threadIds as string[])) {
      try {
        if (await deleteIfEligible(threadId, payload.testId)) deleted++;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    let expired = 0;
    try {
      expired = await sweepExpired(Date.now());
    } catch {
      // Expiry is a fallback; an unavailable search must not undo exact cleanup.
    }
    if (failures.length > 0) {
      return Response.json({ deleted, expired, failures }, { status: 502 });
    }
    return Response.json({ deleted, expired });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
