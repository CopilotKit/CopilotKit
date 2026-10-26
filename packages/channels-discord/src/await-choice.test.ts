import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel, FakeAdapter } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { ProviderActor, Renderable } from "@copilotkit/channels-ui";
import { renderDiscordMessage } from "./render/components-v2.js";
import { decodeInteraction } from "./interaction.js";

/**
 * `thread.awaitChoice` with Discord's own component encoding: posts are
 * rendered by the real Components V2 renderer and clicks decoded by the real
 * interaction decoder. Only the transport is faked.
 */

const PENDING = Symbol("pending");
const CHANNEL_ID = "1100000000000000001";
const alice: ProviderActor = { id: "2200000000000000001", kind: "human" };
const activeChannels: Channel[] = [];

const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Every button `custom_id` on the components rendered for post `index`. */
function buttonCustomIds(fake: FakeAdapter, index: number): string[] {
  const json = renderDiscordMessage(fake.posted[index]!).components.map((c) =>
    c.toJSON(),
  );
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const el = value as { type?: unknown; custom_id?: unknown };
    // Component type 2 is a button.
    if (el.type === 2 && typeof el.custom_id === "string") {
      ids.push(el.custom_id);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(json);
  return ids;
}

/** Click a button the way discord.js delivers it, through the real decoder. */
function clickButton(fake: FakeAdapter, customId: string, messageId: string) {
  const evt = decodeInteraction({
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId,
    channelId: CHANNEL_ID,
    message: { id: messageId },
    user: { id: alice.id, username: "alice" },
  });
  if (!evt) throw new Error("decoder rejected the click");
  fake.emitInteraction({ ...evt, platform: "discord" });
}

async function startPicker(
  picker: () => Renderable,
  before?: (post: (ui: Renderable) => Promise<unknown>) => Promise<void>,
) {
  const fake = new FakeAdapter({ platform: "discord" });
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
    conversationKey: CHANNEL_ID,
    platform: "discord",
    actor: alice,
  });
  await tick();
  return { fake, state };
}

describe("Discord awaitChoice", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it("is answered only by the picker's own button, not an earlier value-only one", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const value = { approved: true };
    const { fake, state } = await startPicker(
      () => Actions({ children: [Button({ value, children: "Approve" })] }),
      async (post) => {
        await post(Actions({ children: [Button({ value, children: "Old" })] }));
      },
    );
    const [oldId] = buttonCustomIds(fake, 0);
    const [ownId] = buttonCustomIds(fake, 1);
    expect(oldId).toBe(`v:${JSON.stringify(value)}`);
    expect(ownId).not.toBe(oldId);

    clickButton(fake, oldId!, "msg-1");
    await tick();
    expect(state.chosen).toBe(PENDING);

    clickButton(fake, ownId!, "msg-2");
    await tick();
    expect(state.chosen).toEqual(value);
  });
});
