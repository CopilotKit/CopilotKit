import { expect, test, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import type {
  ChannelAgentLifecycleArgs,
  PlatformAdapter,
} from "./platform-adapter.js";

test("an omitted Memory grant runs on a direct Channel without Intelligence", async () => {
  const adapter = new FakeAdapter();
  const agent = new FakeAgent();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
  });
  let ran = false;
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
    ran = true;
  });
  await channel.ɵruntime.start();

  await adapter.getSink().onTurn({
    conversationKey: "conversation",
    replyTarget: {},
    userText: "hello",
    platform: "slack",
  });

  expect(ran).toBe(true);
});

test("an explicit Memory grant fails before a direct Channel agent runs without Intelligence", async () => {
  const adapter = new FakeAdapter();
  const agent = new FakeAgent();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent({ memory: { project: "read" } });
  });
  await channel.ɵruntime.start();

  await expect(
    adapter.getSink().onTurn({
      conversationKey: "conversation",
      replyTarget: {},
      userText: "hello",
      platform: "slack",
    }),
  ).rejects.toMatchObject({ code: "channel_memory_unavailable" });
  expect(agent.runAgentCalls).toBe(0);
});

test("project-only Memory works when Channel identity is null", async () => {
  const adapter = new FakeAdapter();
  const lifecycle = vi.fn(async (args: ChannelAgentLifecycleArgs) =>
    args.execute({}, undefined),
  );
  adapter.supportsIntelligenceMemory = true;
  adapter.runAgentLifecycle = lifecycle;
  const channel = createChannel({
    identifyUser: () => null,
    adapters: [adapter],
    agent: () => new FakeAgent(),
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent({ memory: { project: "read-write" } });
  });
  await channel.ɵruntime.start();

  await adapter.getSink().onTurn({
    conversationKey: "conversation",
    replyTarget: {},
    userText: "hello",
    platform: "slack",
  });

  expect(lifecycle).toHaveBeenCalledWith(
    expect.objectContaining({
      user: null,
      memory: {
        grant: { user: "none", project: "read-write" },
        user: null,
      },
    }),
  );
});

test("a custom identity callback may map a non-human actor to personal Memory", async () => {
  const adapter = new FakeAdapter();
  const lifecycle = vi.fn(async (args: ChannelAgentLifecycleArgs) =>
    args.execute({}, undefined),
  );
  adapter.supportsIntelligenceMemory = true;
  adapter.runAgentLifecycle = lifecycle;
  const channel = createChannel({
    identifyUser: ({ actor }) => ({
      id: `service:${actor.id}`,
      name: actor.name ?? actor.id,
    }),
    adapters: [adapter],
    agent: () => new FakeAgent(),
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent({ memory: { user: "read" } });
  });
  await channel.ɵruntime.start();

  await adapter.getSink().onTurn({
    conversationKey: "conversation",
    replyTarget: {},
    userText: "refresh",
    platform: "slack",
    actor: { id: "sync-bot", kind: "bot", name: "Sync Bot" },
  });

  expect(lifecycle).toHaveBeenCalledWith(
    expect.objectContaining({
      user: { id: "service:sync-bot", name: "Sync Bot" },
      memory: {
        grant: { user: "read", project: "none" },
        user: { id: "service:sync-bot", name: "Sync Bot" },
      },
    }),
  );
});

test("personal Memory fails before execution when Channel identity is null", async () => {
  const adapter = new FakeAdapter();
  adapter.supportsIntelligenceMemory = true;
  adapter.runAgentLifecycle = vi.fn();
  const channel = createChannel({
    identifyUser: () => null,
    adapters: [adapter],
    agent: () => new FakeAgent(),
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent({ memory: { user: "read", project: "none" } });
  });
  await channel.ɵruntime.start();

  await expect(
    adapter.getSink().onTurn({
      conversationKey: "conversation",
      replyTarget: {},
      userText: "hello",
      platform: "slack",
    }),
  ).rejects.toMatchObject({ code: "channel_memory_user_required" });
  expect(adapter.runAgentLifecycle).not.toHaveBeenCalled();
});

test("an invalid JavaScript Memory grant fails before agent execution", async () => {
  const adapter = new FakeAdapter();
  adapter.supportsIntelligenceMemory = true;
  adapter.runAgentLifecycle = vi.fn();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => new FakeAgent(),
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent({
      memory: { user: "admin" } as never,
    });
  });
  await channel.ɵruntime.start();

  await expect(
    adapter.getSink().onTurn({
      conversationKey: "conversation",
      replyTarget: {},
      userText: "hello",
      platform: "slack",
      actor: { id: "alice", kind: "human" },
    }),
  ).rejects.toMatchObject({ code: "channel_memory_grant_invalid" });
  expect(adapter.runAgentLifecycle).not.toHaveBeenCalled();
});

test("runAgent snapshots its Memory grant before queued execution", async () => {
  const adapter = new FakeAdapter();
  adapter.supportsIntelligenceMemory = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queuedAdapter = adapter as FakeAdapter & PlatformAdapter;
  queuedAdapter.trackThreadOperation = (_target, operation) =>
    gate.then(operation);
  const lifecycle = vi.fn(async (args: ChannelAgentLifecycleArgs) =>
    args.execute(args.renderer.subscriber, undefined),
  );
  adapter.runAgentLifecycle = lifecycle;
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: new FakeAgent(),
  });
  let thread:
    | Parameters<Parameters<typeof channel.onMessage>[0]>[0]["thread"]
    | undefined;
  channel.onMessage((context) => {
    thread = context.thread;
  });
  await channel.ɵruntime.start();
  await adapter.getSink().onTurn({
    conversationKey: "thread-queued",
    replyTarget: {},
    userText: "hello",
    platform: "slack",
    actor: { id: "U1", kind: "human" },
    identityContext: {
      tenant: { id: "T1" },
      installation: { id: "I1" },
      conversation: { id: "C1" },
      trigger: "message",
      event: { id: "E1" },
      raw: {},
    },
  });
  if (!thread) throw new Error("message handler did not receive a Thread");

  const memory = { user: "read" as const, project: "none" as const };
  const run = thread.runAgent({ memory });
  (memory as { user: "read" | "none" }).user = "none";
  release();
  await run;

  expect(lifecycle).toHaveBeenCalledWith(
    expect.objectContaining({
      memory: {
        grant: { user: "read", project: "none" },
        user: { id: "slack:T1:U1", name: "U1" },
      },
    }),
  );
});
