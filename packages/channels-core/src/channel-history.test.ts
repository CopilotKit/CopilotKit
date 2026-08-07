import { describe, expect, it, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import type { ChannelHistoryAdapter } from "./channel-history.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { toAgentToolDescriptors } from "./tools.js";

describe("Channel provider history", () => {
  it("binds the selected tool to the current trusted surface", async () => {
    const read = vi.fn().mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    const adapter = new FakeAdapter({ messageEvents: true }) as FakeAdapter & {
      channelHistory: ChannelHistoryAdapter;
    };
    adapter.channelHistory = { read };
    const channel = createChannel({
      name: "support",
      identifyUser: "platform",
      adapters: [adapter],
    });
    channel.tool(channel.readChannelMessagesTool);
    let currentThread: unknown;
    channel.onMessage(({ thread }) => {
      currentThread = thread;
    });

    await channel.ɵruntime.start();
    await adapter.getSink().onTurn({
      conversationKey: "thread_support_01",
      replyTarget: { delivery: { deliveryId: "dlv_123" } },
      surfaceId: "surface_support_01",
      userText: "What happened earlier?",
      platform: "slack",
      actor: { id: "U123", kind: "human" },
    });
    await channel.readChannelMessagesTool.handler(
      { limit: 25, cursor: "opaque-cursor" },
      {
        thread: currentThread as never,
        user: null,
        actor: { id: "model-spoof", kind: "app" },
        platform: "slack",
      },
    );

    expect(read).toHaveBeenCalledWith(
      {
        surfaceId: "surface_support_01",
        limit: 25,
        cursor: "opaque-cursor",
      },
      expect.objectContaining({
        replyTarget: { delivery: { deliveryId: "dlv_123" } },
        actor: { id: "U123", kind: "human" },
      }),
    );
    const descriptor = toAgentToolDescriptors([
      channel.readChannelMessagesTool,
    ])[0]!;
    expect(descriptor.parameters).toMatchObject({
      properties: { limit: expect.any(Object), cursor: expect.any(Object) },
      additionalProperties: false,
    });
    expect(
      Object.keys((descriptor.parameters as { properties: object }).properties),
    ).toEqual(["limit", "cursor"]);
  });
});
