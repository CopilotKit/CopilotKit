import { createChannel } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import { startChannelsOverRealtimeGateway } from "./realtime-gateway-launcher.js";
import type { ConnectedRealtimeGatewaySession } from "./realtime-gateway.js";

const { connectRealtimeGatewayMock } = vi.hoisted(() => ({
  connectRealtimeGatewayMock: vi.fn(),
}));

vi.mock("./realtime-gateway.js", () => ({
  connectRealtimeGateway: connectRealtimeGatewayMock,
}));

function setup() {
  const disconnect = vi.fn();
  const session: ConnectedRealtimeGatewaySession = {
    push: vi.fn(async () => ({})),
    on: vi.fn(),
    join: vi.fn(),
    disconnect,
    onClose: vi.fn(),
    onStateChange: vi.fn(),
  };
  connectRealtimeGatewayMock.mockReset();
  connectRealtimeGatewayMock.mockResolvedValue(session);

  const channel = createChannel({ identifyUser: "platform", name: "support" });
  channel.onMessage(async () => {});

  return {
    channel,
    disconnect,
    webSocket: vi.fn(),
  };
}

test("joins the Gateway control topic with the delivery protocol", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
  const { channel, disconnect, webSocket } = setup();

  try {
    const handle = await startChannelsOverRealtimeGateway([channel], {
      wsUrl: "wss://gateway.example/channels",
      apiKey: "cpk-test",
      scope: { projectId: 7, channelName: "support" },
      runtimeInstanceId: "rti_test",
      env: {
        runtimeEnv: "test",
        nodeVersion: "v22.0.0",
        runtimePackageVersion: "1.2.3",
        channelsPackageVersion: "4.5.6",
      },
      webSocket,
      runCanonical: async (args) => args.execute({}),
      loadHistory: async () => [],
    });

    expect(connectRealtimeGatewayMock).toHaveBeenCalledExactlyOnceWith({
      wsUrl: "wss://gateway.example/channels",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        protocol: "channel_delivery_v1",
        runtimeInstanceId: "rti_test",
        channels: [{ channelName: "support", adapter: "slack" }],
      },
      webSocket,
    });

    await handle.stop();
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
