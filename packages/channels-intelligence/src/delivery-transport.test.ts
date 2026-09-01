import { expect, test, vi } from "vitest";
import { ChannelDeliveryTerminatedError } from "@copilotkit/channels-core";
import {
  ChannelProviderMismatchError,
  ChannelProviderDeliveryError,
  ClaimedChannelDelivery,
  ChannelDeliveryTransport,
  safeChannelErrorMetadata,
} from "./delivery-transport.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY } from "./delivery-contracts.js";

function preparedDelivery() {
  return {
    protocol: "channel_delivery_v1" as const,
    deliveryId: "dlv_delivery_01",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_delivery_01",
    channelName: "support",
    canonicalThreadId: "thread_01",
    appUserId: "slack:T1:U1",
    adapter: "slack" as const,
    turn: {
      eventId: "evt_delivery_01",
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: {
        kind: "text" as const,
        text: "Hello",
        messageRef: { id: "pref_v1_message_transport_123" },
        operation: {
          kind: "created" as const,
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: false,
        },
      },
      actor: { externalUserId: "U1", kind: "human" as const },
    },
  };
}

function claimResult(deliveryId: string, ownerGeneration = 7) {
  return {
    result: "claimed" as const,
    deliveryId,
    ownerGeneration,
    joinToken: `chj_token_${deliveryId.slice(4)}`,
    joinTokenExpiresAt: "2099-07-29T16:01:00.000Z",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
  };
}

function invitation(
  deliveryId: string,
  canonicalThreadId: string,
  adapter: "slack" | "teams" | "discord" = "slack",
) {
  return {
    protocol: "channel_delivery_v1" as const,
    deliveryId,
    canonicalThreadId,
    channelName: "support",
    adapter,
  };
}

function acknowledgement(
  packet: unknown,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  const identity = packet as {
    deliveryId: string;
    seq: number;
    packetId: string;
  };
  return {
    deliveryId: identity.deliveryId,
    seq: identity.seq,
    packetId: identity.packetId,
    phase: "applied",
    result: { providerReference: "pref_v1_message_01" },
    ...fields,
  };
}

function channel(
  joinReply: PreparedChannelDelivery = preparedDelivery(),
): RealtimeGatewayDeliveryChannel {
  return {
    joinReply,
    push: vi
      .fn()
      .mockImplementation((_event, packet) =>
        Promise.resolve(acknowledgement(packet)),
      ),
    on: vi.fn(),
    onClose: vi.fn(),
    leave: vi.fn(),
  };
}

async function runTranscriptFailure(input: {
  surfaceKind: NonNullable<PreparedChannelDelivery["surfaceKind"]>;
  mentioned: boolean;
  adapter?: "slack" | "teams" | "discord";
}) {
  const base = preparedDelivery();
  const delivery = {
    ...base,
    adapter: input.adapter ?? base.adapter,
    surfaceKind: input.surfaceKind,
    turn: {
      ...base.turn,
      input: {
        ...base.turn.input,
        operation: {
          ...base.turn.input.operation,
          mentioned: input.mentioned,
        },
      },
    },
  };
  const deliveryChannel = channel(delivery);
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue(claimResult(delivery.deliveryId)),
    on: vi.fn(),
    join: vi.fn().mockResolvedValue(deliveryChannel),
  };
  const appApiFetch = vi.fn(async (_url: string | URL | Request) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: {
            code: "CHANNEL_TRANSCRIPT_PROVIDER_FAILED",
            retryable: true,
          },
        }),
        { status: 503 },
      ),
    ),
  );
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
    appApiBaseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    fileFetch: appApiFetch as unknown as typeof globalThis.fetch,
  });
  transport.start(async (claimedDelivery) => {
    await claimedDelivery.getTranscript();
  });
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
  invitationHandler(
    invitation(
      delivery.deliveryId,
      delivery.canonicalThreadId,
      delivery.adapter,
    ),
  );
  await vi.waitFor(() => expect(deliveryChannel.leave).toHaveBeenCalledOnce());
  await transport.stop();

  return {
    appApiFetch,
    packets: vi.mocked(deliveryChannel.push).mock.calls.map(
      ([, packet]) =>
        (
          packet as {
            payload: Record<string, unknown>;
          }
        ).payload,
    ),
  };
}

async function runHandlerFailure(
  delivery: PreparedChannelDelivery,
  handler: (claimed: ClaimedChannelDelivery) => Promise<void>,
) {
  const deliveryChannel = channel(delivery);
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue(claimResult(delivery.deliveryId)),
    on: vi.fn(),
    join: vi.fn().mockResolvedValue(deliveryChannel),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
  });
  transport.start(handler);
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
  invitationHandler(
    invitation(
      delivery.deliveryId,
      delivery.canonicalThreadId,
      delivery.adapter,
    ),
  );
  await vi.waitFor(() => expect(deliveryChannel.leave).toHaveBeenCalledOnce());
  await transport.stop();
  return vi
    .mocked(deliveryChannel.push)
    .mock.calls.map(
      ([, packet]) => (packet as { payload: Record<string, unknown> }).payload,
    );
}

test("transcript failure posts the generic unmetered error for an app mention", async () => {
  const result = await runTranscriptFailure({
    surfaceKind: "app_mention",
    mentioned: true,
  });

  expect(result.appApiFetch).toHaveBeenCalledTimes(3);
  expect(
    result.appApiFetch.mock.calls.every(([url]) =>
      String(url).endsWith("/transcript"),
    ),
  ).toBe(true);
  expect(result.packets).toEqual([
    {
      kind: "slack.message.create",
      text: "Something went wrong",
    },
    {
      kind: "channel.delivery.terminal",
      status: "failed",
      code: "runtime_handler_failed",
    },
  ]);
});

test("transcript failure posts the generic unmetered error for a direct message", async () => {
  const result = await runTranscriptFailure({
    surfaceKind: "direct_message",
    mentioned: false,
  });

  expect(result.appApiFetch).toHaveBeenCalledTimes(3);
  expect(
    result.appApiFetch.mock.calls.every(([url]) =>
      String(url).endsWith("/transcript"),
    ),
  ).toBe(true);
  expect(result.packets[0]).toEqual({
    kind: "slack.message.create",
    text: "Something went wrong",
  });
});

test("Teams transcript failure uses the Teams generic error effect", async () => {
  const result = await runTranscriptFailure({
    surfaceKind: "personal",
    mentioned: false,
    adapter: "teams",
  });

  expect(result.packets[0]).toEqual({
    kind: "teams.message.create",
    text: "Something went wrong",
  });
});

test("transcript failure is silent and unmetered for an ambient message", async () => {
  const result = await runTranscriptFailure({
    surfaceKind: "message",
    mentioned: false,
  });

  expect(result.appApiFetch).toHaveBeenCalledTimes(3);
  expect(
    result.appApiFetch.mock.calls.every(([url]) =>
      String(url).endsWith("/transcript"),
    ),
  ).toBe(true);
  expect(result.packets).toEqual([
    {
      kind: "channel.delivery.terminal",
      status: "failed_before_output",
      code: "runtime_handler_failed",
    },
  ]);
});

test.each([
  ["slack", "slack.message.create"],
  ["teams", "teams.message.create"],
  ["discord", "discord.message.create"],
] as const)(
  "%s welcome failure posts the fixed provider error before failing the delivery",
  async (adapter, effectKind) => {
    const base = preparedDelivery();
    const delivery = {
      ...base,
      adapter,
      turn: {
        ...base.turn,
        input: { kind: "welcome" as const },
      },
    };
    const deliveryChannel = channel(delivery);
    const control: RealtimeGatewaySession = {
      push: vi.fn().mockResolvedValue(claimResult(delivery.deliveryId)),
      on: vi.fn(),
      join: vi.fn().mockResolvedValue(deliveryChannel),
    };
    const transport = new ChannelDeliveryTransport({
      session: control,
      runtimeInstanceId: "rti_runtime_01",
    });
    transport.start(async () => {
      throw new Error("welcome handler failed");
    });

    const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
    invitationHandler(
      invitation(
        delivery.deliveryId,
        delivery.canonicalThreadId,
        delivery.adapter,
      ),
    );
    await vi.waitFor(() =>
      expect(deliveryChannel.leave).toHaveBeenCalledOnce(),
    );
    await transport.stop();

    expect(
      vi
        .mocked(deliveryChannel.push)
        .mock.calls.map(
          ([, packet]) =>
            (packet as { payload: Record<string, unknown> }).payload,
        ),
    ).toEqual([
      {
        kind: effectKind,
        text: "Something went wrong",
      },
      {
        kind: "channel.delivery.terminal",
        status: "failed",
        code: "runtime_handler_failed",
      },
    ]);
  },
);

test("interaction handler failure sends the generic provider error", async () => {
  const base = preparedDelivery();
  const packets = await runHandlerFailure(
    {
      ...base,
      adapter: "teams",
      turn: {
        ...base.turn,
        input: { kind: "interaction", actionId: "approve" },
      },
    },
    async () => {
      throw new Error("interaction handler failed");
    },
  );

  expect(packets).toEqual([
    { kind: "teams.message.create", text: "Something went wrong" },
    {
      kind: "channel.delivery.terminal",
      status: "failed",
      code: "runtime_handler_failed",
    },
  ]);
});

test("ambient handler failure is silent until developer output is expected", async () => {
  const base = preparedDelivery();
  const delivery: PreparedChannelDelivery = {
    ...base,
    surfaceKind: "message",
    turn: {
      ...base.turn,
      input: {
        ...base.turn.input,
        operation: { ...base.turn.input.operation, mentioned: false },
      },
    },
  };

  await expect(
    runHandlerFailure(delivery, async () => {
      throw new Error("ambient handler failed");
    }),
  ).resolves.toEqual([
    {
      kind: "channel.delivery.terminal",
      status: "failed_before_output",
      code: "runtime_handler_failed",
    },
  ]);

  await expect(
    runHandlerFailure(delivery, async (claimed) => {
      claimed.expectProviderOutput();
      throw new Error("explicit output construction failed");
    }),
  ).resolves.toEqual([
    { kind: "slack.message.create", text: "Something went wrong" },
    {
      kind: "channel.delivery.terminal",
      status: "failed",
      code: "runtime_handler_failed",
    },
  ]);
});

test("rejects a wrong-provider effect before charging or sending a packet", async () => {
  const deliveryChannel = channel();
  const charge = vi.fn().mockResolvedValue(undefined);
  const claimed = new ClaimedChannelDelivery(
    preparedDelivery(),
    { ownerGeneration: 1, runtimeInstanceId: "rti_runtime_01" },
    deliveryChannel,
    vi.fn(),
    undefined,
    undefined,
    new AbortController().signal,
    { charge },
  );

  await expect(
    claimed.effect("response_wrong_provider", {
      kind: "teams.message.create",
      text: "must not cross providers",
    }),
  ).rejects.toBeInstanceOf(ChannelProviderMismatchError);
  expect(charge).not.toHaveBeenCalled();
  expect(deliveryChannel.push).not.toHaveBeenCalled();
});

test("rejects a raw provider message id at the Gateway acknowledgement boundary", async () => {
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push).mockImplementationOnce((_event, packet) =>
    Promise.resolve(
      acknowledgement(packet, {
        result: {
          providerReference: "pref_v1_message_01",
          providerMessageId: "1712345678.1234",
        },
      }),
    ),
  );
  const claimed = new ClaimedChannelDelivery(
    preparedDelivery(),
    { ownerGeneration: 1, runtimeInstanceId: "rti_runtime_01" },
    deliveryChannel,
    vi.fn(),
  );

  await expect(
    claimed.effect("response_raw_provider_id", {
      kind: "slack.message.create",
      text: "Hello",
    }),
  ).rejects.toThrow("stable pid_v1 correlation id");
});

test("rejects acknowledgement fields that drift from the strict Gateway schema", async () => {
  const malformed = [
    { phase: "applied", retryAt: "2026-07-30T20:00:00.000Z" },
    { phase: "applied", rawResponse: "secret" },
    { phase: "applied", result: [] },
  ];

  for (const fields of malformed) {
    const deliveryChannel = channel();
    vi.mocked(deliveryChannel.push).mockImplementationOnce((_event, packet) =>
      Promise.resolve(acknowledgement(packet, fields)),
    );
    const claimed = new ClaimedChannelDelivery(
      preparedDelivery(),
      { ownerGeneration: 1, runtimeInstanceId: "rti_runtime_01" },
      deliveryChannel,
      vi.fn(),
    );

    await expect(
      claimed.effect("response_malformed_ack", {
        kind: "slack.message.create",
        text: "Hello",
      }),
    ).rejects.toThrow("conflicting packet acknowledgement");
  }
});

test("wrong-provider handler output uses only the trusted active-provider fallback", async () => {
  const base = preparedDelivery();

  await expect(
    runHandlerFailure(
      { ...base, surfaceKind: "direct_message" },
      async (claimed) => {
        await claimed.effect("response_wrong_provider", {
          kind: "teams.message.create",
          text: "must not cross providers",
        });
      },
    ),
  ).resolves.toEqual([
    {
      kind: "slack.message.create",
      text: "Something went wrong",
    },
    {
      kind: "channel.delivery.terminal",
      status: "failed",
      code: "runtime_handler_failed",
    },
  ]);
});

test("claims an invitation and consumes the one-use token on delivery join", async () => {
  const deliveryChannel = channel({
    ...preparedDelivery(),
    capabilities: [SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY],
  });
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue(claimResult("dlv_delivery_01")),
    on: vi.fn(),
    join: vi.fn().mockResolvedValue(deliveryChannel),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
  });
  const handled = vi.fn().mockResolvedValue(undefined);

  transport.start(handled);
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
  invitationHandler(invitation("dlv_delivery_01", "thread_01"));
  await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce());

  expect(control.push).toHaveBeenCalledWith("claim", {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    runtimeInstanceId: "rti_runtime_01",
  });
  expect(control.join).toHaveBeenCalledWith("delivery:dlv_delivery_01", {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    runtimeInstanceId: "rti_runtime_01",
    ownerGeneration: 7,
    joinToken: "chj_token_delivery_01",
    capabilities: [SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY],
  });
});

test("reconnect accepts the distinct join-token response without a claim result", async () => {
  const first = channel({
    ...preparedDelivery(),
    capabilities: [SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY],
  });
  const second = channel();
  vi.mocked(first.push).mockRejectedValueOnce(new Error("socket dropped"));
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockImplementation((event, payload) => {
      const deliveryId = (payload as { deliveryId: string }).deliveryId;
      if (event === "claim") return Promise.resolve(claimResult(deliveryId));
      if (event === "join_token") {
        return Promise.resolve({
          deliveryId,
          ownerGeneration: 8,
          joinToken: "chj_reconnect_delivery_01",
          joinTokenExpiresAt: "2099-07-29T16:02:00.000Z",
          deliveryExpiresAt: "2099-07-29T18:00:00.000Z",
        });
      }
      return Promise.resolve({});
    }),
    on: vi.fn(),
    join: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
  });
  let capabilitiesAfterReconnect:
    | PreparedChannelDelivery["capabilities"]
    | undefined;
  transport.start(async (claimed, delivery) => {
    await claimed.effect("response_01", {
      kind: "slack.message.create",
      text: "Hello after reconnect",
    });
    capabilitiesAfterReconnect = delivery.capabilities;
  });

  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
  invitationHandler(invitation("dlv_delivery_01", "thread_01"));

  await vi.waitFor(() => expect(second.leave).toHaveBeenCalledOnce());
  expect(control.push).toHaveBeenCalledWith("join_token", {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    runtimeInstanceId: "rti_runtime_01",
  });
  expect(control.join).toHaveBeenNthCalledWith(2, "delivery:dlv_delivery_01", {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    runtimeInstanceId: "rti_runtime_01",
    ownerGeneration: 8,
    joinToken: "chj_reconnect_delivery_01",
    capabilities: [SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY],
  });
  expect(first.leave).toHaveBeenCalledOnce();
  expect(second.push).toHaveBeenCalledTimes(2);
  expect(capabilitiesAfterReconnect).toBeUndefined();
  await transport.stop();
});

test("adapts an in-flight Slack append across new-old-new gateway rejoins", async () => {
  const first = channel({
    ...preparedDelivery(),
    capabilities: [SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY],
  });
  const second = channel();
  const third = channel({
    ...preparedDelivery(),
    capabilities: [SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY],
  });
  vi.mocked(first.push).mockRejectedValueOnce(new Error("socket dropped"));
  vi.mocked(second.push).mockRejectedValueOnce(new Error("socket dropped"));
  let ownerGeneration = 7;
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockImplementation((event, payload) => {
      const deliveryId = (payload as { deliveryId: string }).deliveryId;
      if (event === "claim") return Promise.resolve(claimResult(deliveryId));
      if (event === "join_token") {
        ownerGeneration += 1;
        return Promise.resolve({
          deliveryId,
          ownerGeneration,
          joinToken: `chj_reconnect_delivery_${ownerGeneration}`,
          joinTokenExpiresAt: "2099-07-29T16:02:00.000Z",
          deliveryExpiresAt: "2099-07-29T18:00:00.000Z",
        });
      }
      return Promise.resolve({});
    }),
    on: vi.fn(),
    join: vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(third),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
  });
  transport.start(async (claimed) => {
    await claimed.effect("response_01", {
      kind: "slack.stream.append",
      providerReference: "pref_v1_safe_reference",
      delta: " world",
      fullText: "Hello world",
    });
  });

  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
  invitationHandler(invitation("dlv_delivery_01", "thread_01"));

  await vi.waitFor(() => expect(third.leave).toHaveBeenCalledOnce());
  const initialPacket = vi.mocked(first.push).mock.calls[0]![1] as {
    packetId: string;
    seq: number;
    payload: Record<string, unknown>;
  };
  const retriedPacket = vi.mocked(second.push).mock.calls[0]![1] as {
    packetId: string;
    seq: number;
    payload: Record<string, unknown>;
  };
  const restoredPacket = vi.mocked(third.push).mock.calls[0]![1] as {
    packetId: string;
    seq: number;
    payload: Record<string, unknown>;
  };
  expect(initialPacket.payload).toMatchObject({
    kind: "slack.stream.append",
    delta: " world",
    fullText: "Hello world",
  });
  expect(retriedPacket.payload).toEqual({
    kind: "slack.stream.append",
    providerReference: "pref_v1_safe_reference",
    delta: " world",
  });
  expect(retriedPacket.packetId).toBe(initialPacket.packetId);
  expect(retriedPacket.seq).toBe(initialPacket.seq);
  expect(restoredPacket.payload).toEqual(initialPacket.payload);
  expect(restoredPacket.packetId).toBe(initialPacket.packetId);
  expect(restoredPacket.seq).toBe(initialPacket.seq);
  await transport.stop();
});

test("claims bounded pending work but does not execute above the local limit", async () => {
  let releaseFirst: (() => void) | undefined;
  const firstDelivery = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockImplementation((_event, payload) => {
      const { deliveryId } = payload as { deliveryId: string };
      return Promise.resolve(claimResult(deliveryId));
    }),
    on: vi.fn(),
    join: vi.fn().mockImplementation((topic) => {
      const deliveryId = topic.replace("delivery:", "");
      return Promise.resolve(
        channel({
          ...preparedDelivery(),
          deliveryId,
          canonicalThreadId:
            deliveryId === "dlv_delivery_01" ? "thread_01" : "thread_02",
        }),
      );
    }),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
    maxConcurrentDeliveries: 1,
  });
  const handled = vi.fn(async (_session, delivery: PreparedChannelDelivery) => {
    if (delivery.deliveryId === "dlv_delivery_01") {
      await firstDelivery;
    }
  });
  transport.start(handled);
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];

  invitationHandler(invitation("dlv_delivery_01", "thread_01"));
  await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce());
  invitationHandler(invitation("dlv_delivery_02", "thread_02"));

  expect(control.push).toHaveBeenCalledWith(
    "claim",
    expect.objectContaining({ deliveryId: "dlv_delivery_02" }),
  );
  expect(handled).toHaveBeenCalledOnce();

  releaseFirst?.();
  await vi.waitFor(() => expect(handled).toHaveBeenCalledTimes(2));
  await transport.stop();
});

test("pending overflow records an explicit outcome without growing the buffer", async () => {
  let releaseFirst: (() => void) | undefined;
  const firstDelivery = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const log = vi.fn();
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockImplementation((event, payload) => {
      const { deliveryId } = payload as { deliveryId: string };
      if (event === "claim_overflow") {
        return Promise.resolve({
          result: "overflowed",
          deliveryId,
          outcome: "runtime_capacity_overflow",
        });
      }
      return Promise.resolve(claimResult(deliveryId));
    }),
    on: vi.fn(),
    join: vi.fn().mockImplementation((topic) => {
      const deliveryId = topic.replace("delivery:", "");
      return Promise.resolve(
        channel({
          ...preparedDelivery(),
          deliveryId,
          canonicalThreadId: `thread_${deliveryId}`,
        }),
      );
    }),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
    maxConcurrentDeliveries: 1,
    maxPendingDeliveries: 1,
    log,
  });
  const handled = vi.fn(async (_session, delivery: PreparedChannelDelivery) => {
    if (delivery.deliveryId === "dlv_delivery_01") {
      await firstDelivery;
    }
  });
  transport.start(handled);
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];

  for (const deliveryId of [
    "dlv_delivery_01",
    "dlv_delivery_02",
    "dlv_delivery_03",
  ]) {
    invitationHandler(invitation(deliveryId, `thread_${deliveryId}`));
    if (deliveryId === "dlv_delivery_01") {
      await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce());
    }
  }

  await vi.waitFor(() => {
    expect(control.push).toHaveBeenCalledWith("claim_overflow", {
      protocol: "channel_delivery_v1",
      deliveryId: "dlv_delivery_03",
      runtimeInstanceId: "rti_runtime_01",
    });
    expect(log).toHaveBeenCalledWith("channel delivery capacity overflow", {
      outcome: "overflowed",
      reason: "runtime_capacity_overflow",
      deliveryId: "dlv_delivery_03",
      canonicalThreadId: "thread_dlv_delivery_03",
    });
  });
  expect(handled).toHaveBeenCalledOnce();

  releaseFirst?.();
  await vi.waitFor(() => expect(handled).toHaveBeenCalledTimes(2));
  expect(handled).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ deliveryId: "dlv_delivery_03" }),
  );
  await transport.stop();
});

test("claims same-Thread work for Redis coordination but executes it in order", async () => {
  let releaseFirst: (() => void) | undefined;
  const firstDelivery = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const threadByDelivery = new Map([
    ["dlv_delivery_01", "thread_01"],
    ["dlv_delivery_02", "thread_01"],
    ["dlv_delivery_03", "thread_03"],
  ]);
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockImplementation((_event, payload) => {
      const { deliveryId } = payload as { deliveryId: string };
      return Promise.resolve(claimResult(deliveryId));
    }),
    on: vi.fn(),
    join: vi.fn().mockImplementation((topic) => {
      const deliveryId = topic.replace("delivery:", "");
      return Promise.resolve(
        channel({
          ...preparedDelivery(),
          deliveryId,
          canonicalThreadId: threadByDelivery.get(deliveryId) ?? "thread_other",
        }),
      );
    }),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
    maxConcurrentDeliveries: 2,
  });
  const handled = vi.fn(async (_session, delivery: PreparedChannelDelivery) => {
    if (delivery.deliveryId === "dlv_delivery_01") {
      await firstDelivery;
    }
  });
  transport.start(handled);
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];

  invitationHandler(invitation("dlv_delivery_01", "thread_01"));
  await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce());
  invitationHandler(invitation("dlv_delivery_02", "thread_01"));
  invitationHandler(invitation("dlv_delivery_03", "thread_03"));

  await vi.waitFor(() => expect(handled).toHaveBeenCalledTimes(2));
  expect(control.push).toHaveBeenCalledWith(
    "claim",
    expect.objectContaining({ deliveryId: "dlv_delivery_02" }),
  );
  expect(control.push).toHaveBeenCalledWith(
    "claim",
    expect.objectContaining({ deliveryId: "dlv_delivery_03" }),
  );

  releaseFirst?.();
  await vi.waitFor(() => expect(handled).toHaveBeenCalledTimes(3));
  await transport.stop();
});

test("a newer same-Thread claim aborts the exact switchable delivery before output", async () => {
  const channels = new Map<string, RealtimeGatewayDeliveryChannel>();
  const supersessionHandlers = new Map<string, (value: unknown) => void>();
  const handled: string[] = [];
  const observedSignals = new Map<string, AbortSignal>();
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockImplementation((_event, payload) => {
      const { deliveryId } = payload as { deliveryId: string };
      if (deliveryId === "dlv_delivery_02") {
        supersessionHandlers.get("dlv_delivery_01")?.({
          deliveryId: "dlv_delivery_01",
          supersededByDeliveryId: "dlv_delivery_02",
          reason: "superseded",
        });
      }
      return Promise.resolve(claimResult(deliveryId));
    }),
    on: vi.fn(),
    join: vi.fn().mockImplementation((topic) => {
      const deliveryId = topic.replace("delivery:", "");
      const joined = channel({
        ...preparedDelivery(),
        deliveryId,
        canonicalThreadId: "thread_01",
      });
      vi.mocked(joined.on).mockImplementation((event, handler) => {
        if (event === "delivery_superseded") {
          supersessionHandlers.set(deliveryId, handler);
        }
      });
      channels.set(deliveryId, joined);
      return Promise.resolve(joined);
    }),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
    maxConcurrentDeliveries: 1,
  });
  transport.start(async (claimed, delivery) => {
    handled.push(delivery.deliveryId);
    observedSignals.set(delivery.deliveryId, claimed.signal);
    if (delivery.deliveryId === "dlv_delivery_01") {
      await new Promise<void>((resolve) => {
        claimed.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
    }
  });
  const invite = vi.mocked(control.on).mock.calls[0]![1];

  invite(invitation("dlv_delivery_01", "thread_01"));
  await vi.waitFor(() => expect(handled).toEqual(["dlv_delivery_01"]));
  invite(invitation("dlv_delivery_02", "thread_01"));

  await vi.waitFor(() =>
    expect(handled).toEqual(["dlv_delivery_01", "dlv_delivery_02"]),
  );
  expect(observedSignals.get("dlv_delivery_01")?.reason).toBe("superseded");
  expect(channels.get("dlv_delivery_01")?.push).not.toHaveBeenCalled();
  await transport.stop();
});

test("later same-Thread work waits FIFO when Redis reports a committed owner", async () => {
  let firstActive = true;
  let releaseFirst: (() => void) | undefined;
  const firstDone = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const handled: string[] = [];
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockImplementation((_event, payload) => {
      const { deliveryId } = payload as { deliveryId: string };
      if (deliveryId === "dlv_delivery_02" && firstActive) {
        return Promise.resolve({
          result: "deferred",
          deliveryId,
          activeDeliveryId: "dlv_delivery_01",
        });
      }
      return Promise.resolve(claimResult(deliveryId));
    }),
    on: vi.fn(),
    join: vi.fn().mockImplementation((topic) => {
      const deliveryId = topic.replace("delivery:", "");
      return Promise.resolve(
        channel({
          ...preparedDelivery(),
          deliveryId,
          canonicalThreadId: "thread_01",
        }),
      );
    }),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
    maxConcurrentDeliveries: 1,
  });
  transport.start(async (_claimed, delivery) => {
    handled.push(delivery.deliveryId);
    if (delivery.deliveryId === "dlv_delivery_01") {
      await firstDone;
      firstActive = false;
    }
  });
  const invite = vi.mocked(control.on).mock.calls[0]![1];

  invite(invitation("dlv_delivery_01", "thread_01"));
  await vi.waitFor(() => expect(handled).toEqual(["dlv_delivery_01"]));
  invite(invitation("dlv_delivery_02", "thread_01"));
  await vi.waitFor(() =>
    expect(control.push).toHaveBeenCalledWith(
      "claim",
      expect.objectContaining({ deliveryId: "dlv_delivery_02" }),
    ),
  );
  expect(handled).toEqual(["dlv_delivery_01"]);

  releaseFirst?.();
  await vi.waitFor(() =>
    expect(handled).toEqual(["dlv_delivery_01", "dlv_delivery_02"]),
  );
  await transport.stop();
});

test("ignores an invitation without a canonical Thread admission key", () => {
  const control: RealtimeGatewaySession = {
    push: vi.fn(),
    on: vi.fn(),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
  });
  transport.start(async () => undefined);
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];

  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
  });

  expect(control.push).not.toHaveBeenCalled();
});

test("retries the exact packet after reconnect and calls no second sequence", async () => {
  const first = channel();
  const second = channel();
  vi.mocked(first.push).mockRejectedValueOnce(new Error("socket dropped"));
  const reconnect = vi.fn().mockResolvedValue({
    channel: second,
    owner: {
      ownerGeneration: 8,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryExpiresAt: "2099-07-29T18:00:00.000Z",
  });
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    first,
    reconnect,
  );

  const result = await session.effect("response_01", {
    kind: "slack.message.create",
    text: "Hello",
  });

  expect(reconnect).toHaveBeenCalledOnce();
  expect(first.push).toHaveBeenCalledOnce();
  expect(second.push).toHaveBeenCalledOnce();
  const retried = vi.mocked(second.push).mock.calls[0]![1] as {
    ownerGeneration: number;
    seq: number;
    packetId: string;
  };
  const original = vi.mocked(first.push).mock.calls[0]![1] as {
    ownerGeneration: number;
    seq: number;
    packetId: string;
  };
  // Exact unacked packet keeps original ownerGeneration on soft retry;
  // subsequent packets use the refreshed generation (next test).
  expect(retried.seq).toBe(original.seq);
  expect(retried.packetId).toBe(original.packetId);
  expect(retried.ownerGeneration).toBe(7);
  expect(result).toEqual({ providerReference: "pref_v1_message_01" });
});

test("polls the same packet after a retry-wait result", async () => {
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push)
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve(
        acknowledgement(packet, {
          phase: "retry_wait",
          retryAt: "2000-01-01T00:00:00.000Z",
          result: {
            status: "retry_wait",
            code: "provider_rate_limited",
          },
        }),
      ),
    )
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve(acknowledgement(packet)),
    );
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  const result = await session.effect("response_01", {
    kind: "slack.message.create",
    text: "Hello",
  });

  expect(deliveryChannel.push).toHaveBeenCalledTimes(2);
  const firstPacket = vi.mocked(deliveryChannel.push).mock.calls[0]![1];
  const secondPacket = vi.mocked(deliveryChannel.push).mock.calls[1]![1];
  expect(secondPacket).toEqual(firstPacket);
  expect(result).toEqual({ providerReference: "pref_v1_message_01" });
});

test("commits irreversible work exactly once and exposes supersession abort", async () => {
  const deliveryChannel = channel();
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  await Promise.all([session.commit(), session.commit()]);

  expect(deliveryChannel.push).toHaveBeenCalledOnce();
  expect(vi.mocked(deliveryChannel.push).mock.calls[0]![1]).toMatchObject({
    seq: 0,
    payload: { kind: "channel.delivery.commit" },
  });
  expect(session.signal.aborted).toBe(false);

  session.supersede("dlv_newer_delivery");

  expect(session.signal.aborted).toBe(true);
  expect(session.signal.reason).toBe("superseded");
  expect(session.supersededByDeliveryId).toBe("dlv_newer_delivery");
});

test("keeps a confirmed Teams image capability rejection non-terminal", async () => {
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push)
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve(
        acknowledgement(packet, {
          result: { capabilityError: "teams_image_rejected" },
        }),
      ),
    )
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve(
        acknowledgement(packet, {
          result: { providerReference: "pref_v1_teams_activity_01" },
        }),
      ),
    );
  const claimedDelivery = new ClaimedChannelDelivery(
    { ...preparedDelivery(), adapter: "teams" },
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  await expect(
    claimedDelivery.effect("response_image", {
      kind: "teams.image.create",
      fileHandle: "file_handle_01",
      altText: "Architecture diagram",
    }),
  ).resolves.toEqual({ capabilityError: "teams_image_rejected" });
  expect(claimedDelivery.hasProviderOutput()).toBe(false);

  await expect(
    claimedDelivery.effect("response_text", {
      kind: "teams.message.create",
      text: "Text fallback",
    }),
  ).resolves.toEqual({
    providerReference: "pref_v1_teams_activity_01",
  });
  expect(claimedDelivery.hasProviderOutput()).toBe(true);
  expect(deliveryChannel.push).toHaveBeenCalledTimes(2);
});

test("stop aborts an active retry wait and leaves its delivery topic", async () => {
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push)
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve(
        acknowledgement(packet, {
          phase: "retry_wait",
          retryAt: new Date(Date.now() + 1_000).toISOString(),
          result: {
            status: "retry_wait",
            code: "provider_rate_limited",
          },
        }),
      ),
    )
    .mockImplementation((_event, packet) =>
      Promise.resolve(acknowledgement(packet)),
    );
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue(claimResult("dlv_delivery_01")),
    on: vi.fn(),
    join: vi.fn().mockResolvedValue(deliveryChannel),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
  });
  transport.start(async (session) => {
    await session.effect("response_01", {
      kind: "slack.message.create",
      text: "Hello",
    });
  });
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
  invitationHandler(invitation("dlv_delivery_01", "thread_01"));
  await vi.waitFor(() => expect(deliveryChannel.push).toHaveBeenCalledOnce());

  const outcome = await Promise.race([
    transport.stop().then(() => "stopped"),
    new Promise<"timed_out">((resolve) =>
      setTimeout(() => resolve("timed_out"), 100),
    ),
  ]);

  expect(outcome).toBe("stopped");
  expect(deliveryChannel.leave).toHaveBeenCalled();
  expect(deliveryChannel.push).toHaveBeenCalledOnce();

  invitationHandler(invitation("dlv_delivery_02", "thread_02"));
  expect(control.push).toHaveBeenCalledOnce();
});

test("still sends a failed terminal when complete terminal fails", async () => {
  const deliveryChannel = channel();
  const { RealtimeGatewayPushError } = await import("./realtime-gateway.js");
  let terminalAttempts = 0;
  vi.mocked(deliveryChannel.push).mockImplementation((_event, packet) => {
    const body = packet as { payload?: { kind?: string } };
    if (body.payload?.kind === "channel.delivery.terminal") {
      terminalAttempts += 1;
      if (terminalAttempts === 1) {
        // Permanent push error (not soft reconnect) so we do not thrash.
        return Promise.reject(
          new RealtimeGatewayPushError(
            "packet",
            "conflict",
            "terminal push dropped",
          ),
        );
      }
    }
    return Promise.resolve(acknowledgement(packet, { result: {} }));
  });
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  await expect(
    session.terminal({
      status: "complete",
      code: "provider_delivery_complete",
    }),
  ).rejects.toBeInstanceOf(RealtimeGatewayPushError);

  await session.terminal({
    status: "failed",
    code: "runtime_handler_failed",
  });

  expect(terminalAttempts).toBe(2);
});

test("refreshes owner generation on packets after reconnect", async () => {
  const first = channel();
  const second = channel();
  vi.mocked(first.push).mockRejectedValueOnce(new Error("socket dropped"));
  const reconnect = vi.fn().mockResolvedValue({
    channel: second,
    owner: {
      ownerGeneration: 9,
      runtimeInstanceId: "rti_runtime_01",
    },
  });
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    first,
    reconnect,
  );

  await session.effect("response_01", {
    kind: "slack.message.create",
    text: "Hello",
  });
  await session.effect("response_02", {
    kind: "slack.message.create",
    text: "World",
  });

  const secondPacket = vi.mocked(second.push).mock.calls[1]![1] as {
    ownerGeneration: number;
    seq: number;
  };
  expect(secondPacket.ownerGeneration).toBe(9);
  expect(secondPacket.seq).toBe(1);
});

test("closes the packet path after a permanent push failure", async () => {
  const deliveryChannel = channel();
  const { RealtimeGatewayPushError } = await import("./realtime-gateway.js");
  vi.mocked(deliveryChannel.push).mockRejectedValue(
    new RealtimeGatewayPushError("packet", "conflict", "sequence conflict"),
  );
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  await expect(
    session.effect("response_01", {
      kind: "slack.message.create",
      text: "Hello",
    }),
  ).rejects.toBeInstanceOf(RealtimeGatewayPushError);

  await expect(
    session.effect("response_02", {
      kind: "slack.message.create",
      text: "World",
    }),
  ).rejects.toThrow(/packet path is closed/);
});

test("still allows stream.stop after a permanent non-terminal failure", async () => {
  const deliveryChannel = channel();
  const { RealtimeGatewayPushError } = await import("./realtime-gateway.js");
  let pushCount = 0;
  vi.mocked(deliveryChannel.push).mockImplementation((_event, packet) => {
    pushCount += 1;
    const body = packet as { payload?: { kind?: string } };
    if (body.payload?.kind === "slack.stream.append") {
      return Promise.reject(
        new RealtimeGatewayPushError("packet", "conflict", "append failed"),
      );
    }
    return Promise.resolve(acknowledgement(packet));
  });
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  await session.effect("response_01", { kind: "slack.stream.start" });
  await expect(
    session.effect("response_01", {
      kind: "slack.stream.append",
      providerReference: "pref_v1_message_01",
      delta: "x",
      fullText: "x",
    }),
  ).rejects.toBeInstanceOf(RealtimeGatewayPushError);

  await session.effect("response_01", {
    kind: "slack.stream.stop",
    providerReference: "pref_v1_message_01",
  });
  expect(pushCount).toBe(3);
  const kinds = vi
    .mocked(deliveryChannel.push)
    .mock.calls.map(
      (call) => (call[1] as { payload?: { kind?: string } }).payload?.kind,
    );
  expect(kinds).toEqual([
    "slack.stream.start",
    "slack.stream.append",
    "slack.stream.stop",
  ]);
});

test("does not count stream.stop alone as provider output", async () => {
  const deliveryChannel = channel();
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  await session.effect("response_01", {
    kind: "slack.stream.stop",
    providerReference: "pref_v1_message_01",
  });
  expect(session.hasProviderOutput()).toBe(false);
});

test("classifies timeout/expiry errors from message text", async () => {
  expect(
    safeChannelErrorMetadata(
      new Error("realtime gateway delivery join timed out"),
    ),
  ).toEqual({ errorCategory: "timeout" });
  expect(
    safeChannelErrorMetadata(new Error("Channel delivery ownership expired")),
  ).toEqual({ errorCategory: "timeout" });
});

async function expectPreparedInputRejected(input: unknown) {
  await expectPreparedDeliveryRejected({
    ...preparedDelivery(),
    turn: {
      eventId: "evt_bad_prepared_01",
      receivedAt: "2026-07-29T17:00:00.000Z",
      input,
      actor: { externalUserId: "U1", kind: "human" as const },
    },
  });
}

async function expectPreparedDeliveryRejected(badPrepared: unknown) {
  const deliveryChannel = channel(
    badPrepared as unknown as ReturnType<typeof preparedDelivery>,
  );
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue(claimResult("dlv_delivery_01", 1)),
    on: vi.fn(),
    join: vi.fn().mockResolvedValue(deliveryChannel),
  };
  const log = vi.fn();
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
    log,
  });
  transport.start(async () => undefined);
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1] as (
    invitation: unknown,
  ) => void;
  invitationHandler(invitation("dlv_delivery_01", "thread_01"));
  await vi.waitFor(() => {
    expect(vi.mocked(control.join)).toHaveBeenCalled();
  });
  await transport.stop();
  expect(deliveryChannel.leave).toHaveBeenCalled();
  // Invalid prepared turn must not emit a complete terminal packet.
  const terminalPackets = vi
    .mocked(deliveryChannel.push)
    .mock.calls.filter(
      (call) =>
        (call[1] as { payload?: { kind?: string } }).payload?.kind ===
        "channel.delivery.terminal",
    );
  expect(terminalPackets.length).toBe(0);
}

test("rejects prepared deliveries with incomplete turn fields", async () => {
  await expectPreparedInputRejected({
    kind: "command",
    command: "triage",
  });
});

test("accepts a Discord command turn", async () => {
  const base = preparedDelivery();
  const delivery = {
    ...base,
    adapter: "discord" as const,
    appUserId: "discord:guild:user",
    turn: {
      ...base.turn,
      input: {
        kind: "command" as const,
        command: "triage",
        text: "summarize",
      },
    },
  };
  const deliveryChannel = channel(delivery);
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue(claimResult(delivery.deliveryId)),
    on: vi.fn(),
    join: vi.fn().mockResolvedValue(deliveryChannel),
  };
  const handler = vi.fn(async () => undefined);
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
  });
  transport.start(handler);

  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
  invitationHandler(
    invitation(delivery.deliveryId, delivery.canonicalThreadId, "discord"),
  );
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  expect(handler).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      adapter: "discord",
      turn: expect.objectContaining({
        input: {
          kind: "command",
          command: "triage",
          text: "summarize",
        },
      }),
    }),
  );
  await transport.stop();
});

test("rejects a prepared reaction carrying a raw provider message id", async () => {
  await expectPreparedInputRejected({
    kind: "reaction",
    rawEmoji: "like",
    added: true,
    messageId: "raw-provider-message-id",
    messageRef: { id: "pref_v1_reaction_capability_01" },
  });
});

test("rejects obsolete raw postedRef fields on prepared reactions", async () => {
  await expectPreparedInputRejected({
    kind: "reaction",
    rawEmoji: "like",
    added: true,
    messageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    postedRef: "raw-provider-message-id",
    messageRef: { id: "pref_v1_reaction_capability_01" },
  });
});

test("rejects malformed capabilities on every prepared input that carries one", async () => {
  const base = preparedDelivery().turn.input;
  await expectPreparedInputRejected({
    ...base,
    messageRef: { id: "pref_v1_short" },
  });
  await expectPreparedInputRejected({
    kind: "interaction",
    actionId: "ck:approve",
    messageRef: { id: "raw-provider-message-id" },
  });
});

test("rejects an unrecognized prepared delivery capability", async () => {
  await expectPreparedDeliveryRejected({
    ...preparedDelivery(),
    capabilities: ["slack_stream_append_future_v2"],
  });
});

test("rejects missing, malformed, and extra prepared input fields", async () => {
  const base = preparedDelivery().turn.input;
  const { text: _text, ...withoutText } = base;
  await expectPreparedInputRejected(withoutText);
  await expectPreparedInputRejected({
    ...base,
    files: [{ handle: "fileref_ok", filename: "brief.txt", rawUrl: "secret" }],
  });
  await expectPreparedInputRejected({
    kind: "interaction",
    actionId: "ck:approve",
    values: [],
  });
  await expectPreparedInputRejected({ kind: "welcome", raw: "provider" });
  await expectPreparedInputRejected({
    kind: "reaction",
    rawEmoji: "like",
    added: true,
    messageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    messageRef: { id: "pref_v1_reaction_capability_01" },
    threadId: "1700000000.000100",
  });
});

test("rejects extra prepared delivery and turn fields", async () => {
  const base = preparedDelivery();
  await expectPreparedDeliveryRejected({ ...base, credentials: "secret" });
  await expectPreparedDeliveryRejected({
    ...base,
    turn: { ...base.turn, replyTarget: { channel: "C1" } },
  });
});

test("accepts a namespaced Teams app user id longer than one external id", async () => {
  const base = preparedDelivery();
  const appUserId = `teams:00000000-0000-0000-0000-000000000000:29:${"a".repeat(87)}`;
  const delivery = {
    ...base,
    adapter: "teams" as const,
    appUserId,
  };
  const deliveryChannel = channel(delivery);
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue(claimResult(delivery.deliveryId)),
    on: vi.fn(),
    join: vi.fn().mockResolvedValue(deliveryChannel),
  };
  const handler = vi.fn(async () => undefined);
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_runtime_01",
  });
  transport.start(handler);

  expect(appUserId).toHaveLength(133);
  const invitationHandler = vi.mocked(control.on).mock.calls[0]![1];
  invitationHandler(
    invitation(delivery.deliveryId, delivery.canonicalThreadId, "teams"),
  );
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  await transport.stop();
});

test("rejects a namespaced app user id over the composite bound", async () => {
  const base = preparedDelivery();
  await expectPreparedDeliveryRejected({
    ...base,
    appUserId: "a".repeat(2049),
  });
});

test("rejects malformed managed mention-routing metadata", async () => {
  const base = preparedDelivery().turn.input;
  await expectPreparedInputRejected({
    ...base,
    operation: {
      ...base.operation,
      mentioned: "false",
    },
  });
});

test("rejects raw provider ids in prepared text operations", async () => {
  const base = preparedDelivery().turn.input;
  await expectPreparedInputRejected({
    ...base,
    operation: {
      ...base.operation,
      logicalMessageId: "1712345678.1234",
    },
  });
});

test("surfaces a failed provider result as an already-terminal error", async () => {
  const details = {
    category: "validation",
    provider: "slack",
    operation: "chat.postMessage",
    effectKind: "slack.message.create",
    providerCode: "invalid_blocks",
    validationMessages: ["invalid field at /blocks/2/elements/0/children"],
    retryable: false,
    deliveryId: "dlv_delivery_01",
  } as const;
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push).mockImplementation((_event, packet) =>
    Promise.resolve(
      acknowledgement(packet, {
        phase: "failed",
        result: {
          error: "provider_call_failed",
          status: "failed",
          details,
          unsafeProviderResponse: "must not escape the gateway",
        },
      }),
    ),
  );
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  const error = await session
    .effect("response_01", {
      kind: "slack.message.create",
      text: "Hello",
    })
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ChannelProviderDeliveryError);
  expect(error).toBeInstanceOf(ChannelDeliveryTerminatedError);
  expect(error).toMatchObject({
    code: "provider_call_failed",
    status: "failed",
    details,
    category: "validation",
    provider: "slack",
    operation: "chat.postMessage",
    effectKind: "slack.message.create",
    providerCode: "invalid_blocks",
    validationMessages: ["invalid field at /blocks/2/elements/0/children"],
    retryable: false,
    deliveryId: "dlv_delivery_01",
    cause: details,
  });
  expect(error).not.toHaveProperty("unsafeProviderResponse");
  expect(safeChannelErrorMetadata(error)).toEqual({
    errorCategory: "validation",
    provider: "slack",
    operation: "chat.postMessage",
    effectKind: "slack.message.create",
    providerCode: "invalid_blocks",
    retryable: false,
  });
  expect(session.hasProviderOutput()).toBe(false);
});

test("keeps effects open after a best-effort provider failure", async () => {
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push)
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve(
        acknowledgement(packet, {
          phase: "failed",
          result: { error: "stream_start_failed", status: "failed" },
        }),
      ),
    )
    .mockImplementation((_event, packet) =>
      Promise.resolve(acknowledgement(packet)),
    );
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  const error = await session
    .effect("response_01", { kind: "slack.stream.start" }, { bestEffort: true })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(ChannelDeliveryTerminatedError);
  await expect(
    session.effect("response_01", {
      kind: "slack.message.create",
      text: "Hello",
    }),
  ).resolves.toMatchObject({ providerReference: "pref_v1_message_01" });
});

test("does not terminate delivery after a failed Slack status", async () => {
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push).mockImplementation((_event, packet) =>
    Promise.resolve(
      acknowledgement(packet, {
        phase: "failed",
        result: { error: "status_failed", status: "failed" },
      }),
    ),
  );
  const session = new ClaimedChannelDelivery(
    preparedDelivery(),
    {
      ownerGeneration: 7,
      runtimeInstanceId: "rti_runtime_01",
    },
    deliveryChannel,
    vi.fn(),
  );

  const error = await session
    .effect("response_01", {
      kind: "slack.thread.status",
      status: "is thinking…",
    })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(ChannelDeliveryTerminatedError);
});
