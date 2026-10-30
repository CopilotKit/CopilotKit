import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Actions, Button, Message } from "@copilotkit/channels-ui";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels-ui";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Channels started by a test; stopped after each one. */
const activeChannels: Channel[] = [];

async function stopChannels() {
  while (activeChannels.length > 0) {
    await activeChannels.pop()!.ɵruntime.stop();
  }
}

function findButtonIds(nodes: ChannelNode[]): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null || !("props" in value)) {
      return;
    }
    const node = value as ChannelNode;
    const onClick = node.props.onClick as { id?: unknown } | undefined;
    if (node.type === "button" && typeof onClick?.id === "string") {
      ids.push(onClick.id);
    }
    for (const propValue of Object.values(node.props)) visit(propValue);
  };
  visit(nodes);
  return ids;
}

/**
 * Two conversations post the same-shaped card (an inline button whose handler
 * closes over its own conversation's data). Returns the fake adapter, the ids
 * each conversation was shown, and the handler log.
 */
async function postCardsInTwoConversations() {
  const fake = new FakeAdapter();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [fake],
    agent: () => new FakeAgent(),
  });
  const ran: string[] = [];
  channel.onMention(async ({ thread }) => {
    const owner = thread.conversationKey;
    await thread.post(
      Actions({
        children: [
          Button({
            value: { confirm: true },
            onClick: () => {
              ran.push(owner);
            },
            children: "Confirm",
          }),
        ],
      }),
    );
  });
  await channel.ɵruntime.start();
  activeChannels.push(channel);

  fake.emitTurn({
    userText: "approve the wire transfer",
    conversationKey: "conv-alice",
    actor: { id: "alice", kind: "human" },
  });
  await tick();
  fake.emitTurn({
    userText: "say hi",
    conversationKey: "conv-bob",
    actor: { id: "bob", kind: "human" },
  });
  await tick();

  const [aliceId] = findButtonIds(fake.posted[0]!);
  const [bobId] = findButtonIds(fake.posted[1]!);
  return { fake, ran, aliceId: aliceId!, bobId: bobId! };
}

describe("inline action ids are scoped to their conversation", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopChannels();
  });

  it("mints a distinct, unguessable id per rendered action", async () => {
    const { aliceId, bobId } = await postCardsInTwoConversations();
    expect(aliceId).toMatch(/^ck:[A-Za-z0-9_-]{22}$/);
    expect(bobId).toMatch(/^ck:[A-Za-z0-9_-]{22}$/);
    expect(aliceId).not.toBe(bobId);
  });

  it("runs the clicked conversation's own handler for a same-conversation click", async () => {
    const { fake, ran, aliceId, bobId } = await postCardsInTwoConversations();
    fake.emitInteraction({
      id: aliceId,
      conversationKey: "conv-alice",
      actor: { id: "alice", kind: "human" },
    });
    await tick();
    fake.emitInteraction({
      id: bobId,
      conversationKey: "conv-bob",
      actor: { id: "bob", kind: "human" },
    });
    await tick();
    expect(ran).toEqual(["conv-alice", "conv-bob"]);
  });

  it("refuses and logs an action id presented from another conversation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, ran, aliceId } = await postCardsInTwoConversations();
    fake.emitInteraction({
      id: aliceId,
      conversationKey: "conv-mallory",
      actor: { id: "mallory", kind: "human" },
    });
    await tick();
    expect(ran).toEqual([]);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("outside its conversation"),
      ),
    ).toBe(true);
  });
});

function Confirm(props: { label: string }): ChannelNode {
  return {
    type: "actions",
    props: {
      children: [
        {
          type: "button",
          props: {
            value: { label: props.label },
            onClick: () => {},
            children: props.label,
          },
        },
      ],
    },
  };
}

describe("ActionRegistry.dispatch scope check", () => {
  const ctx = {} as InteractionContext;

  it("refuses a cross-conversation id on the cold (store) path too", async () => {
    const store = new InMemoryActionStore();
    const first = new ActionRegistry({ store });
    first.registerComponent("Confirm", Confirm as never);
    const tree = await first.bindTree("Confirm", { label: "Pay" }, "conv-1");
    const [id] = findButtonIds(tree);

    const restarted = new ActionRegistry({ store });
    restarted.registerComponent("Confirm", Confirm as never);
    await expect(
      restarted.dispatch(id!, ctx, {
        conversationKey: "conv-2",
        platform: "slack",
      }),
    ).rejects.toMatchObject({ code: "channel_action_scope_mismatch" });
    await expect(
      restarted.dispatch(id!, ctx, {
        conversationKey: "conv-1",
        platform: "slack",
      }),
    ).resolves.toEqual({ label: "Pay" });
  });

  it("mints different ids when the same component is bound twice", async () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    reg.registerComponent("Confirm", Confirm as never);
    const [a] = findButtonIds(
      await reg.bindTree("Confirm", { label: "Pay" }, "conv-1"),
    );
    const [b] = findButtonIds(
      await reg.bindTree("Confirm", { label: "Pay" }, "conv-2"),
    );
    expect(a).not.toBe(b);
    await expect(
      reg.dispatch(a!, ctx, { conversationKey: "conv-2", platform: "slack" }),
    ).rejects.toMatchObject({ code: "channel_action_scope_mismatch" });
  });
});

describe("ActionRegistry.dispatch scope rules", () => {
  const ctx = {} as InteractionContext;

  async function bindConfirm(conversationKey: string, platform = "slack") {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    reg.registerComponent("Confirm", Confirm as never);
    const tree = await reg.bindTree(
      "Confirm",
      { label: "Pay" },
      conversationKey,
      undefined,
      { platform: platform as "slack", signal: new AbortController().signal },
    );
    return { reg, id: findButtonIds(tree)[0]! };
  }

  it("refuses an id presented from another platform with the same conversation key", async () => {
    const { reg, id } = await bindConfirm("conv-1", "slack");
    await expect(
      reg.dispatch(id, ctx, { conversationKey: "conv-1", platform: "teams" }),
    ).rejects.toMatchObject({ code: "channel_action_scope_mismatch" });
    await expect(
      reg.dispatch(id, ctx, { conversationKey: "conv-1", platform: "slack" }),
    ).resolves.toEqual({ label: "Pay" });
  });

  it("refuses an action bound under an empty conversation key", async () => {
    const { reg, id } = await bindConfirm("");
    await expect(
      reg.dispatch(id, ctx, { conversationKey: "", platform: "slack" }),
    ).rejects.toMatchObject({ code: "channel_action_scope_mismatch" });
  });

  it("rejects a dispatch without a scope as an argument error", async () => {
    const { reg, id } = await bindConfirm("conv-1");
    const unscoped = reg.dispatch.bind(reg) as (
      id: string,
      ctx: InteractionContext,
    ) => Promise<unknown>;
    await expect(unscoped(id, ctx)).rejects.toBeInstanceOf(TypeError);
  });

  it("checks the scope of an inline action before reporting it expired", async () => {
    const store = new InMemoryActionStore();
    const first = new ActionRegistry({ store });
    const { root } = await first.bindRenderable(
      Actions({
        children: [
          Button({ value: { ok: true }, onClick: () => {}, children: "OK" }),
        ],
      }),
      "conv-1",
    );
    const [id] = findButtonIds(root);
    // After a restart the inline handler cannot be re-derived.
    const restarted = new ActionRegistry({ store });
    await expect(
      restarted.dispatch(id!, ctx, {
        conversationKey: "conv-2",
        platform: "slack",
      }),
    ).rejects.toMatchObject({ code: "channel_action_scope_mismatch" });
    await expect(
      restarted.dispatch(id!, ctx, {
        conversationKey: "conv-1",
        platform: "slack",
      }),
    ).rejects.toMatchObject({ code: "channel_action_expired" });
  });
});

describe("<Message onReaction> is scoped to its conversation", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopChannels();
  });

  it("does not run a message's reaction handler for a reaction from another conversation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = new FakeAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
    });
    const seen: string[] = [];
    channel.onMessage(async ({ thread }) => {
      await thread.post(
        Message({
          onReaction: (e) => {
            seen.push(e);
          },
          children: "hi",
        }),
      );
    });
    await channel.ɵruntime.start();
    activeChannels.push(channel);
    activeChannels.push(channel);
    fake.emitTurn({ conversationKey: "conv-1" });
    await tick();

    await fake.emitReaction({
      rawEmoji: "🎉",
      messageId: "msg-1",
      conversationKey: "conv-2",
    });
    await fake.emitReaction({
      rawEmoji: "🎉",
      messageId: "msg-1",
      conversationKey: "conv-1",
      platform: "other",
    });
    await tick();
    expect(seen).toEqual([]);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("outside its")),
    ).toHaveLength(2);

    await fake.emitReaction({
      rawEmoji: "🎉",
      messageId: "msg-1",
      conversationKey: "conv-1",
    });
    await tick();
    expect(seen).toEqual(["🎉"]);
  });
});
