import { describe, expect, it, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import type { PlatformAdapter } from "@copilotkit/channels-core";
import { emoji } from "@copilotkit/channels-ui";
import type {
  ClaimedChannelDelivery,
  PreparedChannelDelivery,
} from "./delivery-transport.js";

function adapter(): DeliveryAdapter {
  return new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });
}

function delivery(): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_discord_01",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_support",
    channelName: "support",
    canonicalThreadId: "thread_discord",
    appUserId: "discord:guild:user",
    adapter: "discord",
    turn: {
      eventId: "evt_discord",
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: {
        kind: "text",
        text: "hello",
        messageRef: { id: "pref_v1_message_discord_123" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: false,
        },
      },
    },
  };
}

describe("DeliveryAdapter managed Discord", () => {
  it("posts a Discord message.create payload with rendered components", async () => {
    const effect = vi.fn(async () => ({
      providerReference: "pref_v1_discord_message_01",
      providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    }));
    const session = { effect } as unknown as ClaimedChannelDelivery;

    await expect(
      adapter().post({ claimedDelivery: session, delivery: delivery() }, [
        { type: "text", props: { value: "hello from discord" } },
      ]),
    ).resolves.toMatchObject({
      id: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
      providerReference: "pref_v1_discord_message_01",
    });

    expect(effect).toHaveBeenCalledOnce();
    expect(effect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: "discord.message.create",
        text: "hello from discord",
        components: expect.arrayContaining([
          expect.objectContaining({
            components: expect.arrayContaining([
              expect.objectContaining({ content: "hello from discord" }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("replaces a Discord message through discord.message.replace", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;

    await adapter().update(
      {
        id: "pref_v1_discord_message_01",
        responseId: "response_01",
        claimedDelivery: session,
        adapter: "discord",
        providerReference: "pref_v1_discord_message_01",
      },
      [{ type: "text", props: { value: "edited" } }],
    );

    expect(effect).toHaveBeenCalledWith(
      "response_01",
      expect.objectContaining({
        kind: "discord.message.replace",
        providerReference: "pref_v1_discord_message_01",
        text: "edited",
      }),
    );
  });

  it("adds a Discord reaction through an opaque provider reference", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;
    const managed = adapter() as PlatformAdapter;
    const target = { claimedDelivery: session, delivery: delivery() };
    const messageRef = {
      id: "pref_v1_discord_message_01",
      responseId: "response_01",
      claimedDelivery: session,
      adapter: "discord" as const,
      providerReference: "pref_v1_discord_message_01",
    };

    await expect(
      managed.addReaction?.(target, messageRef, emoji.thumbs_up),
    ).resolves.toEqual({ ok: true });
    expect(effect).toHaveBeenCalledWith(expect.any(String), {
      kind: "discord.reaction.add",
      providerReference: "pref_v1_discord_message_01",
      reaction: "👍",
    });
  });

  it("live-edits Discord text with create then replace, never stream packets", async () => {
    const effect = vi.fn(async () => ({
      providerReference: "pref_v1_discord_message_01",
      providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    }));
    const session = { effect } as unknown as ClaimedChannelDelivery;

    async function* chunks() {
      yield "Hel";
      yield "lo";
    }

    await adapter().stream(
      { claimedDelivery: session, delivery: delivery() },
      chunks(),
    );

    expect(effect).toHaveBeenNthCalledWith(1, expect.any(String), {
      kind: "discord.message.create",
      text: "Hel",
    });
    expect(effect).toHaveBeenNthCalledWith(2, expect.any(String), {
      kind: "discord.message.replace",
      providerReference: "pref_v1_discord_message_01",
      text: "Hello",
    });
  });
});
