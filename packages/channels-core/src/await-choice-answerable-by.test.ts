import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import { DEFAULT_AWAIT_CHOICE_ANSWERABLE_BY } from "./thread.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Actions, Button, Select } from "@copilotkit/channels-ui";
import type {
  AwaitChoiceOptions,
  ChannelNode,
  ProviderActor,
  Renderable,
} from "@copilotkit/channels-ui";

/**
 * `awaitChoice({ answerableBy })`: who may answer a picker. `"initiator"`
 * (the default) is only the actor who started the turn; `"conversation"` is
 * anyone in the same conversation, still only through the picker's own
 * controls and options.
 */

const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const alice: ProviderActor = { id: "U_ALICE", kind: "human" };
const bob: ProviderActor = { id: "U_BOB", kind: "human" };
const PENDING = Symbol("pending");
const activeChannels: Channel[] = [];

function refId(node: ChannelNode, prop: string): string {
  return (node.props[prop] as { id: string }).id;
}

function controls(nodes: readonly ChannelNode[], type: string): ChannelNode[] {
  const out: ChannelNode[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null || !("props" in value)) {
      return;
    }
    const node = value as ChannelNode;
    if (node.type === type) out.push(node);
    for (const propValue of Object.values(node.props)) visit(propValue);
  };
  visit(nodes);
  return out;
}

async function startPicker(picker: Renderable, options?: AwaitChoiceOptions) {
  const fake = new FakeAdapter();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [fake],
    agent: () => new FakeAgent(),
  });
  const state = { chosen: PENDING as unknown };
  channel.onMention(async ({ thread }) => {
    state.chosen = await thread.awaitChoice(picker, options);
  });
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  fake.emitTurn({ userText: "go", conversationKey: "c1", actor: alice });
  await tick();
  return { fake, state, posted: fake.posted.at(-1)! };
}

const approve = () =>
  Actions({
    children: [Button({ value: { approved: true }, children: "Approve" })],
  });

describe("awaitChoice answerableBy", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it('defaults to "initiator"', () => {
    expect(DEFAULT_AWAIT_CHOICE_ANSWERABLE_BY).toBe("initiator");
  });

  it('"conversation" lets anyone in the conversation answer', async () => {
    const { fake, state, posted } = await startPicker(approve(), {
      answerableBy: "conversation",
    });
    fake.emitInteraction({
      id: refId(controls(posted, "button")[0]!, "onClick"),
      conversationKey: "c1",
      actor: bob,
    });
    await tick();
    expect(state.chosen).toEqual({ approved: true });
  });

  it('"conversation" still accepts only the picker\'s own controls, options and conversation', async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fake, state, posted } = await startPicker(
      Actions({
        children: [
          Select({
            placeholder: "Pick",
            options: [
              { label: "A", value: "a" },
              { label: "B", value: "b" },
            ],
          }),
        ],
      }),
      { answerableBy: "conversation" },
    );
    const selectId = refId(controls(posted, "select")[0]!, "onSelect");
    fake.emitInteraction({
      id: "select",
      conversationKey: "c1",
      actor: bob,
      value: "a",
    });
    fake.emitInteraction({
      id: selectId,
      conversationKey: "c1",
      actor: bob,
      value: "z",
    });
    fake.emitInteraction({
      id: selectId,
      conversationKey: "c2",
      actor: bob,
      value: "a",
    });
    await tick();
    expect(state.chosen).toBe(PENDING);

    fake.emitInteraction({
      id: selectId,
      conversationKey: "c1",
      actor: bob,
      value: "b",
    });
    await tick();
    expect(state.chosen).toBe("b");
  });

  it('"initiator" refuses anyone else', async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fake, state, posted } = await startPicker(approve(), {
      answerableBy: "initiator",
    });
    const id = refId(controls(posted, "button")[0]!, "onClick");
    fake.emitInteraction({ id, conversationKey: "c1", actor: bob });
    await tick();
    expect(state.chosen).toBe(PENDING);
    fake.emitInteraction({ id, conversationKey: "c1", actor: alice });
    await tick();
    expect(state.chosen).toEqual({ approved: true });
  });
});
