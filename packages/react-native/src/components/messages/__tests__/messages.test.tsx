import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";

// ─── Mock react-native ───────────────────────────────────────────────────────
// jsdom doesn't have react-native, so we provide lightweight stand-ins.
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

  const timing = (_value: any, _config: any) => ({
    start: vi.fn(),
    stop: vi.fn(),
  });

  const sequence = (animations: any[]) => ({
    start: vi.fn(),
    stop: vi.fn(),
  });

  const loop = (animation: any) => ({
    start: vi.fn(),
    stop: vi.fn(),
  });

  const parallel = (animations: any[]) => ({
    start: vi.fn(),
    stop: vi.fn(),
  });

  const delay = (_ms: number) => ({
    start: vi.fn(),
    stop: vi.fn(),
  });

  const Animated = {
    Value: AnimatedValue,
    View: AnimatedView,
    timing,
    sequence,
    loop,
    parallel,
    delay,
  };

  const StyleSheet = {
    create: (styles: any) => styles,
    flatten: (style: any) =>
      Array.isArray(style) ? Object.assign({}, ...style) : style || {},
  };

  return {
    View,
    Text,
    Animated,
    StyleSheet,
  };
});

// ─── Mock the Markdown component (B1 owns it, may not exist yet) ─────────────
const markdownProps = vi.hoisted(() => ({ current: null as any }));

vi.mock("../../Markdown", () => ({
  defaultMarkdownStyles: {
    h1: {
      fontSize: 24,
      fontWeight: "bold",
      marginTop: 12,
      marginBottom: 8,
      color: "#111111",
    },
    h2: {
      fontSize: 20,
      fontWeight: "bold",
      marginTop: 10,
      marginBottom: 6,
      color: "#111111",
    },
    h3: {
      fontSize: 18,
      fontWeight: "600",
      marginTop: 8,
      marginBottom: 4,
      color: "#222222",
    },
    code: {
      backgroundColor: "#f0f0f0",
      fontFamily: "monospace",
      fontSize: 14,
    },
  },
  CopilotMarkdown: (props: {
    content: string;
    style?: Record<string, Record<string, unknown>>;
    streamingAnimation?: boolean;
  }) => {
    const React = require("react");
    markdownProps.current = props;
    return React.createElement(
      "div",
      { "data-testid": "copilot-markdown" },
      props.content,
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
  beforeEach(() => {
    markdownProps.current = null;
  });

  it("renders content via CopilotMarkdown", () => {
    const { getByTestId } = render(
      <UserMessage content="Hello **from the user**" />,
    );

    expect(getByTestId("copilot-markdown").textContent).toBe(
      "Hello **from the user**",
    );
    expect(markdownProps.current).toMatchObject({
      content: "Hello **from the user**",
      streamingAnimation: false,
      style: {
        paragraph: {
          color: "#FFFFFF",
          fontSize: 16,
          lineHeight: 22,
          marginTop: 0,
          marginBottom: 0,
        },
        h1: {
          fontSize: 24,
          fontWeight: "bold",
          marginTop: 12,
          marginBottom: 8,
          color: "#FFFFFF",
        },
        h2: {
          fontSize: 20,
          fontWeight: "bold",
          marginTop: 10,
          marginBottom: 6,
          color: "#FFFFFF",
        },
        h3: {
          fontSize: 18,
          fontWeight: "600",
          marginTop: 8,
          marginBottom: 4,
          color: "#FFFFFF",
        },
        h4: { color: "#FFFFFF" },
        h5: { color: "#FFFFFF" },
        h6: { color: "#FFFFFF" },
        link: { color: "#FFFFFF", underline: true },
        list: {
          color: "#FFFFFF",
          bulletColor: "#FFFFFF",
          markerColor: "#FFFFFF",
          marginTop: 4,
          marginBottom: 4,
        },
        code: {
          backgroundColor: "#004C99",
          color: "#FFFFFF",
          fontFamily: "monospace",
          fontSize: 14,
        },
      },
    });
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
  it("renders three animated dots", () => {
    const { getByLabelText } = render(<TypingIndicator />);
    const indicator = getByLabelText("Typing indicator");
    expect(indicator).toBeTruthy();
    // Three Animated.View dots inside the container
    expect(indicator.children.length).toBe(3);
  });
});
