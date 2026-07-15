/**
 * Contract test for the HITL button action envelope — the wire shape a consumer
 * (e.g. Intelligence managed-Teams ingress) must decode. Locks the shape in BOTH
 * directions: what {@link renderAdaptiveCard} emits for a `<Button>`, and how
 * {@link parseCardAction} decodes the click Teams delivers back. See
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
    });
    expect(conversationKeyOf(inboundActivity)).toBe("conv-1");
  });

  it("treats an ordinary chat message (no ckActionId) as not-a-card-action", () => {
    const ordinary: TeamsActivityLike = { value: undefined };

    expect(parseCardAction(ordinary)).toBeUndefined();
  });
});
