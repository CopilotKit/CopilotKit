import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { jsx, jsxs, Fragment } from "./jsx-runtime.js";
import type { ChannelNode } from "./ir.js";

describe("jsx factory", () => {
  it("host/string tags become real React elements (image path)", () => {
    const el = jsx("div", { children: "hi" });
    // Real React element so Takumi can rasterize it — distinguishable (via
    // $$typeof) from the string-typed channel vocabulary.
    expect(isValidElement(el)).toBe(true);
    expect((el as unknown as { type: string }).type).toBe("div");
  });

  it("jsxs on a host tag keeps array children as a React element", () => {
    const el = jsxs("div", { children: ["a", "b"] });
    expect(isValidElement(el)).toBe(true);
    expect(
      Array.isArray(
        (el as unknown as { props: { children: unknown } }).props.children,
      ),
    ).toBe(true);
  });

  it("component tags become ChannelNodes (native path / peeked)", () => {
    function Section(_props: Record<string, unknown>): ChannelNode {
      return { type: "section", props: {} };
    }
    const node = jsx(Section, { foo: 1 }) as ChannelNode;
    expect(isValidElement(node)).toBe(false);
    expect(node.type).toBe(Section);
    expect(node.props.foo).toBe(1);
  });

  it("Fragment is a stable ChannelNode sentinel", () => {
    const node = jsx(Fragment, { children: ["a", "b"] }) as ChannelNode;
    expect(isValidElement(node)).toBe(false);
    expect(node.type).toBe(Fragment);
  });
});
