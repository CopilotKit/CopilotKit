import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { InMemoryActionStore } from "./action-store.js";
import type { ActionStore } from "./action-store.js";
import { Actions, Button } from "@copilotkit/channels-ui";
import type {
  ChannelNode,
  MessageRef,
  ProviderActor,
} from "@copilotkit/channels-ui";

/**
 * A picker's controls belong to its choice for their whole published life:
 * from the moment their ids can reach the platform until every one of them is
 * invalidated. An outsider's click never runs a picker control's handler, not
 * while the picker is still being posted, and not while a settled picker's
 * controls are being revoked.
 */

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const alice: ProviderActor = { id: "U_ALICE", kind: "human" };
const mallory: ProviderActor = { id: "U_MALLORY", kind: "human" };

function buttonIds(nodes: readonly ChannelNode[]): string[] {
  const ids: string[] = [];
  const visit = (n: ChannelNode) => {
    if (n.type === "button") ids.push((n.props.onClick as { id: string }).id);
    const children = n.props.children;
    if (Array.isArray(children))
      for (const c of children as ChannelNode[]) visit(c);
  };
  for (const n of nodes) visit(n);
  return ids;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const PENDING = Symbol("pending");

const activeChannels: Channel[] = [];

/**
 * An adapter whose `post` publishes the picker (its ids are visible on the
 * platform at once) but whose completion the test controls.
 */
class HeldPostAdapter extends FakeAdapter {
  held = deferred<MessageRef>();
  override async post(target: unknown, ir: ChannelNode[]): Promise<MessageRef> {
    this.posted.push(ir);
    return this.held.promise;
  }
}

async function startPicker(opts: {
  fake: FakeAdapter;
  actionStore?: ActionStore;
  answerableBy?: "initiator" | "conversation";
}) {
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [opts.fake],
    agent: () => new FakeAgent(),
    ...(opts.actionStore ? { actionStore: opts.actionStore } : {}),
  });
  const state = {
    chosen: PENDING as unknown,
    error: undefined as unknown,
    approveClicks: [] as string[],
    rejectClicks: [] as string[],
  };
  channel.onMention(async ({ thread }) => {
    try {
      state.chosen = await thread.awaitChoice(
        Actions({
          children: [
            Button({
              value: "approve",
              onClick: ({ actor }) => {
                state.approveClicks.push(actor.id);
              },
              children: "Approve",
            }),
            Button({
              value: "reject",
              onClick: ({ actor }) => {
                state.rejectClicks.push(actor.id);
              },
              children: "Reject",
            }),
          ],
        }),
        opts.answerableBy ? { answerableBy: opts.answerableBy } : {},
      );
    } catch (err) {
      state.error = err;
    }
  });
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  opts.fake.emitTurn({
    userText: "deploy",
    conversationKey: "c1",
    actor: alice,
  });
  await tick();
  expect(opts.fake.posted).toHaveLength(1);
  const [approveId, rejectId] = buttonIds(opts.fake.posted[0]!);
  return { state, approveId: approveId!, rejectId: rejectId! };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (activeChannels.length > 0) {
    await activeChannels.pop()!.ɵruntime.stop();
  }
});

describe("awaitChoice: picker controls are owned before they are published", () => {
  it("refuses a non-initiator click while the picker is still being posted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const fake = new HeldPostAdapter();
    const { state, approveId } = await startPicker({ fake });

    // The picker is on the platform, its post has not completed.
    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: mallory,
    });
    await tick();
    expect(state.approveClicks).toEqual([]);

    fake.held.resolve({ id: "msg-picker" });
    await tick();
    expect(state.chosen).toBe(PENDING);

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(state.approveClicks).toEqual(["U_ALICE"]);
    expect(state.chosen).toBe("approve");
  });

  it("runs no control before the choice is open, even for the initiator or in conversation mode", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const fake = new HeldPostAdapter();
    const { state, approveId } = await startPicker({
      fake,
      answerableBy: "conversation",
    });

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: alice,
    });
    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: mallory,
    });
    await tick();
    // A click that cannot answer the choice must not run its handler either.
    expect(state.approveClicks).toEqual([]);

    fake.held.resolve({ id: "msg-picker" });
    await tick();
    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: mallory,
    });
    await tick();
    expect(state.approveClicks).toEqual(["U_MALLORY"]);
    expect(state.chosen).toBe("approve");
  });

  it("revokes every control of a picker whose post failed after it was published", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const fake = new HeldPostAdapter();
    const { state, approveId, rejectId } = await startPicker({ fake });

    fake.held.reject(new Error("post timed out after delivery"));
    await tick();
    expect(state.error).toMatchObject({
      message: "post timed out after delivery",
    });

    for (const actor of [mallory, alice]) {
      for (const id of [approveId, rejectId]) {
        fake.emitInteraction({ id, conversationKey: "c1", actor });
      }
    }
    await tick();
    expect(state.approveClicks).toEqual([]);
    expect(state.rejectClicks).toEqual([]);
  });
});

/** An action store whose deletes the test controls. */
class ControlledDeleteStore extends InMemoryActionStore {
  deletes: string[] = [];
  gate: Promise<void> | undefined;
  failFirst = false;
  override async delete(id: string): Promise<void> {
    this.deletes.push(id);
    if (this.failFirst && this.deletes.length === 1) {
      throw new Error("store unavailable");
    }
    if (this.gate) await this.gate;
    await super.delete(id);
  }
}

describe("awaitChoice: a settled picker's controls are retired before cleanup awaits", () => {
  it("does not run another control for an outsider while a slow delete is pending", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const store = new ControlledDeleteStore();
    const slow = deferred<void>();
    const fake = new FakeAdapter();
    const { state, approveId, rejectId } = await startPicker({
      fake,
      actionStore: store,
    });
    store.gate = slow.promise;

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(state.chosen).toBe("approve");
    expect(store.deletes.length).toBeGreaterThan(0);

    // Revocation is still waiting on the store.
    fake.emitInteraction({
      id: rejectId,
      conversationKey: "c1",
      actor: mallory,
    });
    fake.emitInteraction({ id: rejectId, conversationKey: "c1", actor: alice });
    await tick();
    expect(state.rejectClicks).toEqual([]);

    slow.resolve();
    await tick();
    expect(state.rejectClicks).toEqual([]);
  });

  it("retires and deletes every control even when one delete fails", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new ControlledDeleteStore();
    store.failFirst = true;
    const fake = new FakeAdapter();
    const { state, approveId, rejectId } = await startPicker({
      fake,
      actionStore: store,
    });

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(state.chosen).toBe("approve");
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("could not revoke a settled picker's actions"),
      ),
    ).toBe(true);

    // The later control's snapshot is gone despite the first failure...
    expect(await store.get(rejectId)).toBeUndefined();
    // ...and neither control runs again, for anyone.
    for (const actor of [mallory, alice]) {
      fake.emitInteraction({ id: rejectId, conversationKey: "c1", actor });
      fake.emitInteraction({ id: approveId, conversationKey: "c1", actor });
    }
    await tick();
    expect(state.rejectClicks).toEqual([]);
    expect(state.approveClicks).toEqual(["U_ALICE"]);
  });
});

describe("ActionRegistry.revokeActions", () => {
  function TwoButtons(): ChannelNode {
    return {
      type: "actions",
      props: {
        children: [
          {
            type: "button",
            props: { value: 1, onClick: () => {}, children: "1" },
          },
          {
            type: "button",
            props: { value: 2, onClick: () => {}, children: "2" },
          },
        ],
      },
    };
  }

  it("refuses a revoked id recovered from its snapshot when the delete failed", async () => {
    const { ActionRegistry, ActionExpiredError } =
      await import("./action-registry.js");
    const store = new ControlledDeleteStore();
    store.failFirst = true;
    const runs: number[] = [];
    const reg = new ActionRegistry({ store });
    reg.registerComponent("TwoButtons", () => {
      const tree = TwoButtons();
      for (const [i, b] of (tree.props.children as ChannelNode[]).entries())
        b.props.onClick = () => {
          runs.push(i + 1);
        };
      return tree;
    });
    const ir = await reg.bindTree("TwoButtons", {}, "conv1");
    const [first, second] = buttonIds(ir);
    const scope = { conversationKey: "conv1", platform: "slack" };

    const revocation = reg.revokeActions([first!, second!]);
    // Every id is retired before the first delete settles.
    await expect(
      reg.dispatch(second!, {} as never, scope),
    ).rejects.toBeInstanceOf(ActionExpiredError);
    await expect(revocation).rejects.toThrow();
    // The failed delete left the first snapshot behind; the later one is gone.
    expect(await store.get(first!)).toBeDefined();
    expect(await store.get(second!)).toBeUndefined();

    reg.clearHotCache();
    await expect(
      reg.dispatch(first!, {} as never, scope),
    ).rejects.toBeInstanceOf(ActionExpiredError);
    expect(runs).toEqual([]);
  });
});
