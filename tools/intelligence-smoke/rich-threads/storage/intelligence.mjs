import assert from "node:assert/strict";

/** The gateway adds exactly these authenticated ingestion fields.
 * Validate them before removing them from the comparison projection. The
 * original rows are retained by rawEvents; no source field is discarded.
 */
export function sourceEvent(raw, organizationId) {
  const event = structuredClone(raw);
  assert.equal(
    event.organization_id,
    organizationId,
    "Event escaped organization",
  );
  assert.match(
    event.metadata?.cpki_ingested ?? "",
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
    "Missing ingestion cursor",
  );
  delete event.organization_id;
  delete event.metadata.cpki_ingested;
  return event;
}

/** Pool is pg.Pool from the pinned harness dependencies. Reads are explicitly
 * scoped to the run's organization, project and user; no caller-supplied SQL.
 */
export function createIntelligence({ scope, pool, fetchImpl = fetch }) {
  const values = (threadId) => [
    scope.organizationId,
    scope.projectId,
    scope.userId,
    threadId,
  ];
  const where = `t.organization_id = $1 AND t.project_id = $2
    AND t.end_user_id = $3 AND t.thread_id = $4 AND t.deleted_at IS NULL`;
  async function metadata(threadId) {
    const result = await pool.query(
      `SELECT t.thread_id, t.agent_id, t.end_user_id FROM cpki.threads t WHERE ${where}`,
      values(threadId),
    );
    assert.ok(result.rows.length <= 1, "Ambiguous scoped thread identity");
    return result.rows[0] ?? null;
  }
  async function rawEvents(threadId) {
    const result = await pool.query(
      `SELECT re.id, re.event_seq, ar.id AS run_id, re.raw
      FROM cpki.run_events re JOIN cpki.agent_runs ar ON ar.id = re.run_id
      JOIN cpki.threads t ON t.thread_id = ar.thread_id AND t.organization_id = re.organization_id
      WHERE ${where} AND ar.deleted_at IS NULL AND re.deleted_at IS NULL
      ORDER BY ar.created_at ASC, COALESCE(re.event_seq, re.id) ASC, re.id ASC`,
      values(threadId),
    );
    return result.rows;
  }
  async function read(threadId) {
    const identity = await metadata(threadId);
    assert.ok(identity, "Scoped durable thread not found");
    const url = new URL(
      `/api/threads/${encodeURIComponent(threadId)}/messages`,
      scope.apiUrl,
    );
    url.searchParams.set("endUserId", scope.userId);
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${scope.credentials.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(
      response.status,
      200,
      `Transcript API returned ${response.status}`,
    );
    const transcript = await response.json();
    assert.ok(
      Array.isArray(transcript.messages),
      "Transcript API omitted messages",
    );
    const rows = await rawEvents(threadId);
    const events = rows.map(({ raw }) =>
      sourceEvent(
        typeof raw === "string" ? JSON.parse(raw) : raw,
        scope.organizationId,
      ),
    );
    return {
      threadId: identity.thread_id,
      agentId: identity.agent_id,
      userId: identity.end_user_id,
      runIds: [...new Set(rows.map((row) => row.run_id))],
      events,
      messages: transcript.messages,
      rawRows: rows,
    };
  }
  return {
    pool,
    read,
    rawEvents,
    exists: async (threadId) => Boolean(await metadata(threadId)),
    close: () => pool.end(),
  };
}
