import { HttpAgent } from "@ag-ui/client";
import type {
  ChannelAgentLifecycleArgs,
  RunRenderer,
} from "@copilotkit/channels-core";
import { expect, test } from "vitest";
import { LiveSessionAdapter } from "./live-session-adapter.js";
import {
  LiveDeliverySession,
  LiveSessionTransport,
} from "./live-session-transport.js";
import type { LiveSessionDelivery } from "./live-session-transport.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";

const delivery: LiveSessionDelivery = {
  protocol: "channel_session_v1",
  deliveryId: "delivery-test",
  deliveryCode: "dcode_test",
  sessionTopic: "channel_session:delivery-test",
  canonicalThreadId: "canonical-thread",
  appUserId: "app-user-test",
  channelId: "channel-test",
  adapter: "slack",
  turn: {
    id: "turn-test",
    eventId: "event-test",
    receivedAt: "2026-07-29T00:00:00.000Z",
    input: { kind: "text", text: "hello" },
  },
};

function emptyRenderer(): RunRenderer {
  return {
    subscriber: {},
    markInterrupted: async () => {},
    getCapturedToolCalls: () => [],
    getPendingInterrupt: () => undefined,
    clearPendingInterrupt: () => {},
  };
}

function readRunOpenIds(payload: unknown): {
  callId: string;
  responseId: string;
} {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("callId" in payload) ||
    typeof payload.callId !== "string" ||
    !("responseId" in payload) ||
    typeof payload.responseId !== "string"
  ) {
    throw new Error("invalid run-open payload");
  }
  return { callId: payload.callId, responseId: payload.responseId };
}

test("LiveSessionAdapter closes the Gateway run as failed when runCanonical rejects", async () => {
  const closePayloads: unknown[] = [];
  const deliveryChannel: RealtimeGatewayDeliveryChannel = {
    on: () => {},
    leave: () => {},
    push: async (event, payload) => {
      if (event === "channel.run.open.v1") {
        const request = readRunOpenIds(payload);
        return {
          deliveryId: delivery.deliveryId,
          callId: request.callId,
          responseId: request.responseId,
          threadId: delivery.canonicalThreadId,
          runId: "canonical-run",
          runnerToken: "runner-token",
          runnerTokenExpiresAt: "2026-07-29T00:05:00.000Z",
        };
      }
      if (event === "channel.run.close.v1") {
        closePayloads.push(payload);
      }
      return {};
    },
  };
  const projectSession: RealtimeGatewaySession = {
    on: () => {},
    push: async () => ({}),
  };
  const transport = new LiveSessionTransport({
    session: projectSession,
    runtimeInstanceId: "runtime-test",
  });
  const session = new LiveDeliverySession(
    delivery,
    "runtime-test",
    deliveryChannel,
  );
  const adapter = new LiveSessionAdapter({
    transport,
    loadHistory: async () => [],
    runCanonical: async () => {
      throw Object.assign(new Error("canonical agent failed"), {
        code: "AGENT_FAILED",
      });
    },
  });
  const args: ChannelAgentLifecycleArgs = {
    replyTarget: { session, delivery },
    agent: new HttpAgent({ url: "https://agent.example" }),
    renderer: emptyRenderer(),
    tools: [],
    context: [],
    execute: async () => ({ iterations: 0, interrupted: false }),
  };

  try {
    await expect(adapter.runAgentLifecycle(args)).rejects.toMatchObject({
      message: "canonical agent failed",
      code: "AGENT_FAILED",
    });
  } finally {
    session.leave();
  }

  expect(closePayloads).toEqual([
    expect.objectContaining({
      status: "failed",
    }),
  ]);
});

test("managed Slack keeps a partial run error in one native stream", async () => {
  const effects: Array<Record<string, unknown>> = [];
  const deliveryChannel: RealtimeGatewayDeliveryChannel = {
    on: () => {},
    leave: () => {},
    push: async (event, payload) => {
      if (
        event === "channel.effect.v1" &&
        typeof payload === "object" &&
        payload !== null &&
        "payload" in payload &&
        typeof payload.payload === "object" &&
        payload.payload !== null &&
        "effect" in payload.payload &&
        typeof payload.payload.effect === "object" &&
        payload.payload.effect !== null
      ) {
        const effect = payload.payload.effect as Record<string, unknown>;
        effects.push(effect);
        const seq = effect.seq as number;
        return { receivedThrough: seq, appliedThrough: seq };
      }
      return {};
    },
  };
  const projectSession: RealtimeGatewaySession = {
    on: () => {},
    push: async () => ({}),
  };
  const transport = new LiveSessionTransport({
    session: projectSession,
    runtimeInstanceId: "runtime-test",
  });
  const session = new LiveDeliverySession(
    delivery,
    "runtime-test",
    deliveryChannel,
  );
  const adapter = new LiveSessionAdapter({
    transport,
    loadHistory: async () => [],
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
  });
  const renderer = adapter.createRunRenderer({ session, delivery });

  renderer.subscriber.onTextMessageContentEvent?.({
    event: { messageId: "message-1", delta: "Partial answer" },
  } as never);
  await renderer.subscriber.onRunErrorEvent?.({
    event: { message: "agent failed" },
  } as never);

  try {
    expect(effects.map((effect) => effect.kind)).toEqual([
      "slack.stream.start",
      "slack.stream.append",
      "slack.stream.stop",
    ]);
    expect(effects[1]?.delta).toBe(
      "Partial answer\n\n_(response interrupted)_",
    );
    expect(
      effects.some((effect) => effect.kind === "slack.message.create"),
    ).toBe(false);
  } finally {
    session.leave();
  }
});
