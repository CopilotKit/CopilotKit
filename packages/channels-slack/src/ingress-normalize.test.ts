import { describe, it, expect } from "vitest";
import {
  stripMentions,
  deriveEventId,
  isPlainUserMessage,
  normalizeSlackEvent,
} from "./ingress-normalize.js";

describe("stripMentions", () => {
  it("strips <@U…> tokens and collapses whitespace", () => {
    expect(stripMentions("<@U123>   hello   world")).toBe("hello world");
    expect(stripMentions("<@W999> hi")).toBe("hi");
    expect(stripMentions("<@U1>")).toBe("");
  });

  it("strips the labeled <@U…|handle> form without leaving a |handle> fragment", () => {
    expect(stripMentions("<@U123|alice> hello")).toBe("hello");
    expect(stripMentions("<@W999|Bob Smith> hi")).toBe("hi");
    expect(stripMentions("<@U1|x>")).toBe("");
  });
});

describe("deriveEventId", () => {
  it("prefers the Events API envelope event_id", () => {
    expect(deriveEventId({ event_id: "Ev1" }, { ts: "100.1" }, "C1")).toBe(
      "Ev1",
    );
  });
  it("falls back to client_msg_id, then channel:ts, then undefined", () => {
    expect(deriveEventId({}, { client_msg_id: "cm1", ts: "100.1" }, "C1")).toBe(
      "cm1",
    );
    expect(deriveEventId({}, { ts: "100.1" }, "C1")).toBe("C1:100.1");
    expect(deriveEventId({}, {}, "C1")).toBeUndefined();
  });
});

describe("isPlainUserMessage", () => {
  it("accepts a plain user message", () => {
    expect(
      isPlainUserMessage({ channel: "C1", text: "hi", user: "U1" }, "BOT"),
    ).toBe(true);
  });
  it("rejects subtypes (except file_share), bot echoes, and app-only posts", () => {
    expect(
      isPlainUserMessage(
        { channel: "C1", text: "x", subtype: "channel_join" },
        "BOT",
      ),
    ).toBe(false);
    expect(
      isPlainUserMessage({ channel: "C1", text: "x", user: "BOT" }, "BOT"),
    ).toBe(false);
    expect(
      isPlainUserMessage({ channel: "C1", text: "x", bot_id: "B1" }, "BOT"),
    ).toBe(false);
    expect(
      isPlainUserMessage(
        { channel: "C1", text: "x", subtype: "file_share", user: "U1" },
        "BOT",
      ),
    ).toBe(true);
  });
});

describe("normalizeSlackEvent", () => {
  it("maps an app_mention to a turn with stripped text + thread anchor", () => {
    const n = normalizeSlackEvent({
      event_id: "Ev1",
      event: {
        type: "app_mention",
        channel: "C1",
        text: "<@U1> hello",
        user: "U2",
        ts: "100.1",
      },
    });
    expect(n).toEqual({
      kind: "turn",
      source: "app_mention",
      channel: "C1",
      threadTs: "100.1",
      ts: "100.1",
      userText: "hello",
      operation: {
        kind: "created",
        logicalMessageId: "100.1",
        revisionId: "100.1",
        mentioned: true,
      },
      senderUserId: "U2",
      eventId: "Ev1",
      hasFiles: false,
    });
  });

  it("drops an empty mention with no files", () => {
    expect(
      normalizeSlackEvent({
        event: { type: "app_mention", channel: "C1", text: "<@U1>", ts: "1" },
      }),
    ).toBeUndefined();
  });

  it("maps a DM message to a direct_message turn", () => {
    const n = normalizeSlackEvent({
      event_id: "Ev2",
      event: {
        type: "message",
        channel: "D1",
        channel_type: "im",
        text: "hi there",
        user: "U2",
        ts: "100.2",
      },
    });
    expect(n).toMatchObject({
      kind: "turn",
      source: "direct_message",
      channel: "D1",
      userText: "hi there",
      ts: "100.2",
    });
  });

  it("maps a threaded reply to a thread_reply turn with stripped text", () => {
    const n = normalizeSlackEvent({
      event: {
        type: "message",
        channel: "C1",
        text: "<@U1> reply",
        user: "U2",
        ts: "100.3",
        thread_ts: "100.0",
      },
    });
    expect(n).toMatchObject({
      kind: "turn",
      source: "thread_reply",
      threadTs: "100.0",
      userText: "reply",
    });
  });

  it("normalizes the paired message envelope to the same mentioned operation", () => {
    expect(
      normalizeSlackEvent(
        {
          event: {
            type: "message",
            channel: "C1",
            text: "<@BOT> reply",
            user: "U2",
            ts: "100.4",
            thread_ts: "100.0",
          },
        },
        "BOT",
      ),
    ).toMatchObject({
      source: "thread_reply",
      operation: {
        kind: "created",
        logicalMessageId: "100.4",
        revisionId: "100.4",
        mentioned: true,
      },
    });
  });

  it("skips a threaded reply that mentions the bot in the labeled <@U|handle> form", () => {
    expect(
      normalizeSlackEvent(
        {
          event: {
            type: "message",
            channel: "C1",
            text: "<@BOT|assistant> reply",
            user: "U2",
            ts: "100.7",
            thread_ts: "100.0",
          },
        },
        "BOT",
      ),
    ).toMatchObject({ operation: { mentioned: true } });
  });

  it("still delivers a threaded reply that mentions a DIFFERENT user", () => {
    expect(
      normalizeSlackEvent(
        {
          event: {
            type: "message",
            channel: "C1",
            text: "<@U9> reply",
            user: "U2",
            ts: "100.5",
            thread_ts: "100.0",
          },
        },
        "BOT",
      ),
    ).toMatchObject({ source: "thread_reply", userText: "reply" });
  });

  it("strips mention tokens from a DM turn (parity with app_mention/thread_reply)", () => {
    const n = normalizeSlackEvent({
      event: {
        type: "message",
        channel: "D1",
        channel_type: "im",
        text: "<@U1> hi there",
        user: "U2",
        ts: "100.6",
      },
    });
    expect(n).toMatchObject({ source: "direct_message", userText: "hi there" });
  });

  it("accepts top-level ordinary messages and other bots", () => {
    expect(
      normalizeSlackEvent({
        event: {
          type: "message",
          channel: "C1",
          text: "hi",
          user: "U2",
          ts: "1",
        },
      }),
    ).toMatchObject({
      source: "message",
      threadTs: "1",
      operation: { kind: "created", mentioned: false },
    });
    expect(
      normalizeSlackEvent(
        {
          event: {
            type: "message",
            channel: "C1",
            text: "release complete",
            bot_id: "B1",
            ts: "2",
          },
        },
        "BOT",
      ),
    ).toMatchObject({
      senderUserId: "B1",
      operation: { kind: "created", mentioned: false },
    });
  });

  it("normalizes message edits and deletes as revisions", () => {
    expect(
      normalizeSlackEvent(
        {
          event: {
            type: "message",
            subtype: "message_changed",
            channel: "C1",
            event_ts: "101.2",
            message: {
              user: "U2",
              text: "<@BOT> revised",
              ts: "100.1",
              edited: { ts: "101.2" },
            },
          },
        },
        "BOT",
      ),
    ).toMatchObject({
      userText: "revised",
      operation: {
        kind: "updated",
        logicalMessageId: "100.1",
        revisionId: "101.2",
        mentioned: true,
      },
    });
    expect(
      normalizeSlackEvent({
        event: {
          type: "message",
          subtype: "message_deleted",
          channel: "C1",
          deleted_ts: "100.1",
          event_ts: "102.3",
          previous_message: { user: "U2", text: "gone", ts: "100.1" },
        },
      }),
    ).toMatchObject({
      userText: "",
      operation: {
        kind: "deleted",
        logicalMessageId: "100.1",
        revisionId: "102.3",
        mentioned: false,
      },
    });
  });

  it("maps a slash command", () => {
    const n = normalizeSlackEvent({
      command: "/triage",
      text: "now",
      channel_id: "C1",
      user_id: "U2",
      trigger_id: "T1",
    });
    expect(n).toEqual({
      kind: "command",
      command: "/triage",
      text: "now",
      channel: "C1",
      senderUserId: "U2",
      triggerId: "T1",
      eventId: "/triage:U2:T1",
    });
  });
});
