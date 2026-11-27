import type { AgentSubscriber } from "@ag-ui/client";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { ChannelNode, ProviderActor } from "@copilotkit/channels-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import type { ChannelAgentLifecycleArgs } from "./platform-adapter.js";
import {
  ChannelChoiceAbortedError,
  ChannelChoiceTimeoutError,
} from "./thread.js";
import { MemoryStore } from "./state/memory-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

/**
 * A settled picker must stay settled for every process sharing the store:
 * after its snapshot delete fails, after a restart, and on a replica that
 * never posted it.
 */

const alice: ProviderActor = { id: "U_ALICE", kind: "human" };

const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A shared store whose action deletes, or gate writes, can be made to fail. */
class FlakyStore extends MemoryStore {
  failActionDeletes = false;
  failGateWrites = false;
  /** How many upcoming gate takes fail before the store recovers. */
  failGateConsumes = 0;
  gateConsumeAttempts = 0;
  /** The next gate take waits on this before it reaches the store. */
  holdNextGateConsume: Promise<void> | undefined;
  /** Action snapshot deletes wait on this before they reach the store. */
  holdActionDeletes: Promise<void> | undefined;
  /**
   * The next action write re-scoping a snapshot to `conversationKey` "posted"
   * finishes, then waits on this; `onRescopeHeld` fires as it starts waiting.
   */
  holdAfterRescopeWrite: Promise<void> | undefined;
  onRescopeHeld: (() => void) | undefined;
  /**
   * An action write re-scoping a snapshot to `conversationKey` "posted"
   * reaches the store, but its acknowledgement fails.
   */
  failRescopeAcks = false;

  constructor() {
    super();
    const { delete: del, set, consume } = this.kv;
    this.kv = {
      ...this.kv,
      delete: async (key: string) => {
        if (this.holdActionDeletes && key.startsWith("action:")) {
          await this.holdActionDeletes;
        }
        if (this.failActionDeletes && key.startsWith("action:")) {
          throw new Error("store unavailable");
        }
        return del(key);
      },
      set: async <T,>(key: string, value: T, ttlMs?: number) => {
        if (this.failGateWrites && key.startsWith("action:choice:")) {
          throw new Error("store unavailable");
        }
        await set(key, value, ttlMs);
        if (
          this.failRescopeAcks &&
          key.startsWith("action:") &&
          (value as { conversationKey?: string } | undefined)
            ?.conversationKey === "posted"
        ) {
          throw new Error("store unavailable");
        }
        const hold = this.holdAfterRescopeWrite;
        if (
          hold &&
          key.startsWith("action:") &&
          (value as { conversationKey?: string } | undefined)
            ?.conversationKey === "posted"
        ) {
          this.holdAfterRescopeWrite = undefined;
          this.onRescopeHeld?.();
          await hold;
        }
      },
      consume: async <T,>(key: string) => {
        if (key.startsWith("action:choice:")) {
          this.gateConsumeAttempts++;
          const hold = this.holdNextGateConsume;
          if (hold) {
            this.holdNextGateConsume = undefined;
            await hold;
          }
          if (this.failGateConsumes > 0) {
            this.failGateConsumes--;
            throw new Error("store unavailable");
          }
        }
        return consume<T>(key);
      },
    };
  }
}

const activeChannels: Channel[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (activeChannels.length > 0) {
    await activeChannels.pop()!.ɵruntime.stop();
  }
});

function buttonId(nodes: readonly ChannelNode[]): string {
  for (const node of nodes) {
    const action = node.props.onClick as { id: string } | undefined;
    if (node.type === "button" && action) return action.id;
    const children = node.props.children;
    if (Array.isArray(children)) return buttonId(children as ChannelNode[]);
  }
  throw new Error("missing button");
}

interface Harness {
  shared: FlakyStore;
  clicks: string[];
  /** Handler runs and settlements, in the order they happened. */
  log: string[];
  answers: unknown[];
  errors: unknown[];
  /** Resolves every handler run that is waiting on it. */
  release: () => void;
  replica: () => Promise<{ fake: FakeAdapter; channel: Channel }>;
}

function harness(
  opts: {
    timeoutMs?: number;
    slowHandler?: boolean;
    signal?: AbortSignal;
    /** Every `adapter.post` waits on this before it posts. */
    postHeld?: Promise<void>;
    actionRetentionMs?: number;
  } = {},
) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const shared = new FlakyStore();
  const clicks: string[] = [];
  const log: string[] = [];
  const answers: unknown[] = [];
  const errors: unknown[] = [];
  let release!: () => void;
  const released = new Promise<void>((r) => {
    release = r;
  });

  function Picker() {
    return (
      <Actions>
        <Button
          value="go"
          onClick={async ({ actor }) => {
            clicks.push(actor.id);
            log.push("handler");
            if (opts.slowHandler) await released;
          }}
        >
          Go
        </Button>
      </Actions>
    );
  }

  const replica = async () => {
    const fake = new FakeAdapter({ nativeEphemeral: true });
    const { postHeld } = opts;
    if (postHeld) {
      const post = fake.post.bind(fake);
      fake.post = async (target, ir) => {
        await postHeld;
        return post(target, ir);
      };
    }
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
      components: [Picker],
      store: {
        adapter: shared,
        ...(opts.actionRetentionMs
          ? { actionRetentionMs: opts.actionRetentionMs }
          : {}),
      },
    });
    channel.onMention(async ({ thread }) => {
      try {
        answers.push(
          await thread.awaitChoice(<Picker />, {
            ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
            ...(opts.signal ? { signal: opts.signal } : {}),
          }),
        );
      } catch (err) {
        log.push("settled");
        errors.push(err);
      }
    });
    await channel.ɵruntime.start();
    activeChannels.push(channel);
    return { fake, channel };
  };

  const h: Harness = {
    shared,
    clicks,
    log,
    answers,
    errors,
    release,
    replica,
  };
  return h;
}

async function postPicker(h: Harness, fake: FakeAdapter): Promise<string> {
  fake.emitTurn({ userText: "deploy", conversationKey: "c1", actor: alice });
  await tick();
  return buttonId(fake.posted[0]!);
}

describe("awaitChoice retirement is durable", () => {
  it("(1) a picker whose delete failed stays retired after a restart", async () => {
    const h = harness();
    const a = await h.replica();
    const id = await postPicker(h, a.fake);
    h.shared.failActionDeletes = true;

    a.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();
    expect(h.answers).toEqual(["go"]);
    expect(h.clicks).toEqual([alice.id]);

    // Restart: the posting process goes away, a fresh one shares the store.
    await activeChannels
      .splice(activeChannels.indexOf(a.channel), 1)[0]!
      .ɵruntime.stop();
    const restarted = await h.replica();
    restarted.fake.emitInteraction({
      id,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();

    expect(h.clicks).toEqual([alice.id]);
  });

  it("(2) a picker answered on one replica is refused on another", async () => {
    const h = harness();
    const a = await h.replica();
    const b = await h.replica();
    const id = await postPicker(h, a.fake);
    h.shared.failActionDeletes = true;

    a.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();
    expect(h.answers).toEqual(["go"]);

    b.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();

    expect(h.clicks).toEqual([alice.id]);
    expect(b.fake.ephemeralPosts).toHaveLength(1);
  });

  it("(3) simultaneous clicks on two replicas run the handler once", async () => {
    const h = harness({ slowHandler: true });
    const a = await h.replica();
    const b = await h.replica();
    const id = await postPicker(h, a.fake);

    a.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    b.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();
    h.release();
    await tick();

    expect(h.clicks).toEqual([alice.id]);
  });

  it("(4) a timed-out picker whose delete failed is refused on another replica", async () => {
    const h = harness({ timeoutMs: 40 });
    const a = await h.replica();
    const b = await h.replica();
    const id = await postPicker(h, a.fake);
    h.shared.failActionDeletes = true;

    await new Promise((r) => setTimeout(r, 80));
    await tick();
    expect(h.errors).toHaveLength(1);

    b.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();

    expect(h.clicks).toEqual([]);
  });

  it("(6) an aborted picker with no timeout whose delete failed is refused on another replica", async () => {
    const controller = new AbortController();
    const h = harness({ signal: controller.signal });
    const a = await h.replica();
    const b = await h.replica();
    const id = await postPicker(h, a.fake);
    h.shared.failActionDeletes = true;

    controller.abort();
    await tick();
    expect(h.errors).toHaveLength(1);

    // Its snapshot survived and its deadline is an hour away: only the taken
    // gate stops replica B from running the handler.
    b.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();

    expect(h.clicks).toEqual([]);
    expect(b.fake.ephemeralPosts).toHaveLength(1);
  });

  it("(7) retiring an aborted picker retries a failed gate take", async () => {
    const controller = new AbortController();
    const h = harness({ signal: controller.signal });
    const a = await h.replica();
    const b = await h.replica();
    const id = await postPicker(h, a.fake);
    h.shared.failActionDeletes = true;
    h.shared.failGateConsumes = 1;

    controller.abort();
    // Past the first retry delay.
    await new Promise((r) => setTimeout(r, 120));
    await tick();
    expect(h.errors).toHaveLength(1);
    expect(h.shared.gateConsumeAttempts).toBe(2);

    b.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();

    expect(h.clicks).toEqual([]);
    expect(b.fake.ephemeralPosts).toHaveLength(1);
  });

  it("(5) a picker whose gate cannot be written is never posted", async () => {
    const h = harness();
    const a = await h.replica();
    h.shared.failGateWrites = true;

    a.fake.emitTurn({
      userText: "deploy",
      conversationKey: "c1",
      actor: alice,
    });
    await tick();

    expect(a.fake.posted).toEqual([]);
    expect(h.errors).toHaveLength(1);
  });
});

/** An agent run that raises the "approval" interrupt. */
function interrupt(subscriber: AgentSubscriber): void {
  subscriber.onCustomEvent?.({
    event: { name: "approval", value: { requestId: "request-1" } },
  } as never);
  subscriber.onRunFinishedEvent?.({ event: {} } as never);
}

function finish(subscriber: AgentSubscriber): void {
  subscriber.onRunFinishedEvent?.({ event: {} } as never);
}

/** Ticks until `done()` holds, or fails after a bounded wait. */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (done()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("awaitChoice settles only once its picker is retired everywhere", () => {
  it("(8) an aborted picker reports its cancellation only after its gate is taken", async () => {
    const controller = new AbortController();
    const h = harness({ signal: controller.signal });
    const a = await h.replica();
    const b = await h.replica();
    const id = await postPicker(h, a.fake);

    // Replica A's retirement is slow to reach the store.
    let releaseStore!: () => void;
    const storeHeld = new Promise<void>((r) => {
      releaseStore = r;
    });
    h.shared.holdNextGateConsume = storeHeld;
    h.shared.holdActionDeletes = storeHeld;

    controller.abort();
    await tick();
    // A click on replica B while A's retirement is still in flight.
    b.fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();
    releaseStore();
    await until(() => h.errors.length === 1, "the abort to settle");

    expect(h.errors[0]).toBeInstanceOf(ChannelChoiceAbortedError);
    // Whatever B did, it did before the caller saw the picker cancelled.
    expect(h.log.indexOf("settled")).toBe(h.log.length - 1);
  });

  it("(9) the click that won a picker on one replica can still resume after another re-scoped it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const shared = new FlakyStore();
    const outcomes: unknown[] = [];
    let releaseHandler!: () => void;
    const handlerHeld = new Promise<void>((r) => {
      releaseHandler = r;
    });

    function Picker() {
      return (
        <Actions>
          <Button
            value="go"
            onClick={async ({ thread }) => {
              await handlerHeld;
              try {
                await thread.resume("answer");
                outcomes.push("resumed");
              } catch (err) {
                outcomes.push(err);
              }
            }}
          >
            Go
          </Button>
        </Actions>
      );
    }

    const replica = async (
      script: Array<(subscriber: AgentSubscriber) => void>,
    ) => {
      const fake = new FakeAdapter({ nativeEphemeral: true });
      fake.runAgentLifecycle = async (args: ChannelAgentLifecycleArgs) =>
        args.execute(args.renderer.subscriber, undefined);
      // A click on a posted message arrives under that message's own key.
      Object.assign(fake, { postedConversationKey: () => "posted" });
      const channel = createChannel({
        name: "approvals",
        identifyUser: "platform",
        adapters: [fake],
        agent: new FakeAgent(script),
        components: [Picker],
        store: { adapter: shared },
      });
      channel.onMention(async ({ thread }) => {
        await thread.runAgent();
      });
      channel.onInterrupt("approval", ({ thread }) => {
        thread.awaitChoice(<Picker />, { timeoutMs: 10_000 }).catch(() => {});
      });
      await channel.ɵruntime.start();
      activeChannels.push(channel);
      return fake;
    };
    const a = await replica([interrupt]);
    const b = await replica([finish]);

    // Hold replica A's re-scope just after its snapshot write.
    let rescopeHeld = false;
    let releaseRescope!: () => void;
    shared.holdAfterRescopeWrite = new Promise<void>((r) => {
      releaseRescope = r;
    });
    shared.onRescopeHeld = () => {
      rescopeHeld = true;
    };
    a.emitTurn({ userText: "deploy", conversationKey: "c1", actor: alice });
    await until(() => rescopeHeld, "A's re-scope write");
    const id = buttonId(a.posted[a.posted.length - 1]!);

    // B's click takes the picker's gate and starts its handler.
    b.emitInteraction({ id, conversationKey: "posted", actor: alice });
    await tick();
    // A's re-scope finishes, after the gate was taken.
    releaseRescope();
    await tick();
    releaseHandler();
    await until(() => outcomes.length === 1, "B's resume");

    expect(outcomes).toEqual(["resumed"]);
  });

  it("(10) a picker whose post outlasts its timeout settles as timed out", async () => {
    let releasePost!: () => void;
    const h = harness({
      timeoutMs: 40,
      postHeld: new Promise<void>((r) => {
        releasePost = r;
      }),
    });
    const a = await h.replica();
    a.fake.emitTurn({
      userText: "deploy",
      conversationKey: "c1",
      actor: alice,
    });
    await new Promise((r) => setTimeout(r, 80));
    releasePost();
    await tick();

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toBeInstanceOf(ChannelChoiceTimeoutError);
  });

  it("(11) a picker's timeout counts from the same moment as its gate's deadline", async () => {
    let releasePost!: () => void;
    const h = harness({
      timeoutMs: 120,
      postHeld: new Promise<void>((r) => {
        releasePost = r;
      }),
    });
    const a = await h.replica();
    a.fake.emitTurn({
      userText: "deploy",
      conversationKey: "c1",
      actor: alice,
    });
    await new Promise((r) => setTimeout(r, 60));
    releasePost();
    await tick();
    expect(h.errors).toHaveLength(0);

    // Past the gate's deadline, but not 120ms after the post finished.
    await new Promise((r) => setTimeout(r, 90));
    await tick();

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toBeInstanceOf(ChannelChoiceTimeoutError);
  });

  it("(12) a store error taking the gate for an expired control settles the picker", async () => {
    const h = harness({ timeoutMs: 10_000, actionRetentionMs: 30 });
    const a = await h.replica();
    const id = await postPicker(h, a.fake);
    // The control's snapshot and cache expire; the picker is still pending.
    await new Promise((r) => setTimeout(r, 60));
    h.shared.failGateConsumes = 1;

    await expect(
      a.fake.getSink().onInteraction({
        id,
        conversationKey: "c1",
        replyTarget: {},
        actor: alice,
      }),
    ).rejects.toThrow("store unavailable");
    await tick();

    expect(h.errors).toHaveLength(1);
    expect((h.errors[0] as Error).message).toBe("store unavailable");
  });
});

describe("awaitChoice reports a failed post only once its picker is retired everywhere", () => {
  /**
   * Holds replica A's retirement, clicks the published control on replica
   * B meanwhile, and returns the order of handler runs and settlement.
   */
  async function clickDuringRetirement(
    h: Harness,
    a: { fake: FakeAdapter },
    b: { fake: FakeAdapter },
    clickKey: string,
  ): Promise<void> {
    let releaseStore!: () => void;
    const storeHeld = new Promise<void>((r) => {
      releaseStore = r;
    });
    h.shared.holdNextGateConsume = storeHeld;
    h.shared.holdActionDeletes = storeHeld;

    a.fake.emitTurn({
      userText: "deploy",
      conversationKey: "c1",
      actor: alice,
    });
    await until(() => a.fake.posted.length === 1, "the picker to publish");
    await tick();
    const id = buttonId(a.fake.posted[0]!);
    // A click on replica B while A's retirement is still in flight.
    b.fake.emitInteraction({ id, conversationKey: clickKey, actor: alice });
    await tick();
    releaseStore();
    await until(() => h.errors.length === 1, "the failed post to settle");
  }

  it("(13) a provider that publishes the picker and then fails reports it after retirement", async () => {
    const h = harness();
    const a = await h.replica();
    const b = await h.replica();
    const post = a.fake.post.bind(a.fake);
    a.fake.post = async (target, ir) => {
      await post(target, ir);
      throw new Error("post failed after publishing");
    };

    await clickDuringRetirement(h, a, b, "c1");

    expect((h.errors[0] as Error).message).toBe("post failed after publishing");
    // Whatever B did, it did before the caller saw the post fail.
    expect(h.log.indexOf("settled")).toBe(h.log.length - 1);
  });

  it("(14) a re-scope whose acknowledgement fails after a post reports it after retirement", async () => {
    const h = harness();
    const a = await h.replica();
    const b = await h.replica();
    // A click on a posted message arrives under that message's own key.
    Object.assign(a.fake, { postedConversationKey: () => "posted" });
    h.shared.failRescopeAcks = true;

    await clickDuringRetirement(h, a, b, "posted");

    expect((h.errors[0] as Error).message).toBe("store unavailable");
    expect(h.log.indexOf("settled")).toBe(h.log.length - 1);
  });

  it("(15) a failed post whose picker cannot be retired reports both errors", async () => {
    const h = harness();
    const a = await h.replica();
    a.fake.post = async () => {
      throw new Error("post failed");
    };
    h.shared.failGateConsumes = 100;

    a.fake.emitTurn({
      userText: "deploy",
      conversationKey: "c1",
      actor: alice,
    });
    await until(() => h.errors.length === 1, "the failed post to settle");

    const err = h.errors[0] as AggregateError;
    expect(err).toBeInstanceOf(AggregateError);
    expect(err.errors.map((e: Error) => e.message)).toEqual([
      "store unavailable",
      "post failed",
    ]);
  });
});
