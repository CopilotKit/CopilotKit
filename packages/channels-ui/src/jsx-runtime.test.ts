import { describe, it, expect } from "vitest";
import { jsx, jsxs, Fragment } from "./jsx-runtime.js";
import type { ChannelNode } from "./ir.js";

describe("jsx factory", () => {
  it("builds an ChannelNode with type and props", () => {
    const node = jsx("section", { children: "hi" }) as ChannelNode;
    expect(node.type).toBe("section");
    expect(node.props.children).toBe("hi");
  });
  it("jsxs keeps array children", () => {
    const node = jsxs("actions", { children: ["a", "b"] }) as ChannelNode;
    expect(Array.isArray(node.props.children)).toBe(true);
  });
  it("Fragment is a stable sentinel", () => {
    const node = jsx(Fragment, { children: ["a", "b"] }) as ChannelNode;
    expect(node.type).toBe(Fragment);
  });
});
