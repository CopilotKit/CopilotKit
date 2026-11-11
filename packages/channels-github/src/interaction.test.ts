import { describe, expect, it } from "vitest";
import { conversationKeyOf, decodeChoiceReply } from "./interaction.js";
import type { ChoiceReplyBase } from "./interaction.js";
import type { PendingChoices } from "./pending-choices.js";

const TARGET = { owner: "acme", repo: "widgets", issueNumber: 42 };

const BASE: ChoiceReplyBase = {
  conversationKey: "github:acme/widgets#42",
  replyTarget: TARGET,
  actor: { id: "583231", name: "octocat", kind: "human" },
  identityContext: {
    tenant: { id: "acme" },
    installation: { id: "acme" },
    conversation: { id: "github:acme/widgets#42", kind: "thread" },
    trigger: "interaction",
    event: { id: "delivery-1" },
    raw: {},
  },
  platform: "github",
  eventId: "delivery-1",
};

const PENDING: PendingChoices = {
  messageRef: { id: 900, kind: "issue", ...TARGET },
  choices: [
    { index: 1, label: "Approve", actionId: "ck:approve", value: "yes" },
    { index: 2, label: "Retry later", actionId: "github:choice", value: 30 },
    { index: 3, label: "Advanced", actionId: "ck:opts", value: { mode: "x" } },
  ],
};

const POSTED_REF = {
  id: "900",
  kind: "issue",
  owner: "acme",
  repo: "widgets",
  issueNumber: 42,
};

describe("conversationKeyOf", () => {
  it("keys an issue or PR conversation by repo and number", () => {
    expect(conversationKeyOf(TARGET)).toBe("github:acme/widgets#42");
  });

  it("keys a review thread by its root comment id", () => {
    expect(conversationKeyOf({ ...TARGET, reviewCommentId: 1234 })).toBe(
      "github:acme/widgets#42/r1234",
    );
  });
});

describe("decodeChoiceReply", () => {
  it.each(["2", "#2", "2.", "  2\n"])(
    "decodes the numbered reply %j",
    (text) => {
      expect(decodeChoiceReply(text, PENDING, BASE)).toEqual({
        ...BASE,
        id: "github:choice",
        value: 30,
        rawValue: "30",
        messageRef: POSTED_REF,
      });
    },
  );

  it("decodes an option label, ignoring case", () => {
    expect(decodeChoiceReply("approve", PENDING, BASE)).toEqual({
      ...BASE,
      id: "ck:approve",
      value: "yes",
      rawValue: "yes",
      messageRef: POSTED_REF,
    });
  });

  it("leaves rawValue out for an object value", () => {
    const event = decodeChoiceReply("3", PENDING, BASE);
    expect(event?.value).toEqual({ mode: "x" });
    expect(event?.rawValue).toBeUndefined();
  });

  it.each(["0", "4", "2 please", "approve it"])(
    "does not decode %j",
    (text) => {
      expect(decodeChoiceReply(text, PENDING, BASE)).toBeUndefined();
    },
  );
});
