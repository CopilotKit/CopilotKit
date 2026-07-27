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
    mockToolRegistry: vi.fn(() => new Map()),
  };
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@copilotkit/react-core/v2/headless", () => ({
  useAgent: vi.fn(() => ({ agent: hoisted.mockAgent })),
}));

vi.mock("@copilotkit/react-core/v2/context", () => ({
  useCopilotKit: vi.fn(() => ({
    copilotkit: { runAgent: hoisted.mockRunAgent },
    executingToolCallIds: new Set<string>(),
  })),
}));

// Mock sub-components that B2 builds
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

// Mock RenderToolContext (B3)
vi.mock("../../hooks/RenderToolContext", () => ({
  useRenderToolRegistry: () => hoisted.mockToolRegistry(),
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

// Import component under test AFTER mocks
import { CopilotChat } from "../CopilotChat";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopilotChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockAgent.messages = [];
    hoisted.mockAgent.isRunning = false;
    hoisted.mockAgent.addMessage = vi.fn();
    hoisted.mockRunAgent.mockResolvedValue(undefined);
    hoisted.mockToolRegistry.mockReturnValue(new Map());
  });

  it("renders empty state when there are no messages", () => {
    const { getByText } = render(<CopilotChat />);

    expect(getByText("How can I help?")).toBeTruthy();
    expect(
      getByText("Ask me anything or try a suggestion below."),
    ).toBeTruthy();
  });

  it("renders custom empty state title and subtitle", () => {
    const { getByText } = render(
      <CopilotChat
        emptyStateTitle="Welcome!"
        emptyStateSubtitle="Start chatting"
      />,
    );

    expect(getByText("Welcome!")).toBeTruthy();
    expect(getByText("Start chatting")).toBeTruthy();
  });

  it("renders suggestion pills when initialMessages provided", () => {
    const suggestions = ["Hello", "Help me"];
    const { getByText } = render(<CopilotChat initialMessages={suggestions} />);

    expect(getByText("Hello")).toBeTruthy();
    expect(getByText("Help me")).toBeTruthy();
  });

  it("renders user and assistant messages", () => {
    hoisted.mockAgent.messages = [
      { id: "1", role: "user", content: "Hi there" },
      { id: "2", role: "assistant", content: "Hello! How can I help?" },
    ];

    const { getAllByTestId } = render(<CopilotChat />);

    const userMessages = getAllByTestId("user-message");
    const assistantMessages = getAllByTestId("assistant-message");

    expect(userMessages).toHaveLength(1);
    expect(assistantMessages).toHaveLength(1);
    expect(userMessages[0].textContent).toBe("Hi there");
    expect(assistantMessages[0].textContent).toBe("Hello! How can I help?");
  });

  it("shows loading indicator when agent is running", () => {
    hoisted.mockAgent.messages = [{ id: "1", role: "user", content: "Hi" }];
    hoisted.mockAgent.isRunning = true;

    const { getAllByTestId } = render(<CopilotChat />);

    const assistantMessages = getAllByTestId("assistant-message");
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

    const loadingMsg = assistantMessages[assistantMessages.length - 1];
    expect(loadingMsg.textContent).toBe("Loading...");
  });

  it("calls agent.addMessage and copilotkit.runAgent on send", async () => {
    const { getByTestId } = render(<CopilotChat />);

    const input = getByTestId("text-input");
    const sendBtn = getByTestId("send-button");

    await act(async () => {
      fireEvent.change(input, { target: { value: "Test message" } });
    });

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(hoisted.mockAgent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "Test message",
      }),
    );
    expect(hoisted.mockRunAgent).toHaveBeenCalledWith({
      agent: hoisted.mockAgent,
    });
  });

  it("disables send button when input is empty", () => {
    const { getByTestId } = render(<CopilotChat />);

    const sendBtn = getByTestId("send-button");
    expect(sendBtn).toHaveProperty("disabled", true);
  });

  it("disables send button when agent is running", async () => {
    hoisted.mockAgent.isRunning = true;

    const { getByTestId } = render(<CopilotChat />);

    const input = getByTestId("text-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "Test" } });
    });

    const sendBtn = getByTestId("send-button");
    expect(sendBtn).toHaveProperty("disabled", true);
  });

  it("shows header when showHeader is true", () => {
    const { getByText } = render(
      <CopilotChat showHeader headerTitle="My Chat" />,
    );

    expect(getByText("My Chat")).toBeTruthy();
  });

  it("hides header when showHeader is false", () => {
    const { queryByText } = render(
      <CopilotChat showHeader={false} headerTitle="Hidden" />,
    );

    expect(queryByText("Hidden")).toBeNull();
  });

  it("calls onSendMessage callback when sending", async () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<CopilotChat onSendMessage={onSend} />);

    const input = getByTestId("text-input");
    const sendBtn = getByTestId("send-button");

    await act(async () => {
      fireEvent.change(input, { target: { value: "Callback test" } });
    });

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(onSend).toHaveBeenCalledWith("Callback test");
  });

  it("renders tool call indicator for unregistered tools", () => {
    hoisted.mockAgent.messages = [
      {
        id: "1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            type: "function" as const,
            function: { name: "myTool", arguments: "{}" },
          },
        ],
      },
    ];

    const { getByText } = render(<CopilotChat />);

    expect(getByText("Called: myTool")).toBeTruthy();
  });

  it("renders registered tool renderer with correct props", () => {
    const receivedProps: any[] = [];
    const mockRenderer = (props: any) => {
      receivedProps.push(props);
      const React = require("react");
      return React.createElement(
        "div",
        { "data-testid": "tool-render" },
        `rendered: ${JSON.stringify(props.args)}`,
      );
    };

    const toolMap = new Map([["myTool", mockRenderer]]);
    hoisted.mockToolRegistry.mockReturnValue(toolMap);

    hoisted.mockAgent.messages = [
      {
        id: "1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            type: "function" as const,
            function: {
              name: "myTool",
              arguments: '{"city":"Seattle"}',
            },
          },
        ],
      },
    ];

    const { getByTestId } = render(<CopilotChat />);

    expect(getByTestId("tool-render")).toBeTruthy();
    expect(receivedProps[0]).toEqual({
      args: { city: "Seattle" },
      status: "complete",
    });
  });

  it("shows error message when runAgent fails", async () => {
    hoisted.mockRunAgent.mockRejectedValueOnce(new Error("Network timeout"));

    const { getByTestId, getByText } = render(<CopilotChat />);

    const input = getByTestId("text-input");
    const sendBtn = getByTestId("send-button");

    await act(async () => {
      fireEvent.change(input, { target: { value: "fail message" } });
    });

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(getByText("Network timeout")).toBeTruthy();
  });

  it("uses incrementing message IDs instead of Date.now()", async () => {
    const { getByTestId } = render(<CopilotChat />);
    const input = getByTestId("text-input");
    const sendBtn = getByTestId("send-button");

    await act(async () => {
      fireEvent.change(input, { target: { value: "first" } });
    });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await act(async () => {
      fireEvent.change(input, { target: { value: "second" } });
    });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    const calls = hoisted.mockAgent.addMessage.mock.calls;
    expect(calls[0][0].id).toBe("user-1");
    expect(calls[1][0].id).toBe("user-2");
  });
});
