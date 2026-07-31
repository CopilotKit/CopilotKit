import { expect, test, vi } from "vitest";
import {
  ChannelProviderDeliveryError,
  ClaimedChannelDelivery,
  ChannelDeliveryTransport,
} from "./delivery-transport.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";

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
        operation: {
          kind: "created" as const,
          logicalMessageId: "message-transport",
          revisionId: "revision-transport",
          mentioned: false,
        },
      },
      actor: { externalUserId: "U1" },
    },
  };
}

function channel(
  joinReply = preparedDelivery(),
): RealtimeGatewayDeliveryChannel {
  return {
    joinReply,
    push: vi.fn().mockImplementation((_event, packet) =>
      Promise.resolve({
        ...(packet as object),
        phase: "applied",
        result: { providerReference: "pref_v1_message_01" },
      }),
    ),
    on: vi.fn(),
    onClose: vi.fn(),
    leave: vi.fn(),
  };
}

test("claims an invitation and consumes the one-use token on delivery join", async () => {
  const deliveryChannel = channel();
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue({
      result: "claimed",
      deliveryId: "dlv_delivery_01",
      ownerGeneration: 7,
      joinToken: "chj_token_01",
      joinTokenExpiresAt: "2099-07-29T16:01:00.000Z",
      deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    }),
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
  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    canonicalThreadId: "thread_01",
    channelName: "support",
    adapter: "slack",
  });
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
    joinToken: "chj_token_01",
  });
});

test("does not claim a new invitation while the local delivery limit is full", async () => {
  let releaseFirst: (() => void) | undefined;
  const firstDelivery = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockImplementation((_event, payload) => {
      const { deliveryId } = payload as { deliveryId: string };
      return Promise.resolve({
        result: "claimed",
        deliveryId,
        ownerGeneration: 7,
        joinToken: `chj_${deliveryId}`,
      });
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

  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    canonicalThreadId: "thread_01",
  });
  await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce());
  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_02",
    canonicalThreadId: "thread_02",
  });

  expect(control.push).toHaveBeenCalledTimes(1);
  expect(control.push).not.toHaveBeenCalledWith(
    "claim",
    expect.objectContaining({ deliveryId: "dlv_delivery_02" }),
  );

  releaseFirst?.();
  await transport.stop();
});

test("excludes the same canonical Thread before claim while allowing another Thread", async () => {
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
      return Promise.resolve({
        result: "claimed",
        deliveryId,
        ownerGeneration: 7,
        joinToken: `chj_${deliveryId}`,
      });
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

  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    canonicalThreadId: "thread_01",
  });
  await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce());
  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_02",
    canonicalThreadId: "thread_01",
  });
  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_03",
    canonicalThreadId: "thread_03",
  });

  await vi.waitFor(() => expect(handled).toHaveBeenCalledTimes(2));
  expect(control.push).not.toHaveBeenCalledWith(
    "claim",
    expect.objectContaining({ deliveryId: "dlv_delivery_02" }),
  );
  expect(control.push).toHaveBeenCalledWith(
    "claim",
    expect.objectContaining({ deliveryId: "dlv_delivery_03" }),
  );

  releaseFirst?.();
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
      Promise.resolve({
        ...(packet as object),
        phase: "retry_wait",
        retryAt: "2000-01-01T00:00:00.000Z",
        result: {
          status: "retry_wait",
          code: "provider_rate_limited",
        },
      }),
    )
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve({
        ...(packet as object),
        phase: "applied",
        result: { providerReference: "pref_v1_message_01" },
      }),
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

test("keeps a confirmed Teams image capability rejection non-terminal", async () => {
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push)
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve({
        ...(packet as object),
        phase: "applied",
        result: { capabilityError: "teams_image_rejected" },
      }),
    )
    .mockImplementationOnce((_event, packet) =>
      Promise.resolve({
        ...(packet as object),
        phase: "applied",
        result: { providerReference: "pref_v1_teams_activity_01" },
      }),
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
      Promise.resolve({
        ...(packet as object),
        phase: "retry_wait",
        retryAt: new Date(Date.now() + 1_000).toISOString(),
        result: {
          status: "retry_wait",
          code: "provider_rate_limited",
        },
      }),
    )
    .mockImplementation((_event, packet) =>
      Promise.resolve({
        ...(packet as object),
        phase: "applied",
        result: { providerReference: "pref_v1_message_01" },
      }),
    );
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue({
      result: "claimed",
      deliveryId: "dlv_delivery_01",
      ownerGeneration: 7,
      joinToken: "chj_token_01",
    }),
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
  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    canonicalThreadId: "thread_01",
  });
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

  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_02",
    canonicalThreadId: "thread_02",
  });
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
    return Promise.resolve({
      ...(packet as object),
      phase: "applied",
      result: {},
    });
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
    return Promise.resolve({
      ...(packet as object),
      phase: "applied",
      result: { providerReference: "pref_v1_message_01" },
    });
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
  const { safeChannelErrorMetadata } = await import("./delivery-transport.js");
  expect(
    safeChannelErrorMetadata(
      new Error("realtime gateway delivery join timed out"),
    ),
  ).toEqual({ errorCategory: "timeout" });
  expect(
    safeChannelErrorMetadata(new Error("Channel delivery ownership expired")),
  ).toEqual({ errorCategory: "timeout" });
});

test("rejects prepared deliveries with incomplete turn fields", async () => {
  const badPrepared = {
    ...preparedDelivery(),
    turn: {
      eventId: "evt_bad",
      receivedAt: "2026-07-29T17:00:00.000Z",
      // command kind without required `command` field
      input: { kind: "command" as const },
      actor: { externalUserId: "U1" },
    },
  };
  const deliveryChannel = channel(
    badPrepared as unknown as ReturnType<typeof preparedDelivery>,
  );
  const control: RealtimeGatewaySession = {
    push: vi.fn().mockResolvedValue({
      result: "claimed",
      deliveryId: "dlv_delivery_01",
      ownerGeneration: 1,
      joinToken: "chj_token_01",
    }),
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
  invitationHandler({
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_delivery_01",
    canonicalThreadId: "thread_01",
  });
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
});

test("surfaces a failed provider result as an already-terminal error", async () => {
  const deliveryChannel = channel();
  vi.mocked(deliveryChannel.push).mockImplementation((_event, packet) =>
    Promise.resolve({
      ...(packet as object),
      phase: "failed",
      result: { error: "provider_call_failed", status: "failed" },
    }),
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
  ).rejects.toBeInstanceOf(ChannelProviderDeliveryError);
  expect(session.hasProviderOutput()).toBe(false);
});
