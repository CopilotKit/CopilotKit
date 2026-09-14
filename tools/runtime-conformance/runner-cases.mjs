import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

/** Build complete input for every host-language runner. */
function input() {
  return {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content: "hello" }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
}

/** Start a real run and require its authenticated join before HTTP success. */
async function start(context) {
  const body = input();
  assert.equal(
    (await context.request("POST", "/agent/default/run", body)).status,
    200,
  );
  assert.ok(context.platform.joins.some((join) => join.run_id === body.runId));
  return body;
}

/** Leave the agent stream open so cancellation must interrupt network reads. */
function idleAgent(platform) {
  platform.faults.agentKeepOpen = true;
  platform.faults.agentEvents = (body) => [
    { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
    {
      type: "TEXT_MESSAGE_START",
      messageId: "idle-message",
      role: "assistant",
    },
  ];
}

export const runnerCases = [
  {
    id: "runner.idle-heartbeat-reconnect",
    async run(context) {
      const { platform, request } = context;
      idleAgent(platform);
      platform.faults.disconnectHeartbeat = 1;
      const body = await start(context);
      await platform.waitFor(
        () =>
          platform.joins.filter((join) => join.run_id === body.runId).length >=
          2,
        45000,
      );
      assert.equal(platform.faults.disconnectHeartbeat, 0);
      assert.equal(
        platform.agentInputs.length,
        1,
        "reconnect must not rerun the agent",
      );
      assert.equal(
        platform.agentDisconnects.includes(body.runId),
        false,
        "transport loss must not cancel an idle agent with a valid lease",
      );
      assert.equal(
        platform.events.some((event) => event.type === "RUN_ERROR"),
        false,
      );
      assert.ok(
        platform.locks.has(body.threadId),
        "platform lease remains held",
      );
      assert.equal(
        (
          await request("POST", `/agent/default/stop/${body.threadId}`, {
            runId: body.runId,
          })
        ).status,
        200,
      );
      await platform.waitFor(() => !platform.locks.has(body.threadId));
    },
  },
  {
    id: "runner.agent-cannot-forge-event-identity",
    async run(context) {
      context.platform.faults.agentEvents = (body) => [
        { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
        ...["first", "second"].map((name) => ({
          type: "CUSTOM",
          name,
          value: { expected: name },
          metadata: {
            cpki_event_id: "agent-forged",
            cpki_event_seq: 9000,
            traceTag: name,
          },
        })),
        { type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId },
      ];
      const body = await start(context);
      await context.platform.waitFor(
        () =>
          context.platform.events.some(
            (event) => event.type === "RUN_FINISHED",
          ) ||
          context.platform.attempts.some(
            (event) => event.metadata?.cpki_event_id === "agent-forged",
          ),
      );
      assert.ok(
        context.platform.attempts.every(
          (event) => event.metadata?.cpki_event_id !== "agent-forged",
        ),
        "Agent-supplied identity reached the durable gateway",
      );
      const events = context.platform.events.filter(
        (event) => event.runId === body.runId,
      );
      const custom = events.filter((event) => event.type === "CUSTOM");

      assert.equal(
        custom.length,
        2,
        "Agent metadata must not collapse distinct events",
      );
      assert.deepEqual(
        custom.map((event) => event.metadata.traceTag),
        ["first", "second"],
      );
      assert.equal(
        new Set(events.map((event) => event.metadata.cpki_event_id)).size,
        events.length,
      );
      assert.ok(
        events.every(
          (event) => event.metadata.cpki_event_id !== "agent-forged",
        ),
      );
      assert.deepEqual(
        events.map((event) => event.metadata.cpki_event_seq),
        events.map((_, index) => index + 1),
      );
    },
  },
  {
    id: "runner.client-tool-history-is-preserved",
    async run(context) {
      const body = input();
      const prior = {
        id: "prior-assistant",
        role: "assistant",
        toolCalls: [
          {
            id: "prior-call",
            type: "function",
            function: { name: "render_a2ui", arguments: "{}" },
          },
        ],
      };
      const result = {
        id: "prior-result",
        role: "tool",
        toolCallId: "prior-call",
        content: "rendered",
      };
      const fresh = body.messages[0];
      body.messages = [prior, result, fresh];
      context.platform.seedThread(body.threadId, "test-user", {
        messages: [
          {
            ...prior,
            toolCalls: [{ id: "prior-call", name: "render_a2ui", args: "{}" }],
          },
          result,
        ],
      });

      assert.equal(
        (await context.request("POST", "/agent/default/run", body)).status,
        200,
      );
      await context.platform.waitFor(
        () => context.platform.agentInputs.length === 1,
      );

      assert.deepEqual(context.platform.agentInputs[0].messages, body.messages);
      await context.platform.waitFor(() =>
        context.platform.events.some((event) => event.type === "RUN_FINISHED"),
      );
      const started = context.platform.events.find(
        (event) => event.type === "RUN_STARTED",
      );
      assert.deepEqual(started.input.messages, [fresh]);
    },
  },
  {
    id: "runner.idle-stop-preserves-input",
    async run(context) {
      const { platform } = context;
      platform.faults.agentKeepOpen = true;
      platform.faults.agentEvents = [];
      const body = await start(context);
      await platform.waitFor(() => platform.agentInputs.length === 1);
      platform.stopRun(body.runId);
      await platform.waitFor(() =>
        platform.events.some(
          (event) =>
            event.runId === body.runId &&
            ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
        ),
      );
      const events = platform.events.filter(
        (event) => event.runId === body.runId,
      );
      assert.equal(
        events[0].type,
        "RUN_STARTED",
        "Early stop lost canonical input before the first agent event",
      );
      assert.equal(
        events.filter((event) => event.type === "RUN_STARTED").length,
        1,
      );
      assert.equal(events[0].input.threadId, body.threadId);
      assert.equal(events[0].input.runId, body.runId);
      assert.deepEqual(events[0].input.messages, body.messages);
      // Abort timing can produce RUN_ERROR or RUN_FINISHED in TypeScript.
      // This case requires input persistence, not a new stop-event contract.
      assert.ok(["RUN_FINISHED", "RUN_ERROR"].includes(events.at(-1).type));
    },
  },
  {
    id: "runner.initial-agent-error-preserves-input",
    async run(context) {
      const { platform } = context;
      platform.faults.http.set("POST /agent", {
        status: 503,
        body: { error: "fixture unavailable" },
      });
      const body = await start(context);
      await platform.waitFor(() =>
        platform.events.some(
          (event) =>
            event.runId === body.runId &&
            ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
        ),
      );
      const events = platform.events.filter(
        (event) => event.runId === body.runId,
      );
      assert.equal(
        events[0].type,
        "RUN_STARTED",
        "Initial agent error lost canonical input",
      );
      assert.equal(
        events.filter((event) => event.type === "RUN_STARTED").length,
        1,
      );
      assert.equal(events[0].input.threadId, body.threadId);
      assert.equal(events[0].input.runId, body.runId);
      assert.deepEqual(events[0].input.messages, body.messages);
      assert.equal(events.at(-1).type, "RUN_ERROR");
    },
  },
  {
    id: "runner.missing-terminal-is-not-success",
    async run(context) {
      context.platform.faults.agentEvents = (body) => [
        { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "unfinished-text",
          role: "assistant",
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "unfinished-text",
          delta: "Partial answer",
        },
        {
          type: "TOOL_CALL_START",
          toolCallId: "unfinished-tool",
          toolCallName: "example",
          parentMessageId: "unfinished-text",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "unfinished-tool",
          delta: '{"value":',
        },
      ];
      const body = await start(context);
      await context.platform.waitFor(() =>
        context.platform.events.some(
          (event) =>
            event.runId === body.runId &&
            ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
        ),
      );
      const events = context.platform.events.filter(
        (event) => event.runId === body.runId,
      );
      assert.equal(events.at(-1).type, "RUN_ERROR");
      assert.equal(events.at(-1).code, "INCOMPLETE_STREAM");
      assert.ok(
        events.some(
          (event) =>
            event.type === "TEXT_MESSAGE_END" &&
            event.messageId === "unfinished-text",
        ),
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === "TOOL_CALL_END" &&
            event.toolCallId === "unfinished-tool",
        ),
      );
      const result = events.find(
        (event) =>
          event.type === "TOOL_CALL_RESULT" &&
          event.toolCallId === "unfinished-tool",
      );
      assert.equal(JSON.parse(result.content).reason, "missing_terminal_event");
      assert.equal(
        events.some((event) => event.type === "RUN_FINISHED"),
        false,
      );
    },
  },
  {
    id: "runner.negotiated-batches",
    async run(context) {
      const { platform } = context;
      platform.faults.batchCapability = true;
      platform.faults.agentEvents = (body) => [
        { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "batch-message",
          role: "assistant",
        },
        ...Array.from({ length: 80 }, (_, index) => ({
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "batch-message",
          delta: String(index),
        })),
        { type: "TEXT_MESSAGE_END", messageId: "batch-message" },
        { type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId },
      ];
      const body = await start(context);
      await platform.waitFor(() =>
        platform.events.some(
          (event) =>
            event.runId === body.runId && event.type === "RUN_FINISHED",
        ),
      );
      const frames = platform.frames.filter((frame) =>
        ["event", "events"].includes(frame.name),
      );
      assert.ok(
        frames.length > 0 && frames.every((frame) => frame.name === "events"),
        "Runner ignored negotiated batch capability",
      );
      assert.ok(frames.every((frame) => frame.payload.events.length <= 32));
      assert.ok(
        frames.some((frame) => frame.payload.events.length > 1),
        "Burst output never formed a batch",
      );
      assert.equal(
        platform.events.filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
          .length,
        80,
      );
    },
  },
  {
    id: "runner.retryable-join-drain",
    async run(context) {
      context.platform.faults.joinDrain = 1;
      const body = await start(context);
      await context.platform.waitFor(() =>
        context.platform.events.some(
          (event) =>
            event.runId === body.runId && event.type === "RUN_FINISHED",
        ),
      );
      assert.ok(
        context.platform.frames.filter((frame) => frame.name === "phx_join")
          .length >= 2,
      );
      assert.equal(context.platform.agentInputs.length, 1);
    },
  },
  {
    id: "runner.planned-restart-replays-without-rerun",
    async run(context) {
      context.platform.faults.plannedCloseAfterPersist = 1;
      const body = await start(context);
      await context.platform.waitFor(
        () =>
          context.platform.events.some(
            (event) =>
              event.runId === body.runId && event.type === "RUN_FINISHED",
          ),
        10000,
      );
      assert.equal(context.platform.agentInputs.length, 1);
      assert.ok(context.platform.joins.length >= 2);
      const ids = context.platform.events.map(
        (event) => event.metadata.cpki_event_id,
      );
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(
        context.platform.attempts.length > context.platform.events.length,
      );
    },
  },
  {
    id: "runner.completion-waits-for-final-ack",
    async run(context) {
      context.platform.faults.holdFinalAcks = true;
      await start(context);
      await context.platform.waitFor(() =>
        context.platform.events.some((event) => event.type === "RUN_FINISHED"),
      );
      await delay(100);
      assert.equal(
        context.platform.telemetry.some((event) =>
          event.event.endsWith("stream_ended"),
        ),
        false,
        "Runner reported completion before durable confirmation",
      );
      context.platform.releaseAcknowledgements();
      await context.platform.waitFor(() =>
        context.platform.telemetry.some((event) =>
          event.event.endsWith("stream_ended"),
        ),
      );
    },
  },
  {
    id: "runner.gateway-stop-cancels-idle-agent",
    async run(context) {
      idleAgent(context.platform);
      const body = await start(context);
      await context.platform.waitFor(() =>
        context.platform.events.some(
          (event) => event.type === "TEXT_MESSAGE_START",
        ),
      );
      context.platform.stopRun(body.runId);
      await context.platform.waitFor(
        () => context.platform.agentDisconnects.includes(body.runId),
        3000,
      );
      await context.platform.waitFor(() =>
        context.platform.events.some(
          (event) =>
            event.runId === body.runId &&
            ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
        ),
      );
      assert.equal(context.platform.locks.has(body.threadId), false);
    },
  },
  {
    id: "runner.cross-user-stop-denied",
    async run(context) {
      idleAgent(context.platform);
      const body = await start(context);
      await context.platform.waitFor(() =>
        context.platform.events.some(
          (event) => event.type === "TEXT_MESSAGE_START",
        ),
      );
      assert.equal(
        (
          await context.request(
            "POST",
            `/agent/default/stop/${body.threadId}`,
            { runId: body.runId },
            { "x-test-user-id": "another-user" },
          )
        ).status,
        404,
      );
      await delay(50);
      assert.equal(
        context.platform.agentDisconnects.includes(body.runId),
        false,
      );
    },
  },
  {
    id: "runner.stale-stop-cannot-cancel-current-run",
    async run(context) {
      idleAgent(context.platform);
      const body = await start(context);
      await context.platform.waitFor(() =>
        context.platform.events.some(
          (event) => event.type === "TEXT_MESSAGE_START",
        ),
      );
      const response = await context.request(
        "POST",
        `/agent/default/stop/${body.threadId}`,
        { runId: randomUUID() },
      );
      assert.equal(response.status, 200);
      assert.equal(response.body.stopped, false);
      await delay(50);
      assert.equal(
        context.platform.agentDisconnects.includes(body.runId),
        false,
      );
    },
  },
];
