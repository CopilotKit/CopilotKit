import { describe, it, expect } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { renderWhatsAppMessage } from "./message.js";

const node = (
  type: string,
  props: Record<string, unknown> = {},
): ChannelNode => ({
  type,
  props,
});

describe("renderWhatsAppMessage", () => {
  it("renders plain text/section as a text payload", () => {
    const out = renderWhatsAppMessage([
      node("section", { children: "Hello **world**" }),
    ]);
    expect(out).toEqual([
      { type: "text", text: { body: "Hello *world*", preview_url: false } },
    ]);
  });

  it("renders <=3 buttons as an interactive button message (value encoded in id)", () => {
    const out = renderWhatsAppMessage([
      node("section", { children: "Pick one" }),
      node("button", { children: "Yes", value: "y", onClick: { id: "ck:1" } }),
      node("button", { children: "No", value: "n", onClick: { id: "ck:2" } }),
    ]);
    expect(out).toHaveLength(1);
    const m = out[0] as Record<string, any>;
    expect(m.type).toBe("interactive");
    expect(m.interactive.type).toBe("button");
    expect(m.interactive.body.text).toBe("Pick one");
    expect(m.interactive.action.buttons).toEqual([
      { type: "reply", reply: { id: 'ck:1::"y"', title: "Yes" } },
      { type: "reply", reply: { id: 'ck:2::"n"', title: "No" } },
    ]);
  });

  it("omits the value suffix when a button has no value", () => {
    const out = renderWhatsAppMessage([
      node("section", { children: "x" }),
      node("button", { children: "Go", onClick: { id: "ck:9" } }),
    ]);
    const m = out[0] as Record<string, any>;
    expect(m.interactive.action.buttons[0].reply.id).toBe("ck:9");
  });

  it("renders >3 buttons as an interactive list message", () => {
    const buttons = ["a", "b", "c", "d"].map((t, i) =>
      node("button", { children: t, onClick: { id: `ck:${i}` } }),
    );
    const out = renderWhatsAppMessage([
      node("section", { children: "Choose" }),
      ...buttons,
    ]);
    const m = out[0] as Record<string, any>;
    expect(m.interactive.type).toBe("list");
    expect(m.interactive.action.sections[0].rows).toHaveLength(4);
    expect(m.interactive.action.sections[0].rows[0]).toEqual({
      id: "ck:0",
      title: "a",
    });
  });

  it("renders a select as a list message (option value encoded per row)", () => {
    const out = renderWhatsAppMessage([
      node("select", {
        placeholder: "Region",
        options: [
          { label: "US", value: "us" },
          { label: "EU", value: "eu" },
        ],
        onSelect: { id: "ck:sel" },
      }),
    ]);
    const m = out[0] as Record<string, any>;
    expect(m.interactive.type).toBe("list");
    expect(m.interactive.action.sections[0].rows).toEqual([
      { id: 'ck:sel::"us"', title: "US" },
      { id: 'ck:sel::"eu"', title: "EU" },
    ]);
  });

  it("clamps button titles to 20 chars", () => {
    const out = renderWhatsAppMessage([
      node("section", { children: "x" }),
      node("button", {
        children: "a".repeat(40),
        value: "v",
        onClick: { id: "ck:1" },
      }),
    ]);
    const m = out[0] as Record<string, any>;
    expect(m.interactive.action.buttons[0].reply.title.length).toBe(20);
  });

  it("renders an image as an image payload", () => {
    const out = renderWhatsAppMessage([
      node("image", { url: "https://x/i.png", alt: "pic" }),
    ]);
    expect(out).toContainEqual({
      type: "image",
      image: { link: "https://x/i.png", caption: "pic" },
    });
  });

  it("falls back to a numbered text menu beyond 10 options", () => {
    const buttons = Array.from({ length: 12 }, (_, i) =>
      node("button", { children: `opt${i}`, onClick: { id: `ck:${i}` } }),
    );
    const out = renderWhatsAppMessage([
      node("section", { children: "Many" }),
      ...buttons,
    ]);
    const m = out[0] as Record<string, any>;
    expect(m.type).toBe("text");
    expect(m.text.body).toContain("1. opt0");
    expect(m.text.body).toContain("12. opt11");
  });

  it("throws when an encoded button value exceeds the WhatsApp id limit", () => {
    const huge = "x".repeat(300);
    expect(() =>
      renderWhatsAppMessage([
        node("section", { children: "x" }),
        node("button", {
          children: "Go",
          value: huge,
          onClick: { id: "ck:1" },
        }),
      ]),
    ).toThrow(/too large to round-trip/);
  });

  it("renders value-only buttons (HITL confirm/cancel) encoding the value in the id", () => {
    const out = renderWhatsAppMessage([
      node("section", { children: "Create issue?" }),
      node("button", { children: "Confirm", value: { confirmed: true } }),
      node("button", { children: "Cancel", value: { confirmed: false } }),
    ]);
    const m = out[0] as Record<string, any>;
    expect(m.type).toBe("interactive");
    expect(m.interactive.type).toBe("button");
    expect(m.interactive.action.buttons.map((b: any) => b.reply)).toEqual([
      { id: 'wa:choice::{"confirmed":true}', title: "Confirm" },
      { id: 'wa:choice::{"confirmed":false}', title: "Cancel" },
    ]);
  });

  // --- renderToIR-shaped IR (the real shape thread.post produces) ---
  // renderToIR lowers text into `{ type: "text", props: { value } }` leaves and
  // nests controls inside containers (message > actions > button). These guard
  // against the shape the flat hand-built fixtures above don't exercise.
  const text = (value: string): ChannelNode => ({
    type: "text",
    props: { value },
  });

  it("renders a message>header>section tree with text-value leaves (issue_list regression)", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: [
          node("header", { children: [text("Open CPK issues")] }),
          node("section", { children: [text("*CPK-1* — A\n*CPK-2* — B")] }),
        ],
      }),
    ];
    const out = renderWhatsAppMessage(ir);
    expect(out).toHaveLength(1);
    const m = out[0] as Record<string, any>;
    expect(m.type).toBe("text");
    expect(m.text.body).toContain("Open CPK issues");
    expect(m.text.body).toContain("CPK-1");
    expect(m.text.body).toContain("CPK-2");
  });

  it("finds buttons nested in message>actions with text-value titles (show_incident regression)", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: [
          node("section", { children: [text("An incident needs attention")] }),
          node("actions", {
            children: [
              node("button", {
                children: [text("Acknowledge")],
                value: "ack",
                onClick: { id: "ck:a" },
              }),
              node("button", {
                children: [text("Escalate")],
                value: "esc",
                onClick: { id: "ck:e" },
              }),
            ],
          }),
        ],
      }),
    ];
    const out = renderWhatsAppMessage(ir);
    const m = out[0] as Record<string, any>;
    expect(m.type).toBe("interactive");
    expect(m.interactive.type).toBe("button");
    expect(m.interactive.body.text).toContain("An incident");
    expect(m.interactive.action.buttons.map((b: any) => b.reply.title)).toEqual(
      ["Acknowledge", "Escalate"],
    );
    expect(m.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual([
      'ck:a::"ack"',
      'ck:e::"esc"',
    ]);
  });
});
