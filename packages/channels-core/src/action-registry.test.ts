import { describe, it, expect, beforeEach } from "vitest";
import { ActionRegistry, ActionExpiredError } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import { MemoryStore } from "./state/memory-store.js";
import { kvActionStore } from "./state/kv-action-store.js";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels-ui";

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
      const handlerFired: string[] = [];
      // Wrap the existing Confirm component so we can assert the specific call.
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
});
