import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ─── Mock react-native ───────────────────────────────────────────────────────
vi.mock("react-native", () => {
  const React = require("react");

  const View = React.forwardRef(
    (
      {
        children,
        style,
        testID,
        accessibilityLabel,
        accessibilityRole,
        ...rest
      }: any,
      ref: any,
    ) =>
      React.createElement(
        "div",
        {
          ref,
          style,
          "data-testid": testID,
          "aria-label": accessibilityLabel,
          role: accessibilityRole,
          ...rest,
        },
        children,
      ),
  );
  View.displayName = "View";

  const Text = React.forwardRef(({ children, style, ...rest }: any, ref: any) =>
    React.createElement("span", { ref, style, ...rest }, children),
  );
  Text.displayName = "Text";

  const AnimatedValue = class {
    _value: number;
    constructor(value: number) {
      this._value = value;
    }
    interpolate({ outputRange }: any) {
      return outputRange[0];
    }
  };

  const AnimatedView = React.forwardRef(
    ({ children, style, ...rest }: any, ref: any) =>
      React.createElement("div", { ref, style, ...rest }, children),
  );
  AnimatedView.displayName = "Animated.View";

  const timing = () => ({ start: vi.fn(), stop: vi.fn() });
  const sequence = () => ({ start: vi.fn(), stop: vi.fn() });
  const loop = () => ({ start: vi.fn(), stop: vi.fn() });
  const parallel = () => ({ start: vi.fn(), stop: vi.fn() });
  const delay = () => ({ start: vi.fn(), stop: vi.fn() });

  return {
    View,
    Text,
    Animated: {
      Value: AnimatedValue,
      View: AnimatedView,
      timing,
      sequence,
      loop,
      parallel,
      delay,
    },
    StyleSheet: {
      create: (styles: any) => styles,
      flatten: (style: any) =>
        Array.isArray(style) ? Object.assign({}, ...style) : style || {},
    },
  };
});

// ─── Mock Markdown ────────────────────────────────────────────────────────────
vi.mock("../../Markdown", () => ({
  defaultMarkdownStyles: {
    h1: {},
    h2: {},
    h3: {},
    code: {},
  },
  CopilotMarkdown: ({ content }: { content: string }) => {
    const React = require("react");
    return React.createElement(
      "div",
      { "data-testid": "copilot-markdown" },
      content,
    );
  },
}));

import { AssistantMessage } from "../AssistantMessage";
import { UserMessage } from "../UserMessage";
import { TypingIndicator } from "../TypingIndicator";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AssistantMessage edge cases", () => {
  it("renders empty content without crashing", () => {
    const { container } = render(<AssistantMessage content="" />);
    expect(container).toBeTruthy();
  });

  it("shows both markdown content AND typing indicator when both content and isLoading are provided", () => {
    // When content is truthy AND isLoading is true, BOTH should render
    // Looking at the source: content is rendered when truthy, isLoading adds typing indicator
    const { queryByTestId, queryByLabelText } = render(
      <AssistantMessage content="Thinking..." isLoading />,
    );

    expect(queryByTestId("copilot-markdown")).toBeTruthy();
    expect(queryByLabelText("Typing indicator")).toBeTruthy();
  });

  it("does not render markdown when content is empty", () => {
    const { queryByTestId } = render(<AssistantMessage content="" />);

    // Empty content = falsy = CopilotMarkdown should not render
    expect(queryByTestId("copilot-markdown")).toBeNull();
  });

  it("does not render typing indicator when isLoading is false", () => {
    const { queryByLabelText } = render(
      <AssistantMessage content="Hello" isLoading={false} />,
    );

    expect(queryByLabelText("Typing indicator")).toBeNull();
  });

  it("accepts style override", () => {
    const { container } = render(
      <AssistantMessage content="styled" style={{ marginTop: 20 }} />,
    );

    expect(container).toBeTruthy();
  });
});

describe("UserMessage edge cases", () => {
  it("renders empty content without crashing", () => {
    const { container } = render(<UserMessage content="" />);
    expect(container).toBeTruthy();
  });

  it("renders long content without crashing", () => {
    const longText = "A".repeat(5000);
    const { container } = render(<UserMessage content={longText} />);
    expect(container.textContent).toContain("A".repeat(100));
  });

  it("accepts style override", () => {
    const { container } = render(
      <UserMessage content="styled" style={{ marginBottom: 10 }} />,
    );

    expect(container).toBeTruthy();
  });
});

describe("TypingIndicator edge cases", () => {
  it("accepts style override", () => {
    const { getByLabelText } = render(
      <TypingIndicator style={{ paddingVertical: 10 }} />,
    );

    expect(getByLabelText("Typing indicator")).toBeTruthy();
  });

  it("has correct accessibility attributes", () => {
    const { getByLabelText } = render(<TypingIndicator />);

    const indicator = getByLabelText("Typing indicator");
    expect(indicator).toBeTruthy();
    expect(indicator.getAttribute("role")).toBe("text");
  });
});
