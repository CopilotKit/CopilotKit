import { describe, it, expect } from "vitest";
import { decideChannelResponse } from "@copilotkit/channels-core";
import { classifyConversation, wasBotMentioned } from "./ingress-normalize.js";
import type { Activity } from "@microsoft/agents-activity";

/**
 * Proves the Teams ingress wiring (plan §2): `classifyConversation` produces
 * the `conversationKind` + `mentioned` the REAL `decideChannelResponse`
 * (channels-core, already unit-tested there) needs to make the correct
 * ignore / handler / auto-run call.
 */

function activity(overrides: Record<string, unknown>): Activity {
  return {
    recipient: { id: "bot-1" },
    conversation: {},
    entities: [],
    ...overrides,
  } as unknown as Activity;
}

describe("wasBotMentioned", () => {
  it("is true when a mention entity targets the bot's recipient id", () => {
    const a = activity({
      entities: [{ type: "mention", mentioned: { id: "bot-1" } }],
    });
    expect(wasBotMentioned(a)).toBe(true);
  });

  it("is false when no mention entity is present", () => {
    expect(wasBotMentioned(activity({}))).toBe(false);
  });

  it("is false when a mention entity targets someone else", () => {
    const a = activity({
      entities: [{ type: "mention", mentioned: { id: "someone-else" } }],
    });
    expect(wasBotMentioned(a)).toBe(false);
  });

  it("is false when the activity carries no recipient id", () => {
    const a = activity({
      recipient: undefined,
      entities: [{ type: "mention", mentioned: { id: "bot-1" } }],
    });
    expect(wasBotMentioned(a)).toBe(false);
  });
});

describe("classifyConversation", () => {
  it("personal chat → direct_message, mentioned:false", () => {
    const a = activity({ conversation: { conversationType: "personal" } });
    expect(classifyConversation(a)).toEqual({
      conversationKind: "direct_message",
      mentioned: false,
    });
  });

  it("no conversationType (local Playground) → direct_message", () => {
    const a = activity({ conversation: {} });
    expect(classifyConversation(a)).toEqual({
      conversationKind: "direct_message",
      mentioned: false,
    });
  });

  it("top-level channel post with a mention → channel, mentioned:true", () => {
    const a = activity({
      conversation: { conversationType: "channel" },
      entities: [{ type: "mention", mentioned: { id: "bot-1" } }],
    });
    expect(classifyConversation(a)).toEqual({
      conversationKind: "channel",
      mentioned: true,
    });
  });

  it("channel reply (replyToId set) without a mention → thread, mentioned:false", () => {
    const a = activity({
      conversation: { conversationType: "channel" },
      replyToId: "root-1",
    });
    expect(classifyConversation(a)).toEqual({
      conversationKind: "thread",
      mentioned: false,
    });
  });

  it("groupChat → channel (no thread concept)", () => {
    const a = activity({
      conversation: { conversationType: "groupChat" },
      replyToId: "root-1",
    });
    expect(classifyConversation(a)).toEqual({
      conversationKind: "channel",
      mentioned: false,
    });
  });
});

describe("Teams §2 signals → decideChannelResponse", () => {
  it("a tagged channel message auto-runs with no handlers", () => {
    const a = activity({
      conversation: { conversationType: "channel" },
      entities: [{ type: "mention", mentioned: { id: "bot-1" } }],
    });
    const signals = classifyConversation(a);
    expect(
      decideChannelResponse({
        ...signals,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "auto_run" });
  });

  it("an untagged channel message is ignored with no onMessage handler, handled once one is registered", () => {
    const a = activity({ conversation: { conversationType: "channel" } });
    const signals = classifyConversation(a);
    expect(
      decideChannelResponse({
        ...signals,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "ignore" });
    expect(
      decideChannelResponse({
        ...signals,
        hasMentionHandler: false,
        hasMessageHandler: true,
      }),
    ).toEqual({ action: "handler", handler: "message" });
  });

  it("a personal chat auto-runs regardless of handlers", () => {
    const a = activity({ conversation: { conversationType: "personal" } });
    const signals = classifyConversation(a);
    expect(
      decideChannelResponse({
        ...signals,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "auto_run" });
  });
});
