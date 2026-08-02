import { describe, it, expect } from "vitest";
import {
  CARD_ENVELOPE_KEYS,
  conversationKeyOf,
  isCardEnvelopeKey,
  parseCardAction,
} from "./interaction.js";
import type { CardEnvelopeKey } from "./interaction.js";

describe("CARD_ENVELOPE_KEYS", () => {
  it("is frozen, so a consumer cannot retarget the reserved set", () => {
    // It is exported from the package, and BOTH safety behaviours read it
    // live: the renderer seeds `usedFieldIds` from it and `parseCardAction`
    // strips it out of `values`. Were it mutable, one `push` from anywhere
    // in-process would silently disable them.
    expect(Object.isFrozen(CARD_ENVELOPE_KEYS)).toBe(true);

    // This module is ESM, hence always strict mode, so a rejected write is a
    // thrown TypeError rather than a silent no-op. (`push` throws either way;
    // the element assignment is the one that needs strict mode.)
    const escaped = CARD_ENVELOPE_KEYS as unknown as string[];
    expect(() => escaped.push("reason")).toThrow(TypeError);
    expect(() => {
      escaped[0] = "hijacked";
    }).toThrow(TypeError);
    expect(() => {
      escaped.length = 0;
    }).toThrow(TypeError);

    expect([...CARD_ENVELOPE_KEYS]).toEqual([
      "ckActionId",
      "value",
      "ckValueField",
    ]);
  });

  it("keeps decoding intact after a mutation attempt", () => {
    // The guarantee the freeze buys, end to end. Before it, `push("reason")`
    // made the decoder strip a genuinely submitted `reason` field, and
    // overwriting index 0 leaked `ckActionId` into `values`.
    const escaped = CARD_ENVELOPE_KEYS as unknown as string[];
    expect(() => escaped.push("reason")).toThrow(TypeError);
    expect(() => {
      escaped[0] = "hijacked";
    }).toThrow(TypeError);

    expect(
      parseCardAction({ value: { ckActionId: "ck:x", reason: "ok" } }),
    ).toEqual({ id: "ck:x", value: undefined, values: { reason: "ok" } });
  });

  it("exposes the member names in its type", () => {
    // `readonly string[]` would erase them; `as const` keeps them, so a
    // consumer can spell a reserved key in a type position.
    const key: CardEnvelopeKey = "ckValueField";
    expect(CARD_ENVELOPE_KEYS).toContain(key);
    // @ts-expect-error — "reason" is not a reserved envelope key.
    const notAKey: CardEnvelopeKey = "reason";
    expect(notAKey).toBe("reason");
  });

  it("narrows an arbitrary string via isCardEnvelopeKey", () => {
    for (const reserved of CARD_ENVELOPE_KEYS) {
      expect(isCardEnvelopeKey(reserved)).toBe(true);
    }
    expect(isCardEnvelopeKey("reason")).toBe(false);
    expect(isCardEnvelopeKey("ckactionid")).toBe(false);
    expect(isCardEnvelopeKey("")).toBe(false);
  });
});

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

  it("lands a `__proto__` field as plain data, never on the prototype", () => {
    // `__proto__` survives JSON.parse as an OWN key, so a crafted submit can
    // carry one. Assigned with `values[key] = v` it runs the inherited setter:
    // the handler then sees `values.injected` without `injected` ever appearing
    // in `Object.keys(values)`.
    const parsed = parseCardAction({
      value: JSON.parse(
        '{"ckActionId":"ck:x","__proto__":{"injected":true},"reason":"ok"}',
      ),
    });
    const values = parsed!.values;
    expect(values.injected).toBeUndefined();
    expect(Object.keys(values).sort()).toEqual(["__proto__", "reason"]);
    expect(values.reason).toBe("ok");
    // The crafted key is a field like any other, not the bag's prototype.
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(values, "__proto__")).toBe(
      true,
    );
  });

  it("hands handlers an ORDINARY object, prototype intact", () => {
    // `values` is public API (`ctx.values`, typed `Record<string, unknown>`)
    // and reaches third-party handlers. Hardening the inbound keys must not
    // cost it `Object.prototype`: `ctx.values.hasOwnProperty(...)` is ordinary
    // consumer code and must keep working.
    const values = parseCardAction({
      value: { ckActionId: "ck:x", reason: "ok" },
    })!.values;
    expect(values.hasOwnProperty("reason")).toBe(true);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(values.hasOwnProperty("nope")).toBe(false);
    expect(() => String(values)).not.toThrow();
    expect({ ...values }).toEqual({ reason: "ok" });
  });

  it("delivers a submitted field whose id collides with a builtin", () => {
    // The half of prototype hygiene that IS a correctness guarantee: a field
    // the sender actually submitted must reach the handler as its own value,
    // shadowing whatever `Object.prototype` happens to name.
    const values = parseCardAction({
      value: { ckActionId: "ck:x", toString: "typed", constructor: "ctor" },
    })!.values;
    expect(values.toString).toBe("typed");
    expect(values.constructor).toBe("ctor");
    expect(Object.keys(values).sort()).toEqual(["constructor", "toString"]);
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
