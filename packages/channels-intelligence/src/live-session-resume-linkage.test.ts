import { expect, test, vi } from "vitest";
import {
  ActionRegistry,
  FakeAgent,
  InMemoryActionStore,
  MemoryStore,
  Thread,
} from "@copilotkit/channels-core";
import type { ThreadDeps } from "@copilotkit/channels-core";
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

function delivery(): LiveSessionDelivery {
  return {
    protocol: "channel_session_v1",
    deliveryId: "delivery-resume-linkage",
    deliveryCode: "delivery-code-resume-linkage",
    sessionTopic: "channel_session:delivery-resume-linkage",
    canonicalThreadId: "thread-resume-linkage",
    appUserId: "app-user-resume-linkage",
    channelId: "channel-resume-linkage",
    adapter: "slack",
    turn: {
      id: "turn-resume-linkage",
      eventId: "event-resume-linkage",
      receivedAt: "2026-07-29T00:00:00.000Z",
      input: { kind: "text", text: "hello" },
    },
  };
}

test("Thread.resume opens a canonical run linked to the interrupted run", async () => {
  const admitted = delivery();
  const openRequests: Array<Record<string, unknown>> = [];
  const deliveryChannel: RealtimeGatewayDeliveryChannel = {
    push: vi.fn(async (event, payload) => {
      if (event !== "channel.run.open.v1") return {};
      const request = payload as Record<string, unknown>;
      openRequests.push(request);
      const runId =
        openRequests.length === 1 ? "run-interrupted" : "run-resumed";
      return {
        deliveryId: admitted.deliveryId,
        callId: request.callId,
        responseId: request.responseId,
        threadId: admitted.canonicalThreadId,
        runId,
        runnerToken: `runner-token-${runId}`,
        runnerTokenExpiresAt: "2026-07-29T00:05:00.000Z",
      };
    }),
    on: vi.fn(),
    leave: vi.fn(),
  };
  const gatewaySession: RealtimeGatewaySession = {
    push: vi.fn(),
    on: vi.fn(),
  };
  const transport = new LiveSessionTransport({
    session: gatewaySession,
    runtimeInstanceId: "runtime-resume-linkage",
  });
  const runCanonical = vi
    .fn()
    .mockResolvedValueOnce({ iterations: 1, interrupted: true })
    .mockResolvedValueOnce({ iterations: 1, interrupted: false });
  const adapter = new LiveSessionAdapter({
    transport,
    runCanonical,
    loadHistory: async () => [],
  });
  const session = new LiveDeliverySession(
    admitted,
    "runtime-resume-linkage",
    deliveryChannel,
    undefined,
    60_000,
  );
  const deps: ThreadDeps = {
    adapter,
    replyTarget: { session, delivery: admitted },
    conversationKey: admitted.canonicalThreadId,
    registry: new ActionRegistry({ store: new InMemoryActionStore() }),
    agentFactory: () => new FakeAgent(),
    tools: new Map(),
    toolDescriptors: [],
    context: [],
    registerWaiter: () => undefined,
    interruptHandlers: new Map(),
    state: new MemoryStore(),
  };
  const thread = new Thread(deps);

  try {
    await thread.runAgent();
    await thread.resume("approved");

    expect(openRequests).toHaveLength(2);
    expect(openRequests[0]).not.toHaveProperty("parentRunId");
    expect(openRequests[1]).toMatchObject({
      parentRunId: "run-interrupted",
    });
    expect(openRequests[1]).not.toHaveProperty("resume");
  } finally {
    session.leave();
  }
});
