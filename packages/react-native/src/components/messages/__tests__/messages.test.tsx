import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ─── Mock react-native ───────────────────────────────────────────────────────
// jsdom doesn't have react-native: DOM-backed View/Text on top of the shared
// stub (animation, theme and accessibility primitives).
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

  const StyleSheet = {
    create: (styles: any) => styles,
    flatten: (style: any) =>
      Array.isArray(style) ? Object.assign({}, ...style) : style || {},
  };

  return {
    ...actual,
    View,
    Text,
    StyleSheet,
  };
});

// ─── Mock the Markdown component (B1 owns it, may not exist yet) ─────────────
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

// ─── Imports under test (after mocks) ────────────────────────────────────────
import { AssistantMessage } from "../AssistantMessage";
import { UserMessage } from "../UserMessage";
import { TypingIndicator } from "../TypingIndicator";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AssistantMessage", () => {
  it("renders content via CopilotMarkdown", () => {
    const { getByTestId } = render(
      <AssistantMessage content="Hello from the assistant" />,
    );
    const markdown = getByTestId("copilot-markdown");
    expect(markdown).toBeTruthy();
    expect(markdown.textContent).toBe("Hello from the assistant");
  });

  it("shows TypingIndicator when isLoading is true", () => {
    const { getByLabelText, queryByTestId } = render(
      <AssistantMessage content="" isLoading />,
    );
    // Typing indicator should be present
    expect(getByLabelText("Typing indicator")).toBeTruthy();
    // Markdown should NOT render during loading
    expect(queryByTestId("copilot-markdown")).toBeNull();
  });

  it("rides the cursor at the end of the text while it streams", () => {
    const { getByTestId, queryByLabelText } = render(
      <AssistantMessage content={"Hello\n\n- first\n- sec"} isLoading />,
    );
    expect(getByTestId("copilot-markdown").textContent).toBe(
      "Hello\n\n- first\n- sec\u00A0●",
    );
    expect(queryByLabelText("Typing indicator")).toBeNull();
  });

  it("keeps the cursor below a reply that ends in a code block", () => {
    const content = "Here:\n\n```ts\nconst a = 1;";
    const { getByTestId, getByLabelText } = render(
      <AssistantMessage content={content} isLoading />,
    );
    expect(getByTestId("copilot-markdown").textContent).toBe(content);
    expect(getByLabelText("Typing indicator")).toBeTruthy();
  });

  it("drops the cursor once the reply is complete", () => {
    const { getByTestId } = render(<AssistantMessage content="Done." />);
    expect(getByTestId("copilot-markdown").textContent).toBe("Done.");
  });

  it("displays a timestamp when provided", () => {
    const date = new Date(2025, 0, 15, 14, 30); // Jan 15 2025, 2:30 PM
    const { container } = render(
      <AssistantMessage content="Hi" timestamp={date} />,
    );
    expect(container.textContent).toContain("2:30 PM");
  });

  it("does not display timestamp when not provided", () => {
    const { container } = render(<AssistantMessage content="No timestamp" />);
    // Should only contain the message text (via markdown mock)
    expect(container.textContent).toBe("No timestamp");
  });
});

describe("UserMessage", () => {
  it("renders plain text content", () => {
    const { container } = render(<UserMessage content="Hello from the user" />);
    expect(container.textContent).toContain("Hello from the user");
  });

  it("displays a timestamp when provided", () => {
    const date = new Date(2025, 5, 20, 9, 5); // Jun 20 2025, 9:05 AM
    const { container } = render(
      <UserMessage content="Morning" timestamp={date} />,
    );
    expect(container.textContent).toContain("9:05 AM");
  });

  it("does not display timestamp when not provided", () => {
    const { container } = render(<UserMessage content="Just text" />);
    expect(container.textContent).toBe("Just text");
  });
});

describe("TypingIndicator", () => {
  it("renders a single pulsing dot", () => {
    const { getByLabelText } = render(<TypingIndicator />);
    const indicator = getByLabelText("Typing indicator");
    expect(indicator).toBeTruthy();
    // One Animated.View dot inside the container
    expect(indicator.children.length).toBe(1);
  });
});
