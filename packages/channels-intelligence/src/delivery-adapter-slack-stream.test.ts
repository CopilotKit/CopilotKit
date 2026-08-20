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
  surfaceKind: PreparedChannelDelivery["surfaceKind"] = "message",
): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_slack_stream_01",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_support",
    channelName: "support",
    surfaceId: "surface_support_01",
    canonicalThreadId: "thread_slack_stream",
    appUserId: "slack:T1:U1",
    adapter: "slack",
    capabilities,
    surfaceKind,
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

function setup(
  capabilities?: PreparedChannelDelivery["capabilities"],
  options: {
    distinctMessageReferences?: boolean;
    failStreamAppend?: boolean;
    failStatus?: boolean;
    failStreamStart?: boolean;
    failStreamStop?: boolean;
    dropStreamStartCapability?: boolean;
    surfaceKind?: PreparedChannelDelivery["surfaceKind"];
  } = {},
) {
  const delivery = preparedDelivery(capabilities, options.surfaceKind);
  const payloads: ChannelProviderPayload[] = [];
  let messageCreateCount = 0;
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
      if (options.failStatus && value.payload.kind === "slack.thread.status") {
        return {
          deliveryId: value.deliveryId,
          seq: value.seq,
          packetId: value.packetId,
          phase: "failed",
          result: { error: "status_failed", status: "failed" },
        };
      }
      if (
        options.failStreamStart &&
        value.payload.kind === "slack.stream.start"
      ) {
        return {
          deliveryId: value.deliveryId,
          seq: value.seq,
          packetId: value.packetId,
          phase: "failed",
          result: { error: "stream_start_failed", status: "failed" },
        };
      }
      if (
        options.dropStreamStartCapability &&
        value.payload.kind === "slack.stream.start"
      ) {
        return {
          deliveryId: value.deliveryId,
          seq: value.seq,
          packetId: value.packetId,
          phase: "applied",
          result: {
            capabilityError: "slack_stream_unavailable",
            surfaceKind: "direct_message",
          },
        };
      }
      if (
        options.failStreamAppend &&
        value.payload.kind === "slack.stream.append"
      ) {
        return {
          deliveryId: value.deliveryId,
          seq: value.seq,
          packetId: value.packetId,
          phase: "failed",
          result: { error: "stream_append_failed", status: "failed" },
        };
      }
      if (
        options.failStreamStop &&
        value.payload.kind === "slack.stream.stop"
      ) {
        return {
          deliveryId: value.deliveryId,
          seq: value.seq,
          packetId: value.packetId,
          phase: "failed",
          result: { error: "stream_stop_failed", status: "failed" },
        };
      }
      return {
        deliveryId: value.deliveryId,
        seq: value.seq,
        packetId: value.packetId,
        phase: "applied",
        result: (() => {
          if (value.payload.kind === "slack.stream.start") {
            return {
              providerReference: "pref_v1_slack_stream_01",
              providerMessageId:
                "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
            };
          }
          if (value.payload.kind === "slack.message.create") {
            messageCreateCount += 1;
            return {
              providerReference: options.distinctMessageReferences
                ? `pref_v1_slack_legacy_${messageCreateCount}`
                : "pref_v1_slack_stream_01",
              providerMessageId:
                "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
            };
          }
          return {};
        })(),
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

test("falls back to legacy message creation when managed stream start fails", async () => {
  const fixture = setup(undefined, { failStreamStart: true });

  try {
    await fixture.adapter.stream(fixture.target, streamChunks("Hello"));

    expect(fixture.payloads).toEqual([
      { kind: "slack.stream.start", initialText: "Hello" },
      { kind: "slack.message.create", text: "Hello" },
    ]);
  } finally {
    fixture.teardown();
  }
});

test("falls back to legacy creation when the gateway settles stream start as a dropped capability", async () => {
  const fixture = setup(undefined, {
    surfaceKind: "direct_message",
    dropStreamStartCapability: true,
  });

  try {
    await fixture.adapter.stream(fixture.target, streamChunks("Hello"));

    expect(fixture.payloads).toEqual([
      { kind: "slack.stream.start", initialText: "Hello" },
      { kind: "slack.message.create", text: "Hello" },
    ]);
  } finally {
    fixture.teardown();
  }
});

test("uses native streaming for a direct message surface", async () => {
  const fixture = setup(undefined, { surfaceKind: "direct_message" });

  try {
    await fixture.adapter.stream(
      fixture.target,
      streamChunks("Hello", " world"),
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

test("starts direct-message status before a threaded native stream", async () => {
  vi.useFakeTimers();
  const fixture = setup(undefined, { surfaceKind: "direct_message" });

  try {
    const renderer = fixture.adapter.createRunRenderer(fixture.target);
    await renderer.subscriber.onRunStartedEvent?.({ event: {} } as never);
    renderer.subscriber.onTextMessageContentEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-1",
        delta: "Hello",
      },
      textMessageBuffer: "",
    } as never);
    await renderer.finish?.();

    expect(fixture.payloads[0]).toEqual({
      kind: "slack.thread.status",
      status: "is thinking…",
    });
    expect(fixture.payloads).toContainEqual({
      kind: "slack.stream.start",
      initialText: "Hello",
    });
  } finally {
    fixture.teardown();
    vi.useRealTimers();
  }
});

test("continues a direct-message native reply after status failure", async () => {
  vi.useFakeTimers();
  const fixture = setup(undefined, {
    failStatus: true,
    surfaceKind: "direct_message",
  });

  try {
    const renderer = fixture.adapter.createRunRenderer(fixture.target);
    await renderer.subscriber.onRunStartedEvent?.({ event: {} } as never);
    renderer.subscriber.onTextMessageContentEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-1",
        delta: "Hello",
      },
      textMessageBuffer: "",
    } as never);
    await renderer.finish?.();

    expect(fixture.payloads[0]).toEqual({
      kind: "slack.thread.status",
      status: "is thinking…",
    });
    expect(fixture.payloads).toContainEqual({
      kind: "slack.stream.start",
      initialText: "Hello",
    });
  } finally {
    fixture.teardown();
    vi.useRealTimers();
  }
});

test("rejects a direct-message reply after a native append failure and stops the stream", async () => {
  vi.useFakeTimers();
  const fixture = setup(undefined, {
    failStreamAppend: true,
    surfaceKind: "direct_message",
  });

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
    await vi.runAllTimersAsync();
    renderer.subscriber.onTextMessageContentEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-1",
        delta: " world",
      },
      textMessageBuffer: "Hello",
    } as never);

    await expect(renderer.finish?.()).rejects.toThrow("stream_append_failed");
    expect(fixture.payloads).toContainEqual({
      kind: "slack.stream.start",
      initialText: "Hello",
    });
    expect(fixture.payloads).toContainEqual({
      kind: "slack.stream.stop",
      providerReference: "pref_v1_slack_stream_01",
    });
  } finally {
    fixture.teardown();
    vi.useRealTimers();
  }
});

test("rejects a direct-message reply when native stream stop fails", async () => {
  vi.useFakeTimers();
  const fixture = setup(undefined, {
    failStreamStop: true,
    surfaceKind: "direct_message",
  });

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

    await expect(renderer.finish?.()).rejects.toThrow("stream_stop_failed");
    expect(fixture.payloads).toContainEqual({
      kind: "slack.stream.start",
      initialText: "Hello",
    });
    expect(fixture.payloads).toContainEqual({
      kind: "slack.stream.stop",
      providerReference: "pref_v1_slack_stream_01",
    });
  } finally {
    fixture.teardown();
    vi.useRealTimers();
  }
});

test("starts a long direct-message reply through the native stream", async () => {
  vi.useFakeTimers();
  const fixture = setup(undefined, { surfaceKind: "direct_message" });
  const text = "x".repeat(3_501);

  try {
    const renderer = fixture.adapter.createRunRenderer(fixture.target);
    renderer.subscriber.onTextMessageContentEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-1",
        delta: text,
      },
      textMessageBuffer: "",
    } as never);
    await renderer.finish?.();

    expect(fixture.payloads).toContainEqual({
      kind: "slack.stream.start",
      initialText: text,
    });
  } finally {
    fixture.teardown();
    vi.useRealTimers();
  }
});

test("uses matching legacy references for a long direct-message fallback", async () => {
  vi.useFakeTimers();
  const fixture = setup(undefined, {
    distinctMessageReferences: true,
    failStreamStart: true,
    surfaceKind: "direct_message",
  });
  const text = "x".repeat(3_501);

  try {
    const renderer = fixture.adapter.createRunRenderer(fixture.target);
    renderer.subscriber.onTextMessageContentEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-1",
        delta: text,
      },
      textMessageBuffer: "",
    } as never);
    await renderer.finish?.();

    const creates = fixture.payloads.filter(
      (payload) => payload.kind === "slack.message.create",
    );
    const replaces = fixture.payloads.filter(
      (payload) => payload.kind === "slack.message.replace",
    );
    expect(creates).toHaveLength(2);
    expect(replaces).toEqual([
      {
        kind: "slack.message.replace",
        providerReference: "pref_v1_slack_legacy_1",
        text: text.slice(0, 3_500),
      },
      {
        kind: "slack.message.replace",
        providerReference: "pref_v1_slack_legacy_2",
        text: text.slice(3_500),
      },
    ]);
  } finally {
    fixture.teardown();
    vi.useRealTimers();
  }
});
