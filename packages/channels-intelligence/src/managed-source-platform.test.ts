import { createChannel } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { startChannelsWithGatewaySession } from "./realtime-gateway-launcher.js";
import type {
  LiveSessionAdapterKind,
  LiveSessionDelivery,
  LiveSessionTurnInput,
} from "./live-session-transport.js";

class SourcePlatformGatewaySession implements RealtimeGatewaySession {
  private deliveryHandler?: (payload: unknown) => void;
  private leaves = 0;

  push(_event: string, _payload: unknown): Promise<unknown> {
    return Promise.resolve({});
  }

  on(event: string, handler: (payload: unknown) => void): void {
    if (event === "channel.delivery.v1") this.deliveryHandler = handler;
  }

  async join(
    _topic: string,
    _payload: unknown,
  ): Promise<RealtimeGatewayDeliveryChannel> {
    return {
      push: async () => ({}),
      on: () => undefined,
      leave: () => {
        this.leaves += 1;
      },
    };
  }

  async deliver(delivery: LiveSessionDelivery): Promise<void> {
    const expectedLeaves = this.leaves + 1;
    this.deliveryHandler?.(delivery);
    await vi.waitFor(() => {
      expect(this.leaves).toBe(expectedLeaves);
    });
  }
}

function delivery(
  id: string,
  adapter: LiveSessionAdapterKind,
  input: LiveSessionTurnInput,
): LiveSessionDelivery {
  return {
    protocol: "channel_session_v1",
    deliveryId: `delivery-${id}`,
    deliveryCode: `delivery-code-${id}`,
    sessionTopic: `channel_session:delivery-${id}`,
    canonicalThreadId: `thread-${id}`,
    appUserId: `app-user-${id}`,
    channelId: "channel-source-platform",
    adapter,
    turn: {
      id: `turn-${id}`,
      eventId: `event-${id}`,
      receivedAt: new Date().toISOString(),
      input,
      actor: {
        externalUserId: `user-${id}`,
        displayName: "Ada",
      },
    },
  };
}

test("managed handlers receive the source provider instead of the Intelligence transport name", async () => {
  const observed: Record<string, string> = {};
  const identity = vi.fn(() => "person-1");
  const gateway = new SourcePlatformGatewaySession();
  const channel = createChannel({
    name: "support",
    store: {
      identity,
      transcripts: {},
    },
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
  const handle = await startChannelsWithGatewaySession([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "runtime-source-platform",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      delivery("text", "slack", { kind: "text", text: "hello" }),
    );
    await gateway.deliver(
      delivery("command", "teams", {
        kind: "command",
        command: "triage",
      }),
    );
    await gateway.deliver(
      delivery("interaction", "slack", {
        kind: "interaction",
        actionId: "approve",
      }),
    );
    await gateway.deliver(
      delivery("reaction", "teams", {
        kind: "reaction",
        rawEmoji: "👍",
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
