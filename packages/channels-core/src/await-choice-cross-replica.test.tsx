import { Actions, Button } from "@copilotkit/channels-ui";
import type { ChannelNode, ProviderActor } from "@copilotkit/channels-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionSnapshot } from "./action-store.js";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import { MemoryStore } from "./state/memory-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

/**
 * Replicas share the action store but not their in-process picker state, so a
 * click can reach a process that never posted the picker.
 */

const alice: ProviderActor = { id: "U_ALICE", kind: "human" };
const bob: ProviderActor = { id: "U_BOB", kind: "human" };

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

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

async function startReplicas(answerableBy?: "initiator" | "conversation") {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const shared = new MemoryStore();
  const clicks: string[] = [];
  const answers: unknown[] = [];

  function Picker() {
    return (
      <Actions>
        <Button
          value="go"
          onClick={({ actor }) => {
            clicks.push(actor.id);
          }}
        >
          Go
        </Button>
      </Actions>
    );
  }

  const replica = async () => {
    const fake = new FakeAdapter({ nativeEphemeral: true });
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
      components: [Picker],
      store: { adapter: shared },
    });
    channel.onMention(async ({ thread }) => {
      answers.push(
        await thread.awaitChoice(
          <Picker />,
          answerableBy ? { answerableBy } : {},
        ),
      );
    });
    await channel.ɵruntime.start();
    activeChannels.push(channel);
    return fake;
  };

  const a = await replica();
  const b = await replica();
  a.emitTurn({ userText: "deploy", conversationKey: "c1", actor: alice });
  await tick();
  const id = buttonId(a.posted[0]!);
  return { a, b, id, shared, clicks, answers };
}

describe("awaitChoice across replicas", () => {
  it("refuses a non-owner on the other replica and leaves the picker pending", async () => {
    const { a, b, id, clicks, answers } = await startReplicas();

    b.emitInteraction({ id, conversationKey: "c1", actor: bob });
    await tick();

    expect(clicks).toEqual([]);
    expect(b.ephemeralPosts).toMatchObject([{ user: { id: bob.id } }]);

    a.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();
    expect(clicks).toEqual([alice.id]);
    expect(answers).toEqual(["go"]);
  });

  it("runs the handler for the owner on the other replica", async () => {
    const { b, id, clicks } = await startReplicas();

    b.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();

    expect(clicks).toEqual([alice.id]);
  });

  it("writes the owner before the picker is posted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const shared = new MemoryStore();
    const owners: unknown[] = [];
    class ReadingAdapter extends FakeAdapter {
      override async post(target: unknown, ir: ChannelNode[]) {
        const key = `action:${buttonId(ir)}`;
        owners.push((await shared.kv.get<ActionSnapshot>(key))?.ownerActorId);
        return super.post(target, ir);
      }
    }
    const fake = new ReadingAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
      store: { adapter: shared },
    });
    channel.onMention(async ({ thread }) => {
      await thread.awaitChoice(
        Actions({
          children: [
            Button({ value: "go", onClick: () => {}, children: "Go" }),
          ],
        }),
      );
    });
    await channel.ɵruntime.start();
    activeChannels.push(channel);

    fake.emitTurn({ userText: "deploy", conversationKey: "c1", actor: alice });
    await tick();

    expect(owners).toEqual([alice.id]);
  });

  it("stores no owner on a picker anyone may answer", async () => {
    const { b, id, shared, clicks } = await startReplicas("conversation");

    const snap = await shared.kv.get<ActionSnapshot>(`action:${id}`);
    expect(snap).toBeDefined();
    expect(snap).not.toHaveProperty("ownerActorId");

    b.emitInteraction({ id, conversationKey: "c1", actor: bob });
    await tick();
    expect(clicks).toEqual([bob.id]);
  });

  it("leaves a snapshot stored without an owner clickable, like any action", async () => {
    const { b, id, shared, clicks } = await startReplicas();
    const key = `action:${id}`;
    const { ownerActorId, ...stored } =
      (await shared.kv.get<ActionSnapshot>(key))!;
    expect(ownerActorId).toBe(alice.id);
    await shared.kv.set(key, stored);

    b.emitInteraction({ id, conversationKey: "c1", actor: bob });
    await tick();

    expect(clicks).toEqual([bob.id]);
  });
});
