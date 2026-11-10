import { describe, expect, it } from "vitest";
import type { PendingChoices } from "./conversation-state.js";
import { conversationKeyOf, decodeChoiceReply } from "./interaction.js";
import type { InteractionBase } from "./interaction.js";

const base: InteractionBase = {
  conversationKey: "notion:disc-1",
  replyTarget: {
    workspaceId: "ws-1",
    pageId: "page-1",
    discussionId: "disc-1",
  },
  actor: { id: "user-1", kind: "human" },
  identityContext: {
    tenant: { id: "ws-1" },
    installation: { id: "int-1" },
    conversation: { id: "notion:disc-1", kind: "thread" },
    trigger: "interaction",
    event: { id: "evt-2", occurredAt: "2026-11-10T09:16:00.000Z" },
    raw: {},
  },
  eventId: "evt-2",
};

const pending: PendingChoices = {
  messageRef: { id: "comment-bot", discussionId: "disc-1" },
  choices: [
    { index: 1, label: "Approve", actionId: "ck:approve", value: "yes" },
    { index: 2, label: "Reject", actionId: "ck:reject", value: 2 },
    { index: 3, label: "Later", actionId: "notion:choice", value: { at: 9 } },
  ],
};

describe("conversationKeyOf", () => {
  it("prefixes the discussion id with notion:", () => {
    expect(conversationKeyOf("disc-1")).toBe("notion:disc-1");
  });
});

describe("decodeChoiceReply", () => {
  it.each(["2", "#2", "2.", "  2 \n"])("picks choice 2 from %j", (text) => {
    expect(decodeChoiceReply(text, pending, base)).toEqual({
      ...base,
      id: "ck:reject",
      value: 2,
      rawValue: "2",
      messageRef: { id: "comment-bot", discussionId: "disc-1" },
    });
  });

  it("picks a choice by its label, ignoring case", () => {
    expect(decodeChoiceReply("approve", pending, base)).toEqual({
      ...base,
      id: "ck:approve",
      value: "yes",
      rawValue: "yes",
      messageRef: { id: "comment-bot", discussionId: "disc-1" },
    });
  });

  it("omits rawValue when the value is not a string or number", () => {
    expect(decodeChoiceReply("3", pending, base)).toEqual({
      ...base,
      id: "notion:choice",
      value: { at: 9 },
      messageRef: { id: "comment-bot", discussionId: "disc-1" },
    });
  });

  it.each(["4", "0", "approve it", "2 please", ""])(
    "returns undefined for %j",
    (text) => {
      expect(decodeChoiceReply(text, pending, base)).toBeUndefined();
    },
  );
});
