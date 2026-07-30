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
    vi.mocked(first.push)
      .mockRejectedValueOnce(new Error("socket dropped"))
      .mockResolvedValueOnce(undefined);
    const reconnect = vi.fn().mockResolvedValue(second);
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
    expect(vi.mocked(second.push).mock.calls[0]![1]).toEqual(
      vi.mocked(first.push).mock.calls[0]![1],
    );
    expect(result).toEqual({ providerReference: "pref_v1_message_01" });
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
