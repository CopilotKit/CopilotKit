import { describe, it, expect } from "vitest";
import { buildChannelRouteContext } from "../channel-preflight";
import type { ChannelDeliveryEnvelope } from "../channel-preflight";

const base = {
  turnId: "turn-1",
  eventId: "evt-1",
  channelName: "support",
  platform: "slack",
  conversationKey: "C1:U1",
  user: { id: "U1", displayName: "Ada" },
} as const;

describe("buildChannelRouteContext", () => {
  it("maps a turn envelope to a message route event", () => {
    const env: ChannelDeliveryEnvelope = { ...base, kind: "turn", text: "hi" };
    const signal = new AbortController().signal;

    const ctx = buildChannelRouteContext(env, signal);

    expect(ctx.channelName).toBe("support");
    expect(ctx.platform).toBe("slack");
    expect(ctx.turnId).toBe("turn-1");
    expect(ctx.conversation.key).toBe("C1:U1");
    expect(ctx.event).toEqual({
      kind: "message",
      text: "hi",
      mentioned: false,
    });
    expect(ctx.signal).toBe(signal);
  });

  it("maps a command envelope to a command route event", () => {
    const env: ChannelDeliveryEnvelope = {
      ...base,
      kind: "command",
      command: "deploy",
      text: "prod --force",
    };

    const ctx = buildChannelRouteContext(env, new AbortController().signal);

    expect(ctx.event).toEqual({
      kind: "command",
      name: "deploy",
      args: "prod --force",
    });
  });

  it("maps an interaction envelope to an interaction route event", () => {
    const env: ChannelDeliveryEnvelope = {
      ...base,
      kind: "interaction",
      actionId: "approve",
      value: "yes",
    };

    const ctx = buildChannelRouteContext(env, new AbortController().signal);

    expect(ctx.event).toEqual({
      kind: "interaction",
      actionId: "approve",
      value: "yes",
    });
  });

  it("maps a reaction envelope to a reaction route event", () => {
    const env: ChannelDeliveryEnvelope = {
      ...base,
      kind: "reaction",
      rawEmoji: "eyes",
    };

    const ctx = buildChannelRouteContext(env, new AbortController().signal);

    expect(ctx.event).toEqual({ kind: "reaction", name: "eyes" });
  });

  it("maps a thread_started envelope to a thread_start route event", () => {
    const env: ChannelDeliveryEnvelope = { ...base, kind: "thread_started" };

    const ctx = buildChannelRouteContext(env, new AbortController().signal);

    expect(ctx.event).toEqual({ kind: "thread_start" });
  });

  it("maps the bounded user, mapping displayName to name", () => {
    const env: ChannelDeliveryEnvelope = { ...base, kind: "turn", text: "hi" };

    const ctx = buildChannelRouteContext(env, new AbortController().signal);

    expect(ctx.user).toEqual({ id: "U1", name: "Ada" });
  });

  it("omits the user when the envelope carries none", () => {
    const env: ChannelDeliveryEnvelope = {
      turnId: "t",
      channelName: "support",
      platform: "slack",
      conversationKey: "C1",
      kind: "turn",
      text: "hi",
    };

    const ctx = buildChannelRouteContext(env, new AbortController().signal);

    expect(ctx.user).toBeUndefined();
  });

  it("defaults conversation.kind to direct_message (A9: no envelope source yet)", () => {
    const env: ChannelDeliveryEnvelope = { ...base, kind: "turn", text: "hi" };

    const ctx = buildChannelRouteContext(env, new AbortController().signal);

    expect(ctx.conversation.kind).toBe("direct_message");
  });
});
