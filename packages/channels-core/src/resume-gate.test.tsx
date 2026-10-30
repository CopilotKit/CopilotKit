import type { AgentSubscriber } from "@ag-ui/client";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { ProviderActor } from "@copilotkit/channels-ui";
import { afterEach, expect, test, vi } from "vitest";
import type { ActionSnapshot } from "./action-store.js";
import { createChannel } from "./create-channel.js";
import { singleStringParameterSchema } from "./index.js";
import type { ChannelAgentLifecycleArgs } from "./platform-adapter.js";
import { MemoryStore } from "./state/memory-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { defineChannelTool } from "./tools.js";

const alice: ProviderActor = { id: "alice", kind: "human", name: "Alice" };
const bob: ProviderActor = { id: "bob", kind: "human", name: "Bob" };

const activeChannels: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(activeChannels.splice(0).map((channel) => channel.stop()));
});

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function interrupt(subscriber: AgentSubscriber): void {
  subscriber.onCustomEvent?.({
    event: { name: "approval", value: { requestId: "request-1" } },
  } as never);
  subscriber.onRunFinishedEvent?.({ event: {} } as never);
}

function callTool(subscriber: AgentSubscriber): void {
  subscriber.onToolCallEndEvent?.({
    event: { toolCallId: "tool-1" },
    toolCallName: "show",
    toolCallArgs: { query: "x" },
  } as never);
}

function finish(subscriber: AgentSubscriber): void {
  subscriber.onRunFinishedEvent?.({ event: {} } as never);
}

function buttonIds(adapter: FakeAdapter): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    const node = value as {
      type?: string;
      props?: { onClick?: { id: string }; children?: unknown };
    };
    if (node?.type === "button" && node.props?.onClick) {
      ids.push(node.props.onClick.id);
    }
    if (node?.props?.children) visit(node.props.children);
  };
  visit(adapter.posted);
  return ids;
}

type Handler = (ctx: {
  thread: {
    assertCanResume(options?: object): Promise<void>;
    resume(value: unknown, options?: object): Promise<unknown>;
  };
}) => Promise<void>;

/** One interrupt, one card with two buttons; the second run waits on `gate`. */
async function start(
  onClick: Handler,
  opts: {
    script?: Array<(subscriber: AgentSubscriber) => void>;
    onSecondInterrupt?: (
      thread: Parameters<Handler>[0]["thread"] & {
        awaitChoice(ui: never): Promise<unknown>;
      },
    ) => void;
    gate?: Promise<void>;
    /** Post the card from a tool during the run, with no interrupt. */
    fromTool?: boolean;
  } = {},
) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const adapter = new FakeAdapter({ nativeEphemeral: true });
  const runs: ChannelAgentLifecycleArgs[] = [];
  adapter.runAgentLifecycle = vi.fn(async (args: ChannelAgentLifecycleArgs) => {
    runs.push(args);
    if (runs.length === 2) await opts.gate;
    return args.execute(args.renderer.subscriber, undefined);
  });
  const state = new MemoryStore();

  function Card() {
    return (
      <Actions>
        <Button value={{ approved: true }} onClick={onClick as never}>
          Approve
        </Button>
        <Button value={{ approved: false }} onClick={onClick as never}>
          Reject
        </Button>
      </Actions>
    );
  }

  const channel = createChannel({
    name: "approvals",
    identifyUser: "platform",
    adapters: [adapter],
    agent: new FakeAgent(
      opts.script ?? (opts.fromTool ? [callTool, finish, finish] : [interrupt]),
    ),
    components: [Card],
    tools: opts.fromTool
      ? [
          defineChannelTool({
            name: "show",
            description: "Post the card",
            parameters: singleStringParameterSchema({
              name: "query",
              description: "Unused",
            }),
            async handler(_args, { thread }) {
              await thread.post(<Card />);
              return "posted";
            },
          }),
        ]
      : [],
    store: { adapter: state, actionRetentionMs: 60_000 },
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });
  let interrupts = 0;
  channel.onInterrupt("approval", async ({ thread }) => {
    if (++interrupts === 2 && opts.onSecondInterrupt) {
      opts.onSecondInterrupt(thread as never);
      return;
    }
    await thread.post(<Card />);
  });
  await channel.ɵruntime.start();
  activeChannels.push({ stop: () => channel.ɵruntime.stop() });

  await adapter.getSink().onTurn({
    conversationKey: "thread-1",
    replyTarget: {},
    userText: "start",
    platform: "slack",
    actor: alice,
  });
  const click = (id: string, actor: ProviderActor, eventId: string) =>
    adapter.getSink().onInteraction({
      platform: "slack",
      id,
      conversationKey: "thread-1",
      replyTarget: {},
      eventId,
      actor,
    });
  const told = () =>
    adapter.ephemeralPosts.map((post) => post.ir[0]?.props.value);
  return { adapter, runs, state, click, told, ids: buttonIds(adapter) };
}

test("a second button is refused while the first one's resumed run is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { runs, click, told, ids } = await start(
    async ({ thread }) => {
      await thread.resume("answer");
    },
    { gate },
  );
  const [approve, reject] = ids as [string, string];

  const first = click(approve, alice, "click-approve");
  await tick();
  expect(runs).toHaveLength(2);

  await click(reject, alice, "click-reject");

  expect(runs).toHaveLength(2);
  expect(told()).toEqual(["This has already been answered."]);

  release();
  await first;
  await click(reject, alice, "click-reject-again");
  expect(runs).toHaveLength(2);
});

test("two buttons clicked together start one resumed run", async () => {
  const { runs, click, ids } = await start(async ({ thread }) => {
    await thread.resume("answer");
  });

  await Promise.all([
    click(ids[0]!, alice, "click-1"),
    click(ids[1]!, alice, "click-2"),
  ]);

  expect(runs).toHaveLength(2);
});

test("each interrupt of a chain can be resumed once", async () => {
  const { adapter, runs, click, ids } = await start(
    async ({ thread }) => {
      await thread.resume("answer");
    },
    { script: [interrupt, interrupt] },
  );

  await click(ids[0]!, alice, "first-interrupt");
  expect(runs).toHaveLength(2);

  const next = buttonIds(adapter).filter((id) => !ids.includes(id));
  expect(next).toHaveLength(2);
  await click(next[1]!, alice, "second-interrupt");
  expect(runs).toHaveLength(3);
});

test("assertCanResume refuses like resume, before any side effect", async () => {
  const updates: string[] = [];
  const { runs, click, told, ids, state } = await start(async ({ thread }) => {
    await thread.assertCanResume();
    updates.push("card");
    await thread.resume("answer");
  });
  const consume = vi.spyOn(state.kv, "consume");

  await click(ids[0]!, bob, "bob-click");

  expect(updates).toEqual([]);
  expect(consume).not.toHaveBeenCalled();
  expect(runs).toHaveLength(1);
  expect(told()).toEqual(["Only the person who started this can answer it."]);

  await click(ids[0]!, alice, "alice-click");
  expect(updates).toEqual(["card"]);
  expect(runs).toHaveLength(2);
});

test("assertCanResume honours the opt-out and consumes nothing", async () => {
  const { runs, click, ids } = await start(async ({ thread }) => {
    await thread.assertCanResume({ answerableBy: "conversation" });
  });

  await click(ids[0]!, bob, "check-1");
  await click(ids[0]!, bob, "check-2");

  expect(runs).toHaveLength(1);
});

test("assertCanResume refuses a button whose sibling already resumed", async () => {
  const updates: string[] = [];
  const { click, told, ids } = await start(async ({ thread }) => {
    await thread.assertCanResume();
    updates.push("card");
    await thread.resume("answer");
  });

  await click(ids[0]!, alice, "approve");
  await click(ids[1]!, alice, "reject");

  expect(updates).toEqual(["card"]);
  expect(told()).toEqual(["This has already been answered."]);
});

test("a picker in a chain Bob resumed stays with the chain's initiator", async () => {
  let picker: Promise<unknown> | undefined;
  const { adapter, click, ids, state } = await start(
    async ({ thread }) => {
      await thread.resume("answer", { answerableBy: "conversation" });
    },
    {
      script: [interrupt, interrupt],
      onSecondInterrupt: (thread) => {
        picker = thread.awaitChoice(
          Actions({
            children: [
              Button({ value: "go", onClick: () => {}, children: "Go" }),
            ],
          }) as never,
        );
        picker.catch(() => {});
      },
    },
  );

  await click(ids[0]!, bob, "bob-resumes");
  await tick();

  const [pickerId] = buttonIds(adapter).filter((id) => !ids.includes(id));
  const snap = await state.kv.get<ActionSnapshot>(`action:${pickerId}`);
  expect(snap?.ownerActorId).toBe("alice");
});

test("controls a tool posted during a run share the gate too", async () => {
  const { runs, click, told, ids } = await start(
    async ({ thread }) => {
      await thread.resume("answer");
    },
    { fromTool: true },
  );

  await click(ids[0]!, alice, "approve");
  await click(ids[1]!, alice, "reject");

  expect(runs).toHaveLength(2);
  expect(told()).toEqual(["This has already been answered."]);
});

test("a repeat click on the spent button reads as already answered", async () => {
  const { runs, click, told, ids } = await start(async ({ thread }) => {
    await thread.resume("answer");
  });

  await click(ids[0]!, alice, "click-1");
  await click(ids[0]!, alice, "click-2");

  expect(runs).toHaveLength(2);
  expect(told()).toEqual(["This has already been answered."]);
});

test("an action that expired, rather than being spent, still reads as expired", async () => {
  const { click, told, ids, state } = await start(async ({ thread }) => {
    await thread.resume("answer");
  });
  await state.kv.delete(`action:${ids[0]}`);

  await click(ids[0]!, alice, "late-click");

  expect(told()).toEqual(["This action has expired."]);
});

test("a card stored without a gate keeps its per-control limit", async () => {
  const { runs, click, ids, state } = await start(async ({ thread }) => {
    await thread.resume("answer");
  });
  for (const id of ids) {
    const key = `action:${id}`;
    const snap = (await state.kv.get<ActionSnapshot>(key))!;
    const { resumeGateId, ...continuation } = snap.continuation!;
    expect(resumeGateId).toBeDefined();
    await state.kv.set(key, { ...snap, continuation });
  }

  await click(ids[0]!, alice, "approve");
  await click(ids[1]!, alice, "reject");

  expect(runs).toHaveLength(3);
});
