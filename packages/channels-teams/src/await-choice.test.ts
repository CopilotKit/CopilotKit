import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel, FakeAdapter } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { ProviderActor, Renderable } from "@copilotkit/channels-ui";
import { renderAdaptiveCard } from "./render/adaptive-card.js";
import { parseCardAction } from "./interaction.js";

/**
 * `thread.awaitChoice` with Teams' own card encoding: the picker is rendered by
 * the real Adaptive Card renderer, and a click is decoded by the real
 * `Action.Submit` parser before it reaches the channel. Only the transport is
 * faked.
 */

const PENDING = Symbol("pending");
const alice: ProviderActor = { id: "29:alice", kind: "human" };
const activeChannels: Channel[] = [];

const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

interface SubmitAction {
  type: string;
  title?: string;
  data?: Record<string, unknown>;
}

/** Every `Action.Submit` on the card rendered for posted message `index`. */
function submitActions(fake: FakeAdapter, index: number): SubmitAction[] {
  const card = renderAdaptiveCard(fake.posted[index]!) as {
    actions?: SubmitAction[];
  };
  return (card.actions ?? []).filter((a) => a.type === "Action.Submit");
}

/**
 * Click `action` the way Teams delivers it: a Message activity whose `value`
 * is the action's `data`, decoded by the adapter's own parser. A submit the
 * parser does not recognize never reaches the channel (the adapter treats it
 * as an ordinary message).
 */
function click(
  fake: FakeAdapter,
  action: SubmitAction,
  opts: { actor: ProviderActor; conversationKey?: string; messageId: string },
): boolean {
  const conversationKey = opts.conversationKey ?? "conv-1";
  const parsed = parseCardAction({
    value: action.data,
    conversation: { id: conversationKey },
  });
  if (!parsed) return false;
  fake.emitInteraction({
    id: parsed.id,
    value: parsed.value,
    conversationKey,
    platform: "teams",
    actor: opts.actor,
    messageRef: { id: opts.messageId },
  });
  return true;
}

async function startPicker(
  picker: () => Renderable,
  before?: (post: (ui: Renderable) => Promise<unknown>) => Promise<void>,
) {
  const fake = new FakeAdapter({ platform: "teams" });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [fake],
  });
  const state = { chosen: PENDING as unknown };
  channel.onMention(async ({ thread }) => {
    if (before) await before((ui) => thread.post(ui));
    state.chosen = await thread.awaitChoice(picker());
  });
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  fake.emitTurn({
    userText: "go",
    conversationKey: "conv-1",
    platform: "teams",
    actor: alice,
  });
  await tick();
  return { fake, state };
}

describe("Teams awaitChoice", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it("resolves from a value-only button (which carries no handler of its own)", async () => {
    const { fake, state } = await startPicker(() =>
      Actions({
        children: [Button({ value: { approved: true }, children: "Approve" })],
      }),
    );
    const [approve] = submitActions(fake, 0);

    expect(click(fake, approve!, { actor: alice, messageId: "msg-1" })).toBe(
      true,
    );
    await tick();
    expect(state.chosen).toEqual({ approved: true });
  });

  it("is answered only by the picker's own button, not an earlier one with the same value", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const value = { approved: true };
    const { fake, state } = await startPicker(
      () => Actions({ children: [Button({ value, children: "Approve" })] }),
      async (post) => {
        await post(Actions({ children: [Button({ value, children: "Old" })] }));
      },
    );
    const [old] = submitActions(fake, 0);
    const [own] = submitActions(fake, 1);

    // A value-only button outside a picker carries no ckActionId, so the
    // adapter never routes it as an interaction at all.
    expect(click(fake, old!, { actor: alice, messageId: "msg-1" })).toBe(false);
    await tick();
    expect(state.chosen).toBe(PENDING);

    expect(click(fake, own!, { actor: alice, messageId: "msg-2" })).toBe(true);
    await tick();
    expect(state.chosen).toEqual(value);
  });
});
