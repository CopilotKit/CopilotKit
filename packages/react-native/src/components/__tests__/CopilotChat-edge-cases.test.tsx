import React from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Hoisted state ─────────────────────────────────────────────────────────────

const hoisted = vi.hoisted(() => {
  return {
    mockAgent: {
      messages: [] as any[],
      isRunning: false,
      addMessage: vi.fn(),
    },
    mockRunAgent: vi.fn().mockResolvedValue(undefined),
    mockExecutingToolCallIds: new Set<string>(),
  };
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

// react-core is mocked wholesale for these unit-level edge cases. Tool-call
// rendering against a REAL useRenderToolCall lives in
// CopilotChatToolCalls.test.tsx; here useRenderToolCall resolves no renderer so
// tool calls fall through to the "Called: <name>" placeholder.
vi.mock("@copilotkit/react-core/v2/headless", () => ({
  useAgent: vi.fn(() => ({ agent: hoisted.mockAgent })),
  useRenderToolCall: vi.fn(() => () => null),
}));

vi.mock("@copilotkit/react-core/v2/context", () => ({
  useCopilotKit: vi.fn(() => ({
    copilotkit: { runAgent: hoisted.mockRunAgent },
    executingToolCallIds: hoisted.mockExecutingToolCallIds,
  })),
}));

vi.mock("../messages/AssistantMessage", () => ({
  AssistantMessage: ({ content, isLoading }: any) => {
    const React = require("react");
    return React.createElement(
      "div",
      { "data-testid": "assistant-message" },
      isLoading ? "Loading..." : content,
    );
  },
}));

vi.mock("../messages/UserMessage", () => ({
  UserMessage: ({ content }: any) => {
    const React = require("react");
    return React.createElement(
      "div",
      { "data-testid": "user-message" },
      content,
    );
  },
}));

// Mock react-native components with testable DOM elements
vi.mock("react-native", () => {
  const React = require("react");
  return {
    FlatList: ({ data, renderItem, ListEmptyComponent, keyExtractor }: any) => {
      if (!data || data.length === 0) {
        return React.createElement(
          "div",
          { "data-testid": "flatlist" },
          ListEmptyComponent,
        );
      }
      return React.createElement(
        "div",
        { "data-testid": "flatlist" },
        data.map((item: any, index: number) =>
          React.createElement(
            "div",
            { key: keyExtractor?.(item, index) ?? index },
            renderItem({ item, index }),
          ),
        ),
      );
    },
    KeyboardAvoidingView: ({ children }: any) =>
      React.createElement("div", { "data-testid": "keyboard-view" }, children),
    Platform: { OS: "ios" },
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        "button",
        { onClick: onPress, "data-testid": "pressable", ...props },
        children,
      ),
    StyleSheet: {
      create: (styles: any) => styles,
      hairlineWidth: 1,
    },
    Text: ({ children, ...props }: any) =>
      React.createElement("span", props, children),
    TextInput: ({ value, onChangeText, onSubmitEditing, ...props }: any) =>
      React.createElement("input", {
        value,
        onChange: (e: any) => onChangeText?.(e.target.value),
        onKeyDown: (e: any) => {
          if (e.key === "Enter") onSubmitEditing?.();
        },
        "data-testid": "text-input",
        ...props,
      }),
    TouchableOpacity: ({
      children,
      onPress,
      disabled,
      testID,
      ...props
    }: any) =>
      React.createElement(
        "button",
        {
          onClick: onPress,
          disabled,
          ...(testID ? { "data-testid": testID } : {}),
          ...props,
        },
        children,
      ),
    View: ({ children, ...props }: any) =>
      React.createElement("div", props, children),
  };
});

import { CopilotChat } from "../CopilotChat";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopilotChat edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockAgent.messages = [];
    hoisted.mockAgent.isRunning = false;
    hoisted.mockAgent.addMessage = vi.fn();
    hoisted.mockRunAgent.mockResolvedValue(undefined);
    hoisted.mockExecutingToolCallIds.clear();
  });

  describe("disableKeyboardAvoiding", () => {
    it("wraps content in KeyboardAvoidingView by default", () => {
      const { getByTestId } = render(<CopilotChat />);
      expect(getByTestId("keyboard-view")).toBeTruthy();
    });

    it("skips KeyboardAvoidingView when disableKeyboardAvoiding is true", () => {
      const { queryByTestId } = render(<CopilotChat disableKeyboardAvoiding />);
      expect(queryByTestId("keyboard-view")).toBeNull();
    });
  });

  describe("FlatListComponent", () => {
    it("uses custom FlatListComponent when provided", () => {
      const CustomFlatList = ({
        data,
        renderItem,
        ListEmptyComponent,
        keyExtractor,
      }: any) => {
        return React.createElement(
          "div",
          { "data-testid": "custom-flatlist" },
          ListEmptyComponent,
        );
      };

      const { getByTestId, queryByTestId } = render(
        <CopilotChat FlatListComponent={CustomFlatList} />,
      );

      expect(getByTestId("custom-flatlist")).toBeTruthy();
      // The default FlatList should not be rendered
      expect(queryByTestId("flatlist")).toBeNull();
    });
  });

  describe("message list building", () => {
    it("handles assistant messages with empty content and tool calls", () => {
      hoisted.mockAgent.messages = [
        {
          id: "1",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tc-1",
              type: "function" as const,
              function: { name: "unknownTool", arguments: "{}" },
            },
          ],
        },
      ];

      const { getByText, queryAllByTestId } = render(<CopilotChat />);

      // Should show tool call indicator, not an empty assistant message
      expect(getByText("Called: unknownTool")).toBeTruthy();
      expect(queryAllByTestId("assistant-message")).toHaveLength(0);
    });

    it("handles assistant messages with both content and tool calls", () => {
      hoisted.mockAgent.messages = [
        {
          id: "1",
          role: "assistant",
          content: "Let me check that for you",
          toolCalls: [
            {
              id: "tc-1",
              type: "function" as const,
              function: { name: "searchTool", arguments: "{}" },
            },
          ],
        },
      ];

      const { getByText, getByTestId } = render(<CopilotChat />);

      // Should show both content and tool call indicator
      expect(getByTestId("assistant-message").textContent).toBe(
        "Let me check that for you",
      );
      expect(getByText("Called: searchTool")).toBeTruthy();
    });

    it("shows loading indicator when agent is running and last message is from user", () => {
      hoisted.mockAgent.messages = [
        { id: "1", role: "user", content: "Hello" },
      ];
      hoisted.mockAgent.isRunning = true;

      const { getAllByTestId } = render(<CopilotChat />);

      // Should have user message + loading assistant message
      const userMessages = getAllByTestId("user-message");
      const assistantMessages = getAllByTestId("assistant-message");
      expect(userMessages).toHaveLength(1);
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].textContent).toBe("Loading...");
    });

    it("does not add extra loading indicator when last item is already an assistant message", () => {
      hoisted.mockAgent.messages = [
        { id: "1", role: "user", content: "Hello" },
        { id: "2", role: "assistant", content: "I'm thinking..." },
      ];
      hoisted.mockAgent.isRunning = true;

      const { getAllByTestId } = render(<CopilotChat />);

      // Should NOT add an extra loading indicator since last message is assistant
      const assistantMessages = getAllByTestId("assistant-message");
      expect(assistantMessages).toHaveLength(1);
    });
  });

  describe("empty message handling", () => {
    it("does not send a whitespace-only message", async () => {
      const { getByTestId } = render(<CopilotChat />);

      const input = getByTestId("text-input");
      const sendBtn = getByTestId("send-button");

      await act(async () => {
        fireEvent.change(input, { target: { value: "   " } });
      });

      // Button should still be disabled for whitespace-only input
      expect(sendBtn).toHaveProperty("disabled", true);
    });
  });

  describe("suggestion pill interaction", () => {
    it("sends a message when a suggestion pill is pressed", async () => {
      const suggestions = ["Tell me a joke"];
      const { getByText } = render(
        <CopilotChat initialMessages={suggestions} />,
      );

      await act(async () => {
        fireEvent.click(getByText("Tell me a joke"));
      });

      expect(hoisted.mockAgent.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "user",
          content: "Tell me a joke",
        }),
      );
      expect(hoisted.mockRunAgent).toHaveBeenCalled();
    });
  });
});
