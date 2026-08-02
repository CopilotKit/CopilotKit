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
    expect(parsed).toEqual({
      id: "ck:approve-1",
      value: { confirmed: true },
      values: {},
    });
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
      values: {},
    });
  });

  it("carries merged card inputs as `values`, keyed by the element id", () => {
    // Teams merges every Input.* on the card into the submit's `value` object.
    // A button click must not discard what the user typed beside it.
    expect(
      parseCardAction({
        value: {
          ckActionId: "ck:approve",
          value: { decision: "yes" },
          "ck:note": "looks good",
          reason: "shipping",
        },
      }),
    ).toEqual({
      id: "ck:approve",
      value: { decision: "yes" },
      values: { "ck:note": "looks good", reason: "shipping" },
    });
  });

  it("takes the action value from `ckValueField` when the submit names one", () => {
    // The synthesized submit for an Input-only card: the dispatched handler is
    // an `<Input onSubmit>`, so `ctx.action.value` must be the typed text.
    expect(
      parseCardAction({
        value: {
          ckActionId: "ck:note",
          ckValueField: "ck:note",
          "ck:note": "ship it",
        },
      }),
    ).toEqual({
      id: "ck:note",
      value: "ship it",
      values: { "ck:note": "ship it" },
    });
  });

  it("resolves `ckValueField` when an explicit <Input name> renamed the field", () => {
    expect(
      parseCardAction({
        value: {
          ckActionId: "ck:note",
          ckValueField: "reason",
          reason: "ship it",
        },
      }),
    ).toEqual({
      id: "ck:note",
      value: "ship it",
      values: { reason: "ship it" },
    });
  });

  it("falls back to the button value when `ckValueField` names a missing field", () => {
    expect(
      parseCardAction({
        value: {
          ckActionId: "ck:note",
          ckValueField: "gone",
          value: "fallback",
        },
      }),
    ).toEqual({ id: "ck:note", value: "fallback", values: {} });
  });

  it("keeps typed text as a string even when it parses as JSON", () => {
    // Teams delivers Input.Text values as strings; nothing may coerce them.
    for (const typed of ["42", "true", "null", '{"a":1}']) {
      expect(
        parseCardAction({
          value: {
            ckActionId: "ck:note",
            ckValueField: "ck:note",
            "ck:note": typed,
          },
        })?.value,
      ).toBe(typed);
    }
  });
});
