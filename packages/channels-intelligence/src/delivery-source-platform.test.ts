import { createChannel } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

test("delivery handlers receive the source provider", async () => {
  const observed: Record<string, string> = {};
  const identifyUser = vi.fn(() => ({ id: "person-1", name: "Ada App" }));
  const gateway = new DeliveryTestGateway();
  const channel = createChannel({
    identifyUser,
    name: "support",
  });
  channel.onMessage(({ message, thread }) => {
    observed.textMessagePlatform = message.platform;
    observed.textThreadPlatform = thread.platform;
    observed.applicationUser = message.user?.id ?? "null";
    observed.providerActor = `${message.actor.kind}:${message.actor.id}`;
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
      applicationUser: "person-1",
      providerActor: "human:user_text_pad000",
      commandPlatform: "teams",
      commandThreadPlatform: "teams",
      interactionMessagePlatform: "slack",
      interactionPlatform: "slack",
      interactionThreadPlatform: "slack",
      reactionThreadPlatform: "teams",
    });
    expect(identifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "slack",
        tenant: { id: "tenant_text_pad000" },
        installation: { id: "installation_text_pad000" },
        conversation: {
          id: "conversation_text_pad000",
          kind: "thread",
        },
        actor: expect.objectContaining({
          id: "user_text_pad000",
          kind: "human",
        }),
        trigger: "message",
      }),
    );
  } finally {
    await handle.stop();
  }
});
