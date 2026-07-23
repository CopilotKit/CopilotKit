import { describe, it, expect } from "vitest";
import { conversationKeyOf, parseCardAction } from "./interaction.js";

describe("conversationKeyOf", () => {
  it("derives the key from activity.conversation.id", () => {
    expect(
      conversationKeyOf({ conversation: { id: "19:abc@thread.tacv2" } }),
    ).toBe("19:abc@thread.tacv2");
  });

  it("is empty when there is no conversation id (never throws)", () => {
    expect(conversationKeyOf({})).toBe("");
    expect(conversationKeyOf({ conversation: {} })).toBe("");
  });

  it("matches between an ingress message and its later card-action submit", () => {
    // Both paths MUST agree or the awaitChoice waiter is stranded.
    const id = "19:meeting_xyz@thread.v2";
    const ingress = conversationKeyOf({ conversation: { id } });
    const submit = conversationKeyOf({
      conversation: { id },
      value: { ckActionId: "ck:1", value: { confirmed: true } },
    });
    expect(submit).toBe(ingress);
  });
});

describe("parseCardAction", () => {
  it("decodes an Action.Submit carrying our ckActionId + value", () => {
    const parsed = parseCardAction({
      value: { ckActionId: "ck:approve-1", value: { confirmed: true } },
    });
    expect(parsed).toEqual({ id: "ck:approve-1", value: { confirmed: true } });
  });

  it("returns undefined for an ordinary chat message (no value)", () => {
    expect(parseCardAction({ conversation: { id: "c1" } })).toBeUndefined();
  });

  it("returns undefined when value lacks a ckActionId", () => {
    expect(parseCardAction({ value: { foo: "bar" } })).toBeUndefined();
    expect(parseCardAction({ value: "just text" })).toBeUndefined();
    expect(
      parseCardAction({ value: { ckActionId: 42 } as never }),
    ).toBeUndefined();
  });

  it("passes through a falsy/absent button value", () => {
    expect(parseCardAction({ value: { ckActionId: "ck:x" } })).toEqual({
      id: "ck:x",
      value: undefined,
    });
  });
});
