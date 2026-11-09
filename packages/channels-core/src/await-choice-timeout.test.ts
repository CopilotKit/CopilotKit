import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import { DEFAULT_AWAIT_CHOICE_TIMEOUT_MS } from "./thread.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Actions, Button } from "@copilotkit/channels-ui";
import type {
  AwaitChoiceOptions,
  ChannelNode,
  ProviderActor,
} from "@copilotkit/channels-ui";

/**
 * A pending `thread.awaitChoice` does not wait forever: it settles with a
 * typed error after its timeout (a default applies) or when its signal aborts,
 * and the turn that awaited it is freed.
 */

const alice: ProviderActor = { id: "U_ALICE", kind: "human" };
const activeChannels: Channel[] = [];

/** Flush pending work under fake timers. */
const flush = () => vi.advanceTimersByTimeAsync(0);

function buttonIds(nodes: readonly ChannelNode[]): string[] {
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
 * A serial channel whose mention handler awaits a picker with `options` and
 * records how it settled. A plain message records that its turn ran.
 */
async function start(
  options?: AwaitChoiceOptions,
  hooks: { duringPost?: () => void } = {},
) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const fake = new FakeAdapter();
  if (hooks.duringPost) {
    const post = fake.post.bind(fake);
    const duringPost = hooks.duringPost;
    fake.post = async (target, ir) => {
      duringPost();
      return post(target, ir);
    };
  }
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [fake],
    agent: () => new FakeAgent(),
    store: { concurrency: "serial" },
  });
  const log: string[] = [];
  const outcome: { error?: unknown; value?: unknown } = {};
  let clicks = 0;
  channel.onMention(async ({ thread }) => {
    try {
      outcome.value = await thread.awaitChoice(
        Actions({
          children: [
            Button({
              value: { ok: true },
              onClick: () => {
                clicks++;
              },
              children: "OK",
            }),
          ],
        }),
        options,
      );
    } catch (err) {
      outcome.error = err;
    }
    log.push("choice settled");
  });
  channel.onMessage(async () => {
    log.push("next turn ran");
  });
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  fake.emitTurn({ userText: "go", conversationKey: "c1", actor: alice });
  await flush();
  // A second turn in the same conversation queues behind the pending choice.
  fake.emitTurn({
    userText: "anyone there?",
    conversationKey: "c1",
    actor: alice,
    operation: {
      kind: "created",
      logicalMessageId: "m2",
      revisionId: "m2",
      mentioned: false,
    },
  });
  await flush();
  return { fake, log, outcome, clicks: () => clicks };
}

describe("awaitChoice timeout and abort", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it("times out after the default timeout and frees the turn", async () => {
    const { log, outcome } = await start();
    expect(log).toEqual([]);

    await vi.advanceTimersByTimeAsync(DEFAULT_AWAIT_CHOICE_TIMEOUT_MS - 1);
    expect(log).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.error).toMatchObject({ code: "channel_choice_timeout" });
    expect(log).toEqual(["choice settled", "next turn ran"]);
  });

  it("honours a per-call timeout, after which the picker no longer answers or runs", async () => {
    const { fake, log, outcome, clicks } = await start({ timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outcome.error).toMatchObject({ code: "channel_choice_timeout" });
    expect(log).toEqual(["choice settled", "next turn ran"]);

    fake.emitInteraction({
      id: buttonIds(fake.posted[0]!)[0]!,
      conversationKey: "c1",
      actor: alice,
    });
    await flush();
    expect(outcome.value).toBeUndefined();
    expect(clicks()).toBe(0);
  });

  it("settles when its signal aborts", async () => {
    const controller = new AbortController();
    const { log, outcome } = await start({ signal: controller.signal });
    controller.abort(new Error("user cancelled"));
    await flush();
    expect(outcome.error).toMatchObject({ code: "channel_choice_aborted" });
    expect((outcome.error as Error).cause).toMatchObject({
      message: "user cancelled",
    });
    expect(log).toEqual(["choice settled", "next turn ran"]);
  });

  it("still resolves from a click before the timeout", async () => {
    const { fake, log, outcome } = await start({ timeoutMs: 1_000 });
    fake.emitInteraction({
      id: buttonIds(fake.posted[0]!)[0]!,
      conversationKey: "c1",
      actor: alice,
    });
    await flush();
    expect(outcome.value).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(outcome.error).toBeUndefined();
    expect(log).toEqual(["choice settled", "next turn ran"]);
  });
  it("settles when its signal aborts while the picker is being posted", async () => {
    const controller = new AbortController();
    const { log, outcome } = await start(
      { signal: controller.signal },
      { duringPost: () => controller.abort(new Error("cancelled mid-post")) },
    );
    expect(outcome.error).toMatchObject({ code: "channel_choice_aborted" });
    expect((outcome.error as Error).cause).toMatchObject({
      message: "cancelled mid-post",
    });
    expect(log).toEqual(["choice settled", "next turn ran"]);
  });

  it("rejects a finite timeout longer than a timer can hold, without posting", async () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const { fake, log, outcome } = await start({ timeoutMs: thirtyDays });
    expect(outcome.error).toBeInstanceOf(RangeError);
    expect((outcome.error as Error).message).toContain("2147483647");
    expect(fake.posted).toHaveLength(0);
    expect(log).toEqual(["choice settled", "next turn ran"]);
  });

  it("accepts the largest timeout a timer can hold", async () => {
    const { log, outcome } = await start({ timeoutMs: 2_147_483_647 });
    await vi.advanceTimersByTimeAsync(2_147_483_646);
    expect(outcome.error).toBeUndefined();
    expect(log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.error).toMatchObject({ code: "channel_choice_timeout" });
  });
});
