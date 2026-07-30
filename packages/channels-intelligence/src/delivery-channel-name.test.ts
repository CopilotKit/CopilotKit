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
  const channel = createChannel({ name: "support", agent: () => agent });
  channel.onMessage(async ({ thread, message }) => {
    await thread.runAgent({ prompt: message.text });
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_channel_name",
    runCanonical,
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("channel_name", "slack", {
        kind: "text",
        text: "hello",
      }),
    );

    expect(runCanonical).toHaveBeenCalledOnce();
    expect(runCanonical.mock.calls[0]![0].agentId).toBe("support");
  } finally {
    await handle.stop();
  }
});
