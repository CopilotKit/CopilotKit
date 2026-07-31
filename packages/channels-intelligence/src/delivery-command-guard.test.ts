import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { Section } from "@copilotkit/channels-ui";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

test("Slack commands reject runAgent while direct replies use delivery packets", async () => {
  const gateway = new DeliveryTestGateway();
  const agent = new FakeAgent();
  const runCanonical = vi.fn(async (args) => args.execute({}));
  const channel = createChannel({
    identifyUser: "platform",
    name: "support",
    agent: () => agent,
  });
  channel.onMessage(async () => {});
  let runError: unknown;
  channel.onCommand("triage", async ({ thread, text }) => {
    try {
      await thread.runAgent({ prompt: text });
    } catch (error) {
      runError = error;
    }
    await thread.post(Section({ children: "Direct command reply" }));
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_command_guard",
    runCanonical,
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("command_guard", "slack", {
        kind: "command",
        command: "triage",
        text: "urgent",
      }),
    );

    expect(runError).toMatchObject({
      name: "ChannelSlashCommandAgentNotSupportedError",
      code: "channel_slash_command_agent_not_supported",
    });
    expect(agent.runAgentCalls).toBe(0);
    expect(runCanonical).not.toHaveBeenCalled();
    expect(gateway.packets.map(({ payload }) => payload.kind)).toEqual([
      "slack.message.create",
      "channel.delivery.terminal",
    ]);
  } finally {
    await handle.stop();
  }
});
