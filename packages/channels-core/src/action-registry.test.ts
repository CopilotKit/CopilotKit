import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ActionRegistry,
  ActionContinuationMismatchError,
  ActionExpiredError,
} from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import type { ActionContinuationSnapshot } from "./action-store.js";
import { MemoryStore } from "./state/memory-store.js";
import { kvActionStore } from "./state/kv-action-store.js";
import { mintId } from "./mint-id.js";
import {
  defineChannelComponent,
  resolveComponentName,
} from "@copilotkit/channels-ui";
import type {
  ChannelNode,
  ComponentFn,
  InteractionContext,
} from "@copilotkit/channels-ui";

// Records each click so a test can assert the handler ran — dispatch() now
// returns the clicked element's `value` (needed to resolve HITL waiters on
// platforms whose callback payload can't carry it), not the handler's return.
const clicks: string[] = [];

function Confirm(props: { action: string }): ChannelNode {
  return {
    type: "actions",
    props: {
      children: [
        {
          type: "button",
          props: {
            value: { ok: props.action },
            onClick: ({ action }: InteractionContext) => {
              clicks.push(`ok:${props.action}:${action.id}`);
            },
            children: "Yes",
          },
        },
      ],
    },
  };
}

const ctx = {} as InteractionContext;

describe("ActionRegistry", () => {
  beforeEach(() => {
    clicks.length = 0;
  });

  it("dispatches via hot cache, runs the handler, and returns the element value", async () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    reg.registerComponent("Confirm", Confirm as never);
    const ir = await reg.bindTree("Confirm", { action: "write" }, "conv1");
    const button = (ir[0]!.props.children as ChannelNode[])[0]!;
    const id = (button.props.onClick as { id: string }).id;
    expect(typeof id).toBe("string");
    const value = await reg.dispatch(id, ctx);
    expect(value).toEqual({ ok: "write" });
    expect(clicks[0]).toContain("ok:write:");
  });

  it("cold path re-renders from snapshot when hot cache is cleared, still returning the value", async () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    reg.registerComponent("Confirm", Confirm as never);
    const ir = await reg.bindTree("Confirm", { action: "write" }, "conv1");
    const id = (
      (ir[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
        id: string;
      }
    ).id;
    reg.clearHotCache();
    const value = await reg.dispatch(id, ctx);
    expect(value).toEqual({ ok: "write" });
    expect(clicks[0]).toContain("ok:write:");
  });

  it("throws ActionExpiredError on full miss", async () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    await expect(reg.dispatch("ck:missing", ctx)).rejects.toBeInstanceOf(
      ActionExpiredError,
    );
  });

  it("dispatches from a cold registry via a shared store (restart survival)", async () => {
    const state = new MemoryStore();
    // registryA: bind a tree and persist snapshot to shared state
    const regA = new ActionRegistry({ store: kvActionStore(state) });
    regA.registerComponent("Confirm", Confirm as never);
    const ir = await regA.bindTree(
      "Confirm",
      { action: "approve" },
      "conv-cold",
    );
    const id = (
      (ir[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
        id: string;
      }
    ).id;

    // registryB: fresh registry with no hot cache but sharing the same store
    const regB = new ActionRegistry({ store: kvActionStore(state) });
    regB.registerComponent("Confirm", Confirm as never);

    const value = await regB.dispatch(id, ctx);
    expect(value).toEqual({ ok: "approve" });
    expect(clicks[0]).toContain("ok:approve:");
  });

  it("throws ActionExpiredError when the snapshot is absent (missing id)", async () => {
    const reg = new ActionRegistry({
      store: kvActionStore(new MemoryStore()),
    });
    await expect(reg.dispatch("ck:missing", ctx)).rejects.toBeInstanceOf(
      ActionExpiredError,
    );
  });

  describe("components-seeded registry (createChannel components option)", () => {
    it("enables cold dispatch after simulated restart when component is pre-registered", async () => {
      // Shared store survives the "restart" (like Redis across process restarts).
      const sharedState = new MemoryStore();

      // Registry A: bind a named component and persist its snapshot.
      const regA = new ActionRegistry({ store: kvActionStore(sharedState) });
      regA.registerComponent("Confirm", Confirm as never);
      const ir = await regA.bindTree(
        "Confirm",
        { action: "restart-test" },
        "conv-restart",
      );
      const id = (
        (ir[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
          id: string;
        }
      ).id;

      // Registry B: fresh process — no hot cache, but component is seeded via
      // the createChannel `components` option equivalent (registerComponent at startup).
      const regB = new ActionRegistry({ store: kvActionStore(sharedState) });
      regB.registerComponent("Confirm", Confirm as never);

      // Cold dispatch must succeed and fire the handler.
      const value = await regB.dispatch(id, ctx);
      expect(value).toEqual({ ok: "restart-test" });
      // The shared `clicks` array is populated by Confirm's onClick.
      expect(clicks.some((c) => c.includes("ok:restart-test:"))).toBe(true);
    });

    it("throws ActionExpiredError when component is NOT pre-registered (no-registration degradation)", async () => {
      const sharedState = new MemoryStore();

      // Registry A: bind and persist.
      const regA = new ActionRegistry({ store: kvActionStore(sharedState) });
      regA.registerComponent("Confirm", Confirm as never);
      const ir = await regA.bindTree(
        "Confirm",
        { action: "no-reg" },
        "conv-no-reg",
      );
      const id = (
        (ir[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
          id: string;
        }
      ).id;

      // Registry B': fresh process, shared store, but component NOT registered.
      const regBPrime = new ActionRegistry({
        store: kvActionStore(sharedState),
      });

      // Without registration the cold path cannot re-render → ActionExpiredError.
      await expect(regBPrime.dispatch(id, ctx)).rejects.toBeInstanceOf(
        ActionExpiredError,
      );
    });
  });

  describe("inline (non-component) renderables", () => {
    // An inline renderable carries its handlers as closures with no component to
    // re-render, so its ids can't be content-addressed. Two structurally
    // identical inline posts in one conversation must still get distinct ids —
    // otherwise the later binding overwrites the earlier and a click on the
    // older message runs the newer message's handler.
    function inlinePost(marker: string): ChannelNode {
      return {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: {
                value: { pick: "x" },
                onClick: ({ action }: InteractionContext) => {
                  clicks.push(`${marker}:${action.id}`);
                },
                children: "Go",
              },
            },
          ],
        },
      };
    }

    function bindId(root: ChannelNode[]): string {
      return (
        (root[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
          id: string;
        }
      ).id;
    }

    it("mints distinct ids for structurally identical posts, so the older keeps its handler", async () => {
      const reg = new ActionRegistry({ store: new InMemoryActionStore() });
      // `older` and `newer` differ only by closure — same tree, same props — so
      // a content-addressed id would collide them.
      const { root: older } = await reg.bindRenderable(
        inlinePost("older"),
        "conv",
      );
      const { root: newer } = await reg.bindRenderable(
        inlinePost("newer"),
        "conv",
      );
      const olderId = bindId(older);
      const newerId = bindId(newer);

      expect(olderId).not.toBe(newerId);

      await reg.dispatch(olderId, ctx);
      expect(clicks).toEqual([`older:${olderId}`]);
    });
  });

  describe("stable component identity across a mangling build", () => {
    // The same component as a bundler emits it in two successive deploys. Both
    // are minified, and the mangler picked a different letter each time — only
    // `displayName`, set via defineChannelComponent, is stable across them.
    function makeCard(pin: boolean, fnName: string): ComponentFn {
      const body = (props: Record<string, unknown>): ChannelNode => ({
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: {
                value: { approved: props.summary },
                onClick: ({ action }: InteractionContext) => {
                  clicks.push(`approve:${props.summary}:${action.id}`);
                },
                children: "Approve",
              },
            },
          ],
        },
      });
      // `Object.defineProperty` is how a minifier's output differs from source:
      // only the function's own `name` changes.
      Object.defineProperty(body, "name", { value: fnName });
      return pin
        ? (defineChannelComponent("ApprovalCard", body) as ComponentFn)
        : body;
    }

    /** Post a card from "deploy 1" and return its minted action id. */
    async function post(reg: ActionRegistry, card: ComponentFn) {
      const { root } = await reg.bindRenderable(
        { type: card, props: { summary: "ship it" } },
        "conv-deploy",
      );
      return (
        (root[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
          id: string;
        }
      ).id;
    }

    it("rehydrates a pinned component across a rename of fn.name", async () => {
      const shared = new MemoryStore();
      // Deploy 1 posts the card; the mangler called the function `a`.
      const deploy1 = new ActionRegistry({ store: kvActionStore(shared) });
      const id = await post(deploy1, makeCard(true, "a"));

      // Deploy 2: fresh process, same component, mangled to `b`, seeded the
      // way createChannel seeds `components` — under the resolved name.
      const redeployed = makeCard(true, "b");
      expect(redeployed.name).toBe("b");
      const deploy2 = new ActionRegistry({ store: kvActionStore(shared) });
      deploy2.registerComponent(resolveComponentName(redeployed)!, redeployed);

      await expect(deploy2.dispatch(id, ctx)).resolves.toEqual({
        approved: "ship it",
      });
      expect(clicks[0]).toContain("approve:ship it:");
    });

    it("mints the same id on both sides of the rename, so live cards stay valid", async () => {
      const before = await post(
        new ActionRegistry({ store: kvActionStore(new MemoryStore()) }),
        makeCard(true, "a"),
      );
      const after = await post(
        new ActionRegistry({ store: kvActionStore(new MemoryStore()) }),
        makeCard(true, "b"),
      );
      expect(after).toBe(before);
    });

    it("without a pinned name the same rename silently breaks the card", async () => {
      // Negative control: the bug the pin exists to prevent. Deploy 2 knows the
      // component only as `b`, so the snapshot's `a` resolves to nothing and
      // the click is dropped.
      const shared = new MemoryStore();
      const deploy1 = new ActionRegistry({ store: kvActionStore(shared) });
      const id = await post(deploy1, makeCard(false, "a"));

      const redeployed = makeCard(false, "b");
      const deploy2 = new ActionRegistry({ store: kvActionStore(shared) });
      deploy2.registerComponent(resolveComponentName(redeployed)!, redeployed);

      await expect(deploy2.dispatch(id, ctx)).rejects.toBeInstanceOf(
        ActionExpiredError,
      );
    });

    it("keeps an unpinned named component working exactly as before", async () => {
      // Backward compatibility: no displayName anywhere, ids still derive from
      // fn.name and cold dispatch still resolves.
      const shared = new MemoryStore();
      const deploy1 = new ActionRegistry({ store: kvActionStore(shared) });
      const id = await post(deploy1, makeCard(false, "ApprovalCard"));
      expect(id).toBe(
        mintId("ApprovalCard", [0, "children", 0, "onClick"], {
          summary: "ship it",
        }),
      );

      const deploy2 = new ActionRegistry({ store: kvActionStore(shared) });
      deploy2.registerComponent(
        "ApprovalCard",
        makeCard(false, "ApprovalCard"),
      );
      await expect(deploy2.dispatch(id, ctx)).resolves.toEqual({
        approved: "ship it",
      });
    });

    it("warns when two different components claim one name", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const reg = new ActionRegistry({ store: new InMemoryActionStore() });
        // Re-registering the *same* function object is the normal per-post
        // re-registration and must stay silent. Assert zero warnings before any
        // conflict has fired for "Card": warnOnce dedupes by name, so only a
        // still-empty warn count can prove same-function registration is silent
        // on its own (rather than a second warning being swallowed by dedup).
        const same = makeCard(false, "a");
        reg.registerComponent("Card", same);
        reg.registerComponent("Card", same);
        expect(warn).not.toHaveBeenCalled();
        // A genuinely different function object under the same name — each
        // makeCard() returns a fresh closure — is the real hazard, so it warns.
        reg.registerComponent("Card", makeCard(false, "a"));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toContain(
          'two different components are registered as "Card"',
        );
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("one-use HITL continuations", () => {
    const continuation = {
      channelName: "approvals",
      conversationKey: "conv1",
      threadId: "thread1",
      runChainId: "run-chain-1",
      initiator: {
        user: { id: "user-1", name: "Alice" },
        actor: { id: "actor-1", kind: "human" as const },
      },
    };

    it("mints random capabilities and stores the trusted binding in the action snapshot", async () => {
      const store = new InMemoryActionStore();
      const reg = new ActionRegistry({ store, retentionMs: 60_000 });
      reg.registerComponent("Confirm", Confirm as never);

      const first = await reg.bindTree(
        "Confirm",
        { action: "approve" },
        "conv1",
        continuation,
      );
      const second = await reg.bindTree(
        "Confirm",
        { action: "approve" },
        "conv1",
        continuation,
      );
      const firstId = (
        (first[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
          id: string;
        }
      ).id;
      const secondId = (
        (second[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
          id: string;
        }
      ).id;

      expect(firstId).not.toBe(secondId);
      expect(await store.get(firstId)).toMatchObject({
        continuation: { ...continuation, actionId: firstId },
      });
    });

    it("allows exactly one claimant across concurrent resume attempts", async () => {
      const reg = new ActionRegistry({
        store: new InMemoryActionStore(),
        retentionMs: 60_000,
      });
      reg.registerComponent("Confirm", Confirm as never);
      const tree = await reg.bindTree(
        "Confirm",
        { action: "approve" },
        "conv1",
        continuation,
      );
      const id = (
        (tree[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
          id: string;
        }
      ).id;

      const outcomes = await Promise.allSettled([
        reg.claimContinuation(id, continuation),
        reg.claimContinuation(id, continuation),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === "rejected"),
      ).toHaveLength(1);
      expect(
        (
          outcomes.find(
            (outcome) => outcome.status === "rejected",
          ) as PromiseRejectedResult
        ).reason,
      ).toBeInstanceOf(ActionExpiredError);
    });

    it.each([
      ["Channel", { channelName: "wrong" }],
      ["conversation", { conversationKey: "wrong" }],
      ["Thread", { threadId: "wrong" }],
    ])(
      "rejects a wrong %s binding without consuming the valid continuation",
      async (_label, tampered) => {
        const reg = new ActionRegistry({
          store: new InMemoryActionStore(),
          retentionMs: 60_000,
        });
        reg.registerComponent("Confirm", Confirm as never);
        const tree = await reg.bindTree(
          "Confirm",
          { action: "approve" },
          "conv1",
          continuation,
        );
        const id = (
          (tree[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
            id: string;
          }
        ).id;

        await expect(
          reg.claimContinuation(id, { ...continuation, ...tampered }),
        ).rejects.toBeInstanceOf(ActionContinuationMismatchError);
        await expect(
          reg.claimContinuation(id, continuation),
        ).resolves.toMatchObject({
          actionId: id,
          runChainId: "run-chain-1",
        });
      },
    );

    it.each([
      ["run chain", { runChainId: "" }],
      ["action", { actionId: "ck:other" }],
      [
        "initiator actor",
        { initiator: { ...continuation.initiator, actor: {} } },
      ],
    ])("rejects a snapshot with a tampered %s", async (_label, tampered) => {
      const id = `ck:${globalThis.crypto.randomUUID()}`;
      const store = new InMemoryActionStore();
      const reg = new ActionRegistry({ store, retentionMs: 60_000 });
      await store.put(id, {
        path: [0, "onClick"],
        conversationKey: "conv1",
        continuation: {
          ...continuation,
          actionId: id,
          ...tampered,
        } as unknown as ActionContinuationSnapshot,
      });

      await expect(
        reg.claimContinuation(id, continuation),
      ).rejects.toBeInstanceOf(ActionContinuationMismatchError);
    });

    it("rejects a wrong random capability", async () => {
      const reg = new ActionRegistry({
        store: new InMemoryActionStore(),
        retentionMs: 60_000,
      });

      await expect(
        reg.claimContinuation("ck:wrong-capability", continuation),
      ).rejects.toBeInstanceOf(ActionExpiredError);
    });

    it("expires with the action retention window", async () => {
      vi.useFakeTimers();
      try {
        const reg = new ActionRegistry({
          store: new InMemoryActionStore(),
          retentionMs: 100,
        });
        reg.registerComponent("Confirm", Confirm as never);
        const tree = await reg.bindTree(
          "Confirm",
          { action: "approve" },
          "conv1",
          continuation,
        );
        const id = (
          (tree[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
            id: string;
          }
        ).id;
        vi.advanceTimersByTime(101);

        await expect(
          reg.claimContinuation(id, continuation),
        ).rejects.toBeInstanceOf(ActionExpiredError);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
