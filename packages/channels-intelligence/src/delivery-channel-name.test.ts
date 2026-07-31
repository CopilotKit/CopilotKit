import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

test("managed deliveries use the declared Channel name for canonical runs", async () => {
  const gateway = new DeliveryTestGateway();
  const agent = new FakeAgent();
  const runCanonical = vi.fn(async (args) => args.execute({}));
  const appApiFetch = vi.fn(async () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          messages: [
            {
              logicalMessageId: "message-channel-name",
              revisionId: "revision-channel-name",
              occurredAt: "2026-07-29T17:00:00.000Z",
              role: "participant",
              actor: {
                id: "U1",
                kind: "human",
                displayName: null,
                handle: null,
              },
              text: "hello",
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
      ),
    ),
  );
  const channel = createChannel({ name: "support", agent: () => agent });
  channel.onMessage(async ({ thread, message }) => {
    await thread.runAgent({ prompt: message.text });
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
          logicalMessageId: "message-channel-name",
          revisionId: "revision-channel-name",
          mentioned: false,
        },
      }),
    );

    expect(runCanonical).toHaveBeenCalledOnce();
    expect(runCanonical.mock.calls[0]![0].agentId).toBe("support");
  } finally {
    await handle.stop();
  }
});
