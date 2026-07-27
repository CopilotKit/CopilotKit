import { describe, it, expect, vi } from "vitest";
import { emoji } from "@copilotkit/channels-ui";
import { decodeReaction } from "../interaction.js";
import { DiscordAdapter } from "../adapter.js";

it("decodes a unicode reaction add", () => {
  const evt = decodeReaction(
    {
      emoji: { name: "👍", id: null },
      message: { id: "m1", channelId: "C1", guildId: "G1" },
    },
    { id: "U1", username: "ada", bot: false },
    true,
  );
  expect(evt).toMatchObject({
    rawEmoji: "👍",
    added: true,
    user: { id: "U1", name: "ada" },
    conversationKey: "C1",
    messageId: "m1",
    replyTarget: { channelId: "C1", guildId: "G1" },
  });
});

it("encodes a custom emoji as name:id passthrough", () => {
  const evt = decodeReaction(
    {
      emoji: { name: "blob", id: "999" },
      message: { id: "m2", channelId: "C2" },
    },
    { id: "U2", bot: false },
    false,
  );
  expect(evt!.rawEmoji).toBe("blob:999");
  expect(evt!.added).toBe(false);
});

describe("addReaction / removeReaction egress", () => {
  function makeAdapter() {
    const botId = "BOT1";
    const react = vi.fn().mockResolvedValue(undefined);
    const removeUser = vi.fn().mockResolvedValue(undefined);
    const msg = {
      react,
      reactions: {
        cache: new Map([
          ["👍", { users: { remove: removeUser } }],
          ["custom", { users: { remove: removeUser } }],
          // Discord keys hearts by the BARE codepoint (no trailing U+FE0F).
          ["❤", { users: { remove: removeUser } }],
        ]),
      },
    };
    const client = {
      user: { id: botId },
      channels: {
        fetch: vi.fn().mockResolvedValue({
          id: "C1",
          send: vi.fn(),
          messages: {
            fetch: vi.fn().mockResolvedValue(msg),
          },
        }),
      },
    };
    const adapter = new DiscordAdapter(
      { botToken: "t", appId: "app" },
      { client: client as any },
    );
    return { adapter, react, removeUser, botId, msg };
  }

  const target = { channelId: "C1" };
  const messageRef = { id: "M1", channelId: "C1" };

  it("addReaction resolves thumbs_up to 👍 and calls msg.react", async () => {
    const { adapter, react } = makeAdapter();
    const res = await adapter.addReaction!(target, messageRef, "thumbs_up");
    expect(res).toEqual({ ok: true });
    expect(react).toHaveBeenCalledWith("👍");
  });

  it("addReaction passes unknown emoji through raw", async () => {
    const { adapter, react } = makeAdapter();
    const res = await adapter.addReaction!(
      target,
      messageRef,
      "some_custom_emoji" as any,
    );
    expect(res).toEqual({ ok: true });
    expect(react).toHaveBeenCalledWith("some_custom_emoji");
  });

  it("removeReaction removes the bot's own id via reactions.cache.get(token)?.users.remove", async () => {
    const { adapter, removeUser, botId } = makeAdapter();
    const res = await adapter.removeReaction!(target, messageRef, "thumbs_up");
    expect(res).toEqual({ ok: true });
    expect(removeUser).toHaveBeenCalledWith(botId);
  });

  it("removeReaction finds a reaction cached under the bare (VS16-stripped) codepoint", async () => {
    // `emoji.heart` resolves to the qualified "❤️" (U+2764 U+FE0F), but Discord
    // keys the cache by the bare "❤" (U+2764). A VS16-tolerant lookup must still
    // find the reaction and remove the bot's own id.
    const { adapter, removeUser, botId } = makeAdapter();
    const res = await adapter.removeReaction!(target, messageRef, emoji.heart);
    expect(res).toEqual({ ok: true });
    expect(removeUser).toHaveBeenCalledWith(botId);
  });
});
