import { describe, expect, it, vi } from "vitest";
import {
  ChannelProviderDeliveryError,
  ChannelDeliverySession,
  ChannelDeliveryTransport,
} from "./delivery-transport.js";
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
      input: { kind: "text" as const, text: "Hello" },
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

describe("Channel delivery transport", () => {
  it("claims an invitation and consumes the one-use token on delivery join", async () => {
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

  it("retries the exact packet after reconnect and calls no second sequence", async () => {
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
    const session = new ChannelDeliverySession(
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
      effectId: string;
    };
    const original = vi.mocked(first.push).mock.calls[0]![1] as {
      ownerGeneration: number;
      seq: number;
      effectId: string;
    };
    // Exact unacked packet keeps original ownerGeneration on soft retry;
    // subsequent packets use the refreshed generation (next test).
    expect(retried.seq).toBe(original.seq);
    expect(retried.effectId).toBe(original.effectId);
    expect(retried.ownerGeneration).toBe(7);
    expect(result).toEqual({ providerReference: "pref_v1_message_01" });
  });

  it("still sends a failed terminal when complete terminal fails", async () => {
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
    const session = new ChannelDeliverySession(
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

  it("refreshes owner generation on packets after reconnect", async () => {
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
    const session = new ChannelDeliverySession(
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

  it("closes the packet path after a permanent push failure", async () => {
    const deliveryChannel = channel();
    const { RealtimeGatewayPushError } = await import("./realtime-gateway.js");
    vi.mocked(deliveryChannel.push).mockRejectedValue(
      new RealtimeGatewayPushError("packet", "conflict", "sequence conflict"),
    );
    const session = new ChannelDeliverySession(
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

  it("surfaces an applied provider failure as an already-terminal error", async () => {
    const deliveryChannel = channel();
    vi.mocked(deliveryChannel.push).mockImplementation((_event, packet) =>
      Promise.resolve({
        ...(packet as object),
        phase: "applied",
        result: { error: "provider_call_failed", status: "failed" },
      }),
    );
    const session = new ChannelDeliverySession(
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
});
