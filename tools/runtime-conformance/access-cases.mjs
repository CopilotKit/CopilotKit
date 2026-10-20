import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Keep a joined run active while the test changes authoritative platform data. */
async function activeRun({ platform, request }) {
  const body = {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
  platform.faults.agentKeepOpen = true;
  platform.faults.agentEvents = [
    { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
    { type: "TEXT_MESSAGE_START", messageId: "access-idle", role: "assistant" },
  ];
  assert.equal((await request("POST", "/agent/default/run", body)).status, 200);
  await platform.waitFor(() =>
    platform.events.some((event) => event.type === "TEXT_MESSAGE_START"),
  );
  return body;
}

export const accessCases = [
  {
    id: "access.thread-delete-audit-reason",
    async run({ request, platform }) {
      const id = randomUUID();
      platform.threads.set(id, {
        id,
        userId: "test-user",
        agentId: "default",
        messages: [],
      });
      const response = await request("DELETE", `/threads/${id}`, {
        agentId: "default",
      });
      assert.equal(
        response.status,
        200,
        "runtime must supply the platform audit reason",
      );
      assert.equal(platform.threads.has(id), false);
      const deletion = platform.requests.find(
        (entry) =>
          entry.method === "DELETE" && entry.path === `/api/threads/${id}`,
      );
      assert.equal(typeof deletion.body.reason, "string");
      assert.ok(
        deletion.body.reason.trim().length > 0 &&
          deletion.body.reason.trim().length <= 1000,
      );
    },
  },
  ...["endUserId", "end_user_id"].flatMap((alias) =>
    ["messages", "update", "archive", "list"].map((operation) => ({
      id: `access.thread-identity-${alias}-${operation}`,
      async run({ request, platform }) {
        const id = randomUUID();
        platform.threads.set(id, {
          id,
          userId: "victim",
          agentId: "default",
          name: "Private",
          messages: [],
        });
        const spoof = { agentId: "default", [alias]: "victim", name: "Stolen" };
        const response =
          operation === "messages"
            ? await request("GET", `/threads/${id}/messages?${alias}=victim`)
            : operation === "list"
              ? await request("GET", `/threads?agentId=default&${alias}=victim`)
              : await request(
                  operation === "update" ? "PATCH" : "POST",
                  `/threads/${id}${operation === "archive" ? "/archive" : ""}`,
                  spoof,
                );
        if (operation === "list") {
          assert.equal(response.status, 200);
          assert.equal(JSON.stringify(response.body).includes(id), false);
        } else {
          assert.ok(
            response.status >= 400,
            `${alias} must not override authenticated identity (received ${response.status})`,
          );
          const ordinary =
            operation === "messages"
              ? await request("GET", `/threads/${id}/messages`)
              : await request(
                  operation === "update" ? "PATCH" : "POST",
                  `/threads/${id}${operation === "archive" ? "/archive" : ""}`,
                  { agentId: "default", name: "Stolen" },
                );
          assert.equal(response.status, ordinary.status);
        }
        assert.equal(platform.threads.get(id).name, "Private");
        assert.equal(platform.threads.get(id).archived, undefined);
      },
    })),
  ),
  {
    id: "access.memory-absent-policy",
    configuration: { omitMemoryPolicy: true },
    async run({ request, platform }) {
      const spoof = {
        "x-cpki-user-id": "victim",
        "x-cpki-memory-grant": JSON.stringify({
          user: "none",
          project: "none",
        }),
      };
      const created = await request(
        "POST",
        "/memories",
        {
          content: "Owned memory",
          kind: "topical",
          scope: "user",
          userId: "victim",
          projectId: "victim-project",
        },
        spoof,
      );
      assert.equal(created.status, 201);
      assert.equal(
        (await request("GET", "/memories", undefined, spoof)).status,
        200,
      );
      const upstream = platform.requests.filter((entry) =>
        entry.path.startsWith("/api/memories"),
      );
      assert.ok(upstream.length >= 2);
      for (const entry of upstream) {
        assert.equal(entry.headers["x-cpki-user-id"], "test-user");
        assert.equal(entry.headers["x-cpki-memory-grant"], undefined);
      }
      assert.equal([...platform.memories.values()][0].userId, "test-user");
      const foreign = await request("GET", "/memories", undefined, {
        "x-test-user-id": "another-user",
      });
      assert.equal(foreign.status, 200);
      assert.equal(
        JSON.stringify(foreign.body).includes("Owned memory"),
        false,
      );
    },
  },
  {
    id: "access.memory-read-only-writes",
    configuration: { memoryGrant: { user: "read", project: "read" } },
    async run({ request, platform }) {
      platform.memories.set("existing-memory", {
        id: "existing-memory",
        userId: "test-user",
        content: "Existing",
        scope: "user",
        kind: "topical",
      });
      assert.equal((await request("GET", "/memories")).status, 200);
      for (const [method, path, body] of [
        [
          "POST",
          "/memories",
          { content: "Denied", kind: "topical", scope: "user" },
        ],
        [
          "PATCH",
          "/memories/existing-memory",
          { content: "Denied", kind: "topical" },
        ],
        ["DELETE", "/memories/existing-memory", undefined],
      ])
        assert.equal((await request(method, path, body)).status, 403);
      assert.equal(
        platform.memories.get("existing-memory").invalidated,
        undefined,
      );
      assert.equal(platform.memories.size, 1);
    },
  },
  {
    id: "access.stop-rejects-malformed-run-id",
    async run(context) {
      const body = await activeRun(context);
      for (const runId of [false, null, 42, "", "   "]) {
        const response = await context.request(
          "POST",
          `/agent/default/stop/${body.threadId}`,
          { runId },
        );
        assert.equal(
          response.status,
          400,
          `Malformed runId ${JSON.stringify(runId)} must not stop the current run`,
        );
      }
      assert.equal(
        context.platform.agentDisconnects.includes(body.runId),
        false,
      );
    },
  },
  {
    id: "access.stop-rechecks-current-ownership",
    async run(context) {
      const body = await activeRun(context);
      context.platform.threads.get(body.threadId).userId = "new-owner";
      const response = await context.request(
        "POST",
        `/agent/default/stop/${body.threadId}`,
        { runId: body.runId },
      );
      assert.equal(response.status, 404);
      assert.equal(
        context.platform.agentDisconnects.includes(body.runId),
        false,
      );
    },
  },
  {
    id: "access.stop-uses-canonical-thread-id",
    async run(context) {
      const body = await activeRun(context);
      const alias = randomUUID();
      context.platform.threads.set(
        alias,
        context.platform.threads.get(body.threadId),
      );
      const response = await context.request(
        "POST",
        `/agent/default/stop/${alias}`,
        { runId: body.runId },
      );
      assert.equal(response.status, 200);
      assert.equal(response.body.stopped, true);
      await context.platform.waitFor(() =>
        context.platform.agentDisconnects.includes(body.runId),
      );
    },
  },
  {
    id: "access.stop-rejects-different-thread-agent",
    async run(context) {
      const body = await activeRun(context);
      context.platform.threads.get(body.threadId).agentId = "different-agent";
      const response = await context.request(
        "POST",
        `/agent/default/stop/${body.threadId}`,
        { runId: body.runId },
      );
      assert.equal(response.status, 403);
      assert.equal(
        context.platform.agentDisconnects.includes(body.runId),
        false,
      );
    },
  },
  {
    id: "access.memory-explicit-denial",
    configuration: { memoryGrant: { user: "none", project: "none" } },
    async run({ request, platform }) {
      assert.equal((await request("GET", "/memories")).status, 403);
      assert.equal(
        platform.requests.some((entry) =>
          entry.path.startsWith("/api/memories"),
        ),
        false,
      );
    },
  },
  {
    id: "access.memory-null-denial",
    configuration: { memoryGrant: null },
    async run({ request, platform }) {
      assert.equal((await request("GET", "/memories")).status, 403);
      assert.equal(
        platform.requests.some((entry) =>
          entry.path.startsWith("/api/memories"),
        ),
        false,
      );
    },
  },
  {
    id: "access.memory-invalid-grant",
    configuration: { memoryGrant: { user: "invalid", project: "none" } },
    async run({ request, platform }) {
      assert.equal((await request("GET", "/memories")).status, 500);
      assert.equal(
        platform.requests.some((entry) =>
          entry.path.startsWith("/api/memories"),
        ),
        false,
      );
    },
  },
];
