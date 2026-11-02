import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Actions, Button } from "@copilotkit/channels-ui";
import type {
  ChannelNode,
  ProviderActor,
  Renderable,
  Thread,
} from "@copilotkit/channels-ui";

/**
 * The lifecycle of a pending `thread.awaitChoice`: it is registered only once
 * its picker is posted, a newer picker in the same conversation settles it, and
 * a picker handler that throws settles it with that error, once.
 */

const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const alice: ProviderActor = { id: "U_ALICE", kind: "human" };

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

/** Track a promise's outcome without awaiting it. */
function track<T>(p: Promise<T>) {
  const state: {
    status: "pending" | "resolved" | "rejected";
    value?: T;
    error?: unknown;
  } = { status: "pending" };
  p.then(
    (value) => {
      state.status = "resolved";
      state.value = value;
    },
    (error: unknown) => {
      state.status = "rejected";
      state.error = error;
    },
  );
  return state;
}

const activeChannels: Channel[] = [];

async function start(
  handler: (thread: Pick<Thread, "awaitChoice">) => Promise<void>,
) {
  const fake = new FakeAdapter();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [fake],
    agent: () => new FakeAgent(),
  });
  channel.onMention(async ({ thread }) => handler(thread));
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  fake.emitTurn({ userText: "go", conversationKey: "c1", actor: alice });
  await tick();
  return fake;
}

const picker = (label: string, onClick?: () => void): Renderable =>
  Actions({
    children: [Button({ value: { label }, onClick, children: label })],
  });

describe("awaitChoice lifecycle", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it("settles an earlier pending choice when a newer one is posted in the same conversation", async () => {
    let first!: ReturnType<typeof track>;
    let second!: ReturnType<typeof track>;
    const fake = await start(async (thread) => {
      first = track(thread.awaitChoice(picker("first")));
      await tick();
      second = track(thread.awaitChoice(picker("second")));
    });
    await tick();

    expect(first.status).toBe("rejected");
    expect(first.error).toMatchObject({ code: "channel_choice_superseded" });

    // The superseded picker's control no longer answers anything.
    fake.emitInteraction({
      id: buttonIds(fake.posted[0]!)[0]!,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(second.status).toBe("pending");

    fake.emitInteraction({
      id: buttonIds(fake.posted[1]!)[0]!,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(second.status).toBe("resolved");
    expect(second.value).toEqual({ label: "second" });
  });

  it("leaves no pending choice behind when posting the picker fails", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const clicks: string[] = [];
    let failed: ReturnType<typeof track> | undefined;
    const fake = new FakeAdapter();
    const realPost = fake.post.bind(fake);
    let failNext = true;
    fake.post = async (target, ir) => {
      if (failNext) {
        failNext = false;
        throw new Error("provider rejected the message");
      }
      return realPost(target, ir);
    };
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    channel.onMention(async ({ thread }) => {
      const lost = thread.awaitChoice(picker("lost"));
      failed = track(lost);
      await lost.catch(() => undefined);
      await thread.post(picker("card", () => clicks.push("card")));
    });
    await channel.ɵruntime.start();
    activeChannels.push(channel);
    fake.emitTurn({ userText: "go", conversationKey: "c1", actor: alice });
    await tick();

    expect(failed!.status).toBe("rejected");
    fake.emitInteraction({
      id: buttonIds(fake.posted[0]!)[0]!,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(clicks).toEqual(["card"]);
    // No orphaned picker is waiting in the conversation.
    expect(
      debug.mock.calls.some((c) => String(c[0]).includes("awaitChoice")),
    ).toBe(false);
  });

  it("settles the choice with the error when the picker's handler throws, and does not run it again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    let choice!: ReturnType<typeof track>;
    const fake = await start(async (thread) => {
      choice = track(
        thread.awaitChoice(
          picker("explode", () => {
            runs++;
            throw new Error("handler failed");
          }),
        ),
      );
    });
    const id = buttonIds(fake.posted[0]!)[0]!;
    const sink = fake.getSink();

    await expect(
      sink.onInteraction({
        id,
        conversationKey: "c1",
        replyTarget: {},
        actor: alice,
        identityContext: undefined as never,
      }),
    ).rejects.toThrow("handler failed");
    await tick();
    expect(choice.status).toBe("rejected");
    expect(choice.error).toMatchObject({ message: "handler failed" });

    fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();
    expect(runs).toBe(1);
  });
});
