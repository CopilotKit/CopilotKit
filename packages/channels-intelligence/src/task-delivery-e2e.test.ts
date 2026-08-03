import { createChannel } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";

const eventTask = {
  id: "task_event_e2e_01",
  surfaceId: "surface_support_01",
  goal: "Handle production blockers",
  when: {
    kind: "event" as const,
    event: "message" as const,
    rule: "The message says production is blocked",
  },
  enabled: true,
  createdBy: {
    kind: "application" as const,
    applicationId: "runtime_01",
  },
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

const scheduledTask = {
  ...eventTask,
  id: "task_scheduled_e2e_01",
  goal: "Post the daily status prompt",
  when: {
    kind: "schedule" as const,
    cron: "0 9 * * 1-5",
    timeZone: "America/Los_Angeles",
  },
  enabled: true as const,
};

test("event and scheduled Tasks share the managed delivery, effect, and canonical Thread paths", async () => {
  const gateway = new DeliveryTestGateway();
  const structuredOutput = vi.fn().mockResolvedValue({
    data: { taskId: eventTask.id },
    rawText: JSON.stringify({ taskId: eventTask.id }),
  });
  const model = {
    kind: "text",
    name: "task-e2e",
    model: "task-e2e",
    structuredOutput,
    chatStream: vi.fn(),
    "~types": {},
  } as never;
  const channel = createChannel({
    identifyUser: "platform",
    name: "support",
    tasks: { model },
  });
  const taskRuns: Array<{
    kind: "event" | "schedule";
    actorId: string | null;
    thread: string;
  }> = [];
  const ordinaryThreads: string[] = [];
  channel.onTask(async ({ task, cause, thread }) => {
    taskRuns.push({
      kind: cause.kind,
      actorId: cause.actor?.id ?? null,
      thread: thread.conversationKey,
    });
    await thread.post(task.goal);
  });
  channel.onMessage(({ thread }) => {
    ordinaryThreads.push(thread.conversationKey);
  });
  let taskListReads = 0;
  const appApiFetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/tasks?")) {
      taskListReads += 1;
      return new Response(
        JSON.stringify({ tasks: taskListReads === 1 ? [eventTask] : [] }),
      );
    }
    return new Response(
      JSON.stringify({
        charged: true,
        metering: { mode: "unlimited", lifetimeUsed: 1 },
      }),
    );
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 7, channelName: "support" },
    runtimeInstanceId: "rti_task_e2e_01",
    appApiBaseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    appApiFetch,
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("event_task_e2e_01", "slack", {
        kind: "text",
        text: "Production is blocked",
      }),
    );
    const scheduled = {
      ...preparedDelivery("scheduled_task_e2e_01", "slack", {
        kind: "scheduled_task" as const,
        scheduledAt: "2026-08-01T16:00:00.000Z",
        task: scheduledTask,
      }),
      surfaceId: scheduledTask.surfaceId,
    };
    await gateway.deliver(scheduled);
    await gateway.deliver({
      ...preparedDelivery("scheduled_reply_e2e_01", "slack", {
        kind: "text",
        text: "Here is today's update",
      }),
      canonicalThreadId: scheduled.canonicalThreadId,
    });

    expect(structuredOutput).toHaveBeenCalledOnce();
    expect(taskRuns).toEqual([
      {
        kind: "event",
        actorId: "user_event_task_e2e_01",
        thread: "thread_event_task_e2e_01",
      },
      {
        kind: "schedule",
        actorId: null,
        thread: scheduled.canonicalThreadId,
      },
    ]);
    expect(ordinaryThreads).toEqual([scheduled.canonicalThreadId]);
    const scheduledCreates = gateway.packets.filter(
      (packet) =>
        packet.payload.kind === "slack.message.create" &&
        packet.payload.text === scheduledTask.goal,
    );
    expect(scheduledCreates.length).toBeGreaterThan(0);
    for (const packet of scheduledCreates) {
      expect(packet.payload).not.toHaveProperty("threadTs");
    }
    expect(
      appApiFetch.mock.calls.filter(([url]) => String(url).endsWith("/charge")),
    ).toHaveLength(2);
    expect(appApiFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/tasks?surfaceId=surface_support_01&event=message&enabled=true",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-cpki-channel-delivery-id": expect.stringMatching(/^dlv_/u),
        }),
      }),
    );
  } finally {
    await handle.stop();
  }
});
