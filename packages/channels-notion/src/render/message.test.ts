import { describe, it, expect } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { RichTextAnnotations, RichTextItem } from "../types.js";
import { renderNotionMessage } from "./message.js";

const node = (
  type: string,
  props: Record<string, unknown> = {},
): ChannelNode => ({
  type,
  props,
});

// renderToIR lowers text into `{ type: "text", props: { value } }` leaves and
// nests controls inside containers (message > actions > button).
const text = (value: string): ChannelNode => ({
  type: "text",
  props: { value },
});

function item(content: string, annotations?: RichTextAnnotations) {
  const out: RichTextItem = {
    type: "text",
    text: { content },
    ...(annotations ? { annotations } : {}),
  };
  return out;
}

function contentLengths(items: RichTextItem[]) {
  return items.map((entry) =>
    entry.type === "text" ? entry.text.content.length : 0,
  );
}

describe("renderNotionMessage", () => {
  it("renders a section as Markdown rich text with no choices", () => {
    expect(
      renderNotionMessage([node("section", { children: "Hello **world**" })]),
    ).toEqual({
      richText: [item("Hello "), item("world", { bold: true })],
      text: "Hello world",
      choices: [],
    });
  });

  it("returns empty output for empty IR", () => {
    expect(renderNotionMessage([])).toEqual({
      richText: [],
      text: "",
      choices: [],
    });
  });

  it("lowers a rich message tree to lines", () => {
    const ir = [
      node("message", {
        children: [
          node("header", { children: [text("Deploy report")] }),
          node("section", { children: [text("Hi "), text("Ada")] }),
          node("fields", {
            children: [
              node("field", { label: "Status", children: [text("Green")] }),
            ],
          }),
          node("table", {
            columns: [{ header: "Env" }, { header: "Version" }],
            children: [
              node("row", {
                children: [
                  node("cell", { children: [text("prod")] }),
                  node("cell", { children: [text("1.2")] }),
                ],
              }),
            ],
          }),
          node("divider"),
          node("context", { children: [text("Updated now")] }),
          node("image", { url: "https://example.com/a.png", alt: "Graph" }),
        ],
      }),
    ];
    expect(renderNotionMessage(ir)).toEqual({
      richText: [
        item("Deploy report", { bold: true }),
        item("\nHi Ada\n"),
        item("Status:", { bold: true }),
        item(" Green\n"),
        item("Env | Version", { bold: true }),
        item("\nprod | 1.2\n---\n"),
        item("Updated now", { italic: true }),
        item("\n"),
        {
          type: "text",
          text: {
            content: "Graph",
            link: { url: "https://example.com/a.png" },
          },
        },
      ],
      text: "Deploy report\nHi Ada\nStatus: Green\nEnv | Version\nprod | 1.2\n---\nUpdated now\nGraph",
      choices: [],
    });
  });

  it("lists handler buttons nested in actions as numbered choices", () => {
    const ir = [
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
                onClick: { id: "ck:e" },
              }),
            ],
          }),
        ],
      }),
    ];
    const out = renderNotionMessage(ir);
    expect(out.text).toBe(
      "An incident needs attention\n\nReply with a number:\n1. Acknowledge\n2. Escalate",
    );
    expect(out.choices).toEqual([
      { index: 1, label: "Acknowledge", actionId: "ck:a", value: "ack" },
      { index: 2, label: "Escalate", actionId: "ck:e" },
    ]);
  });

  it("keeps the values of value-only awaitChoice buttons under the synthetic id", () => {
    const out = renderNotionMessage([
      node("section", { children: "Ship it?" }),
      node("button", { children: "Confirm", value: true }),
      node("button", { children: "Cancel", value: false }),
      node("button", { children: "Inert" }),
    ]);
    expect(out.choices).toEqual([
      { index: 1, label: "Confirm", actionId: "notion:choice", value: true },
      { index: 2, label: "Cancel", actionId: "notion:choice", value: false },
    ]);
    expect(out.text).toBe(
      "Ship it?\n\nReply with a number:\n1. Confirm\n2. Cancel",
    );
  });

  it("renders a link button as a link, not a choice", () => {
    const out = renderNotionMessage([
      node("button", { children: "Open", url: "https://example.com" }),
    ]);
    expect(out.choices).toEqual([]);
    expect(out.richText).toEqual([
      {
        type: "text",
        text: { content: "Open", link: { url: "https://example.com" } },
      },
    ]);
  });

  it("lists select options under the select's action id", () => {
    const out = renderNotionMessage([
      node("select", {
        placeholder: "Region",
        options: [
          { label: "US", value: "us" },
          { label: "EU", value: "eu" },
        ],
        onSelect: { id: "ck:sel" },
      }),
    ]);
    expect(out.choices).toEqual([
      { index: 1, label: "US", actionId: "ck:sel", value: "us" },
      { index: 2, label: "EU", actionId: "ck:sel", value: "eu" },
    ]);
    expect(out.text).toBe("Reply with a number:\n1. US\n2. EU");
  });

  it("skips a select with no handler id", () => {
    const out = renderNotionMessage([
      node("select", { options: [{ label: "US", value: "us" }] }),
    ]);
    expect(out).toEqual({ richText: [], text: "", choices: [] });
  });

  it("cuts long prose but keeps the whole choice list", () => {
    const out = renderNotionMessage([
      node("section", { children: "x".repeat(20_000) }),
      node("button", { children: "Retry", onClick: { id: "ck:r" } }),
    ]);
    expect(out.text).toHaveLength(16_000);
    expect(out.text.endsWith("…\n\nReply with a number:\n1. Retry")).toBe(true);
    expect(out.choices).toEqual([
      { index: 1, label: "Retry", actionId: "ck:r" },
    ]);
  });

  it("splits a section longer than 2000 characters over several items", () => {
    const out = renderNotionMessage([
      node("section", { children: "y".repeat(3000) }),
    ]);
    expect(contentLengths(out.richText)).toEqual([2000, 1000]);
  });
});
