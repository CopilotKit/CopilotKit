import assert from "node:assert/strict";

const serializable = (value) => JSON.parse(JSON.stringify(value));

/** A full project-scope read catches new/unmapped/soft-deleted duplicates as well as selected imports. */
export function createDestinationReader({
  pool,
  organizationId,
  projectId,
  readThread,
}) {
  assert(
    organizationId && Number.isInteger(projectId),
    "Explicit destination tenant/project required",
  );
  return async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const rows = (
        await client.query(
          "SELECT * FROM cpki.threads WHERE organization_id=$1 AND project_id=$2 ORDER BY id",
          [organizationId, projectId],
        )
      ).rows;
      const projectionExists =
        (
          await client.query(
            "SELECT to_regclass('cpki.run_replay_projections') AS table_name",
          )
        ).rows[0].table_name !== null;
      const threads = [];
      for (const thread of rows) {
        const args = [organizationId, thread.thread_id];
        const runs = (
          await client.query(
            "SELECT * FROM cpki.agent_runs WHERE organization_id=$1 AND thread_id=$2 ORDER BY created_at,id",
            args,
          )
        ).rows;
        const events = (
          await client.query(
            "SELECT e.* FROM cpki.run_events e JOIN cpki.agent_runs r ON r.id=e.run_id AND r.organization_id=e.organization_id WHERE r.organization_id=$1 AND r.thread_id=$2 ORDER BY r.created_at,r.id,COALESCE(e.event_seq,e.id),e.id",
            args,
          )
        ).rows;
        const runState = (
          await client.query(
            "SELECT * FROM cpki.run_state WHERE organization_id=$1 AND thread_id=$2 ORDER BY id",
            args,
          )
        ).rows;
        const projections = projectionExists
          ? (
              await client.query(
                "SELECT p.* FROM cpki.run_replay_projections p JOIN cpki.agent_runs r ON r.id=p.run_id AND r.organization_id=p.organization_id WHERE r.organization_id=$1 AND r.thread_id=$2 ORDER BY p.run_id",
                args,
              )
            ).rows
          : null;
        // Use the actual durable API transcript, never a made-up event reducer.
        // Retain deleted threads' raw records even when the API no longer serves them.
        const transcript = thread.deleted_at
          ? null
          : await readThread(thread.thread_id, thread.end_user_id);
        if (transcript)
          assert(
            Array.isArray(transcript.messages),
            "Intelligence API omitted messages",
          );
        threads.push({
          id: thread.thread_id,
          sourceId:
            thread.import_metadata?.source_thread_id ?? thread.thread_id,
          nativeThreadId:
            thread.import_metadata?.backendThreadId ?? thread.thread_id,
          messages: transcript?.messages ?? [],
          state: transcript?.state ?? null,
          events,
          thread,
          runs,
          runState,
          projections,
          transcript,
        });
      }
      await client.query("COMMIT");
      return serializable({
        threads,
        projectionTablePresent: projectionExists,
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        const failure = new AggregateError(
          [error, rollbackError],
          "Destination snapshot and rollback failed",
          { cause: rollbackError },
        );
        throw failure;
      }
      throw error;
    } finally {
      client.release();
    }
  };
}

export function createTranscriptReader({ apiUrl, apiKey, signal }) {
  const base = new URL(apiUrl);
  assert(
    ["http:", "https:"].includes(base.protocol) &&
      !base.username &&
      !base.password,
    "Invalid Intelligence API URL",
  );
  return async (threadId, endUserId) => {
    const url = new URL(
      `/api/threads/${encodeURIComponent(threadId)}/messages`,
      base,
    );
    if (endUserId) url.searchParams.set("endUserId", endUserId);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      redirect: "error",
    });
    assert.equal(
      response.status,
      200,
      `Durable transcript read returned HTTP ${response.status}`,
    );
    return response.json();
  };
}
