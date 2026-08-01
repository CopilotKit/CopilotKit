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
    observed.textMessageRef = message.ref.id;
    observed.textThreadPlatform = thread.platform;
  });
  channel.onInteraction("approve", ({ message, platform, thread }) => {
    observed.interactionMessagePlatform = message.platform;
    observed.interactionPlatform = platform;
    observed.interactionThreadPlatform = thread.platform;
  });
  channel.onInteraction("submit", ({ values }) => {
    observed.submittedReason = String(values.reason);
  });
  channel.onWelcome(({ platform, thread }) => {
    observed.welcomePlatform = platform;
    observed.welcomeThreadPlatform = thread.platform;
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
      preparedDelivery("text", "slack", {
        kind: "text",
        text: "hello",
        messageRef: { id: "pref_v1_sourcePlatformText_123" },
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
        messageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
        messageRef: { id: "pref_v1_sourcePlatformReaction_123" },
      }),
    );
    await gateway.deliver(
      preparedDelivery("interaction-values", "teams", {
        kind: "interaction",
        actionId: "submit",
        values: { reason: "ready" },
      }),
    );
    await gateway.deliver(
      preparedDelivery("welcome", "teams", { kind: "welcome" }),
    );

    expect(observed).toEqual({
      textMessagePlatform: "slack",
      textMessageRef: "pref_v1_sourcePlatformText_123",
      textThreadPlatform: "slack",
      interactionMessagePlatform: "slack",
      interactionPlatform: "slack",
      interactionThreadPlatform: "slack",
      reactionThreadPlatform: "teams",
      submittedReason: "ready",
      welcomePlatform: "teams",
      welcomeThreadPlatform: "teams",
    });
    expect(identity).toHaveBeenCalledWith(
      expect.objectContaining({ adapter: "slack" }),
    );
  } finally {
    await handle.stop();
  }
});

test("managed text selects onMention with onMessage fallback", async () => {
  const mentionGateway = new DeliveryTestGateway();
  const mentionChannel = createChannel({ name: "support" });
  const onMention = vi.fn();
  const onMessage = vi.fn();
  mentionChannel.onMention(onMention);
  mentionChannel.onMessage(onMessage);
  const mentionHandle = await startChannelsWithGatewayControl(
    [mentionChannel],
    {
      session: mentionGateway,
      scope: { projectId: 1, channelName: "support" },
      runtimeInstanceId: "rti_mention_route",
      runCanonical: async (args) => args.execute({}),
      loadHistory: async () => [],
    },
  );

  try {
    await mentionGateway.deliver(
      preparedDelivery("mention-route", "teams", {
        kind: "text",
        text: "@bot hello",
        messageRef: { id: "pref_v1_mention_route_01" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: true,
        },
      }),
    );
    expect(onMention).toHaveBeenCalledOnce();
    expect(onMessage).not.toHaveBeenCalled();
  } finally {
    await mentionHandle.stop();
  }

  const fallbackGateway = new DeliveryTestGateway();
  const fallbackChannel = createChannel({ name: "support" });
  const fallback = vi.fn();
  fallbackChannel.onMessage(fallback);
  const fallbackHandle = await startChannelsWithGatewayControl(
    [fallbackChannel],
    {
      session: fallbackGateway,
      scope: { projectId: 1, channelName: "support" },
      runtimeInstanceId: "rti_mention_fallback",
      runCanonical: async (args) => args.execute({}),
      loadHistory: async () => [],
    },
  );

  try {
    await fallbackGateway.deliver(
      preparedDelivery("mention-fallback", "slack", {
        kind: "text",
        text: "@bot hello",
        messageRef: { id: "pref_v1_mention_fallback_01" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: true,
        },
      }),
    );
    expect(fallback).toHaveBeenCalledOnce();
  } finally {
    await fallbackHandle.stop();
  }
});
