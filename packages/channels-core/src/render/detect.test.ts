import { describe, it, expect } from "vitest";
import { createElement, Fragment } from "react";
import { Message, Button, renderToIR } from "@copilotkit/channels-ui";
import type { Renderable } from "@copilotkit/channels-ui";
import { resolveArbitraryElement } from "./detect.js";

const classify = (ui: unknown) =>
  resolveArbitraryElement(renderToIR(ui as Renderable));

describe("image classification after native expansion", () => {
  it("routes a host element or an app component to an image", () => {
    expect(classify(createElement("div", null, "hi"))).toBeTruthy();
    expect(
      classify({ type: () => createElement("div"), props: {} }),
    ).toBeTruthy();
  });
  it("keeps React-authored native wrappers and fragments native", () => {
    const Card = () =>
      Message({ children: Button({ value: "yes", children: "Approve" }) });
    const Wrapper = () =>
      createElement(Fragment, null, createElement(Card as never));
    expect(classify(createElement(Wrapper))).toBeNull();
  });
  it("keeps native strings, IR, arrays and raw payloads native", () => {
    for (const value of [
      "hello",
      Message({ children: "hi" }),
      [],
      { raw: [] },
    ]) {
      expect(classify(value)).toBeNull();
    }
  });
  it("requires Render for a mixed native and host tree", () => {
    expect(() =>
      classify([Message({ children: "hi" }), createElement("div")]),
    ).toThrow(/<Render>/);
  });
});
