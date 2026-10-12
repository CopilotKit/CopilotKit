import { expect, test, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import { MemoryStore } from "./state/memory-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Thread } from "./thread.js";

/** Run an agent from a welcome handler and return its resulting message history. */
async function runWelcomeAgent(opts?: {
  prompt?: string;
  /** Force the shipping-adapter path where the conversation store seeds inbound turns. */
  seedsInboundTurn?: boolean;
}) {
  const adapter = new FakeAdapter();
  const agent = new FakeAgent();
  adapter.conversationStore.getOrCreate = async () => ({ agent });
  if (opts?.seedsInboundTurn) {
    Object.defineProperty(adapter.conversationStore, "seedsInboundTurn", {
      value: true,
    });
  }
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent,
  });
  channel.onWelcome(async ({ thread }) => {
    await thread.runAgent(
      opts?.prompt === undefined ? undefined : { prompt: opts.prompt },
    );
  });
  await channel.ɵruntime.start();

  try {
    await adapter.emitWelcome();
    return agent.messages;
  } finally {
    await channel.ɵruntime.stop();
  }
}

test("defaults welcome agent runs to an introduction prompt unless overridden", async () => {
  const defaultMessages = await runWelcomeAgent();
  const overriddenMessages = await runWelcomeAgent({
    prompt: "Use my custom prompt",
  });

  expect(defaultMessages).toEqual([
    expect.objectContaining({
      role: "user",
      content: "Introduce yourself to the channel!",
    }),
  ]);
  expect(overriddenMessages).toEqual([
    expect.objectContaining({
      role: "user",
      content: "Use my custom prompt",
    }),
  ]);
});

test("defaults the welcome prompt when the conversation store seeds inbound turns", async () => {
  // Every shipping adapter's store sets seedsInboundTurn, but a welcome has no
  // inbound turn to seed — the default must still be injected on that path.
  const messages = await runWelcomeAgent({ seedsInboundTurn: true });

  expect(messages).toEqual([
    expect.objectContaining({
      role: "user",
      content: "Introduce yourself to the channel!",
    }),
  ]);
});

test("an inbound message outranks the thread's default prompt", async () => {
  // No createChannel path reaches this combination today (only welcome threads
  // carry a defaultPrompt, and they never carry a message), so pin the
  // precedence at the Thread level for when a second producer appears.
  const adapter = new FakeAdapter();
  const agent = new FakeAgent();
  adapter.conversationStore.getOrCreate = async () => ({ agent });
  const thread = new Thread({
    adapter,
    replyTarget: {},
    conversationKey: "c1",
    channelName: "test",
    threadId: "c1",
    registry: new ActionRegistry({ store: new InMemoryActionStore() }),
    agentFactories: new Map([["default", () => agent]]),
    defaultId: "default",
    tools: new Map(),
    toolDescriptors: [],
    context: [],
    registerWaiter: () => {},
    interruptHandlers: new Map(),
    state: new MemoryStore(),
    message: {
      text: "Real user input",
      user: null,
      actor: { id: "provider-user-1", kind: "human" },
      ref: { id: "m1" },
      platform: "fake",
    },
    defaultPrompt: "Introduce yourself to the channel!",
    user: null,
    actor: { id: "provider-user-1", kind: "human" },
  });

  await thread.runAgent();

  expect(agent.messages).toEqual([
    expect.objectContaining({ role: "user", content: "Real user input" }),
  ]);
});

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
