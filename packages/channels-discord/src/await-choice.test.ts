import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel, FakeAdapter } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import { Actions, Button, Select } from "@copilotkit/channels-ui";
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

/** Every string select rendered for post `index`, as Discord would see it. */
function selectMenus(
  fake: FakeAdapter,
  index: number,
): { customId: string; minValues?: number; maxValues?: number }[] {
  const json = renderDiscordMessage(fake.posted[index]!).components.map((c) =>
    c.toJSON(),
  );
  const menus: { customId: string; minValues?: number; maxValues?: number }[] =
    [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const el = value as {
      type?: unknown;
      custom_id?: unknown;
      min_values?: number;
      max_values?: number;
    };
    // Component type 3 is a string select.
    if (el.type === 3 && typeof el.custom_id === "string") {
      menus.push({
        customId: el.custom_id,
        minValues: el.min_values,
        maxValues: el.max_values,
      });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(json);
  return menus;
}

/** Pick select option value(s) the way discord.js delivers it, through the real decoder. */
function pickSelect(
  fake: FakeAdapter,
  menu: { customId: string; minValues?: number; maxValues?: number },
  values: string[],
  messageId: string,
) {
  const evt = decodeInteraction({
    isButton: () => false,
    isStringSelectMenu: () => true,
    customId: menu.customId,
    values,
    component: { minValues: menu.minValues, maxValues: menu.maxValues },
    channelId: CHANNEL_ID,
    message: { id: messageId },
    user: { id: alice.id, username: "alice" },
  });
  if (!evt) throw new Error("decoder rejected the pick");
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

describe("Discord awaitChoice: option values the decoder would parse as JSON", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  const tricky = ["9.90", "null", "1e2", " true "];
  const picker = (offered: string, multi: boolean) => () =>
    Actions({
      children: [
        Select({
          placeholder: "Pick",
          multi,
          options: [
            { label: "Other", value: "other" },
            { label: "Tricky", value: offered },
          ],
        }),
      ],
    });

  it.each(tricky)(
    "single select answers with the offered option %j",
    async (offered) => {
      const { fake, state } = await startPicker(picker(offered, false));
      const [menu] = selectMenus(fake, 0);
      pickSelect(fake, menu!, [offered], "msg-1");
      await tick();
      expect(state.chosen).toBe(offered);
    },
  );

  it.each(tricky)(
    "multi select answers with the offered option %j",
    async (offered) => {
      const { fake, state } = await startPicker(picker(offered, true));
      const [menu] = selectMenus(fake, 0);
      pickSelect(fake, menu!, ["other", offered], "msg-1");
      await tick();
      expect(state.chosen).toEqual(["other", offered]);
    },
  );

  it("tells apart two options whose values decode to the same JSON", async () => {
    const { fake, state } = await startPicker(() =>
      Actions({
        children: [
          Select({
            placeholder: "Pick",
            options: [
              { label: "Short", value: "9.9" },
              { label: "Long", value: "9.90" },
            ],
          }),
        ],
      }),
    );
    const [menu] = selectMenus(fake, 0);
    pickSelect(fake, menu!, ["9.90"], "msg-1");
    await tick();
    expect(state.chosen).toBe("9.90");
  });

  it("still refuses a single-select value the picker does not offer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fake, state } = await startPicker(picker("9.90", false));
    const [menu] = selectMenus(fake, 0);
    // "9.9" decodes to the same number as the offered "9.90" but is not offered.
    pickSelect(fake, menu!, ["9.9"], "msg-1");
    await tick();
    expect(state.chosen).toBe(PENDING);
  });

  it("still refuses a multi-select value the picker does not offer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fake, state } = await startPicker(picker("true", true));
    const [menu] = selectMenus(fake, 0);
    // " true " decodes to the same boolean as the offered "true" but is not offered.
    pickSelect(fake, menu!, ["other", " true "], "msg-1");
    await tick();
    expect(state.chosen).toBe(PENDING);
  });
});
