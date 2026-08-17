import type { AgentSubscriber } from "@ag-ui/client";
import { Button } from "@copilotkit/channels-ui";
import { afterEach, expect, test, vi } from "vitest";
import type { ActionSnapshot } from "./action-store.js";
import { createChannel } from "./create-channel.js";
import type { MemoryGrant } from "./memory.js";
import type { ChannelAgentLifecycleArgs } from "./platform-adapter.js";
import { MemoryStore } from "./state/memory-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

const activeChannels: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(activeChannels.splice(0).map((channel) => channel.stop()));
});

function firstActionId(adapter: FakeAdapter): string {
  const button = adapter.posted.flat().find((node) => node.type === "button");
  const action = button?.props.onClick as { id?: unknown } | undefined;
  if (typeof action?.id !== "string") throw new Error("missing action id");
  return action.id;
}

function actionIds(adapter: FakeAdapter): string[] {
  return adapter.posted
    .flat()
    .filter((node) => node.type === "button")
    .map((node) => (node.props.onClick as { id?: unknown } | undefined)?.id)
    .filter((id): id is string => typeof id === "string");
}

function interrupt(subscriber: AgentSubscriber): void {
  subscriber.onCustomEvent?.({
    event: { name: "approval", value: { requestId: "request-1" } },
  } as never);
  subscriber.onRunFinishedEvent?.({ event: {} } as never);
}

async function setup(
  subject: "initiator" | "actor" | undefined,
  memory: MemoryGrant,
) {
  const adapter = new FakeAdapter();
  adapter.supportsIntelligenceMemory = true;
  const lifecycleCalls: ChannelAgentLifecycleArgs[] = [];
  adapter.runAgentLifecycle = vi.fn(async (args: ChannelAgentLifecycleArgs) => {
    lifecycleCalls.push(args);
    return args.execute(args.renderer.subscriber, undefined);
  });
  const state = new MemoryStore();
  const agent = new FakeAgent([interrupt]);

  function Approval() {
    return (
      <Button
        value={{ approved: true }}
        onClick={async ({ thread }) => {
          await thread.resume({ approved: true }, { memory, subject });
        }}
      >
        Approve
      </Button>
    );
  }

  const channel = createChannel({
    name: "approvals",
    identifyUser: ({ actor }) =>
      actor.kind === "human"
        ? { id: `app:${actor.id}`, name: actor.name ?? actor.id }
        : null,
    adapters: [adapter],
    agent,
    components: [Approval],
    store: { adapter: state, actionRetentionMs: 60_000 },
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });
  channel.onInterrupt("approval", async ({ thread }) => {
    await thread.post(<Approval />);
  });
  await channel.ɵruntime.start();
  activeChannels.push({ stop: () => channel.ɵruntime.stop() });

  await adapter.getSink().onTurn({
    conversationKey: "thread-1",
    replyTarget: {},
    userText: "start",
    platform: "slack",
    actor: { id: "alice", kind: "human", name: "Alice" },
  });

  return { adapter, lifecycleCalls, state, actionId: firstActionId(adapter) };
}

test("resume with initiator Memory keeps the original user when Bob clicks", async () => {
  const { adapter, lifecycleCalls, actionId } = await setup("initiator", {
    user: "read",
  });

  await adapter.getSink().onInteraction({
    id: actionId,
    conversationKey: "thread-1",
    replyTarget: {},
    eventId: "bob-click",
    actor: { id: "bob", kind: "human", name: "Bob" },
  });

  expect(lifecycleCalls).toHaveLength(2);
  expect(lifecycleCalls[1]!.memory).toEqual({
    grant: { user: "read", project: "none" },
    user: { id: "app:alice", name: "Alice" },
  });
});

test("a managed continuation keeps its initiator across a Runtime restart", async () => {
  const state = new MemoryStore();
  const lifecycleCalls: ChannelAgentLifecycleArgs[] = [];

  function Approval() {
    return (
      <Button
        value={{ approved: true }}
        onClick={async ({ thread }) => {
          await thread.resume(
            { approved: true },
            { memory: { user: "read" }, subject: "initiator" },
          );
        }}
      >
        Approve
      </Button>
    );
  }

  const makeRuntime = (agent: FakeAgent) => {
    const adapter = new FakeAdapter();
    adapter.supportsIntelligenceMemory = true;
    adapter.runAgentLifecycle = vi.fn(
      async (args: ChannelAgentLifecycleArgs) => {
        lifecycleCalls.push(args);
        return args.execute(args.renderer.subscriber, undefined);
      },
    );
    const channel = createChannel({
      name: "approvals",
      identifyUser: ({ actor }) =>
        actor.kind === "human"
          ? { id: `app:${actor.id}`, name: actor.name ?? actor.id }
          : null,
      adapters: [adapter],
      agent,
      components: [Approval],
      store: { adapter: state, actionRetentionMs: 60_000 },
    });
    channel.onMessage(async ({ thread }) => {
      await thread.runAgent();
    });
    channel.onInterrupt("approval", async ({ thread }) => {
      await thread.post(<Approval />);
    });
    return { adapter, channel };
  };

  const first = makeRuntime(new FakeAgent([interrupt]));
  await first.channel.ɵruntime.start();
  await first.adapter.getSink().onTurn({
    conversationKey: "thread-1",
    replyTarget: {},
    userText: "start",
    platform: "slack",
    actor: { id: "alice", kind: "human", name: "Alice" },
  });
  const actionId = firstActionId(first.adapter);
  await first.channel.ɵruntime.stop();

  const restarted = makeRuntime(new FakeAgent());
  await restarted.channel.ɵruntime.start();
  activeChannels.push({ stop: () => restarted.channel.ɵruntime.stop() });
  await restarted.adapter.getSink().onInteraction({
    id: actionId,
    conversationKey: "thread-1",
    replyTarget: {},
    eventId: "bob-click-after-restart",
    actor: { id: "bob", kind: "human", name: "Bob" },
  });

  expect(lifecycleCalls).toHaveLength(2);
  expect(lifecycleCalls[1]!.memory).toEqual({
    grant: { user: "read", project: "none" },
    user: { id: "app:alice", name: "Alice" },
  });
  expect(lifecycleCalls[1]!.isResume).toBe(true);
});

test("independent runs snapshot new initiators", async () => {
  const state = new MemoryStore();
  const adapter = new FakeAdapter();

  function Approval() {
    return (
      <Button value={{ approved: true }} onClick={() => undefined}>
        Approve
      </Button>
    );
  }

  const channel = createChannel({
    name: "approvals",
    identifyUser: ({ actor }) =>
      actor.kind === "human"
        ? { id: `app:${actor.id}`, name: actor.name ?? actor.id }
        : null,
    adapters: [adapter],
    agent: new FakeAgent([interrupt]),
    components: [Approval],
    store: { adapter: state, actionRetentionMs: 60_000 },
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });
  channel.onInterrupt("approval", async ({ thread }) => {
    await thread.post(<Approval />);
  });
  await channel.ɵruntime.start();
  activeChannels.push({ stop: () => channel.ɵruntime.stop() });

  for (const { actor, conversationKey } of [
    {
      actor: { id: "alice", kind: "human" as const, name: "Alice" },
      conversationKey: "thread-alice",
    },
    {
      actor: { id: "bob", kind: "human" as const, name: "Bob" },
      conversationKey: "thread-bob",
    },
  ]) {
    await adapter.getSink().onTurn({
      conversationKey,
      replyTarget: {},
      userText: "start",
      platform: "slack",
      actor,
    });
  }

  const snapshots = await Promise.all(
    actionIds(adapter).map((id) =>
      state.kv.get<ActionSnapshot>(`action:${id}`),
    ),
  );
  expect(snapshots).toHaveLength(2);
  expect(
    snapshots.map((snapshot) => snapshot?.continuation?.initiator.user?.id),
  ).toEqual(["app:alice", "app:bob"]);
  expect(
    new Set(snapshots.map((snapshot) => snapshot?.continuation?.runChainId))
      .size,
  ).toBe(2);
});

test("concurrent independent runs cannot share a continuation chain", async () => {
  const state = new MemoryStore();
  const adapter = new FakeAdapter();

  function Approval() {
    return (
      <Button value={{ approved: true }} onClick={() => undefined}>
        Approve
      </Button>
    );
  }

  const channel = createChannel({
    name: "approvals",
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => new FakeAgent([interrupt]),
    agents: { billing: () => new FakeAgent([interrupt]) },
    components: [Approval],
    store: { adapter: state, actionRetentionMs: 60_000 },
  });
  let receivedThread:
    | Parameters<Parameters<typeof channel.onMessage>[0]>[0]["thread"]
    | undefined;
  channel.onMessage(({ thread }) => {
    receivedThread = thread;
  });
  channel.onInterrupt("approval", async ({ thread }) => {
    await thread.post(<Approval />);
  });
  await channel.ɵruntime.start();
  activeChannels.push({ stop: () => channel.ɵruntime.stop() });

  await adapter.getSink().onTurn({
    conversationKey: "thread-concurrent",
    replyTarget: {},
    userText: "start",
    platform: "slack",
    actor: { id: "alice", kind: "human", name: "Alice" },
    identityContext: {
      tenant: { id: "T1" },
      installation: { id: "I1" },
      conversation: { id: "C1" },
      trigger: "message",
      event: { id: "E1" },
      raw: {},
    },
  });
  if (!receivedThread)
    throw new Error("message handler did not receive a Thread");

  await Promise.all([
    receivedThread.runAgent(),
    receivedThread.runAgent({ agentId: "billing" }),
  ]);

  const snapshots = await Promise.all(
    actionIds(adapter).map((id) =>
      state.kv.get<ActionSnapshot>(`action:${id}`),
    ),
  );
  expect(snapshots).toHaveLength(2);
  expect(
    new Set(snapshots.map((snapshot) => snapshot?.continuation?.runChainId))
      .size,
  ).toBe(2);
});

test("resume with actor Memory selects the current interaction user", async () => {
  const { adapter, lifecycleCalls, actionId } = await setup("actor", {
    user: "read-write",
  });

  await adapter.getSink().onInteraction({
    id: actionId,
    conversationKey: "thread-1",
    replyTarget: {},
    eventId: "bob-click",
    actor: { id: "bob", kind: "human", name: "Bob" },
  });

  expect(lifecycleCalls[1]!.memory?.user).toEqual({
    id: "app:bob",
    name: "Bob",
  });
});

test("project-only resume needs no personal subject or fabricated user", async () => {
  const { adapter, lifecycleCalls, actionId } = await setup(undefined, {
    project: "read",
  });

  await adapter.getSink().onInteraction({
    id: actionId,
    conversationKey: "thread-1",
    replyTarget: {},
    eventId: "system-click",
    actor: { id: "approval-bot", kind: "bot" },
  });

  expect(lifecycleCalls[1]!.memory).toEqual({
    grant: { user: "none", project: "read" },
    user: null,
  });
});

test("personal resume requires an explicit trusted subject selector", async () => {
  const { adapter, lifecycleCalls, actionId } = await setup(undefined, {
    user: "read",
  });

  await expect(
    adapter.getSink().onInteraction({
      id: actionId,
      conversationKey: "thread-1",
      replyTarget: {},
      eventId: "bob-click",
      actor: { id: "bob", kind: "human", name: "Bob" },
    }),
  ).rejects.toMatchObject({ code: "channel_memory_subject_required" });
  expect(lifecycleCalls).toHaveLength(1);
});

test("personal resume fails before execution when the selected actor has no application user", async () => {
  const { adapter, lifecycleCalls, actionId } = await setup("actor", {
    user: "read",
  });

  await expect(
    adapter.getSink().onInteraction({
      id: actionId,
      conversationKey: "thread-1",
      replyTarget: {},
      eventId: "system-click",
      actor: { id: "approval-bot", kind: "bot" },
    }),
  ).rejects.toMatchObject({ code: "channel_memory_user_required" });
  expect(lifecycleCalls).toHaveLength(1);
});

test("a continuation starts only one resumed run", async () => {
  const { adapter, lifecycleCalls, actionId } = await setup("actor", {
    project: "read",
  });
  const click = (eventId: string) =>
    adapter.getSink().onInteraction({
      id: actionId,
      conversationKey: "thread-1",
      replyTarget: {},
      eventId,
      actor: { id: "bob", kind: "human", name: "Bob" },
    });

  await Promise.all([click("click-1"), click("click-2")]);

  expect(lifecycleCalls).toHaveLength(2);
});

test("a wrong conversation cannot consume another conversation's continuation", async () => {
  const { adapter, lifecycleCalls, actionId } = await setup("actor", {
    project: "read",
  });

  await expect(
    adapter.getSink().onInteraction({
      id: actionId,
      conversationKey: "thread-wrong",
      replyTarget: {},
      eventId: "wrong-thread-click",
      actor: { id: "bob", kind: "human", name: "Bob" },
    }),
  ).rejects.toMatchObject({ code: "channel_continuation_mismatch" });
  expect(lifecycleCalls).toHaveLength(1);

  await adapter.getSink().onInteraction({
    id: actionId,
    conversationKey: "thread-1",
    replyTarget: {},
    eventId: "correct-thread-click",
    actor: { id: "bob", kind: "human", name: "Bob" },
  });
  expect(lifecycleCalls).toHaveLength(2);
});

test("normal runs write no continuation state and one resume consumes once", async () => {
  const state = new MemoryStore();
  const set = vi.spyOn(state.kv, "set");
  const consume = vi.spyOn(state.kv, "consume");
  const adapter = new FakeAdapter();
  adapter.supportsIntelligenceMemory = true;

  function Approval() {
    return (
      <Button
        value={{ approved: true }}
        onClick={async ({ thread }) => {
          await thread.resume(
            { approved: true },
            { memory: { project: "read" } },
          );
        }}
      >
        Approve
      </Button>
    );
  }

  const finish = (subscriber: AgentSubscriber): void => {
    subscriber.onRunFinishedEvent?.({ event: {} } as never);
  };
  const agent = new FakeAgent([finish]);
  const channel = createChannel({
    name: "approvals",
    identifyUser: ({ actor }) =>
      actor.kind === "human"
        ? { id: `app:${actor.id}`, name: actor.name ?? actor.id }
        : null,
    adapters: [adapter],
    agent,
    components: [Approval],
    store: { adapter: state, actionRetentionMs: 60_000 },
  });
  channel.onMessage(async ({ thread, message }) => {
    agent.setScript([message.text === "interrupt" ? interrupt : finish]);
    await thread.runAgent();
  });
  channel.onInterrupt("approval", async ({ thread }) => {
    await thread.post(<Approval />);
  });
  await channel.ɵruntime.start();
  activeChannels.push({ stop: () => channel.ɵruntime.stop() });

  const turn = (userText: string) =>
    adapter.getSink().onTurn({
      conversationKey: "thread-1",
      replyTarget: {},
      userText,
      platform: "slack",
      actor: { id: "alice", kind: "human", name: "Alice" },
    });
  await turn("normal");
  expect(set).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();

  await turn("interrupt");
  const actionId = firstActionId(adapter);
  expect(
    set.mock.calls.filter((call) => call[0] === `action:${actionId}`),
  ).toHaveLength(1);
  expect(consume).not.toHaveBeenCalled();

  const click = (eventId: string) =>
    adapter.getSink().onInteraction({
      id: actionId,
      conversationKey: "thread-1",
      replyTarget: {},
      eventId,
      actor: { id: "bob", kind: "human", name: "Bob" },
    });
  await click("bob-click");
  await click("bob-click-redelivery");
  expect(consume).toHaveBeenCalledTimes(1);
  expect(consume.mock.calls[0]?.[0]).toBe(`action:${actionId}`);
});
