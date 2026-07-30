import { expect, test, vi } from "vitest";
import { LiveDeliverySession } from "./live-session-transport.js";
import type { LiveSessionDelivery } from "./live-session-transport.js";
import type { RealtimeGatewayDeliveryChannel } from "./realtime-gateway.js";

function delivery(): LiveSessionDelivery {
  return {
    protocol: "channel_session_v1",
    deliveryId: "delivery-run-replay",
    deliveryCode: "delivery-code-run-replay",
    sessionTopic: "channel_session:delivery-run-replay",
    canonicalThreadId: "thread-run-replay",
    appUserId: "app-user-run-replay",
    channelId: "channel-run-replay",
    adapter: "slack",
    turn: {
      id: "turn-run-replay",
      eventId: "event-run-replay",
      receivedAt: "2026-07-29T00:00:00.000Z",
      input: { kind: "text", text: "hello" },
    },
  };
}

test("run-open retries one ambiguous reply loss with the identical request", async () => {
  const requests: unknown[] = [];
  const channel: RealtimeGatewayDeliveryChannel = {
    push: vi.fn(async (event, payload) => {
      if (event !== "channel.run.open.v1") return {};
      requests.push(payload);
      if (requests.length === 1) {
        throw new Error("realtime gateway session push timed out");
      }
      return {
        deliveryId: "delivery-run-replay",
        callId: "call-run-replay",
        responseId: "response-run-replay",
        threadId: "thread-run-replay",
        runId: "run-replayed",
        runnerToken: "runner-token-replayed",
        runnerTokenExpiresAt: "2026-07-29T00:05:00.000Z",
      };
    }),
    on: vi.fn(),
    leave: vi.fn(),
  };
  const session = new LiveDeliverySession(
    delivery(),
    "runtime-run-replay",
    channel,
    undefined,
    60_000,
  );

  try {
    const opened = await session.openRun({
      callId: "call-run-replay",
      responseId: "response-run-replay",
      agentId: "support",
    });

    expect(opened.runId).toBe("run-replayed");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  } finally {
    session.leave();
  }
});

test("run-close retries one ambiguous reply loss with the identical request", async () => {
  const requests: unknown[] = [];
  const channel: RealtimeGatewayDeliveryChannel = {
    push: vi.fn(async (event, payload) => {
      if (event !== "channel.run.close.v1") return {};
      requests.push(payload);
      if (requests.length === 1) {
        throw new Error("realtime gateway session push timed out");
      }
      return {};
    }),
    on: vi.fn(),
    leave: vi.fn(),
  };
  const session = new LiveDeliverySession(
    delivery(),
    "runtime-run-replay",
    channel,
    undefined,
    60_000,
  );

  try {
    await session.closeRun("call-run-replay", "complete");

    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  } finally {
    session.leave();
  }
});
