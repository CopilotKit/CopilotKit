import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ─── Mock react-native ───────────────────────────────────────────────────────
// DOM-backed View/Text on top of the shared stub (animation, theme and
// accessibility primitives).
vi.mock("react-native", async () => {
  const actual = await vi.importActual<any>("../../../__mocks__/react-native");
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

  return {
    ...actual,
    View,
    Text,
    StyleSheet: {
      create: (styles: any) => styles,
      flatten: (style: any) =>
        Array.isArray(style) ? Object.assign({}, ...style) : style || {},
    },
  };
});

// ─── Mock Markdown ────────────────────────────────────────────────────────────
vi.mock("../../Markdown", () => ({
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
    const { queryByTestId, queryByLabelText } = render(
      <AssistantMessage content="Thinking..." isLoading />,
    );

    expect(queryByTestId("copilot-markdown")).toBeTruthy();
    expect(queryByLabelText("Typing indicator")).toBeTruthy();
  });

  it("puts the cursor at the end of the text with inlineCursor", () => {
    // Once text arrives the cursor rides it instead of sitting below.
    const { getByTestId, queryByLabelText } = render(
      <AssistantMessage content="Thinking..." isLoading inlineCursor />,
    );

    expect(getByTestId("copilot-markdown").textContent).toBe(
      "Thinking...\u00A0●",
    );
    expect(queryByLabelText("Typing indicator")).toBeNull();
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
