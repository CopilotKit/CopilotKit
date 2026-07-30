import { HttpAgent } from "@ag-ui/client";
import type {
  ChannelAgentLifecycleArgs,
  RunRenderer,
} from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import { LiveSessionAdapter } from "./live-session-adapter.js";
import type { LiveSessionAdapterOptions } from "./live-session-adapter.js";
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

function setupRunLifecycle(
  runCanonical: LiveSessionAdapterOptions["runCanonical"],
  options: {
    closeError?: Error;
    log?: (message: string, meta?: unknown) => void;
  } = {},
): {
  adapter: LiveSessionAdapter;
  args: ChannelAgentLifecycleArgs;
  closePayloads: unknown[];
  teardown(): void;
} {
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
        if (options.closeError) throw options.closeError;
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
    runCanonical,
    log: options.log,
  });
  const args: ChannelAgentLifecycleArgs = {
    replyTarget: { session, delivery },
    agent: new HttpAgent({ url: "https://agent.example" }),
    renderer: emptyRenderer(),
    tools: [],
    context: [],
    execute: async () => ({ iterations: 0, interrupted: false }),
  };

  return {
    adapter,
    args,
    closePayloads,
    teardown: () => session.leave(),
  };
}

test("LiveSessionAdapter closes the Gateway run as failed when runCanonical rejects", async () => {
  const canonicalFailure = Object.assign(new Error("canonical agent failed"), {
    code: "AGENT_FAILED",
  });
  const { adapter, args, closePayloads, teardown } = setupRunLifecycle(
    async () => {
      throw canonicalFailure;
    },
  );

  try {
    await expect(adapter.runAgentLifecycle(args)).rejects.toMatchObject({
      message: "canonical agent failed",
      code: "AGENT_FAILED",
    });
  } finally {
    teardown();
  }

  expect(closePayloads).toEqual([
    expect.objectContaining({
      status: "failed",
    }),
  ]);
});

test("LiveSessionAdapter closes the canonical run complete before surfacing a provider failure", async () => {
  const deliveryError = new Error("provider delivery failed");
  const { adapter, args, closePayloads, teardown } = setupRunLifecycle(
    async () => ({
      iterations: 1,
      interrupted: false,
      deliveryError,
    }),
  );

  try {
    await expect(adapter.runAgentLifecycle(args)).rejects.toBe(deliveryError);
  } finally {
    teardown();
  }

  expect(closePayloads).toEqual([
    expect.objectContaining({
      status: "complete",
    }),
  ]);
});

test("LiveSessionAdapter logs a run-close failure without its raw message", async () => {
  const log = vi.fn();
  const { adapter, args, teardown } = setupRunLifecycle(
    async () => ({
      iterations: 1,
      interrupted: false,
    }),
    {
      closeError: new Error(
        "provider body secret-close-body with opaque pref_v1_secret-close",
      ),
      log,
    },
  );

  try {
    await adapter.runAgentLifecycle(args);
  } finally {
    teardown();
  }

  expect(log).toHaveBeenCalledWith("channel run close failed", {
    errorCategory: "unknown",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret-close-body");
  expect(JSON.stringify(log.mock.calls)).not.toContain("pref_v1_secret-close");
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
      "slack.status",
      "slack.stream.start",
      "slack.status",
      "slack.stream.append",
      "slack.stream.stop",
    ]);
    expect(effects[3]?.delta).toBe(
      "Partial answer\n\n_(response interrupted)_",
    );
    expect(
      effects.some((effect) => effect.kind === "slack.message.create"),
    ).toBe(false);
  } finally {
    session.leave();
  }
});
