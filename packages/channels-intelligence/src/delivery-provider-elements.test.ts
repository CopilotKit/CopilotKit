import { expect, test, vi } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { DeliveryAdapter } from "./delivery-adapter.js";
import { ChannelProviderMismatchError } from "./delivery-transport.js";
import type {
  ClaimedChannelDelivery,
  PreparedChannelDelivery,
} from "./delivery-transport.js";

function delivery(adapter: "slack" | "teams"): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: `dlv_provider_element_${adapter}`,
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_provider_element",
    channelName: "support",
    canonicalThreadId: "thread_provider_element",
    appUserId: `${adapter}:tenant:user`,
    adapter,
    turn: {
      eventId: `evt_provider_element_${adapter}`,
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: {
        kind: "text",
        text: "hello",
        messageRef: { id: "pref_v1_provider_element_message_123" },
        operation: {
          kind: "created",
          logicalMessageId: "provider-element-message",
          revisionId: "provider-element-revision",
          mentioned: true,
        },
      },
      actor: { externalUserId: "user", kind: "human" },
    },
  };
}

function makeAdapter(): DeliveryAdapter {
  return new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });
}

function target(provider: "slack" | "teams", effect: ReturnType<typeof vi.fn>) {
  return {
    claimedDelivery: { effect } as unknown as ClaimedChannelDelivery,
    delivery: delivery(provider),
  };
}

test.each([
  ["slack", "teams"],
  ["teams", "slack"],
] as const)(
  "%s delivery rejects a %s-native element before an effect is sent",
  async (activeProvider, elementProvider) => {
    const effect = vi.fn();
    const ir: ChannelNode[] = [
      {
        type: "raw",
        props: {
          provider: elementProvider,
          value:
            elementProvider === "teams"
              ? { type: "AdaptiveCard", version: "1.5", body: [] }
              : [{ type: "section", text: { type: "plain_text", text: "hi" } }],
        },
      },
    ];

    await expect(
      makeAdapter().post(target(activeProvider, effect), ir),
    ).rejects.toBeInstanceOf(ChannelProviderMismatchError);
    expect(effect).not.toHaveBeenCalled();
  },
);

test("Teams delivery forwards a Teams-native Adaptive Card without translation", async () => {
  const card = { type: "AdaptiveCard", version: "1.5", body: [] };
  const effect = vi.fn().mockResolvedValue({
    providerReference: "pref_v1_teams_native_card_123",
  });

  await makeAdapter().post(target("teams", effect), [
    { type: "raw", props: { provider: "teams", value: card } },
  ]);

  expect(effect).toHaveBeenCalledWith(expect.any(String), {
    kind: "teams.message.create",
    text: "",
    cards: [card],
  });
});
