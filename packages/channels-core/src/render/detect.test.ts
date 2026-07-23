import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { Message, Button } from "@copilotkit/channels-ui";
import { isReactElement, isArbitraryJsx } from "./detect.js";

describe("isReactElement", () => {
  it("recognizes a React element", () => {
    expect(isReactElement(createElement("div", null, "hi"))).toBe(true);
  });
  it("rejects a plain channel node", () => {
    expect(isReactElement({ type: "message", props: {} })).toBe(false);
  });
});

describe("isArbitraryJsx", () => {
  it("routes a React element to image", () => {
    expect(isArbitraryJsx(createElement("div", null))).toBe(true);
  });
  it("routes an unbranded-function node to image", () => {
    const MyCard = (p: { x: number }) => p;
    expect(isArbitraryJsx({ type: MyCard, props: { x: 1 } })).toBe(true);
  });
  it("keeps a branded-component node on the channel path", () => {
    expect(isArbitraryJsx({ type: Message, props: {} })).toBe(false);
    expect(isArbitraryJsx({ type: Button, props: {} })).toBe(false);
  });
  it("keeps string-type / fragment / string / array / raw on the channel path", () => {
    expect(isArbitraryJsx({ type: "message", props: {} })).toBe(false);
    expect(isArbitraryJsx("hello")).toBe(false);
    expect(isArbitraryJsx([{ type: "text", props: { value: "x" } }])).toBe(
      false,
    );
    expect(isArbitraryJsx({ raw: { blocks: [] } })).toBe(false);
    expect(isArbitraryJsx(null)).toBe(false);
  });
});
