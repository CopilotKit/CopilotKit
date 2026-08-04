import { EventType } from "@ag-ui/client";
import { expect, test, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import {
  ChannelDeliveryTransport,
  ClaimedChannelDelivery,
} from "./delivery-transport.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";
import { assertDeliveryPacket } from "./delivery-contracts.js";
import type { ChannelProviderPayload } from "./delivery-contracts.js";
import { SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY } from "./delivery-contracts.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";

function preparedDelivery(
  capabilities: PreparedChannelDelivery["capabilities"] = [
    SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY,
  ],
): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_slack_stream_01",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_support",
    channelName: "support",
    canonicalThreadId: "thread_slack_stream",
    appUserId: "slack:T1:U1",
    adapter: "slack",
    capabilities,
    turn: {
      eventId: "evt_slack_stream",
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: {
        kind: "text",
        text: "hello",
        messageRef: { id: "pref_v1_message_slackStream_123" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: true,
        },
      },
    },
  };
}

function setup(capabilities?: PreparedChannelDelivery["capabilities"]) {
  const delivery = preparedDelivery(capabilities);
  const payloads: ChannelProviderPayload[] = [];
  const deliveryChannel: RealtimeGatewayDeliveryChannel = {
    joinReply: delivery,
    push: vi.fn(async (_event, value) => {
      assertDeliveryPacket(value);
      if (
        value.payload.kind === "channel.delivery.terminal" ||
        value.payload.kind === "channel.delivery.commit"
      ) {
        throw new TypeError("expected a provider delivery packet");
      }
      payloads.push(value.payload);
      return {
        deliveryId: value.deliveryId,
        seq: value.seq,
        packetId: value.packetId,
        phase: "applied",
        result:
          value.payload.kind === "slack.stream.start"
            ? {
                providerReference: "pref_v1_slack_stream_01",
                providerMessageId:
                  "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
              }
            : {},
      };
    }),
    on: vi.fn(),
    onClose: vi.fn(),
    leave: vi.fn(),
  };
  const claimedDelivery = new ClaimedChannelDelivery(
    delivery,
    { ownerGeneration: 1, runtimeInstanceId: "rti_slack_stream_01" },
    deliveryChannel,
    async () => ({
      channel: deliveryChannel,
      owner: {
        ownerGeneration: 1,
        runtimeInstanceId: "rti_slack_stream_01",
      },
    }),
  );
  const session: RealtimeGatewaySession = {
    push: vi.fn(),
    on: vi.fn(),
  };
  const adapter = new DeliveryAdapter({
    channelName: "support",
    transport: new ChannelDeliveryTransport({
      session,
      runtimeInstanceId: "rti_slack_stream_01",
    }),
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });

  return {
    adapter,
    payloads,
    target: { claimedDelivery, delivery },
    teardown: () => claimedDelivery.leave(),
  };
}

/** Yield text chunks through the adapter's public streaming boundary. */
async function* streamChunks(...chunks: string[]): AsyncGenerator<string> {
  yield* chunks;
}

test("starts a managed Slack stream with the first text delta", async () => {
  vi.useFakeTimers();
  const fixture = setup();
  try {
    const renderer = fixture.adapter.createRunRenderer(fixture.target);

    renderer.subscriber.onTextMessageContentEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-1",
        delta: "Hello",
      },
      textMessageBuffer: "",
    } as never);
    await renderer.finish?.();

    expect(fixture.payloads).toEqual([
      { kind: "slack.stream.start", initialText: "Hello" },
      { kind: "slack.thread.status", status: "" },
      {
        kind: "slack.stream.stop",
        providerReference: "pref_v1_slack_stream_01",
      },
    ]);
  } finally {
    fixture.teardown();
    vi.useRealTimers();
  }
});

test("starts an explicit managed Slack stream with its first text chunk", async () => {
  const fixture = setup();

  try {
    await fixture.adapter.stream(
      fixture.target,
      streamChunks("", "Hello", " world"),
    );

    expect(fixture.payloads).toEqual([
      { kind: "slack.stream.start", initialText: "Hello" },
      {
        kind: "slack.stream.append",
        providerReference: "pref_v1_slack_stream_01",
        delta: " world",
        fullText: "Hello world",
      },
      {
        kind: "slack.stream.stop",
        providerReference: "pref_v1_slack_stream_01",
      },
    ]);
  } finally {
    fixture.teardown();
  }
});

test("uses the legacy append shape when the gateway does not negotiate snapshots", async () => {
  const fixture = setup([]);

  try {
    await fixture.adapter.stream(
      fixture.target,
      streamChunks("Hello", " world"),
    );

    expect(fixture.payloads).toContainEqual({
      kind: "slack.stream.append",
      providerReference: "pref_v1_slack_stream_01",
      delta: " world",
    });
  } finally {
    fixture.teardown();
  }
});

test("preserves the managed Slack stream lifecycle without text chunks", async () => {
  const fixture = setup();

  try {
    await fixture.adapter.stream(fixture.target, streamChunks(""));

    expect(fixture.payloads).toEqual([
      { kind: "slack.stream.start" },
      {
        kind: "slack.stream.stop",
        providerReference: "pref_v1_slack_stream_01",
      },
    ]);
  } finally {
    fixture.teardown();
  }
});
