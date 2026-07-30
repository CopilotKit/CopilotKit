import type { ChannelDeliveryPacket } from "./delivery-contracts.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";

/** In-memory control and delivery topics for SDK integration tests. */
export class DeliveryTestGateway implements RealtimeGatewaySession {
  readonly controlPushes: Array<{ event: string; payload: unknown }> = [];
  readonly packets: ChannelDeliveryPacket[] = [];
  private invitationHandler?: (payload: unknown) => void;
  private currentDelivery?: PreparedChannelDelivery;
  private leaves = 0;

  push(event: string, payload: unknown): Promise<unknown> {
    this.controlPushes.push({ event, payload });
    if (event === "claim" || event === "join_token") {
      const deliveryId = (payload as { deliveryId: string }).deliveryId;
      return Promise.resolve({
        result: "claimed",
        deliveryId,
        ownerGeneration: 1,
        joinToken: `chj_${deliveryId}`,
        deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
      });
    }
    return Promise.resolve({});
  }

  on(event: string, handler: (payload: unknown) => void): void {
    if (event === "delivery_invitation") this.invitationHandler = handler;
  }

  async join(
    _topic: string,
    _payload: unknown,
  ): Promise<RealtimeGatewayDeliveryChannel> {
    const delivery = this.currentDelivery;
    if (!delivery) throw new Error("No prepared delivery is queued");
    return {
      joinReply: delivery,
      push: async (_event, payload) => {
        const packet = payload as ChannelDeliveryPacket;
        this.packets.push(packet);
        return {
          deliveryId: packet.deliveryId,
          seq: packet.seq,
          effectId: packet.effectId,
          responseId: packet.responseId,
          payloadDigest: packet.payloadDigest,
          phase: "applied",
          result:
            packet.payload.kind === "channel.delivery.terminal"
              ? {}
              : { providerReference: `pref_v1_${packet.responseId}` },
        };
      },
      on: () => undefined,
      onClose: () => undefined,
      leave: () => {
        this.leaves += 1;
      },
    };
  }

  /** Publish one prepared delivery and wait for its delivery topic to close. */
  async deliver(delivery: PreparedChannelDelivery): Promise<void> {
    const expectedLeaves = this.leaves + 1;
    this.currentDelivery = delivery;
    this.invitationHandler?.({
      protocol: "channel_delivery_v1",
      deliveryId: delivery.deliveryId,
    });
    const deadline = Date.now() + 1_000;
    while (this.leaves !== expectedLeaves) {
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for delivery topic to close");
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
}

/** Build one valid prepared delivery for SDK integration tests. */
export function preparedDelivery(
  suffix: string,
  adapter: "slack" | "teams",
  input: PreparedChannelDelivery["turn"]["input"],
): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: `dlv_${suffix}`,
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    canonicalThreadId: `thread_${suffix}`,
    appUserId: `app_user_${suffix}`,
    channelId: "channel_support",
    channelName: "support",
    adapter,
    turn: {
      eventId: `event_${suffix}`,
      receivedAt: "2026-07-29T17:00:00.000Z",
      input,
      actor: {
        externalUserId: `user_${suffix}`,
        displayName: "Ada",
      },
    },
  };
}
