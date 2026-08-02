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

  it("treats an ordinary chat message (no ckActionId) as not-a-card-action", () => {
    const ordinary: TeamsActivityLike = { value: undefined };

    expect(parseCardAction(ordinary)).toBeUndefined();
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

  it("yields `undefined` (not the raw envelope) when ckValueField names an absent field", () => {
    // The documented miss fallback: `data.value`, which a synthesized submit
    // never carries. An out-of-band decoder must reproduce exactly this.
    const action = renderAdaptiveCard([
      el("input", [], { onSubmit: { id: "ck:note" } }),
    ]).actions![0]!;

    expect(parseCardAction({ value: { ...(action.data as object) } })).toEqual({
      id: "ck:note",
      value: undefined,
      values: {},
    });
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
    // Nothing to decode: an OpenUrl click never reaches the bot at all, and a
    // payload carrying its (absent) data is not a card action.
    expect(parseCardAction({ value: action.data })).toBeUndefined();
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
      // consumer decoding the click never gets `undefined`.
      expect(parseCardAction({ value: action.data })).toBeDefined();
    }
  });
});
