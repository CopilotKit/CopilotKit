import { describe, it, expect } from "vitest";
import { isHostElement } from "./ir.js";
import { jsx, jsxs, Fragment } from "./jsx-runtime.js";
import type { ChannelNode } from "./ir.js";

describe("jsx factory", () => {
  it("host/string tags become opaque host nodes (image path)", () => {
    const el = jsx("div", { children: "hi" });
    // Host branding distinguishes markup from the native channel vocabulary.
    expect(isHostElement(el)).toBe(true);
    expect((el as unknown as { type: string }).type).toBe("div");
  });

  it("jsxs on a host tag keeps array children as an opaque host node", () => {
    const el = jsxs("div", { children: ["a", "b"] });
    expect(isHostElement(el)).toBe(true);
    expect(
      Array.isArray(
        (el as unknown as { props: { children: unknown } }).props.children,
      ),
    ).toBe(true);
  });

  it("component tags become ChannelNodes (expanded on each operation)", () => {
    function Section(_props: Record<string, unknown>): ChannelNode {
      return { type: "section", props: {} };
    }
    const node = jsx(Section, { foo: 1 }) as ChannelNode;
    expect(isHostElement(node)).toBe(false);
    expect(node.type).toBe(Section);
    expect(node.props.foo).toBe(1);
  });

  it("Fragment is a stable ChannelNode sentinel", () => {
    const node = jsx(Fragment, { children: ["a", "b"] }) as ChannelNode;
    expect(isHostElement(node)).toBe(false);
    expect(node.type).toBe(Fragment);
  });
});
