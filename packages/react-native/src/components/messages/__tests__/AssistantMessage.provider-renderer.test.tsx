import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("react-native", () => {
  const R = require("react");
  const View = R.forwardRef(
    ({ children, style, testID, ...rest }: any, ref: any) =>
      R.createElement(
        "div",
        { ref, style, "data-testid": testID, ...rest },
        children,
      ),
  );
  View.displayName = "View";
  const Text = R.forwardRef(({ children, style, ...rest }: any, ref: any) =>
    R.createElement("span", { ref, style, ...rest }, children),
  );
  Text.displayName = "Text";
  return {
    View,
    Text,
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
  };
});

// The typing indicator pulls in the RN Animated API which the minimal mock
// above does not provide; it is irrelevant to renderer resolution.
vi.mock("../TypingIndicator", () => ({ TypingIndicator: () => null }));

import { AssistantMessage } from "../AssistantMessage";
import { MarkdownRendererProvider } from "../../MarkdownRendererContext";

describe("AssistantMessage provider markdown renderer (slot -> provider -> built-in)", () => {
  it("uses a provider-level renderer when CopilotKitProvider sets one", () => {
    const Custom = ({
      content,
      isStreaming,
    }: {
      content: string;
      isStreaming?: boolean;
    }) =>
      React.createElement(
        "span",
        {
          "data-testid": "custom-renderer",
          "data-streaming": String(!!isStreaming),
        },
        content,
      );

    const { getByTestId } = render(
      <MarkdownRendererProvider renderer={Custom}>
        <AssistantMessage content="hello world" isLoading />
      </MarkdownRendererProvider>,
    );

    const el = getByTestId("custom-renderer");
    // Regression: previously AssistantMessage always used CopilotMarkdown and
    // silently ignored the provider renderer, contradicting the migration guide.
    expect(el.textContent).toBe("hello world");
    // `isLoading` (streaming) must flow through as `isStreaming`.
    expect(el.getAttribute("data-streaming")).toBe("true");
  });

  it("falls back to the built-in renderer when no provider renderer is set", () => {
    const { queryByTestId, container } = render(
      <AssistantMessage content="hello world" />,
    );
    expect(queryByTestId("custom-renderer")).toBeNull();
    expect(container.textContent).toContain("hello world");
  });
});
