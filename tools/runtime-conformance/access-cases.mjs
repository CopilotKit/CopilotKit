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
      assert.equal(response.status, 403);
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
