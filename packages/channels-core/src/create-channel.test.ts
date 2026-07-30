import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createChannel } from "./create-channel.js";
import { defineChannelCommand } from "./commands.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { MemoryStore } from "./state/memory-store.js";
import { Section, Actions, Button } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { PlatformAdapter } from "./platform-adapter.js";
import type { AgentSubscriber } from "@ag-ui/client";

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Compile-time guards for the handler generics (validated by check-types/build,
 * never executed). `onInterrupt<T>` types `payload`; `onInteraction<T>` types
 * `ctx.action.value`.
 */
const __handlerTypeGuards = () => {
  const channel = createChannel({ adapters: [new FakeAdapter()] });
  channel.onInterrupt<{ question: string }>("ask", ({ payload }) => {
    payload.question.toUpperCase();
    // @ts-expect-error 'missing' is not on the payload type
    payload.missing;
  });
  channel.onInteraction<{ page: number }>("next", (ctx) => {
    ctx.action.value?.page.toFixed(0);
    // @ts-expect-error 'nope' is not on the action value type
    ctx.action.value?.nope;
  });
};
void __handlerTypeGuards;

/** Recursively find the first node of a given type in an IR tree. */
function findNode(nodes: ChannelNode[], type: string): ChannelNode | undefined {
  for (const n of nodes) {
    if (n.type === type) return n;
    const children = n.props.children;
    if (Array.isArray(children)) {
      const found = findNode(children as ChannelNode[], type);
      if (found) return found;
    }
  }
  return undefined;
}

/** Concatenate all text node values in an IR tree. */
function collectText(nodes: ChannelNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text" && typeof n.props.value === "string")
      out += n.props.value;
    const children = n.props.children;
    if (Array.isArray(children)) out += collectText(children as ChannelNode[]);
  }
  return out;
}

/**
 * Apply `patch` to `agent` and, recursively, to every clone descended from it.
 *
 * `createChannel` isolates every turn via `clone()`, so the instance that
 * actually runs is never the one configured in the test. A spy installed only on
 * the configured agent would observe nothing.
 */
function patchAgentAndClones(
  agent: FakeAgent,
  patch: (target: FakeAgent) => void,
): void {
  const wrap = (target: FakeAgent): void => {
    patch(target);
    const origClone = target.clone.bind(target);
    target.clone = () => {
      const cloned = origClone();
      wrap(cloned);
      return cloned;
    };
  };
  wrap(agent);
}

/** Capture user messages injected into a fake agent (and every clone of it). */
function captureAddedMessages(agent: FakeAgent): unknown[] {
  const added: unknown[] = [];
  patchAgentAndClones(agent, (target) => {
    const addMessage = target.addMessage.bind(target);
    target.addMessage = (message) => {
      added.push(message);
      return addMessage(message);
    };
  });
  return added;
}

/** Sum `runAgent` calls across the configured agent and every clone of it. */
function trackRunAgentCalls(agent: FakeAgent): { total: () => number } {
  let total = 0;
  patchAgentAndClones(agent, (target) => {
    const orig = target.runAgent.bind(target);
    target.runAgent = async (parameters, subscriber) => {
      total += 1;
      // Keep FakeAgent's own counter in sync for any direct assertions.
      return orig(parameters, subscriber);
    };
  });
  return { total: () => total };
}

/**
 * Capture the agent instance handed to the conversation store (post-isolation).
 * Use when asserting on the agent that actually ran, not the configured prototype.
 */
function captureSessionAgents(fake: FakeAdapter): { agents: FakeAgent[] } {
  const agents: FakeAgent[] = [];
  const orig = fake.conversationStore.getOrCreate.bind(fake.conversationStore);
  fake.conversationStore.getOrCreate = async (key, target, makeAgent) => {
    const session = await orig(key, target, makeAgent);
    agents.push(session.agent as FakeAgent);
    return session;
  };
  return { agents };
}

describe("createChannel", () => {
  it("routes a mention to a handler that posts UI", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    channel.onMention(async ({ thread }) => {
      await thread.post(Section({ children: "hi" }));
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    expect(fake.posted.length).toBe(1);
    const ir = fake.posted[0]!;
    expect(findNode(ir, "section")).toBeDefined();
    expect(collectText(ir)).toBe("hi");
  });

  it("calls renderer.finish() once after a turn's run-loop resolves", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    const renderer = fake.lastRunRenderer as unknown as {
      finishCalls: number;
    };
    expect(renderer.finishCalls).toBe(1);
  });

  it("defaults runAgent prompt to the inbound message text", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const added = captureAddedMessages(agent);
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    await channel.ɵruntime.start();
    await fake.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "Say my name",
      platform: "fake",
    });

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      role: "user",
      content: "Say my name",
    });
  });

  it("injects the inbound turn only into the first managed run in one handler", async () => {
    const fake = new FakeAdapter();
    Object.defineProperty(fake, "injectInboundTurnOnce", { value: true });
    const agent = new FakeAgent();
    const added = captureAddedMessages(agent);
    const runs = trackRunAgentCalls(agent);
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
      await thread.runAgent();
    });

    await channel.ɵruntime.start();
    await fake.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "Use this once",
      platform: "fake",
    });

    // Two runAgent calls in one handler → two isolated agent instances, each run once.
    expect(runs.total()).toBe(2);
    // Implicit inbound prompt is injected only on the first run of the turn.
    expect(added).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Use this once",
      }),
    ]);
  });

  it("wraps every local tool iteration in one managed lifecycle", async () => {
    const fake = new FakeAdapter();
    const canonicalToolEnds: string[] = [];
    const lifecycleCalls: number[] = [];
    (fake as PlatformAdapter).runAgentLifecycle = async (args) => {
      lifecycleCalls.push(1);
      const subscriber: AgentSubscriber = {
        onToolCallEndEvent({ event }) {
          canonicalToolEnds.push(event.toolCallId);
        },
      };
      return args.execute(subscriber);
    };
    const agent = new FakeAgent([
      (subscriber) => {
        subscriber.onToolCallEndEvent?.({
          event: { toolCallId: "tool-1" },
          toolCallName: "echo",
          toolCallArgs: { value: "hello" },
        } as never);
      },
      () => undefined,
    ]);
    const sessionAgents = captureSessionAgents(fake);
    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      tools: [
        {
          name: "echo",
          description: "Return the input",
          parameters: z.object({ value: z.string() }),
          handler: ({ value }) => value,
        },
      ],
    });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    await channel.ɵruntime.start();
    await fake.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "Run the tool",
      platform: "fake",
    });

    expect(lifecycleCalls).toHaveLength(1);
    // Tool loop runs twice on the isolated session agent, not the prototype.
    expect(sessionAgents.agents).toHaveLength(1);
    expect(sessionAgents.agents[0]!.runAgentCalls).toBe(2);
    expect(canonicalToolEnds).toEqual(["tool-1"]);
    expect(
      sessionAgents.agents[0]!.messages.some(
        (message) => message.role === "tool" && message.toolCallId === "tool-1",
      ),
    ).toBe(true);
  });

  it("does not duplicate an inbound message seeded by the conversation store", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const added = captureAddedMessages(agent);
    const getOrCreate = fake.conversationStore.getOrCreate.bind(
      fake.conversationStore,
    );
    Object.defineProperty(fake.conversationStore, "seedsInboundTurn", {
      value: true,
    });
    fake.conversationStore.getOrCreate = async (...args) => {
      const session = await getOrCreate(...args);
      session.agent.addMessage({
        id: "inbound",
        role: "user",
        content: "Say my name",
      });
      return session;
    };
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    await channel.ɵruntime.start();
    await fake.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "Say my name",
      platform: "fake",
    });

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      id: "inbound",
      role: "user",
      content: "Say my name",
    });
  });

  it("defaults runAgent prompt to inbound multimodal content parts", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const added = captureAddedMessages(agent);
    const channel = createChannel({ adapters: [fake], agent: () => agent });
    const parts = [
      { type: "text" as const, text: "look" },
      {
        type: "image" as const,
        source: { type: "data" as const, value: "QUJD", mimeType: "image/png" },
      },
    ];

    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    await channel.ɵruntime.start();
    await fake.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "look",
      contentParts: parts,
      platform: "fake",
    });

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      role: "user",
      content: parts,
    });
  });

  it("prefers an explicit multimodal prompt over inbound content parts", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const added = captureAddedMessages(agent);
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    const explicitParts = [
      { type: "text" as const, text: "use this instead" },
      {
        type: "image" as const,
        source: { type: "data" as const, value: "QUJD", mimeType: "image/png" },
      },
    ];
    const inboundParts = [{ type: "text" as const, text: "inbound" }];
    channel.onMention(async ({ thread }) => {
      await thread.runAgent({ prompt: explicitParts });
    });

    await channel.ɵruntime.start();
    await fake.getSink().onTurn({
      userText: "inbound",
      conversationKey: "c1",
      replyTarget: {},
      contentParts: inboundParts,
      platform: "fake",
    });

    expect(added).toHaveLength(1);
    const msg = added[0] as { role: string; content: unknown };
    expect(msg.role).toBe("user");
    // The multimodal parts array survives the string-typed `content` cast.
    expect(msg.content).toEqual(explicitParts);
  });

  it("dispatches a bound onClick handler on interaction", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    let clicked = false;
    channel.onMention(async ({ thread }) => {
      await thread.post(
        Actions({
          children: [
            Button({
              value: { ok: 1 },
              onClick: () => {
                clicked = true;
              },
              children: "Go",
            }),
          ],
        }),
      );
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    const button = findNode(fake.posted[0]!, "button")!;
    const id = (button.props.onClick as { id: string }).id;
    expect(typeof id).toBe("string");

    fake.emitInteraction({ id, conversationKey: "c1", value: { ok: 1 } });
    await tick();

    expect(clicked).toBe(true);
  });

  it("resolves a HITL awaitChoice with the element value when the event carries none (Telegram)", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    let chosen: unknown;
    channel.onMention(async ({ thread }) => {
      chosen = await thread.awaitChoice(
        Actions({
          children: [
            Button({
              value: { confirmed: true },
              onClick: () => {},
              children: "Create",
            }),
          ],
        }),
      );
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "create a thing", conversationKey: "c1" });
    await tick();

    const button = findNode(fake.posted[0]!, "button")!;
    const id = (button.props.onClick as { id: string }).id;

    // Telegram can't carry the button value in callback_data, so the event has
    // no `value`. The waiter must still resolve with the button's value, which
    // the registry recovers from the rendered element.
    fake.emitInteraction({ id, conversationKey: "c1" });
    await tick();

    expect(chosen).toEqual({ confirmed: true });
  });

  it("merges per-turn runAgent context with the channel-level context", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    // Capture the context/tools passed to the (isolated) agent's first runAgent call.
    let seenContext: unknown;
    let seenTools: unknown;
    patchAgentAndClones(agent, (target) => {
      const origRunAgent = target.runAgent.bind(target);
      target.runAgent = async (parameters, subscriber) => {
        if (seenContext === undefined) {
          seenContext = (parameters as { context?: unknown } | undefined)
            ?.context;
          seenTools = (parameters as { tools?: unknown } | undefined)?.tools;
        }
        return origRunAgent(parameters, subscriber);
      };
    });

    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      context: [{ description: "channel-level", value: "always here" }],
    });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent({
        context: [{ description: "who", value: "user U1" }],
      });
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "go", conversationKey: "c1" });
    await tick();

    expect(seenContext).toEqual([
      { description: "channel-level", value: "always here" },
      { description: "who", value: "user U1" },
    ]);
    expect(seenTools).toEqual([]);
  });

  it("thread.postFile returns a capability-gated error when the adapter can't upload", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    let result: { ok: boolean; error?: string } | undefined;
    channel.onMention(async ({ thread }) => {
      result = await thread.postFile({
        bytes: new Uint8Array([1, 2, 3]),
        filename: "x.png",
      });
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "hi", conversationKey: "c1" });
    await tick();

    expect(result).toEqual({
      ok: false,
      error: "fake does not support file upload",
    });
  });

  it("thread.getMessages and thread.lookupUser surface the adapter's data", async () => {
    const fake = new FakeAdapter();
    fake.messages = [
      { user: { id: "u1", name: "Ada" }, text: "hi", ts: "1", isBot: false },
    ];
    fake.user = { id: "u1", name: "Ada" };
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    let history: unknown;
    let resolved: unknown;
    channel.onMention(async ({ thread }) => {
      history = await thread.getMessages();
      resolved = await thread.lookupUser("Ada");
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "hi", conversationKey: "c1" });
    await tick();

    expect(history).toEqual([
      { user: { id: "u1", name: "Ada" }, text: "hi", ts: "1", isBot: false },
    ]);
    expect(resolved).toEqual({ id: "u1", name: "Ada" });
  });

  it("resolves awaitChoice when a matching interaction arrives", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent: () => agent });

    let choicePromise: Promise<unknown> | undefined;
    channel.onMention(async ({ thread }) => {
      choicePromise = thread.awaitChoice(
        Actions({
          children: [
            Button({
              value: { confirmed: true },
              onClick: () => {},
              children: "Confirm",
            }),
          ],
        }),
      );
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "decide", conversationKey: "c1" });
    await tick();

    const button = findNode(fake.posted[0]!, "button")!;
    const id = (button.props.onClick as { id: string }).id;

    fake.emitInteraction({
      id,
      conversationKey: "c1",
      value: { confirmed: true },
    });
    await tick();

    expect(choicePromise).toBeDefined();
    await expect(choicePromise!).resolves.toEqual({ confirmed: true });
  });

  it("drops an overlapping turn on the same conversation (onLockConflict: drop)", async () => {
    const state = new MemoryStore();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      store: { adapter: state, onLockConflict: "drop" },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const turn = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    };

    // Fire two overlapping onTurn calls — second arrives while first holds the lock.
    const p1 = sink.onTurn(turn);
    const p2 = sink.onTurn(turn);
    release();
    await Promise.all([p1, p2]);

    // Only the first turn's handler should have run; the second was dropped.
    expect(runs).toBe(1);
  });

  it("runs both handlers when onLockConflict is force", async () => {
    const state = new MemoryStore();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      store: { adapter: state, onLockConflict: "force" },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const turn = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    };

    // Fire two overlapping onTurn calls — second forces through the lock.
    const p1 = sink.onTurn(turn);
    const p2 = sink.onTurn(turn);
    release();
    await Promise.all([p1, p2]);

    // Both turns' handlers should have run.
    expect(runs).toBe(2);
  });

  it("default concurrency is parallel: overlapping same-conversation turns both run", async () => {
    const state = new MemoryStore();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
      store: { adapter: state },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const turn = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    };

    const p1 = sink.onTurn({ ...turn, eventId: "E-a" });
    const p2 = sink.onTurn({ ...turn, eventId: "E-b" });
    // Both handlers must have started before either finishes (parallel).
    await vi.waitFor(() => expect(runs).toBe(2));
    release();
    await Promise.all([p1, p2]);
    expect(runs).toBe(2);
  });

  it("concurrency: serial queues the second turn until the first finishes", async () => {
    const state = new MemoryStore();
    const order: string[] = [];
    let release1!: () => void;
    const gate1 = new Promise<void>((r) => (release1 = r));

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
      store: { adapter: state, concurrency: "serial" },
    });
    channel.onMention(async ({ message }) => {
      order.push(`start:${message.eventId}`);
      if (message.eventId === "E1") await gate1;
      order.push(`end:${message.eventId}`);
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const base = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    };

    const p1 = sink.onTurn({ ...base, eventId: "E1" });
    const p2 = sink.onTurn({ ...base, eventId: "E2" });

    await vi.waitFor(() => expect(order).toContain("start:E1"));
    // Second must not start while first is gated.
    expect(order).toEqual(["start:E1"]);
    release1();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["start:E1", "end:E1", "start:E2", "end:E2"]);
  });

  it("concurrency: drop discards the overlapping turn", async () => {
    const state = new MemoryStore();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
      store: { adapter: state, concurrency: "drop" },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const turn = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    };

    const p1 = sink.onTurn({ ...turn, eventId: "E1" });
    const p2 = sink.onTurn({ ...turn, eventId: "E2" });
    release();
    await Promise.all([p1, p2]);
    expect(runs).toBe(1);
  });

  it("singleton agent is cloned per run (distinct instances)", async () => {
    const state = new MemoryStore();
    const prototype = new FakeAgent();
    const seen: FakeAgent[] = [];

    const fake = new FakeAdapter();
    // Capture agents the conversation store receives from makeAgent.
    const origGetOrCreate = fake.conversationStore.getOrCreate.bind(
      fake.conversationStore,
    );
    fake.conversationStore.getOrCreate = async (key, target, makeAgent) => {
      const session = await origGetOrCreate(key, target, makeAgent);
      seen.push(session.agent as FakeAgent);
      return session;
    };

    const channel = createChannel({
      adapters: [fake],
      agent: prototype, // singleton, not factory
      store: { adapter: state },
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent({ prompt: "hi" });
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    await Promise.all([
      sink.onTurn({
        conversationKey: "c1",
        replyTarget: {},
        userText: "a",
        platform: "fake" as const,
        eventId: "E1",
      }),
      sink.onTurn({
        conversationKey: "c1",
        replyTarget: {},
        userText: "b",
        platform: "fake" as const,
        eventId: "E2",
      }),
    ]);

    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(prototype);
    expect(seen[1]).not.toBe(prototype);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("singleton agent whose clone returns itself fails loud", async () => {
    const state = new MemoryStore();
    const bad = new FakeAgent();
    bad.clone = () => bad;

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: bad,
      store: { adapter: state },
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent({ prompt: "hi" });
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    await expect(
      sink.onTurn({
        conversationKey: "c1",
        replyTarget: {},
        userText: "hi",
        platform: "fake" as const,
        eventId: "E1",
      }),
    ).rejects.toThrow(/clone\(\) must return a distinct instance/);
  });

  it("factory that returns a shared instance still isolates per turn", async () => {
    const state = new MemoryStore();
    const shared = new FakeAgent();

    const fake = new FakeAdapter();
    const { agents: seen } = captureSessionAgents(fake);

    // Common "singleton factory" anti-pattern: returns the same object every call.
    // Parallel turns must still get distinct clones, not serialize on one agent.
    const channel = createChannel({
      adapters: [fake],
      agent: (threadId) => {
        shared.threadId = threadId;
        return shared;
      },
      store: { adapter: state },
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent({ prompt: "hi" });
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    await Promise.all([
      sink.onTurn({
        conversationKey: "c1",
        replyTarget: {},
        userText: "a",
        platform: "fake" as const,
        eventId: "E1",
      }),
      sink.onTurn({
        conversationKey: "c1",
        replyTarget: {},
        userText: "b",
        platform: "fake" as const,
        eventId: "E2",
      }),
    ]);

    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(shared);
    expect(seen[1]).not.toBe(shared);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("dedupes turns by eventId", async () => {
    const state = new MemoryStore();
    let runs = 0;

    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      store: { adapter: state },
    });
    channel.onMention(async () => {
      runs++;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const base = {
      conversationKey: "c",
      replyTarget: {},
      userText: "x",
      platform: "fake" as const,
      eventId: "E1",
    };

    // Same eventId delivered twice → handler runs only once.
    await sink.onTurn(base);
    await sink.onTurn({ ...base });
    expect(runs).toBe(1);

    // Different eventId → handler runs again.
    await sink.onTurn({ ...base, eventId: "E2" });
    expect(runs).toBe(2);
  });

  it("throws when identity is set without transcripts", () => {
    const fake = new FakeAdapter();
    expect(() =>
      createChannel({
        adapters: [fake],
        store: { identity: () => "key" },
      }),
    ).toThrow(
      "createChannel: `identity` and `transcripts` must be configured together.",
    );
  });

  it("throws when transcripts is set without identity", () => {
    const fake = new FakeAdapter();
    expect(() =>
      createChannel({
        adapters: [fake],
        store: { transcripts: { maxPerUser: 100 } },
      }),
    ).toThrow(
      "createChannel: `identity` and `transcripts` must be configured together.",
    );
  });

  it("stamps message.userKey when identity resolves a key", async () => {
    const state = new MemoryStore();
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      store: {
        adapter: state,
        identity: () => "user@example.com",
        transcripts: {},
      },
    });

    let capturedKey: string | undefined;
    channel.onMention(async ({ message }) => {
      capturedKey = message.userKey;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    await sink.onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "hello",
      platform: "fake" as const,
      user: { id: "u1" },
    });

    expect(capturedKey).toBe("user@example.com");
  });

  it("channel.transcripts.append/list round-trips with MemoryStore", async () => {
    const state = new MemoryStore();
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      store: {
        adapter: state,
        identity: () => "alice@example.com",
        transcripts: { maxPerUser: 50 },
      },
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();

    // Drive a turn so identity is resolved and we can verify transcripts exist
    const thread = { platform: "fake", conversationKey: "c1" } as Parameters<
      typeof channel.transcripts.append
    >[0];

    // Directly append via channel.transcripts
    await channel.transcripts.append(
      thread,
      { role: "user", text: "hi there" },
      {
        userKey: "alice@example.com",
      },
    );
    await channel.transcripts.append(
      thread,
      { role: "assistant", text: "hello!" },
      { userKey: "alice@example.com" },
    );

    const entries = await channel.transcripts.list({
      userKey: "alice@example.com",
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.role).toBe("user");
    expect(entries[0]!.text).toBe("hi there");
    expect(entries[1]!.role).toBe("assistant");
    expect(entries[1]!.text).toBe("hello!");
  });

  it("runAgent({ transcript: true }) injects prior history and captures the reply", async () => {
    const state = new MemoryStore();
    const fake = new FakeAdapter();
    const agent = new FakeAgent();

    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      store: {
        adapter: state,
        identity: () => "u@x.com",
        transcripts: {},
      },
    });

    // Capture the context the agent receives on its first runAgent call, and
    // have the fake produce an assistant message with text on agent.messages
    // (mirroring how run-loop expects assistant replies to land there).
    let seenContext: unknown;
    patchAgentAndClones(agent, (target) => {
      const origRunAgent = target.runAgent.bind(target);
      target.runAgent = async (parameters, subscriber) => {
        if (seenContext === undefined) {
          seenContext = (parameters as { context?: unknown } | undefined)
            ?.context;
        }
        target.addMessage({
          id: globalThis.crypto.randomUUID(),
          role: "assistant",
          content: "the assistant reply",
        });
        return origRunAgent(parameters, subscriber);
      };
    });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent({ transcript: true });
    });

    await channel.ɵruntime.start();
    // Seed one prior cross-platform entry (different platform label) so we can
    // assert it shows up in the injected context. Seeded post-start: transcripts
    // are only available once the backend is resolved in start().
    await channel.transcripts.append(
      { platform: "discord", conversationKey: "other" },
      { role: "user", text: "remembered from discord" },
      { userKey: "u@x.com" },
    );
    const sink = fake.getSink();
    await sink.onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "hello from fake",
      platform: "fake" as const,
      user: { id: "u1" },
    });

    // Append side: both the user turn and the assistant reply are recorded,
    // oldest-first (after the seeded discord entry).
    const entries = await channel.transcripts.list({ userKey: "u@x.com" });
    const fakeEntries = entries.filter((e) => e.platform === "fake");
    expect(fakeEntries).toHaveLength(2);
    expect(fakeEntries[0]!.role).toBe("user");
    expect(fakeEntries[0]!.text).toBe("hello from fake");
    expect(fakeEntries[1]!.role).toBe("assistant");
    expect(fakeEntries[1]!.text).toBe("the assistant reply");

    // Injection side: the agent's context includes an entry whose value carries
    // the prior discord message text.
    const ctx = seenContext as { description: string; value: string }[];
    const injected = ctx.find((c) =>
      c.value.includes("remembered from discord"),
    );
    expect(injected).toBeDefined();
    expect(injected!.value).toContain(
      "[discord] user: remembered from discord",
    );
  });

  it("typesafe state: setState validates against store.state schema and round-trips", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({
      adapters: [fake],
      agent: () => agent,
      store: {
        adapter: new MemoryStore(),
        state: z.object({ step: z.string() }),
      },
    });

    let roundTripped: { step: string } | undefined;
    let rejected = false;
    channel.onMention(async ({ thread }) => {
      // Typed to { step: string } via the configured schema.
      await thread.setState({ step: "x" });
      roundTripped = await thread.state();
      // An invalid value (wrong shape) must reject at runtime.
      try {
        await thread.setState({ bad: 1 } as never);
      } catch {
        rejected = true;
      }
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "go", conversationKey: "c1" });
    await tick();

    expect(roundTripped).toEqual({ step: "x" });
    expect(rejected).toBe(true);
  });
});

describe("createChannel lock and dedup edge cases", () => {
  it("releases the lock after the handler throws", async () => {
    const state = new MemoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const fake = new FakeAdapter();
    // Use a separate channel so the throwing handler is isolated.
    const bot1 = createChannel({
      adapters: [fake],
      store: { adapter: state, onLockConflict: "drop", lockTtl: 5000 },
    });

    let runs = 0;
    bot1.onMention(async () => {
      runs++;
      await gate;
      throw new Error("boom");
    });

    await bot1.ɵruntime.start();
    const sink = fake.getSink();
    const turn = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    };

    // Turn 1 throws after gate releases.
    const p1 = Promise.resolve(sink.onTurn(turn)).catch(() => {});
    release();
    await p1;

    // Lock must be free — verify by acquiring it directly.
    const tok = await state.lock.acquire("turn:c1");
    expect(tok).not.toBeNull();
    if (tok) await state.lock.release("turn:c1", tok.token);
    expect(runs).toBe(1);
  });

  it("onLockConflict callback drop: second turn dropped and callback receives correct args", async () => {
    const state = new MemoryStore();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    let callbackConversationKey: string | undefined;
    let callbackMessageText: string | undefined;

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      store: {
        adapter: state,
        onLockConflict: (conversationKey, message) => {
          callbackConversationKey = conversationKey;
          callbackMessageText = message.text;
          return "drop";
        },
      },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const turn = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "hello",
      platform: "fake" as const,
    };

    const p1 = sink.onTurn(turn);
    const p2 = sink.onTurn(turn);
    release();
    await Promise.all([p1, p2]);

    expect(runs).toBe(1);
    expect(callbackConversationKey).toBe("c1");
    expect(callbackMessageText).toBe("hello");
  });

  it("onLockConflict callback returning Promise<force>: both turns run", async () => {
    const state = new MemoryStore();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      store: {
        adapter: state,
        onLockConflict: () => Promise.resolve("force" as const),
      },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const turn = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    };

    const p1 = sink.onTurn(turn);
    const p2 = sink.onTurn(turn);
    release();
    await Promise.all([p1, p2]);

    expect(runs).toBe(2);
  });

  it("identity throws: handler still runs and userKey is undefined", async () => {
    const state = new MemoryStore();
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      store: {
        adapter: state,
        identity: () => {
          throw new Error("x");
        },
        transcripts: {},
      },
    });

    let capturedUserKey: string | undefined = "SENTINEL";
    channel.onMention(async ({ message }) => {
      capturedUserKey = message.userKey;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    await sink.onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    });

    expect(capturedUserKey).toBeUndefined();
  });

  it("identity returns null: userKey is undefined", async () => {
    const state = new MemoryStore();
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      store: { adapter: state, identity: () => null, transcripts: {} },
    });

    let capturedUserKey: string | undefined = "SENTINEL";
    channel.onMention(async ({ message }) => {
      capturedUserKey = message.userKey;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    await sink.onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
    });

    expect(capturedUserKey).toBeUndefined();
  });

  it("dedup+lock ordering: deduped turn never takes the lock", async () => {
    const state = new MemoryStore();
    let runs = 0;

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      store: { adapter: state, onLockConflict: "drop" },
    });
    channel.onMention(async () => {
      runs++;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const base = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "x",
      platform: "fake" as const,
      eventId: "E1",
    };

    await sink.onTurn(base);
    await sink.onTurn({ ...base }); // same eventId — should be deduped before lock

    expect(runs).toBe(1);

    // Lock must still be acquirable (deduped turn never held it).
    const tok = await state.lock.acquire("turn:c1");
    expect(tok).not.toBeNull();
    if (tok) await state.lock.release("turn:c1", tok.token);
  });

  it("dedup store error is swallowed: handler still runs", async () => {
    const state = new MemoryStore();
    // Wrap state.dedup.seen to throw.
    const origSeen = state.dedup.seen.bind(state.dedup);
    let firstCall = true;
    state.dedup.seen = async (key, ttlMs) => {
      if (firstCall) {
        firstCall = false;
        throw new Error("dedup store exploded");
      }
      return origSeen(key, ttlMs);
    };

    let runs = 0;
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      store: { adapter: state },
    });
    channel.onMention(async () => {
      runs++;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    await sink.onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "hi",
      platform: "fake" as const,
      eventId: "E1",
    });

    // Handler must still run despite the dedup store error.
    expect(runs).toBe(1);
  });

  it("a turn dropped on lock-conflict does not burn its eventId — a redelivery is processed", async () => {
    const state = new MemoryStore();
    let runs = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      store: { adapter: state, onLockConflict: "drop" },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const turnA = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "first",
      platform: "fake" as const,
      eventId: "E1",
    };
    const turnB = {
      conversationKey: "c1",
      replyTarget: {},
      userText: "second",
      platform: "fake" as const,
      eventId: "E2",
    };

    // Turn A acquires the lock and blocks on the gate.
    const p1 = sink.onTurn(turnA);
    // Turn B arrives while A holds the lock — dropped (onLockConflict: "drop").
    const p2 = sink.onTurn(turnB);
    // B is dropped before reaching dedup, so E2 must NOT be burned.
    await p2;

    // Release A so it finishes and releases the lock.
    releaseGate();
    await p1;

    // Now redeliver turn B with the same eventId "E2" — must be processed.
    await sink.onTurn(turnB);

    // A ran once; B's redelivery ran once = 2 total.
    expect(runs).toBe(2);
  });

  it("a genuine duplicate delivery is still deduped (processed once)", async () => {
    const state = new MemoryStore();
    let runs = 0;

    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      store: { adapter: state },
    });
    channel.onMention(async () => {
      runs++;
    });

    await channel.ɵruntime.start();
    const sink = fake.getSink();
    const turn = {
      conversationKey: "c2",
      replyTarget: {},
      userText: "hello",
      platform: "fake" as const,
      eventId: "D1",
    };

    // First delivery: processes successfully and marks E D1 seen.
    await sink.onTurn(turn);
    expect(runs).toBe(1);

    // Second delivery of the same eventId: must be deduped — handler does NOT run again.
    await sink.onTurn({ ...turn });
    expect(runs).toBe(1);
  });
});

describe("createChannel slash commands", () => {
  it("routes a command to its handler with the raw text", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    let seen: { command: string; text: string } | undefined;
    channel.onCommand("triage", ({ command, text }) => {
      seen = { command, text };
    });
    await channel.ɵruntime.start();
    await fake.emitCommand({ command: "/Triage", text: "db is down" });
    expect(seen).toEqual({ command: "triage", text: "db is down" });
  });

  it("ignores a command with no registered handler", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    let fired = false;
    channel.onCommand("triage", () => {
      fired = true;
    });
    await channel.ɵruntime.start();
    await fake.emitCommand({ command: "unknown", text: "x" });
    expect(fired).toBe(false);
  });

  it("parses rawOptions through the command's schema into ctx.options", async () => {
    let captured: { seat: string } | undefined;
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      commands: [
        defineChannelCommand({
          name: "book",
          options: z.object({ seat: z.string() }),
          handler: ({ options }) => {
            captured = options; // typed { seat: string }
          },
        }),
      ],
    });
    await channel.ɵruntime.start();
    await fake.emitCommand({
      command: "book",
      text: "raw",
      rawOptions: { seat: "12A" },
    });
    expect(captured).toEqual({ seat: "12A" });
  });

  it("hands declared commands to adapters that implement registerCommands", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    channel.onCommand("triage", () => {});
    channel.onCommand("status", () => {});
    await channel.ɵruntime.start();
    expect(fake.registeredCommands?.map((c) => c.name).sort()).toEqual([
      "status",
      "triage",
    ]);
  });

  it("start() resolves and keeps healthy adapters when one adapter's start() rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad = new FakeAdapter({ platform: "telegram", failStart: true });
      const good = new FakeAdapter({ platform: "slack" });
      const channel = createChannel({ adapters: [bad, good] });
      await expect(channel.ɵruntime.start()).resolves.toBeUndefined();
      expect(good.started).toBe(true);
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).includes("telegram")),
      ).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("start() resolves and the healthy adapter still receives commands when another adapter's registerCommands() rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad = new FakeAdapter({
        platform: "telegram",
        failRegisterCommands: true,
      });
      const good = new FakeAdapter({ platform: "slack" });
      const channel = createChannel({ adapters: [bad, good] });
      channel.onCommand("triage", () => {});
      await expect(channel.ɵruntime.start()).resolves.toBeUndefined();
      expect(good.started).toBe(true);
      expect(good.registeredCommands?.map((c) => c.name)).toEqual(["triage"]);
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).includes("telegram")),
      ).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("stop() resolves and stops healthy adapters when one adapter's stop() rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad = new FakeAdapter({ platform: "telegram", failStop: true });
      const good = new FakeAdapter({ platform: "slack" });
      const stopSpy = vi.spyOn(good, "stop");
      const channel = createChannel({ adapters: [bad, good] });
      await channel.ɵruntime.start();
      await expect(channel.ɵruntime.stop()).resolves.toBeUndefined();
      expect(stopSpy).toHaveBeenCalled();
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).includes("telegram")),
      ).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("exposes attached adapters through a read-only, non-mutable-through accessor", () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });

    expect(channel.adapters).toContain(fake);
    expect(channel.adapters).toHaveLength(1);

    // The returned snapshot is a copy: mutating it must not affect the channel.
    (channel.adapters as PlatformAdapter[]).push(new FakeAdapter());
    expect(channel.adapters).toHaveLength(1);
  });

  it("reflects an adapter attached via addAdapter in the adapters accessor", () => {
    const channel = createChannel({});
    expect(channel.adapters).toHaveLength(0);

    const fake = new FakeAdapter();
    channel.ɵruntime.addAdapter(fake);
    expect(channel.adapters).toEqual([fake]);
  });
});
