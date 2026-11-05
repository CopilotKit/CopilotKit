import { describe, it, expect, vi, afterEach } from "vitest";
import { Message } from "@copilotkit/channels-ui";
import type {
  ChannelNode,
  InteractionContext,
  MessageReactionHandler,
} from "@copilotkit/channels-ui";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import type { ActionSnapshot } from "./action-store.js";

/**
 * Action and reaction snapshots written before actions were scoped by
 * platform (and, earlier still, by conversation) are still in durable stores
 * after an upgrade. A snapshot without a platform matches on its conversation
 * key alone; one without a conversation key can never be checked, so it is
 * refused as a legacy action that must be re-rendered. Neither may crash.
 */

const ctx = {} as InteractionContext;
const clicks: string[] = [];

function Confirm(props: { label: string }): ChannelNode {
  return {
    type: "actions",
    props: {
      children: [
        {
          type: "button",
          props: {
            value: { label: props.label },
            onClick: () => {
              clicks.push(props.label);
            },
            children: props.label,
          },
        },
      ],
    },
  };
}

const onReaction: MessageReactionHandler = () => undefined;

function registry(store: InMemoryActionStore): ActionRegistry {
  const reg = new ActionRegistry({ store });
  reg.registerComponent("Confirm", Confirm as never);
  reg.registerComponent("Deployed", () =>
    Message({ children: "done", onReaction }),
  );
  return reg;
}

/** Bind a Confirm button, then rewrite its stored snapshot with `edit`. */
async function legacyAction(
  edit: (snap: ActionSnapshot) => Partial<ActionSnapshot>,
): Promise<{ store: InMemoryActionStore; id: string }> {
  const store = new InMemoryActionStore();
  const tree = await registry(store).bindTree(
    "Confirm",
    { label: "Pay" },
    "conv-1",
  );
  const button = (tree[0]!.props.children as ChannelNode[])[0]!;
  const id = (button.props.onClick as { id: string }).id;
  const snap = (await store.get(id))!;
  await store.put(id, { ...snap, ...edit(snap) } as ActionSnapshot);
  return { store, id };
}

describe("pre-upgrade action snapshots", () => {
  afterEach(() => {
    clicks.length = 0;
    vi.restoreAllMocks();
  });

  it("dispatches a snapshot without a platform in its own conversation", async () => {
    const { store, id } = await legacyAction(() => ({ platform: undefined }));
    const restarted = registry(store);

    await expect(
      restarted.dispatch(id, ctx, {
        conversationKey: "conv-1",
        platform: "slack",
      }),
    ).resolves.toEqual({ label: "Pay" });
    expect(clicks).toEqual(["Pay"]);
  });

  it("still refuses a snapshot without a platform from another conversation", async () => {
    const { store, id } = await legacyAction(() => ({ platform: undefined }));
    await expect(
      registry(store).dispatch(id, ctx, {
        conversationKey: "conv-2",
        platform: "slack",
      }),
    ).rejects.toMatchObject({ code: "channel_action_scope_mismatch" });
    expect(clicks).toEqual([]);
  });

  it("refuses a snapshot without a conversation key as a legacy action, without crashing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, id } = await legacyAction(() => ({
      conversationKey: undefined,
      platform: undefined,
    }));

    await expect(
      registry(store).dispatch(id, ctx, {
        conversationKey: "conv-1",
        platform: "slack",
      }),
    ).rejects.toMatchObject({ code: "channel_action_expired" });
    expect(clicks).toEqual([]);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("legacy action, re-render required"),
      ),
    ).toBe(true);
  });
});

describe("pre-upgrade reaction snapshots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a reaction snapshot without a platform in its own conversation", async () => {
    const store = new InMemoryActionStore();
    await registry(store).persistMessageReaction("msg-1", {
      component: "Deployed",
      props: {},
      conversationKey: "conv-1",
    });
    const restarted = registry(store);
    await expect(
      restarted.resolveMessageReaction("msg-1", {
        conversationKey: "conv-1",
        platform: "slack",
      }),
    ).resolves.toBe(onReaction);
    await expect(
      restarted.resolveMessageReaction("msg-1", {
        conversationKey: "conv-2",
        platform: "slack",
      }),
    ).rejects.toMatchObject({ code: "channel_action_scope_mismatch" });
  });

  it("ignores a reaction snapshot without a conversation key, without crashing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new InMemoryActionStore();
    await store.put("reaction:msg-1", {
      component: "Deployed",
      props: {},
      path: [],
    } as unknown as ActionSnapshot);
    await expect(
      registry(store).resolveMessageReaction("msg-1", {
        conversationKey: "conv-1",
        platform: "slack",
      }),
    ).resolves.toBeUndefined();
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("legacy action, re-render required"),
      ),
    ).toBe(true);
  });
});
