import { describe, it, expect } from "vitest";
import { jsx, jsxs, Fragment } from "./jsx-runtime.js";
import type { BotNode } from "./ir.js";

describe("jsx factory", () => {
  it("builds an BotNode with type and props", () => {
    const node = jsx("section", { children: "hi" }) as BotNode;
    expect(node.type).toBe("section");
    expect(node.props.children).toBe("hi");
  });
  it("jsxs keeps array children", () => {
    const node = jsxs("actions", { children: ["a", "b"] }) as BotNode;
    expect(Array.isArray(node.props.children)).toBe(true);
  });
  it("Fragment is a stable sentinel", () => {
    const node = jsx(Fragment, { children: ["a", "b"] }) as BotNode;
    expect(node.type).toBe(Fragment);
  });
});
