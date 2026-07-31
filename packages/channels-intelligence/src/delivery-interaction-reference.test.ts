import { createChannel } from "@copilotkit/channels-core";
import { Section } from "@copilotkit/channels-ui";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

test("interaction update and delete preserve the opaque provider reference", async () => {
  const providerReference = "pref_v1_opaqueReference_123";
  const gateway = new DeliveryTestGateway();
  const channel = createChannel({ identifyUser: "platform", name: "support" });
  channel.onMessage(async () => {});
  channel.onInteraction("approve", async ({ thread, message }) => {
    await thread.update(
      message.ref,
      Section({ children: "Updated interaction message" }),
    );
    await thread.delete(message.ref);
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_interaction_reference",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("interaction_reference", "slack", {
        kind: "interaction",
        actionId: "approve",
        messageRef: { id: providerReference },
      }),
    );
    expect(gateway.packets.map(({ payload }) => payload)).toMatchObject([
      { kind: "slack.message.replace", providerReference },
      { kind: "slack.message.delete", providerReference },
      { kind: "channel.delivery.terminal", status: "complete" },
    ]);
  } finally {
    await handle.stop();
  }
});

test("invalid interaction references fail before handler dispatch", async () => {
  const gateway = new DeliveryTestGateway();
  const handler = vi.fn();
  const channel = createChannel({ identifyUser: "platform", name: "support" });
  channel.onMessage(async () => {});
  channel.onInteraction("approve", handler);
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_invalid_reference",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("invalid_reference", "slack", {
        kind: "interaction",
        actionId: "approve",
        messageRef: { id: "1712345678.123456" },
      }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(gateway.packets.at(-1)?.payload).toMatchObject({
      kind: "channel.delivery.terminal",
      status: "failed_before_output",
    });
  } finally {
    await handle.stop();
  }
});
