import { expect, test, vi } from "vitest";
import { ChannelTaskHttpClient } from "./channel-tasks.js";

const task = {
  id: "task_support_01",
  surfaceId: "surface_support_01",
  goal: "Triage production issues",
  when: {
    kind: "event" as const,
    event: "message" as const,
    rule: "The issue blocks production",
  },
  enabled: true,
  createdBy: { kind: "application" as const, applicationId: "runtime_01" },
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

test("Task client uses the trusted delivery surface and delivery id", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ tasks: [task] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ task }), { status: 200 }),
    );
  const client = new ChannelTaskHttpClient({
    baseUrl: "https://api.example/",
    apiKey: "cpk-runtime",
    channelName: "support",
    fetch,
  });
  const context = {
    replyTarget: {
      delivery: {
        deliveryId: "dlv_delivery_01",
        surfaceId: "surface_support_01",
      },
    },
  };

  await expect(
    client.list(
      { surfaceId: "surface_support_01", event: "message", enabled: true },
      context,
    ),
  ).resolves.toEqual([task]);
  await expect(
    client.update({ taskId: task.id, enabled: false }, context),
  ).resolves.toEqual(task);

  expect(fetch).toHaveBeenNthCalledWith(
    1,
    "https://api.example/api/channels/support/tasks?surfaceId=surface_support_01&event=message&enabled=true",
    {
      method: "GET",
      headers: {
        authorization: "Bearer cpk-runtime",
        "x-cpki-channel-delivery-id": "dlv_delivery_01",
      },
    },
  );
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    "https://api.example/api/channels/support/tasks/task_support_01?surfaceId=surface_support_01",
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer cpk-runtime",
        "content-type": "application/json",
        "x-cpki-channel-delivery-id": "dlv_delivery_01",
      },
      body: JSON.stringify({ enabled: false }),
    },
  );
});
