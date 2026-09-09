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
        403,
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
