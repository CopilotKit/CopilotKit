import { createChannel } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

test("delivery handlers receive the source provider", async () => {
  const observed: Record<string, string> = {};
  const identity = vi.fn(() => "person-1");
  const gateway = new DeliveryTestGateway();
  const channel = createChannel({
    name: "support",
    store: { identity, transcripts: {} },
  });
  channel.onMessage(({ message, thread }) => {
    observed.textMessagePlatform = message.platform;
    observed.textThreadPlatform = thread.platform;
  });
  channel.onCommand("triage", ({ platform, thread }) => {
    observed.commandPlatform = platform;
    observed.commandThreadPlatform = thread.platform;
  });
  channel.onInteraction("approve", ({ message, platform, thread }) => {
    observed.interactionMessagePlatform = message.platform;
    observed.interactionPlatform = platform;
    observed.interactionThreadPlatform = thread.platform;
  });
  channel.onReaction(({ thread }) => {
    observed.reactionThreadPlatform = thread.platform;
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_source_platform",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("text", "slack", { kind: "text", text: "hello" }),
    );
    await gateway.deliver(
      preparedDelivery("command", "teams", {
        kind: "command",
        command: "triage",
      }),
    );
    await gateway.deliver(
      preparedDelivery("interaction", "slack", {
        kind: "interaction",
        actionId: "approve",
      }),
    );
    await gateway.deliver(
      preparedDelivery("reaction", "teams", {
        kind: "reaction",
        rawEmoji: "thumbs-up",
        added: true,
        messageId: "pref_v1_sourcePlatformReaction_123",
        messageRef: { id: "pref_v1_sourcePlatformReaction_123" },
      }),
    );

    expect(observed).toEqual({
      textMessagePlatform: "slack",
      textThreadPlatform: "slack",
      commandPlatform: "teams",
      commandThreadPlatform: "teams",
      interactionMessagePlatform: "slack",
      interactionPlatform: "slack",
      interactionThreadPlatform: "slack",
      reactionThreadPlatform: "teams",
    });
    expect(identity).toHaveBeenCalledWith(
      expect.objectContaining({ adapter: "slack" }),
    );
  } finally {
    await handle.stop();
  }
});
