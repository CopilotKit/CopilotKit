import { describe, it, expect } from "vitest";
import { renderGoogleChatMessage } from "./cards-v2.js";
import type { BotNode } from "@copilotkit/bot-ui";

const text = (value: string): BotNode => ({ type: "text", props: { value } });
const section = (t: string): BotNode => ({
  type: "section",
  props: { children: [text(t)] },
});
const header = (t: string): BotNode => ({
  type: "header",
  props: { children: [text(t)] },
});

describe("renderGoogleChatMessage", () => {
  it("renders a lone text node as a plain text message (no card)", () => {
    const out = renderGoogleChatMessage([text("hello")]);
    expect(out.text).toBe("hello");
    expect(out.cardsV2).toBeUndefined();
  });

  it("renders a header+section as a cardsV2 card", () => {
    const out = renderGoogleChatMessage([header("Title"), section("Body")]);
    expect(out.cardsV2).toHaveLength(1);
    const card = (out.cardsV2![0] as any).card;
    expect(card.header.title).toBe("Title");
    expect(JSON.stringify(card.sections)).toContain("Body");
  });

  it("clamps widgets to the per-card budget", () => {
    const many = Array.from({ length: 200 }, (_, i) => section(`s${i}`));
    const out = renderGoogleChatMessage(many);
    const widgets = (out.cardsV2![0] as any).card.sections.flatMap(
      (s: any) => s.widgets,
    );
    expect(widgets.length).toBeLessThanOrEqual(100);
  });

  it("renders an actions/button node as a buttonList widget with the ck: id in onClick.action.function", () => {
    // Simulate a button whose onClick has been stamped with a ck: id by the action registry.
    const ckId = "ck:abc123";
    const button: BotNode = {
      type: "button",
      props: {
        onClick: { id: ckId },
        value: { answer: 42 },
        children: [text("Click me")],
      },
    };
    const actionsNode: BotNode = {
      type: "actions",
      props: { children: [button] },
    };

    const out = renderGoogleChatMessage([actionsNode]);
    // The result should be a cardsV2 card (not plain text) because `actions` is not a text node.
    expect(out.cardsV2).toBeDefined();
    expect(out.cardsV2).toHaveLength(1);

    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);

    // There should be exactly one buttonList widget.
    const buttonListWidget = widgets.find((w) => w.buttonList !== undefined);
    expect(buttonListWidget).toBeDefined();

    const buttons = buttonListWidget.buttonList.buttons;
    expect(buttons).toHaveLength(1);

    // The ck: id must be carried in onClick.action.function (the round-trip contract
    // for decodeInteraction which reads it from common.invokedFunction).
    expect(buttons[0].onClick.action.function).toBe(ckId);

    // The button value should be serialized as a JSON string in the parameters.
    const params: any[] = buttons[0].onClick.action.parameters;
    const valueParam = params.find((p: any) => p.key === "value");
    expect(valueParam).toBeDefined();
    expect(JSON.parse(valueParam.value)).toEqual({ answer: 42 });

    // The button text should be present.
    expect(buttons[0].text).toBe("Click me");
  });
});
