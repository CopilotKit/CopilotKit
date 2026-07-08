import { describe, it, expect } from "vitest";
import { renderToIR } from "./render.js";
import type { BotNode } from "./ir.js";

function Card(props: { title: string }): BotNode {
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
    expect(out.map((n) => (n as BotNode).type)).toEqual(["section", "section"]);
  });
  it("wraps string children inside intrinsic nodes recursively", () => {
    const out = renderToIR({ type: "actions", props: { children: ["x"] } });
    const actions = out[0] as BotNode;
    expect((actions.props.children as BotNode[])[0]).toEqual({
      type: "text",
      props: { value: "x" },
    });
  });
  it("passes {raw} through as a raw node", () => {
    expect(renderToIR({ raw: [{ block: 1 }] })).toEqual([
      { type: "raw", props: { value: [{ block: 1 }] } },
    ]);
  });
});
