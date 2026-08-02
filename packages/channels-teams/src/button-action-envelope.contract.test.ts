/**
 * Contract test for the HITL button action envelope — the wire shape a consumer
 * (e.g. Intelligence managed-Teams ingress) must decode. Locks the shape in BOTH
 * directions for BOTH emitters: the `Action.Submit` {@link renderAdaptiveCard}
 * emits for a `<Button>`, the one it synthesizes for a card with no dispatchable
 * submit, the `Action.OpenUrl` a link `<Button>` becomes, and how
 * {@link parseCardAction} decodes each click Teams delivers back. See
 * `docs/button-action-envelope.md`.
 */
import { describe, it, expect } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { renderAdaptiveCard } from "./render/adaptive-card.js";
import { parseCardAction, conversationKeyOf } from "./interaction.js";
import type { TeamsActivityLike } from "./interaction.js";

const text = (value: string): ChannelNode => ({
  type: "text",
  props: { value },
});
const el = (
  type: string,
  children: ChannelNode[],
  props = {},
): ChannelNode => ({
  type,
  props: { ...props, children },
});

const buttonAction = () => {
  const action = renderAdaptiveCard([
    el("actions", [
      el("button", [text("Approve")], {
        onClick: { id: "ck:approve" },
        value: { decision: "yes" },
      }),
    ]),
  ]).actions?.[0];
  if (!action) throw new Error("expected one action");
  return action;
};

describe("HITL button action envelope (contract)", () => {
  it("emits a <Button> as Action.Submit carrying { ckActionId, value } in `data` — NOT Action.Execute", () => {
    const action = buttonAction();

    expect(action.type).toBe("Action.Submit");
    // It is a Submit, not an Execute: no `verb`, and the payload rides in `data`.
    expect(action).not.toHaveProperty("verb");
    expect(action.data).toEqual({
      ckActionId: "ck:approve",
      value: { decision: "yes" },
    });
  });

  it("round-trips: the emitted `data` is exactly Teams' inbound activity.value, decoding to { id, value }", () => {
    const action = buttonAction();

    // Teams delivers a Button click as a *Message* activity whose `value` IS the
    // action's `data` object (merged with any card inputs) and whose `text` is
    // empty — there is no invoke/adaptiveCard/action envelope.
    const inboundActivity: TeamsActivityLike = {
      value: action.data,
      conversation: { id: "conv-1" },
    };

    expect(parseCardAction(inboundActivity)).toEqual({
      id: "ck:approve",
      value: { decision: "yes" },
      // No `<Input>` on this card, so nothing merged in alongside the envelope.
      values: {},
    });
    expect(conversationKeyOf(inboundActivity)).toBe("conv-1");
  });

  it("treats an activity carrying no `value` object at all as not-a-card-action", () => {
    // A typed chat message puts its text in `text` and carries no `value`, so
    // the decode stops on the is-there-a-payload half of the guard, before
    // `ckActionId` is ever consulted. `null` must take the same exit: `typeof
    // null === "object"`, so reading through it would throw rather than
    // return.
    const ordinary: TeamsActivityLike = { value: undefined };

    expect(parseCardAction(ordinary)).toBeUndefined();
    expect(parseCardAction({})).toBeUndefined();
    expect(parseCardAction({ value: null })).toBeUndefined();
    // Nor is a non-object `value` an envelope, however it is spelled.
    expect(parseCardAction({ value: "ck:approve" })).toBeUndefined();
  });

  it("treats a `value` object with no string ckActionId as not-a-card-action", () => {
    // Past the payload guard, so this is the id test doing the deciding: an
    // activity really can arrive with a `value` object that is not one of our
    // submits, and only a *string* `ckActionId` routes. Anything else is an
    // ordinary chat message the adapter drives as a user turn.
    expect(parseCardAction({ value: {} })).toBeUndefined();
    expect(parseCardAction({ value: { reason: "ship it" } })).toBeUndefined();
    expect(parseCardAction({ value: { ckActionId: 42 } })).toBeUndefined();
    expect(parseCardAction({ value: { ckActionId: null } })).toBeUndefined();
    expect(
      parseCardAction({ value: { ckActionId: ["ck:approve"] } }),
    ).toBeUndefined();
  });
});

describe("synthesized submit envelope (contract)", () => {
  it("emits { ckActionId, ckValueField } and NO `value` for a card with no dispatchable submit", () => {
    const card = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" }, placeholder: "Why?" }),
    ]);

    expect(card.actions).toEqual([
      {
        type: "Action.Submit",
        title: "Submit",
        // `ckValueField` names the field whose submitted value IS the action
        // value; there is deliberately no `value` key to fall back to.
        data: { ckActionId: "ck:note", ckValueField: "ck:note" },
      },
    ]);
  });

  it("round-trips the synthesized submit: the named field's text becomes the action value", () => {
    const action = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" } }),
    ]).actions![0]!;

    // Teams merges every Input.* into the submit's data, keyed by element id.
    const inbound: TeamsActivityLike = {
      value: { ...(action.data as object), "ck:note": "ship it" },
      conversation: { id: "conv-1" },
    };

    expect(parseCardAction(inbound)).toEqual({
      id: "ck:note",
      value: "ship it",
      values: { "ck:note": "ship it" },
    });
  });

  it("round-trips when an explicit <Input name> makes ckValueField diverge from ckActionId", () => {
    const action = renderAdaptiveCard([
      el("input", [], { name: "reason", onSubmit: { id: "ck:note" } }),
    ]).actions![0]!;

    expect(action.data).toEqual({
      ckActionId: "ck:note",
      ckValueField: "reason",
    });
    // Dispatch keys off `ckActionId`; the value is read from `ckValueField`.
    expect(
      parseCardAction({
        value: { ...(action.data as object), reason: "ship it" },
      }),
    ).toEqual({
      id: "ck:note",
      value: "ship it",
      values: { reason: "ship it" },
    });
  });

  it("synthesizes for a <Select onSelect>-only card too — the trigger is not input-only", () => {
    const action = renderAdaptiveCard([
      el("select", [], {
        onSelect: { id: "ck:pick" },
        options: [{ label: "One", value: "1" }],
      }),
    ]).actions![0]!;

    expect(action).toEqual({
      type: "Action.Submit",
      title: "Submit",
      data: { ckActionId: "ck:pick", ckValueField: "ck:pick" },
    });
    expect(
      parseCardAction({
        value: { ...(action.data as object), "ck:pick": "1" },
      }),
    ).toEqual({ id: "ck:pick", value: "1", values: { "ck:pick": "1" } });
  });

  it('resolves ckValueField against an untouched field, which Teams submits as ""', () => {
    // Teams merges EVERY `Input.*` on the card into the submit's `data`, keyed
    // by the element's `id`: a field the user never touched still arrives, as
    // an empty string. So on a card THIS renderer emits, `ckValueField` always
    // names a key the payload carries, and blank text is the action value —
    // never a miss. (`input-submit.e2e.test.ts` drives the same client model
    // end-to-end; the two must not disagree about what Teams sends.)
    const card = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" } }),
    ]);
    const action = card.actions![0]!;
    const field = (action.data as { ckValueField: string }).ckValueField;
    // `synthesizeSubmit` binds only a field that survived the body clamp, so
    // the named field is one the card really rendered and Teams really sends.
    expect(card.body.map((element) => element.id)).toContain(field);

    expect(
      parseCardAction({ value: { ...(action.data as object), [field]: "" } }),
    ).toEqual({ id: "ck:note", value: "", values: { [field]: "" } });
  });

  it("falls back to `data.value` when an out-of-band envelope names an absent field", () => {
    // Not reachable through this renderer: `synthesizeSubmit` only ever names a
    // field it rendered, and Teams submits every rendered field. But the
    // envelope is a published wire contract (`docs/button-action-envelope.md`)
    // that consumers mint and decode themselves, so a hand-authored card can
    // carry a `ckValueField` naming nothing on the card. The decode must
    // neither throw nor surface the raw envelope: it yields `data.value`.
    expect(
      parseCardAction({
        value: { ckActionId: "ck:note", ckValueField: "gone" },
      }),
    ).toEqual({ id: "ck:note", value: undefined, values: {} });

    // It is a real fallback, not a hardcoded `undefined` — an out-of-band
    // envelope carrying both keys dispatches with its own `value`.
    expect(
      parseCardAction({
        value: {
          ckActionId: "ck:note",
          ckValueField: "gone",
          value: { decision: "yes" },
        },
      }),
    ).toEqual({ id: "ck:note", value: { decision: "yes" }, values: {} });

    // A `ckValueField` naming a reserved envelope key misses the same way:
    // reserved keys are stripped before the lookup, so they are never fields.
    expect(
      parseCardAction({
        value: { ckActionId: "ck:note", ckValueField: "value", value: "env" },
      }),
    ).toEqual({ id: "ck:note", value: "env", values: {} });
  });
});

describe("link <Button> envelope (contract)", () => {
  it("emits Action.OpenUrl with no `data`, so it never round-trips", () => {
    const action = renderAdaptiveCard([
      el("actions", [
        el("button", [text("Docs")], { url: "https://example.com/docs" }),
      ]),
    ]).actions![0]!;

    expect(action).toEqual({
      type: "Action.OpenUrl",
      title: "Docs",
      url: "https://example.com/docs",
    });
    expect(action).not.toHaveProperty("data");
    // Nothing to decode: an OpenUrl click never reaches the bot at all. And
    // there is no envelope hiding anywhere on it — posting the whole action
    // back as an activity `value` still yields no card action, because no key
    // on it is a `ckActionId`. (Asserting on `action.data` here would be
    // vacuous: it is absent, so it only re-tests the no-payload case above.)
    expect(parseCardAction({ value: action })).toBeUndefined();
  });

  it("still gets a synthesized submit beside an <Input> — OpenUrl is not dispatchable", () => {
    const card = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" } }),
      el("actions", [el("button", [text("Docs")], { url: "https://x.test" })]),
    ]);

    expect(card.actions).toEqual([
      { type: "Action.OpenUrl", title: "Docs", url: "https://x.test" },
      {
        type: "Action.Submit",
        title: "Submit",
        data: { ckActionId: "ck:note", ckValueField: "ck:note" },
      },
    ]);
  });
});

describe("routeless <Button> (contract)", () => {
  it("emits NO action for a <Button> with neither a url nor an onClick", () => {
    const card = renderAdaptiveCard([
      el("actions", [
        el("button", [text("Dismiss")], {}),
        // `value` is not a route: the decode keys on `ckActionId` alone.
        el("button", [text("Later")], { value: "later" }),
      ]),
    ]);

    expect(card.actions).toBeUndefined();
  });

  it("drops the routeless <Button> rather than emitting a submit the decode rejects", () => {
    // The rule is a decode-side contract: a submit with no `ckActionId` posts a
    // Message activity `parseCardAction` reads as an ordinary chat message, and
    // since Teams merges every card input into whichever submit fires, that
    // click would also swallow what the user typed. Only the synthesized submit
    // is left, so the card's single click is always routable.
    const card = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" } }),
      el("actions", [el("button", [text("Dismiss")], {})]),
    ]);

    expect(card.actions).toEqual([
      {
        type: "Action.Submit",
        title: "Submit",
        data: { ckActionId: "ck:note", ckValueField: "ck:note" },
      },
    ]);
    expect(
      parseCardAction({
        value: { ...(card.actions![0]!.data as object), "ck:note": "ship it" },
      }),
    ).toEqual({
      id: "ck:note",
      value: "ship it",
      values: { "ck:note": "ship it" },
    });
  });

  it("keeps only routable actions on a mixed card — every emitted submit decodes", () => {
    const card = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" } }),
      el("actions", [
        el("button", [text("Approve")], { onClick: { id: "ck:ok" } }),
        el("button", [text("Dismiss")], {}), // routeless — not emitted
        el("button", [text("Docs")], { url: "https://x.test" }),
      ]),
    ]);

    // The dispatchable <Button> suppresses synthesis, so these are exactly the
    // authored actions minus the routeless one, in author order.
    expect(card.actions).toEqual([
      {
        type: "Action.Submit",
        title: "Approve",
        data: { ckActionId: "ck:ok" },
      },
      { type: "Action.OpenUrl", title: "Docs", url: "https://x.test" },
    ]);
    for (const action of card.actions!) {
      if (action.type !== "Action.Submit") continue;
      // Every Action.Submit we emit carries a routable `ckActionId`, so a
      // consumer decoding the click never gets `undefined` — including with
      // the card's untouched input merged in, the way Teams sends it.
      expect(
        parseCardAction({
          value: { ...(action.data as object), "ck:note": "" },
        }),
      ).toBeDefined();
    }
  });
});

describe("submitted field ids (contract)", () => {
  // Teams keys a submitted field by the card `id` the renderer minted for it,
  // so what `fieldId` picks IS the wire name an out-of-band consumer reads
  // `values` (and `ckValueField`) by.

  it("keys a field by its `name`, else its minted handler id, else a positional slot on one shared counter", () => {
    const card = renderAdaptiveCard([
      // Neither a name nor a minted handler id: a positional slot.
      el("select", [], { options: [{ label: "One", value: "1" }] }),
      el("input", [], {}),
      // A minted handler id but no name: the id itself.
      el("input", [], { onSubmit: { id: "ck:note" } }),
      // An explicit `name` outranks the minted id, and is trimmed.
      el("input", [], { name: "  reason  ", onSubmit: { id: "ck:why" } }),
    ]);

    // `<Input>` and `<Select>` share ONE 1-based counter, so the input after a
    // select is `input_2` — not `input_1`.
    expect(card.body.map((element) => element.id)).toEqual([
      "select_1",
      "input_2",
      "ck:note",
      "reason",
    ]);

    // Those ids are exactly the keys the decode surfaces as `values`.
    expect(
      parseCardAction({
        value: {
          ...(card.actions![0]!.data as object),
          select_1: "1",
          input_2: "",
          "ck:note": "why",
          reason: "because",
        },
      }),
    ).toEqual({
      id: "ck:note",
      value: "why",
      values: {
        select_1: "1",
        input_2: "",
        "ck:note": "why",
        reason: "because",
      },
    });
  });

  it("suffixes a field id already taken on the card — two <Input>s on one handler", () => {
    const card = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" } }),
      el("input", [], { onSubmit: { id: "ck:note" } }),
    ]);

    expect(card.body.map((element) => element.id)).toEqual([
      "ck:note",
      "ck:note_1",
    ]);
    // Both fields answer to the same action id, so `ckValueField` has to be
    // the FIELD id to name one of them; the two arrive as distinct keys.
    expect(card.actions).toEqual([
      {
        type: "Action.Submit",
        title: "Submit",
        data: { ckActionId: "ck:note", ckValueField: "ck:note" },
      },
    ]);
    expect(
      parseCardAction({
        value: {
          ...(card.actions![0]!.data as object),
          "ck:note": "first",
          "ck:note_1": "second",
        },
      }),
    ).toEqual({
      id: "ck:note",
      value: "first",
      values: { "ck:note": "first", "ck:note_1": "second" },
    });
  });

  it("never mints a field id over a reserved envelope key, whatever `name` asks for", () => {
    const card = renderAdaptiveCard([
      el("input", [], { name: "ckActionId", onSubmit: { id: "ck:note" } }),
      el("input", [], { name: "value" }),
      el("input", [], { name: "ckValueField" }),
    ]);

    // A `name` colliding with `CARD_ENVELOPE_KEYS` is ignored and the field
    // falls back down the same ladder. Honouring it would key the user's text
    // under an envelope name, which the decode strips as reserved — the text
    // would vanish, and a `name: "ckActionId"` would forge the route.
    expect(card.body.map((element) => element.id)).toEqual([
      "ck:note",
      "input_2",
      "input_3",
    ]);

    expect(
      parseCardAction({
        value: {
          ...(card.actions![0]!.data as object),
          "ck:note": "why",
          input_2: "b",
          input_3: "c",
        },
      }),
    ).toEqual({
      id: "ck:note",
      value: "why",
      values: { "ck:note": "why", input_2: "b", input_3: "c" },
    });
  });
});

describe("decoded `values` bag (contract)", () => {
  it("delivers typed text as a string — nothing on this path coerces it", () => {
    // Teams submits an `Input.Text` as a string, so text that merely LOOKS
    // like JSON stays text. `<Input onSubmit>` is a `ClickHandler<string>`:
    // handing it a number, a boolean, `null` or an object breaks the contract
    // that the value is what the user typed.
    const action = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" } }),
    ]).actions![0]!;

    for (const typed of ["42", "true", "null", '{"a":1}']) {
      const decoded = parseCardAction({
        value: { ...(action.data as object), "ck:note": typed },
      });

      expect(decoded).toEqual({
        id: "ck:note",
        value: typed,
        values: { "ck:note": typed },
      });
      expect(typeof decoded!.value).toBe("string");
      expect(typeof decoded!.values["ck:note"]).toBe("string");
    }
  });

  it("lands a `__proto__` field as own data and leaves `values` an ordinary object", () => {
    // `__proto__` survives `JSON.parse` as an OWN key, so a payload really can
    // carry one. Copied onto a bag with `bag[key] = …` it would run
    // `Object.prototype`'s SETTER instead of becoming a field: the submitted
    // value would disappear from `Object.keys`, and — being an object — would
    // become the bag's prototype, so everything it carries would read back off
    // the bag as though it had been submitted. Build the payload the way the
    // wire does, not with an object literal (which sets the prototype).
    const inbound = JSON.parse(
      '{"ckActionId":"ck:note","__proto__":{"polluted":"yes"},"reason":"ship it"}',
    ) as Record<string, unknown>;

    const decoded = parseCardAction({ value: inbound })!;

    // It is a field like any other: own, enumerable, and carrying its value.
    expect(Object.keys(decoded.values).sort()).toEqual(["__proto__", "reason"]);
    expect(
      Object.getOwnPropertyDescriptor(decoded.values, "__proto__"),
    ).toMatchObject({ value: { polluted: "yes" }, enumerable: true });
    // …and it reached no prototype: not the bag's, not every object's.
    expect(Object.getPrototypeOf(decoded.values)).toBe(Object.prototype);
    expect(decoded.values).not.toHaveProperty("polluted");
    expect({}).not.toHaveProperty("polluted");

    // The bag stays an ORDINARY object: `values` is public API (it reaches
    // handlers as `ctx.values`, a `Record<string, unknown>`), and consumer
    // code calls `Object.prototype` methods on it. A null-prototype bag would
    // block the injection too, but at the cost of breaking that. (See
    // `setField`; the doc bullet still describes the older `Object.create(null)`
    // build and is stale on this point.)
    expect(typeof decoded.values.hasOwnProperty).toBe("function");
    expect(decoded.value).toBeUndefined();
  });
});
