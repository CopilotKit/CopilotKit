import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceEvent, createIntelligence } from "./storage/intelligence.mjs";

test("durable projection validates gateway ownership and preserves all source fields", () => {
  const raw = {
    type: "CUSTOM",
    organization_id: "org",
    metadata: {
      cpki_ingested: "01989898-1234-7890-abcd-000000000000",
      cpki_event_id: "original",
      unusual: { value: [1, 1] },
    },
    payload: [1, 1],
  };
  assert.deepEqual(sourceEvent(raw, "org"), {
    type: "CUSTOM",
    metadata: { cpki_event_id: "original", unusual: { value: [1, 1] } },
    payload: [1, 1],
  });
  assert.throws(() => sourceEvent(raw, "other"), /organization/);
  assert.throws(() => sourceEvent({ ...raw, metadata: {} }, "org"), /cursor/);
  assert.ok(raw.metadata.cpki_ingested);
});

test("reader binds all scope dimensions and reads the API independently", async () => {
  const queries = [];
  const scope = {
    organizationId: "org",
    projectId: 3,
    userId: "user",
    apiUrl: "https://api.invalid",
    credentials: { apiKey: "test" },
  };
  const reader = createIntelligence({
    scope,
    pool: {
      async query(sql, values) {
        queries.push({ sql, values });
        return {
          rows: sql.includes("re.raw")
            ? []
            : [{ thread_id: "thread", agent_id: "agent", end_user_id: "user" }],
        };
      },
    },
    fetchImpl: async (url) => {
      assert.equal(url.searchParams.get("endUserId"), "user");
      return new Response(
        JSON.stringify({
          messages: [{ id: "api-only", content: "independent" }],
        }),
      );
    },
  });
  const result = await reader.read("thread");
  assert.equal(result.messages[0].id, "api-only");
  assert.equal(queries.length, 2);
  for (const query of queries)
    assert.deepEqual(query.values, ["org", 3, "user", "thread"]);
  assert.match(
    queries[1].sql,
    /ORDER BY ar.created_at ASC, COALESCE\(re.event_seq, re.id\) ASC, re.id ASC/,
  );
});
