import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";

const task = {
  id: "task_charge_e2e_01",
  surfaceId: "surface_support_01",
  goal: "Run scheduled work",
  when: {
    kind: "schedule" as const,
    cron: "0 9 * * 1-5",
    timeZone: "America/Los_Angeles",
  },
  enabled: true as const,
  createdBy: {
    kind: "application" as const,
    applicationId: "runtime_01",
  },
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

/** Run one controlled scheduled delivery and report its visible side effects. */
async function runScheduledHandler(
  mode: "noop" | "agent" | "effect",
): Promise<{ chargeCalls: number; providerEffects: number }> {
  const gateway = new DeliveryTestGateway();
  const channel = createChannel({
    identifyUser: "platform",
    name: "support",
    tasks: {
      model: {
        kind: "text",
        name: "unused",
        model: "unused",
        structuredOutput: vi.fn(),
        chatStream: vi.fn(),
        "~types": {},
      } as never,
    },
  });
  channel.onTask(async ({ thread }) => {
    if (mode === "agent") {
      await thread.runAgent({ agent: new FakeAgent(), prompt: task.goal });
    }
    if (mode === "effect") await thread.post(task.goal);
  });
  const appApiFetch = vi.fn(async (_input: string | URL | Request) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          charged: true,
          metering: { mode: "unlimited", lifetimeUsed: 1 },
        }),
      ),
    ),
  );
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 7, channelName: "support" },
    runtimeInstanceId: `rti_charge_${mode}_01`,
    appApiBaseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    appApiFetch,
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver({
      ...preparedDelivery(`scheduled_charge_${mode}_01`, "slack", {
        kind: "scheduled_task",
        scheduledAt: "2026-08-01T16:00:00.000Z",
        task,
      }),
      surfaceId: task.surfaceId,
    });
    return {
      chargeCalls: appApiFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/charge"),
      ).length,
      providerEffects: gateway.packets.filter(
        (packet) => packet.payload.kind === "slack.message.create",
      ).length,
    };
  } finally {
    await handle.stop();
  }
}

test("scheduled no-op handlers remain uncharged", async () => {
  await expect(runScheduledHandler("noop")).resolves.toEqual({
    chargeCalls: 0,
    providerEffects: 0,
  });
});

test("scheduled agent runs charge once before work", async () => {
  await expect(runScheduledHandler("agent")).resolves.toMatchObject({
    chargeCalls: 1,
  });
});

test("scheduled provider effects charge once", async () => {
  const result = await runScheduledHandler("effect");
  expect(result.chargeCalls).toBe(1);
  expect(result.providerEffects).toBeGreaterThan(0);
});
