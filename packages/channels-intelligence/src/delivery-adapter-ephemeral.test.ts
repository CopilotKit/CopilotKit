import { describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "@copilotkit/channels-core";
import { DeliveryAdapter } from "./delivery-adapter.js";
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

function delivery(
  overrides: {
    adapter?: "slack" | "teams";
    /** A turn Intelligence could not attribute to a person. */
    anonymous?: boolean;
  } = {},
): PreparedChannelDelivery {
  const { adapter: platform = "slack", anonymous = false } = overrides;
  const externalUserId = anonymous ? undefined : "U9999999999";
  return {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_ephemeral_01",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_support",
    channelName: "support",
    canonicalThreadId: "thread_ephemeral",
    appUserId: `${platform}:user-1`,
    adapter: platform,
    turn: {
      eventId: "evt_ephemeral",
      receivedAt: "2026-07-29T17:00:00.000Z",
      ...(externalUserId ? { actor: { externalUserId } } : {}),
      input: {
        kind: "text",
        text: "connect gmail",
        messageRef: { id: "pref_v1_message_ephemeral_1" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: true,
        },
      },
    },
  } as PreparedChannelDelivery;
}

describe("DeliveryAdapter ephemeral posts", () => {
  it("posts to this turn's own recipient and returns no message ref", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;
    const managed = adapter() as PlatformAdapter;

    await expect(
      managed.postEphemeral?.(
        { claimedDelivery: session, delivery: delivery() },
        "U9999999999",
        [{ type: "text", props: { value: "Only you can see this" } }],
        { fallbackToDM: true },
      ),
    ).resolves.toEqual({ ok: true, usedFallback: false });

    expect(effect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: "slack.message.ephemeral",
        user: "U9999999999",
        text: "Only you can see this",
      }),
    );
  });

  it("refuses a recipient this turn does not belong to", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;
    const managed = adapter() as PlatformAdapter;

    // The boundary would refuse it anyway — it posts to its own fenced
    // recipient — so failing here just names the user that was expected.
    await expect(
      managed.postEphemeral?.(
        { claimedDelivery: session, delivery: delivery() },
        "U1111111111",
        [{ type: "text", props: { value: "Only you can see this" } }],
        { fallbackToDM: true },
      ),
    ).resolves.toMatchObject({ ok: false });
    expect(effect).not.toHaveBeenCalled();
  });

  it("refuses a turn with no identified recipient", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;
    const managed = adapter() as PlatformAdapter;

    await expect(
      managed.postEphemeral?.(
        {
          claimedDelivery: session,
          delivery: delivery({ anonymous: true }),
        },
        "U9999999999",
        [{ type: "text", props: { value: "Only you can see this" } }],
        { fallbackToDM: true },
      ),
    ).resolves.toMatchObject({ ok: false });
    expect(effect).not.toHaveBeenCalled();
  });

  it("declines on Teams, where there is no private message to send", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;
    const managed = adapter() as PlatformAdapter;

    // `null` is the contract's "native unsupported" answer, which is what makes
    // a caller's DM fallback kick in rather than posting to the channel.
    await expect(
      managed.postEphemeral?.(
        {
          claimedDelivery: session,
          delivery: delivery({ adapter: "teams" }),
        },
        "29:teams-user",
        [{ type: "text", props: { value: "Only you can see this" } }],
        { fallbackToDM: true },
      ),
    ).resolves.toBeNull();
    expect(effect).not.toHaveBeenCalled();
  });
});
