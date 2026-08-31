import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { renderToIR } from "./render.js";
import { Render } from "./components.js";
import type { ChannelNode } from "./ir.js";

function Card(props: { title: string }): ChannelNode {
  return { type: "section", props: { children: props.title } };
}

describe("renderToIR", () => {
  it("wraps a bare string into a text node", () => {
    expect(renderToIR("hi")).toEqual([
      { type: "text", props: { value: "hi" } },
    ]);
  });
  it("expands a component function with its props", () => {
    const out = renderToIR(<Card title="Flights" />);
    expect(out).toEqual([
      {
        type: "section",
        props: { children: [{ type: "text", props: { value: "Flights" } }] },
      },
    ]);
  });
  it("flattens Fragment children and nested components", () => {
    const out = renderToIR(
      <>
        <Card title="A" />
        <Card title="B" />
      </>,
    );
    expect(out.map((n) => (n as ChannelNode).type)).toEqual([
      "section",
      "section",
    ]);
  });
  it("wraps string children inside intrinsic nodes recursively", () => {
    const out = renderToIR({ type: "actions", props: { children: ["x"] } });
    const actions = out[0] as ChannelNode;
    expect((actions.props.children as ChannelNode[])[0]).toEqual({
      type: "text",
      props: { value: "x" },
    });
  });
  it("passes {raw} through as a raw node", () => {
    expect(renderToIR({ raw: [{ block: 1 }] })).toEqual([
      {
        type: "raw",
        props: { provider: "slack", value: [{ block: 1 }] },
      },
    ]);
  });

  it("retains the provider identity of native elements", () => {
    expect(
      renderToIR({
        provider: "teams",
        raw: { type: "AdaptiveCard", version: "1.5", body: [] },
      }),
    ).toEqual([
      {
        type: "raw",
        props: {
          provider: "teams",
          value: { type: "AdaptiveCard", version: "1.5", body: [] },
        },
      },
    ]);
  });

  it("keeps Render children as React elements so a host button is not flattened", () => {
    const [node] = renderToIR(
      <Render alt="card">
        <button>Buy</button>
      </Render>,
    );
    const child = node!.props.children;
    expect(isValidElement(child)).toBe(true);
    expect((child as { type: unknown }).type).toBe("button");
    expect((child as { $$typeof: unknown }).$$typeof).toBeDefined();
    expect((child as { props: { children: unknown } }).props.children).toBe(
      "Buy",
    );
  });
});
