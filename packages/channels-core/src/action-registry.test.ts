import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ActionRegistry,
  ActionAlreadyClaimedError,
  ActionContinuationMismatchError,
  ActionExpiredError,
} from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import type { ActionContinuationSnapshot } from "./action-store.js";
import { MemoryStore } from "./state/memory-store.js";
import { mintActionId } from "./mint-id.js";
import { kvActionStore } from "./state/kv-action-store.js";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels-ui";

// Records each click so a test can assert the handler ran — dispatch()
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
    const value = await reg.dispatch(id, ctx, {
      conversationKey: "conv1",
      platform: "slack",
    });
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
    const value = await reg.dispatch(id, ctx, {
      conversationKey: "conv1",
      platform: "slack",
    });
    expect(value).toEqual({ ok: "write" });
    expect(clicks[0]).toContain("ok:write:");
  });

  it("throws ActionExpiredError on full miss", async () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    await expect(
      reg.dispatch("ck:missing", ctx, {
        conversationKey: "conv1",
        platform: "slack",
      }),
    ).rejects.toBeInstanceOf(ActionExpiredError);
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

    const value = await regB.dispatch(id, ctx, {
      conversationKey: "conv-cold",
      platform: "slack",
    });
    expect(value).toEqual({ ok: "approve" });
    expect(clicks[0]).toContain("ok:approve:");
  });

  it("throws ActionExpiredError when the snapshot is absent (missing id)", async () => {
    const reg = new ActionRegistry({
      store: kvActionStore(new MemoryStore()),
    });
    await expect(
      reg.dispatch("ck:missing", ctx, {
        conversationKey: "conv1",
        platform: "slack",
      }),
    ).rejects.toBeInstanceOf(ActionExpiredError);
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
      const value = await regB.dispatch(id, ctx, {
        conversationKey: "conv-restart",
        platform: "slack",
      });
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
      await expect(
        regBPrime.dispatch(id, ctx, {
          conversationKey: "conv-no-reg",
          platform: "slack",
        }),
      ).rejects.toBeInstanceOf(ActionExpiredError);
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

    const firstActionId = (tree: ChannelNode[]) =>
      (
        (tree[0]!.props.children as ChannelNode[])[0]!.props.onClick as {
          id: string;
        }
      ).id;

    const bindTwo = async (store: InMemoryActionStore) => {
      const reg = new ActionRegistry({ store, retentionMs: 60_000 });
      reg.registerComponent("Confirm", Confirm as never);
      const chain = { ...continuation };
      const bind = async () =>
        firstActionId(
          await reg.bindTree("Confirm", { action: "approve" }, "conv1", chain),
        );
      return { reg, ids: [await bind(), await bind()] as [string, string] };
    };

    it("claims once when removing the action fails after the gate is taken", async () => {
      const store = new InMemoryActionStore();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { reg, ids } = await bindTwo(store);
      const [id, sibling] = ids;
      const consume = store.consume.bind(store);
      vi.spyOn(store, "consume").mockImplementation(async (key) => {
        if (key === id) throw new Error("store unavailable");
        return consume(key);
      });

      await expect(
        reg.claimContinuation(id, continuation),
      ).resolves.toMatchObject({ actionId: id });

      await expect(
        reg.claimContinuation(id, continuation),
      ).rejects.toBeInstanceOf(ActionAlreadyClaimedError);
      await expect(
        reg.claimContinuation(sibling, continuation),
      ).rejects.toBeInstanceOf(ActionAlreadyClaimedError);
    });

    it("spends nothing when consuming the gate fails, so the same control can retry", async () => {
      const store = new InMemoryActionStore();
      const { reg, ids } = await bindTwo(store);
      const consume = store.consume.bind(store);
      vi.spyOn(store, "consume").mockImplementationOnce(async (key) => {
        if (key.startsWith("resume:")) throw new Error("store unavailable");
        return consume(key);
      });

      await expect(reg.claimContinuation(ids[0], continuation)).rejects.toThrow(
        "store unavailable",
      );

      await expect(
        reg.claimContinuation(ids[0], continuation),
      ).resolves.toMatchObject({ actionId: ids[0] });
      await expect(
        reg.claimContinuation(ids[1], continuation),
      ).rejects.toBeInstanceOf(ActionAlreadyClaimedError);
    });

    it("reports expiry and keeps the gate when the action vanishes during a claim", async () => {
      const store = new InMemoryActionStore();
      const { reg, ids } = await bindTwo(store);
      const consume = store.consume.bind(store);
      vi.spyOn(store, "consume").mockImplementation(async (key) =>
        key === ids[0] ? undefined : consume(key),
      );

      await expect(
        reg.claimContinuation(ids[0], continuation),
      ).rejects.toBeInstanceOf(ActionExpiredError);

      await expect(
        reg.claimContinuation(ids[1], continuation),
      ).resolves.toMatchObject({ actionId: ids[1] });
    });

    it("reports a claim when the spent marker records one", async () => {
      const store = new InMemoryActionStore();
      const { reg, ids } = await bindTwo(store);
      await store.put(`resume:spent:${ids[0]}`, {
        path: [],
        conversationKey: "conv1",
      });
      const consume = store.consume.bind(store);
      vi.spyOn(store, "consume").mockImplementation(async (key) =>
        key === ids[0] ? undefined : consume(key),
      );

      await expect(
        reg.claimContinuation(ids[0], continuation),
      ).rejects.toBeInstanceOf(ActionAlreadyClaimedError);
    });

    it("publishes nothing when the gate cannot be stored, and the next bind retries", async () => {
      const store = new InMemoryActionStore();
      const reg = new ActionRegistry({ store, retentionMs: 60_000 });
      reg.registerComponent("Confirm", Confirm as never);
      const chain = { ...continuation };
      const put = vi
        .spyOn(store, "put")
        .mockRejectedValueOnce(new Error("store unavailable"));

      await expect(
        reg.bindTree("Confirm", { action: "approve" }, "conv1", chain),
      ).rejects.toThrow("store unavailable");
      expect(put).toHaveBeenCalledTimes(1);

      const id = firstActionId(
        await reg.bindTree("Confirm", { action: "approve" }, "conv1", chain),
      );
      await expect(
        reg.claimContinuation(id, continuation),
      ).resolves.toMatchObject({ actionId: id });
    });

    it("gives binds running together one gate", async () => {
      const store = new InMemoryActionStore();
      const reg = new ActionRegistry({ store, retentionMs: 60_000 });
      reg.registerComponent("Confirm", Confirm as never);
      const chain = { ...continuation };
      const bind = async () =>
        firstActionId(
          await reg.bindTree("Confirm", { action: "approve" }, "conv1", chain),
        );
      const [first, second] = await Promise.all([bind(), bind()]);

      await reg.claimContinuation(first, continuation);

      await expect(
        reg.claimContinuation(second, continuation),
      ).rejects.toBeInstanceOf(ActionAlreadyClaimedError);
    });

    it.each([
      [
        "re-scoping",
        (reg: ActionRegistry, _id: string, tree: ChannelNode[]) =>
          reg.rescopeActions(tree, { conversationKey: "conv1" }),
      ],
      [
        "setting an owner",
        (reg: ActionRegistry, id: string) =>
          reg.setActionOwner([id], "actor-1"),
      ],
    ])("never lets %s carry an action past its gate", async (_label, renew) => {
      vi.useFakeTimers();
      try {
        const store = new InMemoryActionStore();
        const reg = new ActionRegistry({ store, retentionMs: 60_000 });
        reg.registerComponent("Confirm", Confirm as never);
        const chain = { ...continuation };
        await reg.bindTree("Confirm", { action: "first" }, "conv1", chain);

        vi.advanceTimersByTime(50_000);
        const tree = await reg.bindTree(
          "Confirm",
          { action: "late" },
          "conv1",
          chain,
        );
        const id = firstActionId(tree);
        vi.advanceTimersByTime(20_000);
        const put = vi.spyOn(store, "put");
        await renew(reg, id, tree);
        expect(
          put.mock.calls.filter(([key]) => key.startsWith("resume:")),
        ).toEqual([]);

        vi.advanceTimersByTime(55_000);

        await expect(
          reg.claimContinuation(id, continuation),
        ).rejects.toBeInstanceOf(ActionExpiredError);
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives a card rendered late in a run leg a gate that is still live", async () => {
      vi.useFakeTimers();
      try {
        const store = new InMemoryActionStore();
        const reg = new ActionRegistry({ store, retentionMs: 60_000 });
        reg.registerComponent("Confirm", Confirm as never);
        const chain = { ...continuation };
        await reg.bindTree("Confirm", { action: "first" }, "conv1", chain);

        vi.advanceTimersByTime(90_000);
        const id = firstActionId(
          await reg.bindTree("Confirm", { action: "late" }, "conv1", chain),
        );
        vi.advanceTimersByTime(45_000);

        await expect(
          reg.claimContinuation(id, continuation),
        ).resolves.toMatchObject({ actionId: id });
      } finally {
        vi.useRealTimers();
      }
    });

    it("mints random capabilities and stores the trusted binding in the action snapshot", async () => {
      const store = new InMemoryActionStore();
      const reg = new ActionRegistry({ store, retentionMs: 60_000 });
      reg.registerComponent("Confirm", Confirm as never);

      const chain = { ...continuation };
      const first = await reg.bindTree(
        "Confirm",
        { action: "approve" },
        "conv1",
        chain,
      );
      const second = await reg.bindTree(
        "Confirm",
        { action: "approve" },
        "conv1",
        chain,
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
        continuation: { ...chain, actionId: firstId },
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
        { ...continuation },
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
      ).toBeInstanceOf(ActionAlreadyClaimedError);
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
          { ...continuation },
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
      const id = mintActionId();
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
