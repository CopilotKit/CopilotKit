import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { uiCases } from "./ui-cases.mjs";
import { telemetryCases } from "./telemetry-cases.mjs";
import { runnerCases } from "./runner-cases.mjs";
import { clientCases } from "./client-cases.mjs";
import { accessCases } from "./access-cases.mjs";
import { inspectorCases } from "./inspector-cases.mjs";
import { entitlementCases } from "./entitlement-cases.mjs";

/** A complete AG-UI input accepted by the reference RunAgentInput schema. */
export function runInput(overrides = {}) {
  return {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content: "hello" }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...overrides,
  };
}

/** Inspect both the browser response and platform effects for every case. */
export const cases = [
  ...entitlementCases,
  ...inspectorCases,
  ...accessCases,
  ...clientCases,
  ...runnerCases,
  ...uiCases,
  ...telemetryCases,
  {
    id: "discovery.intelligence",
    async run({ request, platform }) {
      const response = await request("GET", "/info");
      assert.equal(response.status, 200);
      assert.equal(response.body.mode, "intelligence");
      assert.equal(response.body.agents.default.name, "default");
      assert.equal(
        response.body.agents.default.description,
        "Conformance agent",
      );
      assert.deepEqual(response.body.threadEndpoints, {
        list: true,
        inspect: true,
        mutations: true,
        realtimeMetadata: true,
      });
      assert.equal(
        response.body.intelligence.wsUrl,
        `${platform.wsUrl}/client`,
      );
      assert.equal(response.body.runtimeEntitlements.status, "ready");
    },
  },
  {
    id: "routing.no-legacy-dispatch",
    async run({ request }) {
      assert.equal((await request("POST", "", { method: "info" })).status, 404);
      assert.equal((await request("POST", "/info", {})).status, 405);
      // TypeScript preserves known suffix routes below a mount. This path has
      // no supported suffix and must be rejected by every host.
      assert.equal((await request("GET", "/unknown/not-a-route")).status, 404);
      assert.equal(
        (await request("POST", "/agent/missing/connect", runInput())).status,
        404,
      );
    },
  },
  {
    id: "connect.blank-is-read-only",
    async run({ request, platform }) {
      const result = await request(
        "POST",
        "/agent/default/connect",
        runInput(),
      );
      assert.equal(result.status, 204);
      assert.equal(platform.threads.size, 0);
      assert.equal(platform.locks.size, 0);
      assert.equal(platform.agentInputs.length, 0);
    },
  },
  {
    id: "connect.credentials-and-ownership",
    async run({ request, platform }) {
      platform.seedThread("owned");
      platform.seedThread("foreign", "another-user");
      const owned = await request(
        "POST",
        "/agent/default/connect",
        runInput({ threadId: "owned", userId: "spoof" }),
      );
      assert.equal(owned.status, 200);
      assert.deepEqual(owned.body, {
        threadId: "owned",
        joinToken: "connect-token-owned",
        realtime: {
          clientUrl: `${platform.wsUrl}/client`,
          topic: "thread:owned",
        },
      });
      const foreign = await request(
        "POST",
        "/agent/default/connect",
        runInput({ threadId: "foreign", userId: "another-user" }),
      );
      assert.equal(foreign.status, 404);
      assert.equal(platform.agentInputs.length, 0);
    },
  },
  {
    id: "connect.upstream-unavailable",
    async run({ request, platform }) {
      platform.faults.http.set("POST /api/threads/broken/connect", {
        status: 503,
        body: { error: "private upstream diagnostic" },
      });
      const response = await request(
        "POST",
        "/agent/default/connect",
        runInput({ threadId: "broken" }),
      );
      assert.equal(response.status, 503);
      assert.ok(!JSON.stringify(response.body).includes(platform.apiKey));
    },
  },
  {
    id: "validation.no-run-side-effects",
    async run({ request, platform }) {
      for (const body of [
        null,
        [],
        {},
        { threadId: "", runId: "r" },
        runInput({ messages: "not-an-array" }),
      ]) {
        assert.equal(
          (await request("POST", "/agent/default/run", body)).status,
          400,
        );
      }
      assert.equal(platform.threads.size, 0);
      assert.equal(platform.locks.size, 0);
      assert.equal(platform.agentInputs.length, 0);
    },
  },
  {
    id: "threads.trusted-identity-and-mutations",
    async run({ request, platform }) {
      platform.seedThread("owned");
      platform.seedThread("foreign", "another-user");
      const listed = await request(
        "GET",
        "/threads?agentId=default&userId=another-user",
      );
      assert.equal(listed.status, 200);
      assert.deepEqual(
        listed.body.threads.map((thread) => thread.id),
        ["owned"],
      );
      const update = await request("PATCH", "/threads/owned", {
        agentId: "default",
        userId: "another-user",
        name: "New name",
      });
      assert.equal(update.status, 200);
      assert.equal(update.body.name, "New name");
      assert.equal(platform.threads.get("owned").userId, "test-user");
      const archive = await request("POST", "/threads/owned/archive", {
        agentId: "default",
      });
      assert.equal(archive.status, 200);
      assert.equal(platform.threads.get("owned").archived, true);
      const deleted = await request("DELETE", "/threads/owned", {
        agentId: "default",
      });
      assert.ok([200, 204].includes(deleted.status));
      assert.equal(platform.threads.has("owned"), false);
      assert.equal(platform.threads.has("foreign"), true);
    },
  },
  {
    id: "memories.crud-and-subscriptions",
    async run({ request, platform }) {
      const created = await request("POST", "/memories", {
        content: "Prefer concise replies",
        kind: "topical",
        userId: "spoof",
      });
      assert.equal(created.status, 201);
      const memory = created.body.memory;
      assert.equal(memory.userId, "test-user");
      const listing = await request("GET", "/memories?userId=spoof");
      assert.equal(listing.status, 200);
      assert.equal(listing.body.memories[0].id, memory.id);
      const recalled = await request("POST", "/memories/recall", {
        query: "preferences",
        limit: 2,
      });
      assert.equal(recalled.status, 200);
      assert.equal(recalled.body.memories.length, 1);
      const updated = await request("PATCH", `/memories/${memory.id}`, {
        content: "Prefer code examples",
        kind: "operational",
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.retiredId, memory.id);
      assert.equal(
        (await request("DELETE", `/memories/${updated.body.memory.id}`)).status,
        204,
      );
      const subscription = await request("POST", "/memories/subscribe", {});
      assert.equal(subscription.body.projectJoinToken, "project-token");
      for (const call of platform.requests.filter((entry) =>
        entry.path.startsWith("/api/memories"),
      )) {
        assert.equal(call.headers["x-cpki-user-id"], "test-user");
        assert.equal(call.body?.userId, undefined);
      }
    },
  },
  {
    id: "memories.validation-and-upstream-error",
    async run({ request, platform }) {
      for (const body of [
        { query: "" },
        { query: "valid", limit: 0 },
        { query: "valid", limit: 1.5 },
        { query: "valid", scope: "all" },
      ]) {
        assert.equal(
          (await request("POST", "/memories/recall", body)).status,
          400,
        );
      }
      assert.equal(
        (await request("POST", "/memories", { content: "x", kind: "invalid" }))
          .status,
        400,
      );
      assert.equal(
        platform.requests.filter((call) =>
          call.path.startsWith("/api/memories"),
        ).length,
        0,
      );
      platform.faults.http.set("GET /api/memories", {
        status: 500,
        body: { error: "private failure" },
      });
      assert.equal((await request("GET", "/memories")).status, 502);
    },
  },
  {
    id: "annotation.trusted-user-and-idempotency-key",
    async run({ request, platform }) {
      const response = await request("POST", "/annotate", {
        threadId: "thread",
        type: "user_action",
        clientEventId: "stable-id",
        userId: "spoof",
        payload: { action: "accept" },
      });
      assert.equal(response.status, 200);
      const call = platform.requests.find(
        (entry) => entry.path === "/connector/annotate/stable-id",
      );
      assert.equal(call.method, "PUT");
      assert.equal(call.body.userId, "test-user");
      assert.deepEqual(call.body.payload, { action: "accept" });
    },
  },
  {
    id: "run.durable-events-and-aimock",
    async run({ request, platform }) {
      const input = runInput();
      const response = await request("POST", "/agent/default/run", input);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, {
        threadId: input.threadId,
        runId: input.runId,
        joinToken: `run-token-${input.runId}`,
        realtime: {
          clientUrl: `${platform.wsUrl}/client`,
          topic: `thread:${input.threadId}`,
        },
      });
      assert.ok(platform.joins.length > 0);
      await platform.waitFor(() =>
        platform.events.some((event) => event.type === "RUN_FINISHED"),
      );
      assert.equal(platform.mock.getRequests().length, 1);
      assert.equal(platform.agentInputs.length, 1);
      assert.equal(platform.events[0].type, "RUN_STARTED");
      assert.ok(
        platform.events.some(
          (event) =>
            event.type === "TEXT_MESSAGE_CONTENT" &&
            event.delta === "Hello from AIMock.",
        ),
      );
      assert.equal(platform.locks.size, 0);
      assert.equal(
        new Set(platform.events.map((event) => event.metadata.cpki_event_id))
          .size,
        platform.events.length,
      );
      platform.events.forEach((event, index) => {
        assert.equal(event.metadata.cpki_event_seq, index + 1);
        assert.equal(event.threadId, input.threadId);
        assert.equal(event.runId, input.runId);
      });
    },
  },
  {
    id: "run.join-rejection-cleans-lock",
    async run({ request, platform }) {
      platform.faults.joinReject = true;
      const response = await request("POST", "/agent/default/run", runInput());
      assert.equal(response.status, 502);
      assert.equal(platform.agentInputs.length, 0);
      await platform.waitFor(() => platform.locks.size === 0);
    },
  },
  {
    id: "run.join-before-success",
    async run({ request, platform }) {
      platform.faults.joinDelayMs = 150;
      const response = await request("POST", "/agent/default/run", runInput());
      assert.equal(response.status, 200);
      assert.ok(
        platform.joins.length > 0,
        "Runtime returned before gateway accepted join",
      );
      await platform.waitFor(() =>
        platform.events.some((event) => event.type === "RUN_FINISHED"),
      );
    },
  },
  {
    id: "run.conflict-does-not-start-agent",
    async run({ request, platform }) {
      platform.seedThread("locked");
      platform.locks.set("locked", {
        runId: "existing",
        userId: "test-user",
        agentId: "default",
      });
      const response = await request(
        "POST",
        "/agent/default/run",
        runInput({ threadId: "locked" }),
      );
      assert.equal(response.status, 409);
      assert.equal(platform.agentInputs.length, 0);
      assert.equal(platform.locks.get("locked").runId, "existing");
    },
  },
  {
    id: "run.replay-after-disconnect",
    async run({ request, platform }) {
      platform.faults.disconnectAfterPersist = 1;
      const response = await request("POST", "/agent/default/run", runInput());
      assert.equal(response.status, 200);
      await platform.waitFor(
        () => platform.events.some((event) => event.type === "RUN_FINISHED"),
        12000,
      );
      assert.equal(platform.agentInputs.length, 1, "Reconnect reran the agent");
      const first = platform.events[0];
      const replays = platform.attempts.filter(
        (event) =>
          event.metadata.cpki_event_id === first.metadata.cpki_event_id,
      );
      assert.ok(replays.length >= 2, "Unacknowledged event was not replayed");
      for (const event of replays) assert.deepEqual(event, first);
    },
  },
  {
    id: "telemetry.lifecycle-without-content",
    async run({ request, platform }) {
      const input = runInput({
        messages: [
          {
            id: "secret-message",
            role: "user",
            content: "sensitive customer text",
          },
        ],
      });
      assert.equal(
        (await request("POST", "/agent/default/run", input)).status,
        200,
      );
      await platform.waitFor(() =>
        platform.telemetry.some(
          (event) => event.event === "oss.runtime.agent_execution_stream_ended",
        ),
      );
      const names = platform.telemetry.map((event) => event.event);
      for (const name of [
        "oss.runtime.instance_created",
        "oss.runtime.copilot_request_created",
        "oss.runtime.agent_execution_stream_started",
        "oss.runtime.agent_execution_stream_ended",
      ])
        assert.ok(names.includes(name), `Missing ${name}`);
      const encoded = JSON.stringify(platform.telemetry);
      assert.ok(!encoded.includes(platform.apiKey));
      assert.ok(!encoded.includes("sensitive customer text"));
      for (const event of platform.telemetry) {
        assert.equal(typeof event.ts, "number");
        assert.equal(typeof event.package?.name, "string");
        assert.equal(typeof event.global_properties, "object");
      }
    },
  },
];
