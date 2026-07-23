import { describe, it, expect } from "vitest";
import { conversationKeyOf, decodeInteraction } from "./interaction.js";
import type { InboundMessage } from "./types.js";

describe("conversationKeyOf", () => {
  it("keys a conversation by wa_id", () => {
    expect(conversationKeyOf("15551234567")).toBe("whatsapp:15551234567");
  });
});

describe("decodeInteraction", () => {
  const target = { to: "15551234567", phoneNumberId: "PNID" };

  it("decodes a button_reply into an InteractionEvent", () => {
    const msg: InboundMessage = {
      from: "15551234567",
      id: "wamid.A",
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "ck:42", title: "Yes" },
      },
    };
    const evt = decodeInteraction(msg, target);
    expect(evt).toEqual({
      id: "ck:42",
      conversationKey: "whatsapp:15551234567",
      replyTarget: target,
      value: undefined,
      user: { id: "15551234567" },
      messageRef: { id: "wamid.A", to: "15551234567", phoneNumberId: "PNID" },
    });
  });

  it("decodes a list_reply, splitting the JSON-encoded option value off the id", () => {
    const msg: InboundMessage = {
      from: "15551234567",
      id: "wamid.B",
      type: "interactive",
      interactive: {
        type: "list_reply",
        list_reply: { id: 'ck:sel::"eu"', title: "EU" },
      },
    };
    const evt = decodeInteraction(msg, target);
    expect(evt?.id).toBe("ck:sel");
    expect(evt?.value).toBe("eu");
  });

  it("decodes a button_reply with a JSON-encoded value", () => {
    const msg: InboundMessage = {
      from: "15551234567",
      id: "wamid.C",
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: 'ck:7::{"confirmed":true}', title: "Yes" },
      },
    };
    const evt = decodeInteraction(msg, target);
    expect(evt?.id).toBe("ck:7");
    expect(evt?.value).toEqual({ confirmed: true });
  });

  it("returns undefined for a non-interactive message", () => {
    const msg: InboundMessage = {
      from: "x",
      id: "1",
      type: "text",
      text: { body: "hi" },
    };
    expect(decodeInteraction(msg, target)).toBeUndefined();
  });
});
