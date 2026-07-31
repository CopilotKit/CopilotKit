import { expect, test, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

test("routes a welcome lifecycle event without synthesizing a message turn", async () => {
  const adapter = new FakeAdapter();
  const onWelcome = vi.fn();
  const onMessage = vi.fn();
  const channel = createChannel({ adapters: [adapter] });
  channel.onWelcome(onWelcome);
  channel.onMessage(onMessage);
  await channel.ɵruntime.start();

  await adapter.emitWelcome({
    conversationKey: "teams:tenant:conversation",
    replyTarget: { conversationId: "conversation" },
    platform: "teams",
    user: { id: "user-1", name: "Ada" },
  });

  expect(onWelcome).toHaveBeenCalledOnce();
  expect(onWelcome).toHaveBeenCalledWith(
    expect.objectContaining({
      user: { id: "user-1", name: "Ada" },
      platform: "teams",
    }),
  );
  expect(onMessage).not.toHaveBeenCalled();
});

test("exposes submitted input values separately from the action envelope", async () => {
  const adapter = new FakeAdapter();
  const handler = vi.fn();
  const channel = createChannel({ adapters: [adapter] });
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
