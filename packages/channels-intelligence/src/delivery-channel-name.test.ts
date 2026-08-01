import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

test("managed deliveries use the canonical Channel agent id for runs", async () => {
  const gateway = new DeliveryTestGateway();
  const agent = new FakeAgent();
  const runCanonical = vi.fn(async (args) => args.execute({}));
  const appApiFetch = vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith("/charge")) {
      return new Response(JSON.stringify({ charged: true }));
    }
    return new Response(
      JSON.stringify({
        messages: [
          {
            logicalMessageId:
              "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
            revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
            occurredAt: "2026-07-29T17:00:00.000Z",
            role: "participant",
            actor: {
              id: "U1",
              kind: "human",
              displayName: null,
              handle: null,
            },
            text: "hello",
            messageRef: {
              id: "pref_v1_transcript_message_channel_name_123",
            },
            deleted: false,
            currentTrigger: true,
            files: [],
          },
        ],
        truncation: {
          messageLimit: false,
          byteLimit: false,
          omittedMessageCount: 0,
        },
      }),
    );
  });
  const channel = createChannel({
    identifyUser: "platform",
    name: "support",
    agent: () => agent,
  });
  channel.onMessage(async ({ thread, message }) => {
    await thread.runAgent({
      prompt: message.text,
      memory: { user: "read", project: "read-write" },
    });
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_channel_name",
    appApiBaseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    appApiFetch,
    runCanonical,
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("channel_name", "slack", {
        kind: "text",
        text: "hello",
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: false,
        },
      }),
    );

    expect(runCanonical).toHaveBeenCalledOnce();
    expect(runCanonical.mock.calls[0]![0].agentId).toBe("channel:support");
    expect(runCanonical.mock.calls[0]![0].memory).toEqual({
      grant: { user: "read", project: "read-write" },
      user: {
        id: "slack:tenant_channel_name:user_channel_name",
        name: "Ada",
      },
    });
  } finally {
    await handle.stop();
  }
});
