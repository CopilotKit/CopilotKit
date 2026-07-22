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

describe("createChannel", () => {
  it("routes a mention to a handler that posts UI", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent });

    channel.onMention(async ({ thread }) => {
      await thread.post(Section({ children: "hi" }));
    });

    await channel.start();
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
    const channel = createChannel({ adapters: [fake], agent });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    await channel.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    const renderer = fake.lastRunRenderer as unknown as {
      finishCalls: number;
    };
    expect(renderer.finishCalls).toBe(1);
  });

  it("delivers a turn's contentParts as the runAgent prompt to agent.addMessage", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    // Capture what the framework injects as the user message.
    const added: unknown[] = [];
    const origAddMessage = agent.addMessage.bind(agent);
    agent.addMessage = (m) => {
      added.push(m);
      return origAddMessage(m);
    };
    const channel = createChannel({ adapters: [fake], agent });

    const parts = [
      { type: "text" as const, text: "look" },
      {
        type: "image" as const,
        source: { type: "data" as const, value: "QUJD", mimeType: "image/png" },
      },
    ];
    channel.onMention(async ({ thread, message }) => {
      // The example mirrors this: prefer multimodal parts over plain text.
      await thread.runAgent({
        prompt:
          message.contentParts && message.contentParts.length > 0
            ? message.contentParts
            : message.text,
      });
    });

    await channel.start();
    fake.emitTurn({
      userText: "look",
      conversationKey: "c1",
      contentParts: parts,
    });
    await tick();

    expect(added).toHaveLength(1);
    const msg = added[0] as { role: string; content: unknown };
    expect(msg.role).toBe("user");
    // The multimodal parts array survives the string-typed `content` cast.
    expect(msg.content).toEqual(parts);
  });

  it("dispatches a bound onClick handler on interaction", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({ adapters: [fake], agent });

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

    await channel.start();
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
    const channel = createChannel({ adapters: [fake], agent });

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

    await channel.start();
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
    // Capture the context/tools passed to the agent's first runAgent call.
    let seenContext: unknown;
    let seenTools: unknown;
    const origRunAgent = agent.runAgent.bind(agent);
    agent.runAgent = async (parameters, subscriber) => {
      if (seenContext === undefined) {
        seenContext = (parameters as { context?: unknown } | undefined)
          ?.context;
        seenTools = (parameters as { tools?: unknown } | undefined)?.tools;
      }
      return origRunAgent(parameters, subscriber);
    };

    const channel = createChannel({
      adapters: [fake],
      agent,
      context: [{ description: "channel-level", value: "always here" }],
    });

    channel.onMention(async ({ thread }) => {
      await thread.runAgent({
        context: [{ description: "who", value: "user U1" }],
      });
    });

    await channel.start();
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
    const channel = createChannel({ adapters: [fake], agent });

    let result: { ok: boolean; error?: string } | undefined;
    channel.onMention(async ({ thread }) => {
      result = await thread.postFile({
        bytes: new Uint8Array([1, 2, 3]),
        filename: "x.png",
      });
    });

    await channel.start();
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
    const channel = createChannel({ adapters: [fake], agent });

    let history: unknown;
    let resolved: unknown;
    channel.onMention(async ({ thread }) => {
      history = await thread.getMessages();
      resolved = await thread.lookupUser("Ada");
    });

    await channel.start();
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
    const channel = createChannel({ adapters: [fake], agent });

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

    await channel.start();
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
      agent,
      store: { adapter: state, onLockConflict: "drop" },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.start();
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
      agent,
      store: { adapter: state, onLockConflict: "force" },
    });
    channel.onMention(async () => {
      runs++;
      await gate;
    });

    await channel.start();
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

  it("dedupes turns by eventId", async () => {
    const state = new MemoryStore();
    let runs = 0;

    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const channel = createChannel({
      adapters: [fake],
      agent,
      store: { adapter: state },
    });
    channel.onMention(async () => {
      runs++;
    });

    await channel.start();
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
      agent,
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

    await channel.start();
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
      agent,
      store: {
        adapter: state,
        identity: () => "alice@example.com",
        transcripts: { maxPerUser: 50 },
      },
    });

    await channel.start();
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
      agent,
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
    const origRunAgent = agent.runAgent.bind(agent);
    agent.runAgent = async (parameters, subscriber) => {
      if (seenContext === undefined) {
        seenContext = (parameters as { context?: unknown } | undefined)
          ?.context;
      }
      agent.addMessage({
        id: globalThis.crypto.randomUUID(),
        role: "assistant",
        content: "the assistant reply",
      });
      return origRunAgent(parameters, subscriber);
    };

    channel.onMention(async ({ thread }) => {
      await thread.runAgent({ transcript: true });
    });

    await channel.start();
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
      agent,
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

    await channel.start();
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

    await bot1.start();
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

    await channel.start();
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

    await channel.start();
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

    await channel.start();
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

    await channel.start();
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

    await channel.start();
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

    await channel.start();
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

    await channel.start();
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

    await channel.start();
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
    await channel.start();
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
    await channel.start();
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
    await channel.start();
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
    await channel.start();
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
      await expect(channel.start()).resolves.toBeUndefined();
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
      await expect(channel.start()).resolves.toBeUndefined();
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
      await channel.start();
      await expect(channel.stop()).resolves.toBeUndefined();
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
    channel.addAdapter(fake);
    expect(channel.adapters).toEqual([fake]);
  });
});
