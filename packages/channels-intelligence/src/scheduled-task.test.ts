import { createChannel } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";

test("scheduled delivery invokes onTask with no actor and posts through the normal effect path", async () => {
  const gateway = new DeliveryTestGateway();
  const model = {
    kind: "text",
    name: "unused",
    model: "unused",
    structuredOutput: vi.fn(),
    chatStream: vi.fn(),
    "~types": {},
  } as never;
  const channel = createChannel({
    identifyUser: "platform",
    name: "support",
    tasks: { model },
  });
  const handled = vi.fn();
  channel.onTask(async ({ task, cause, thread }) => {
    handled({ task, cause });
    await thread.post(task.goal);
  });
  const appApiFetch = vi.fn(async () =>
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
    runtimeInstanceId: "rti_scheduled_01",
    appApiBaseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    appApiFetch,
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });
  const task = {
    id: "task_scheduled_01",
    surfaceId: "surface_support_01",
    goal: "Post the daily status prompt",
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

  await gateway.deliver({
    ...preparedDelivery("scheduled_01", "slack", {
      kind: "scheduled_task",
      scheduledAt: "2026-08-01T16:00:00.000Z",
      task,
    }),
    surfaceId: task.surfaceId,
    turn: {
      eventId: "evt_scheduled_01",
      receivedAt: "2026-08-01T16:00:00.000Z",
      input: {
        kind: "scheduled_task",
        scheduledAt: "2026-08-01T16:00:00.000Z",
        task,
      },
    },
  });

  expect(handled).toHaveBeenCalledWith({
    task,
    cause: {
      kind: "schedule",
      scheduledAt: "2026-08-01T16:00:00.000Z",
      actor: null,
    },
  });
  expect(gateway.packets.map((packet) => packet.payload)).toContainEqual(
    expect.objectContaining({
      kind: "slack.message.create",
      text: "Post the daily status prompt",
    }),
  );
  expect(appApiFetch).toHaveBeenCalledOnce();

  await handle.stop();
});
