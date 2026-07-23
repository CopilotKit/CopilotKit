import { describe, it, expect } from "vitest";
import { emoji } from "@copilotkit/channels-ui";
import { decodeReaction } from "../interaction.js";
import { DiscordAdapter } from "../adapter.js";
import { FakeDiscordConnector } from "../testing/fake-discord-connector.js";

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
    const adapter = new DiscordAdapter({});
    const connector = new FakeDiscordConnector();
    adapter.ɵbindConnector(connector);
    return { adapter, connector };
  }

  const target = { channelId: "C1" };
  const messageRef = { id: "M1", channelId: "C1" };

  it("addReaction resolves thumbs_up to 👍 and calls the connector", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.addReaction!(target, messageRef, "thumbs_up");
    expect(res).toEqual({ ok: true });
    expect(connector.calls[0]).toMatchObject({
      op: "addReaction",
      args: { channelId: "C1", messageId: "M1", emoji: "👍" },
    });
  });

  it("addReaction passes unknown emoji through raw", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.addReaction!(
      target,
      messageRef,
      "some_custom_emoji" as any,
    );
    expect(res).toEqual({ ok: true });
    expect((connector.calls[0]!.args as { emoji: string }).emoji).toBe(
      "some_custom_emoji",
    );
  });

  it("removeReaction routes to the connector with the resolved channel/message/emoji", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.removeReaction!(target, messageRef, "thumbs_up");
    expect(res).toEqual({ ok: true });
    expect(connector.calls[0]).toMatchObject({
      op: "removeReaction",
      args: { channelId: "C1", messageId: "M1", emoji: "👍" },
    });
  });

  it("removeReaction resolves emoji.heart to its Discord-ready token", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.removeReaction!(target, messageRef, emoji.heart);
    expect(res).toEqual({ ok: true });
    expect(connector.calls[0]!.op).toBe("removeReaction");
  });

  it("falls back to the target channel when the reacted ref has no channelId", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.addReaction!(
      target,
      { id: "M1" } as any, // no channelId — parity with the bot-ui example payload
      "eyes",
    );
    expect(res).toEqual({ ok: true });
    expect((connector.calls[0]!.args as { channelId: string }).channelId).toBe(
      "C1",
    );
  });
});
