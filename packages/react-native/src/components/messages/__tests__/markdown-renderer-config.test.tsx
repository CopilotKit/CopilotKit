import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("react-native", () => {
  const R = require("react");
  // RN accepts array styles (style={[a, b]}); a DOM element needs a plain
  // object, so flatten before forwarding or react-dom rejects the array.
  const flatten = (s: any) =>
    Array.isArray(s)
      ? Object.assign({}, ...s.flat(Infinity).filter(Boolean))
      : s;
  const View = R.forwardRef(
    ({ children, style, testID, ...rest }: any, ref: any) =>
      R.createElement(
        "div",
        { ref, style: flatten(style), "data-testid": testID, ...rest },
        children,
      ),
  );
  View.displayName = "View";
  const Text = R.forwardRef(({ children, style, ...rest }: any, ref: any) =>
    R.createElement("span", { ref, style: flatten(style), ...rest }, children),
  );
  Text.displayName = "Text";
  return { View, Text, StyleSheet: { create: (s: any) => s, flatten } };
});
vi.mock("../TypingIndicator", () => ({ TypingIndicator: () => null }));

const captured: any[] = [];
vi.mock("../../Markdown", () => ({
  CopilotMarkdown: (props: any) => {
    captured.push(props);
    return null;
  },
}));

import { AssistantMessage } from "../AssistantMessage";
import { MarkdownRendererProvider } from "../../MarkdownRendererContext";

describe("RN markdownRenderer config", () => {
  it("config object configures the built-in CopilotMarkdown (style + animate)", () => {
    captured.length = 0;
    const style = { paragraph: { color: "red" } };
    render(
      <MarkdownRendererProvider renderer={{ style, animate: true }}>
        <AssistantMessage content="hello" />
      </MarkdownRendererProvider>,
    );
    expect(captured[0].style).toEqual(style);
    expect(captured[0].streamingAnimation).toBe(true);
  });

  it("component replaces the renderer (escape hatch)", () => {
    captured.length = 0;
    const Custom = ({ content }: { content: string }) =>
      React.createElement("span", { "data-testid": "custom" }, content);
    const { getByTestId } = render(
      <MarkdownRendererProvider renderer={Custom}>
        <AssistantMessage content="hello" isLoading />
      </MarkdownRendererProvider>,
    );
    expect(getByTestId("custom").textContent).toBe("hello");
    expect(captured).toHaveLength(0); // built-in CopilotMarkdown was bypassed
  });
});
