import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Cell,
  Field,
  Fields,
  Header,
  Image,
  Message,
  Render,
  Row,
  Section,
  Select,
  Table,
  renderToIR,
} from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { irToText, serializeIr } from "../serialize.js";

describe("serializeIr", () => {
  it("reduces bound handlers to their minted ids and keeps values", () => {
    const ir: ChannelNode[] = [
      {
        type: "button",
        props: {
          onClick: { id: "ck:1" },
          value: { plan: "pro" },
          children: [{ type: "text", props: { value: "Upgrade" } }],
        },
      },
    ];
    expect(serializeIr(ir)).toEqual([
      {
        type: "button",
        props: {
          onClick: "ck:1",
          value: { plan: "pro" },
          children: [{ type: "text", props: { value: "Upgrade" } }],
        },
      },
    ]);
  });

  it("drops unbound handler functions, symbols, raw nodes, and render host children", () => {
    const ir: ChannelNode[] = [
      {
        type: "button",
        props: { onClick: () => {}, marker: Symbol("x"), children: [] },
        key: "b1",
      },
      { type: "raw", props: { value: { blocks: [] } } },
      {
        type: "render",
        props: {
          alt: "A chart",
          width: 400,
          children: { $$typeof: Symbol.for("react.element"), type: "div" },
        },
      },
    ];
    expect(serializeIr(ir)).toEqual([
      { type: "button", props: { children: [] }, key: "b1" },
      { type: "render", props: { alt: "A chart", width: 400 } },
    ]);
  });

  it("produces JSON that survives a round trip", () => {
    const ir = renderToIR(
      Message({
        accent: "#00ff00",
        children: [
          Header({ children: "Order" }),
          Select({
            placeholder: "Size",
            options: [{ label: "Small", value: "s" }],
          }),
        ],
      }),
    );
    const wire = serializeIr(ir);
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);
  });
});

describe("irToText", () => {
  it("prefers the root fallbackText", () => {
    const ir = renderToIR(
      Message({
        fallbackText: "Short summary",
        children: Section({ children: "Long body" }),
      }),
    );
    expect(irToText(ir)).toBe("Short summary");
  });

  it("joins readable blocks and skips controls", () => {
    const ir = renderToIR(
      Message({
        children: [
          Header({ children: "Status" }),
          Fields({
            children: [
              Field({ label: "Region", children: "eu-west" }),
              Field({ children: "healthy" }),
            ],
          }),
          Image({ url: "https://example.com/a.png", alt: "graph" }),
          Actions({ children: Button({ children: "Refresh" }) }),
          Table({
            columns: [{ header: "Name" }, { header: "Count" }],
            children: Row({
              children: [Cell({ children: "a" }), Cell({ children: "1" })],
            }),
          }),
          Render({ alt: "Snapshot of the board" }),
        ],
      }),
    );
    expect(irToText(ir)).toBe(
      [
        "Status",
        "Region: eu-west",
        "healthy",
        "Name | Count",
        "a | 1",
        "Snapshot of the board",
      ].join("\n"),
    );
  });
});
