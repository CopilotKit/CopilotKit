import { describe, it, expect, vi, afterEach } from "vitest";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels-ui";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import type { ActionSnapshot } from "./action-store.js";
import type { ActionContinuationContext } from "./action-store.js";

/**
 * Once a message is posted, its actions move to the conversation a click on
 * it arrives from (`rescopeActions`). The move must carry a continuation's
 * binding along, renew the in-process entry with the stored one, and never
 * bring back an action that was revoked or claimed while it ran.
 */

const ctx = {} as InteractionContext;

function buttonIds(root: readonly ChannelNode[]): string[] {
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
    if (typeof onClick?.id === "string") ids.push(onClick.id);
    for (const propValue of Object.values(node.props)) visit(propValue);
  };
  visit(root);
  return ids;
}

const card = (onClick: () => void) =>
  Actions({
    children: [Button({ value: { ok: true }, onClick, children: "OK" })],
  });

const continuation: ActionContinuationContext = {
  channelName: "approvals",
  conversationKey: "C1::slash::U1",
  threadId: "C1::slash::U1",
  runChainId: "run-1",
  initiator: { user: null, actor: { id: "U1", kind: "human" } },
};

/** A store whose reads can be held, to interleave another operation. */
class GatedStore extends InMemoryActionStore {
  private gate?: Promise<void>;
  hold(): () => void {
    let open!: () => void;
    this.gate = new Promise((resolve) => {
      open = resolve;
    });
    return () => {
      this.gate = undefined;
      open();
    };
  }
  override async get(id: string): Promise<ActionSnapshot | undefined> {
    const snap = await super.get(id);
    if (this.gate) await this.gate;
    return snap;
  }
}

describe("ActionRegistry.rescopeActions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves a continuation's binding with its action", async () => {
    const store = new InMemoryActionStore();
    const reg = new ActionRegistry({ store });
    const { root } = await reg.bindRenderable(
      card(() => {}),
      continuation.conversationKey,
      continuation,
    );
    const [id] = buttonIds(root);

    await reg.rescopeActions(root, {
      conversationKey: "C1::900.0001",
      threadId: "C1::900.0001",
    });

    const moved = {
      channelName: "approvals",
      conversationKey: "C1::900.0001",
      threadId: "C1::900.0001",
    };
    await expect(reg.getContinuation(id!, moved)).resolves.toMatchObject(moved);
    await expect(
      reg.getContinuation(id!, {
        channelName: "approvals",
        conversationKey: continuation.conversationKey,
        threadId: continuation.threadId,
      }),
    ).rejects.toMatchObject({ code: "channel_continuation_mismatch" });
  });

  it("renews the in-process entry along with the stored snapshot", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const clicks: number[] = [];
    const reg = new ActionRegistry({
      store: new InMemoryActionStore(),
      retentionMs: 1_000,
    });
    const { root } = await reg.bindRenderable(
      card(() => {
        clicks.push(1);
      }),
      "turn",
    );
    const [id] = buttonIds(root);

    vi.advanceTimersByTime(800);
    await reg.rescopeActions(root, { conversationKey: "posted" });
    vi.advanceTimersByTime(800);

    // 1.6 s after binding but 0.8 s after the re-scope: still live. An inline
    // handler exists only in process, so it must not have expired there.
    await expect(
      reg.dispatch(id!, ctx, { conversationKey: "posted", platform: "slack" }),
    ).resolves.toEqual({ ok: true });
    expect(clicks).toEqual([1]);
  });

  it("does not bring back an action revoked while it was being re-scoped", async () => {
    const store = new GatedStore();
    const reg = new ActionRegistry({ store });
    const { root } = await reg.bindRenderable(
      card(() => {}),
      "turn",
      continuation,
    );
    const [id] = buttonIds(root);

    const open = store.hold();
    const rescoping = reg.rescopeActions(root, { conversationKey: "posted" });
    await reg.revokeActions([id!]);
    open();
    await rescoping;

    await expect(store.get(id!)).resolves.toBeUndefined();
    await expect(
      reg.dispatch(id!, ctx, { conversationKey: "posted", platform: "slack" }),
    ).rejects.toMatchObject({ code: "channel_action_expired" });
  });
});
