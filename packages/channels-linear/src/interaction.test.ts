import { describe, expect, it } from "vitest";
import {
  conversationKeyOf,
  decodeSelectReply,
  type InteractionEventBase,
} from "./interaction.js";
import type { PendingChoiceSet } from "./pending-choices.js";

const base: InteractionEventBase = {
  platform: "linear",
  conversationKey: "linear:ses_1",
  replyTarget: { organizationId: "org_1", agentSessionId: "ses_1" },
  actor: { id: "user_1", kind: "human" },
  eventId: "act_9",
  identityContext: {
    tenant: { id: "org_1" },
    installation: { id: "org_1" },
    conversation: { id: "linear:ses_1", kind: "thread" },
    trigger: "interaction",
    event: { id: "act_9" },
    raw: null,
  },
};

const pending: PendingChoiceSet = {
  messageRef: { id: "act_elicit", agentSessionId: "ses_1" },
  choices: [
    {
      label: "Approve",
      optionValue: "Approve",
      actionId: "ck:approve",
      value: "yes",
    },
    {
      label: "Approve",
      optionValue: "Approve (2)",
      actionId: "ck:approve-2",
      value: 2,
    },
    { label: "Details", optionValue: "Details", actionId: "ck:details" },
    {
      label: "Plan",
      optionValue: "Plan",
      actionId: "linear:choice",
      value: { tier: "pro" },
    },
  ],
};

describe("conversationKeyOf", () => {
  it("prefixes the agent session id with the platform", () => {
    expect(conversationKeyOf("ses_1")).toBe("linear:ses_1");
  });
});

describe("decodeSelectReply", () => {
  it("maps an exact option value to its action, value, and raw value", () => {
    expect(decodeSelectReply("  Approve (2)\n", pending, base)).toEqual({
      ...base,
      id: "ck:approve-2",
      value: 2,
      rawValue: "2",
      messageRef: { id: "act_elicit", agentSessionId: "ses_1" },
    });
  });

  it("prefers the option value over an equal label", () => {
    expect(decodeSelectReply("Approve", pending, base)?.id).toBe("ck:approve");
  });

  it("falls back to a case-insensitive label match", () => {
    expect(decodeSelectReply("details", pending, base)).toEqual({
      ...base,
      id: "ck:details",
      value: undefined,
      messageRef: { id: "act_elicit", agentSessionId: "ses_1" },
    });
  });

  it("omits the raw value when the value is not a string or number", () => {
    const event = decodeSelectReply("Plan", pending, base);
    expect(event?.value).toEqual({ tier: "pro" });
    expect(event).not.toHaveProperty("rawValue");
  });

  it("returns undefined when the body picks no option", () => {
    expect(decodeSelectReply("Approve it please", pending, base)).toBe(
      undefined,
    );
  });
});
