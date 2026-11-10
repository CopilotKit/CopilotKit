import { describe, it, expect } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { renderLinearMessage } from "./message.js";
import { LINEAR_LIMITS } from "./budget.js";

const node = (
  type: string,
  props: Record<string, unknown> = {},
): ChannelNode => ({ type, props });

/** A `renderToIR`-style text leaf. */
const text = (value: string | number) => node("text", { value });

const button = (label: string, props: Record<string, unknown> = {}) =>
  node("button", { children: [text(label)], ...props });

describe("renderLinearMessage", () => {
  it("renders IR without controls as a response activity", () => {
    expect(
      renderLinearMessage([
        node("section", { children: [text("Hello "), text("**world**")] }),
      ]),
    ).toEqual({
      content: { type: "response", body: "Hello **world**" },
      choices: [],
    });
  });

  it("renders rich IR to Markdown", () => {
    const ir = [
      node("message", {
        children: [
          node("header", { children: [text("ENG-123 triage")] }),
          node("section", { children: [text("Found "), text(2), text(" bugs.")] }),
          node("fields", {
            children: [
              node("field", { label: "Status", children: [text("Open")] }),
              node("field", { children: [text("No label")] }),
            ],
          }),
          node("divider"),
          node("table", {
            columns: [{ header: "Name" }, { header: "Count", align: "right" }],
            children: [
              node("row", {
                children: [
                  node("cell", { children: [text("a|b")] }),
                  node("cell", { children: [text(3)] }),
                ],
              }),
            ],
          }),
          node("image", { url: "https://x.test/a.png", alt: "chart" }),
          node("context", { children: [text("Updated just now")] }),
        ],
      }),
    ];
    expect(renderLinearMessage(ir).content).toEqual({
      type: "response",
      body: [
        "### ENG-123 triage",
        "Found 2 bugs.",
        "**Status:** Open\nNo label",
        "---",
        "| Name | Count |\n| --- | ---: |\n| a\\|b | 3 |",
        "![chart](https://x.test/a.png)",
        "_Updated just now_",
      ].join("\n\n"),
    });
  });

  it("renders handler buttons as an elicitation with select options", () => {
    const out = renderLinearMessage([
      node("section", { children: [text("Deploy ENG-9?")] }),
      node("actions", {
        children: [
          button("Yes", { value: "y", onClick: { id: "ck:1" } }),
          button("No", { onClick: { id: "ck:2" } }),
        ],
      }),
    ]);
    expect(out).toEqual({
      content: { type: "elicitation", body: "Deploy ENG-9?" },
      signal: "select",
      signalMetadata: { options: [{ value: "Yes" }, { value: "No" }] },
      choices: [
        { label: "Yes", optionValue: "Yes", actionId: "ck:1", value: "y" },
        {
          label: "No",
          optionValue: "No",
          actionId: "ck:2",
          value: undefined,
        },
      ],
    });
  });

  it("round-trips value-only awaitChoice buttons under the synthetic id", () => {
    const out = renderLinearMessage([
      button("Approve", { value: { approved: true } }),
      button("Reject", { value: { approved: false } }),
    ]);
    expect(out.choices).toEqual([
      {
        label: "Approve",
        optionValue: "Approve",
        actionId: "linear:choice",
        value: { approved: true },
      },
      {
        label: "Reject",
        optionValue: "Reject",
        actionId: "linear:choice",
        value: { approved: false },
      },
    ]);
    expect(out.content).toEqual({
      type: "elicitation",
      body: "Choose an option.",
    });
  });

  it("gives duplicate labels distinct option values", () => {
    const out = renderLinearMessage([
      button("Retry", { value: 1, onClick: { id: "ck:a" } }),
      button("Retry", { value: 2, onClick: { id: "ck:b" } }),
    ]);
    expect(out.signalMetadata).toEqual({
      options: [{ value: "Retry" }, { value: "Retry (2)" }],
    });
    expect(out.choices.map((c) => [c.optionValue, c.value])).toEqual([
      ["Retry", 1],
      ["Retry (2)", 2],
    ]);
  });

  it("renders select options as choices bound to the select handler", () => {
    const out = renderLinearMessage([
      node("select", {
        placeholder: "Region",
        onSelect: { id: "ck:sel" },
        options: [
          { label: "US", value: "us" },
          { label: "EU", value: "eu" },
        ],
      }),
    ]);
    expect(out.signalMetadata).toEqual({
      options: [{ value: "US" }, { value: "EU" }],
    });
    expect(out.choices).toEqual([
      { label: "US", optionValue: "US", actionId: "ck:sel", value: "us" },
      { label: "EU", optionValue: "EU", actionId: "ck:sel", value: "eu" },
    ]);
  });

  it("resolves a multi select pick with a one-item array", () => {
    const out = renderLinearMessage([
      node("select", {
        multi: true,
        onSelect: { id: "ck:m" },
        options: [{ label: "Bug", value: "bug" }],
      }),
    ]);
    expect(out.choices).toEqual([
      { label: "Bug", optionValue: "Bug", actionId: "ck:m", value: ["bug"] },
    ]);
  });

  it("renders link buttons as links and skips buttons that cannot round-trip", () => {
    const out = renderLinearMessage([
      button("Open PR", { url: "https://x.test/pr/1" }),
      button("Dead"),
    ]);
    expect(out).toEqual({
      content: { type: "response", body: "[Open PR](https://x.test/pr/1)" },
      choices: [],
    });
  });

  it("truncates a body longer than the activity limit", () => {
    const long = "a".repeat(LINEAR_LIMITS.activityBody + 10);
    const { content } = renderLinearMessage([
      node("section", { children: [text(long)] }),
    ]);
    if (content.type !== "response") throw new Error("expected a response");
    expect(content.body).toHaveLength(LINEAR_LIMITS.activityBody);
    expect(content.body.endsWith("a…")).toBe(true);
  });
});
