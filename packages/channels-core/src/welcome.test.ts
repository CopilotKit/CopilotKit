import { expect, test, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

test("routes a welcome lifecycle event without synthesizing a message turn", async () => {
  const adapter = new FakeAdapter();
  const onWelcome = vi.fn();
  const onMessage = vi.fn();
  const channel = createChannel({
    identifyUser: () => ({ id: "app-user-1", name: "Ada App" }),
    adapters: [adapter],
  });
  channel.onWelcome(onWelcome);
  channel.onMessage(onMessage);
  await channel.ɵruntime.start();

  await adapter.emitWelcome({
    conversationKey: "teams:tenant:conversation",
    replyTarget: { conversationId: "conversation" },
    platform: "teams",
    actor: { id: "provider-user-1", kind: "human", name: "Ada Provider" },
  });

  expect(onWelcome).toHaveBeenCalledOnce();
  expect(onWelcome).toHaveBeenCalledWith(
    expect.objectContaining({
      user: { id: "app-user-1", name: "Ada App" },
      actor: {
        id: "provider-user-1",
        kind: "human",
        name: "Ada Provider",
      },
      platform: "teams",
    }),
  );
  expect(onMessage).not.toHaveBeenCalled();
});

test("exposes submitted input values separately from the action envelope", async () => {
  const adapter = new FakeAdapter();
  const handler = vi.fn();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
  });
  channel.onInteraction("approve", handler);
  await channel.ɵruntime.start();

  adapter.emitInteraction({
    id: "approve",
    value: { decision: "yes" },
    values: { reason: "ready", priority: "high" },
    platform: "teams",
  });
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({
      action: { id: "approve", value: { decision: "yes" } },
      values: { reason: "ready", priority: "high" },
    }),
  );
});
