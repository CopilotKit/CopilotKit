import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { Message, Button } from "@copilotkit/channels-ui";
import { isReactElement, resolveArbitraryElement } from "./detect.js";

describe("isReactElement", () => {
  it("recognizes a React element", () => {
    expect(isReactElement(createElement("div", null, "hi"))).toBe(true);
  });
  it("rejects a plain channel node", () => {
    expect(isReactElement({ type: "message", props: {} })).toBe(false);
  });
});

describe("resolveArbitraryElement", () => {
  it("returns a React element as-is", () => {
    const el = createElement("div", null);
    const result = resolveArbitraryElement(el);
    expect(result).toBeTruthy();
    expect(isReactElement(result)).toBe(true);
  });

  it("peeks a {type: fn} node whose fn returns a React element (app JSX)", () => {
    const AppCard = () => createElement("div", null);
    const result = resolveArbitraryElement({ type: AppCard, props: {} });
    expect(result).toBeTruthy();
    expect(isReactElement(result)).toBe(true);
  });

  it("returns null for a {type: fn} node whose fn returns a channel node (native)", () => {
    const NativeCard = () => ({ type: "message", props: {} });
    expect(resolveArbitraryElement({ type: NativeCard, props: {} })).toBe(null);
  });

  it("skips the peek for branded channels-ui components", () => {
    expect(resolveArbitraryElement({ type: Message, props: {} })).toBe(null);
    expect(resolveArbitraryElement({ type: Button, props: {} })).toBe(null);
  });

  it("returns null for a branded channels-ui component authored as a React element", () => {
    expect(resolveArbitraryElement(createElement(Message as never, {}))).toBe(
      null,
    );
  });

  it("routes native when an unbranded fn node peeks out to a branded channel element", () => {
    expect(
      resolveArbitraryElement({
        type: () => createElement(Message as never, {}),
        props: {},
      }),
    ).toBeNull();
  });

  it("returns null when the fn throws while peeking (e.g. uses React hooks)", () => {
    const HooksComponent = () => {
      throw new Error("hooks");
    };
    expect(resolveArbitraryElement({ type: HooksComponent, props: {} })).toBe(
      null,
    );
  });

  it("invokes a component at most once, however often the node is classified", () => {
    // `awaitChoice`/`post` each classify before acting; a component with a side
    // effect (a fetch, a counter) must not run twice for one node.
    const calls = vi.fn(() => createElement("div", null));
    const node = { type: calls, props: {} };
    expect(resolveArbitraryElement(node)).toBeTruthy();
    expect(resolveArbitraryElement(node)).toBeTruthy();
    expect(resolveArbitraryElement(node)).toBeTruthy();
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("memoizes the native verdict too (a throwing or channel-node component)", () => {
    const native = vi.fn(() => ({ type: "message", props: {} }));
    const nativeNode = { type: native, props: {} };
    expect(resolveArbitraryElement(nativeNode)).toBe(null);
    expect(resolveArbitraryElement(nativeNode)).toBe(null);
    expect(native).toHaveBeenCalledTimes(1);

    const throwing = vi.fn(() => {
      throw new Error("hooks");
    });
    const throwingNode = { type: throwing, props: {} };
    expect(resolveArbitraryElement(throwingNode)).toBe(null);
    expect(resolveArbitraryElement(throwingNode)).toBe(null);
    expect(throwing).toHaveBeenCalledTimes(1);
  });

  it("returns null for string-type / string / array / raw / null / number", () => {
    expect(resolveArbitraryElement({ type: "message", props: {} })).toBe(null);
    expect(resolveArbitraryElement("hello")).toBe(null);
    expect(
      resolveArbitraryElement([{ type: "text", props: { value: "x" } }]),
    ).toBe(null);
    expect(resolveArbitraryElement({ raw: { blocks: [] } })).toBe(null);
    expect(resolveArbitraryElement(null)).toBe(null);
    expect(resolveArbitraryElement(42)).toBe(null);
  });
});
