import { createChannel } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

test("managed delivery advertises its backend-owned typing lifecycle", () => {
  const adapter = new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });

  expect(adapter.capabilities.supportsTyping).toBe(true);
});

async function deliverNoopTeamsMessage(typingDelayMs: 0 | 300) {
  const gateway = new DeliveryTestGateway();
  const channel = createChannel({ name: "support" });
  channel.onMessage(() => undefined);
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: `rti_typing_${typingDelayMs}`,
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });
  const base = preparedDelivery(`typing_${typingDelayMs}`, "teams", {
    kind: "text",
    text: "hello",
  });

  try {
    await gateway.deliver({
      ...base,
      turn: { ...base.turn, typingDelayMs },
    });
    return gateway.packets.map((packet) => packet.payload.kind);
  } finally {
    await handle.stop();
  }
}

test("addressed Teams typing remains backend-owned", async () => {
  await expect(deliverNoopTeamsMessage(0)).resolves.toEqual([
    "channel.delivery.terminal",
  ]);
});

test("ambient Teams typing remains backend-owned", async () => {
  await expect(deliverNoopTeamsMessage(300)).resolves.toEqual([
    "channel.delivery.terminal",
  ]);
});

test.each([
  ["accept", ["teams.file.consent.complete", "channel.delivery.terminal"]],
  ["decline", ["channel.delivery.terminal"]],
] as const)(
  "Teams personal-file consent %s stays system-owned",
  async (action, expectedKinds) => {
    const gateway = new DeliveryTestGateway();
    const onMessage = vi.fn();
    const channel = createChannel({ name: "support" });
    channel.onMessage(onMessage);
    const handle = await startChannelsWithGatewayControl([channel], {
      session: gateway,
      scope: { projectId: 1, channelName: "support" },
      runtimeInstanceId: `rti_file_consent_${action}`,
      runCanonical: async (args) => args.execute({}),
      loadHistory: async () => [],
    });

    try {
      await gateway.deliver(
        preparedDelivery(`file_consent_${action}`, "teams", {
          kind: "file_consent",
          action,
          fileHandle: "fileref_personal_file_01",
        }),
      );
      expect(gateway.packets.map((packet) => packet.payload.kind)).toEqual(
        expectedKinds,
      );
      expect(onMessage).not.toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  },
);
