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
    mockSuggestions: [] as any[],
    reduceMotion: false,
    // Spied so tests can see which entrance animations start.
    timing: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  };
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

// This suite mocks react-core wholesale to unit-test CopilotChat's non-tool
// behavior. Tool-call rendering (which drives a REAL useRenderToolCall) lives
// in CopilotChatToolCalls.test.tsx; here useRenderToolCall is a stub that
// resolves no renderer, so tool calls fall through to the placeholder.
vi.mock("@copilotkit/react-core/v2/headless", () => ({
  useAgent: vi.fn(() => ({ agent: hoisted.mockAgent })),
  useRenderToolCall: vi.fn(() => () => null),
  useSuggestions: vi.fn(() => ({ suggestions: hoisted.mockSuggestions })),
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

// Mock react-native components with testable DOM elements, on top of the
// shared stub (animation, theme and accessibility primitives).
vi.mock("react-native", async () => {
  const actual = await vi.importActual<any>("../../__mocks__/react-native");
  const React = require("react");
  return {
    ...actual,
    Animated: { ...actual.Animated, timing: hoisted.timing },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(hoisted.reduceMotion),
      addEventListener: () => ({ remove: () => {} }),
    },
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
    hoisted.mockSuggestions = [];
    hoisted.reduceMotion = false;
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

  it("renders a compact tool card for unregistered tools", () => {
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

    expect(getByText("myTool")).toBeTruthy();
    expect(getByText("Done")).toBeTruthy();
  });

  it("marks an unregistered tool call as running until its result arrives", () => {
    hoisted.mockAgent.isRunning = true;
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

    const { getByText, rerender } = render(<CopilotChat />);
    expect(getByText("Running")).toBeTruthy();

    hoisted.mockAgent.messages = [
      ...hoisted.mockAgent.messages,
      { id: "2", role: "tool", toolCallId: "tc-1", content: "ok" },
    ];
    rerender(<CopilotChat />);
    expect(getByText("Done")).toBeTruthy();
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

describe("CopilotChat welcome screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockAgent.messages = [];
    hoisted.mockAgent.isRunning = false;
    hoisted.mockSuggestions = [];
    hoisted.reduceMotion = false;
  });

  // The entrance animations that started, as [delay] per animated element.
  const introDelays = () =>
    hoisted.timing.mock.calls
      .map(([, config]: any) => config)
      .filter((config: any) => config.duration === 480)
      .map((config: any) => config.delay);

  it("shows the agent's suggestions as cards, with the message as body", () => {
    hoisted.mockSuggestions = [
      {
        title: "Plan a launch",
        message: "Turn the Q3 goals into a plan",
        isLoading: false,
      },
      { title: "Say hi", message: "Say hi", isLoading: false },
    ];

    const { getByText, getAllByText } = render(<CopilotChat />);

    expect(getByText("Plan a launch")).toBeTruthy();
    expect(getByText("Turn the Q3 goals into a plan")).toBeTruthy();
    // A message that repeats the title isn't shown twice.
    expect(getAllByText("Say hi")).toHaveLength(1);
  });

  it("sends a card's message, not its title", async () => {
    hoisted.mockSuggestions = [
      {
        title: "Plan a launch",
        message: "Turn the Q3 goals into a plan",
        isLoading: false,
      },
    ];

    const { getByText } = render(<CopilotChat />);
    await act(async () => {
      fireEvent.click(getByText("Plan a launch"));
    });

    expect(hoisted.mockAgent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Turn the Q3 goals into a plan" }),
    );
  });

  it("eases the greeting, then the cards, then the input in", async () => {
    render(<CopilotChat initialMessages={["One", "Two", "Three"]} />);
    // Held until the reduced-motion setting is known.
    expect(introDelays()).toEqual([]);

    await act(async () => {});

    expect(introDelays()).toEqual([0, 70, 100, 130, 180]);
  });

  it("skips the intro when introAnimation is false", async () => {
    render(<CopilotChat initialMessages={["One"]} introAnimation={false} />);
    await act(async () => {});

    expect(introDelays()).toEqual([]);
  });

  it("skips the intro when the user prefers reduced motion", async () => {
    hoisted.reduceMotion = true;
    render(<CopilotChat initialMessages={["One"]} />);
    await act(async () => {});

    expect(introDelays()).toEqual([]);
  });

  it("has no intro once there is a conversation", async () => {
    hoisted.mockAgent.messages = [{ id: "1", role: "user", content: "Hi" }];
    render(<CopilotChat />);
    await act(async () => {});

    expect(introDelays()).toEqual([]);
  });

  it("keeps the same input through the first send", async () => {
    const { getByTestId, queryByText, rerender } = render(
      <CopilotChat initialMessages={["One"]} />,
    );
    const input = getByTestId("text-input");

    hoisted.mockAgent.messages = [{ id: "1", role: "user", content: "One" }];
    rerender(<CopilotChat initialMessages={["One"]} />);

    // The welcome screen is gone, but the input was never remounted.
    expect(queryByText("How can I help?")).toBeNull();
    expect(getByTestId("text-input")).toBe(input);
  });
});

describe("CopilotChat conversation suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockAgent.messages = [
      { id: "1", role: "user", content: "Hi" },
      { id: "2", role: "assistant", content: "Hello!" },
    ];
    hoisted.mockAgent.isRunning = false;
    hoisted.mockSuggestions = [
      {
        title: "Tell me more",
        message: "Tell me more about it",
        isLoading: false,
      },
    ];
  });

  it("shows the agent's suggestions as pills above the input", async () => {
    const { getByText } = render(<CopilotChat />);

    await act(async () => {
      fireEvent.click(getByText("Tell me more"));
    });
    expect(hoisted.mockAgent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Tell me more about it" }),
    );
  });

  it("hides them while the agent runs", () => {
    hoisted.mockAgent.isRunning = true;
    const { queryByText } = render(<CopilotChat />);

    expect(queryByText("Tell me more")).toBeNull();
  });

  it("leaves initialMessages on the welcome screen", () => {
    const { queryByText } = render(<CopilotChat initialMessages={["Hello"]} />);

    expect(queryByText("Hello")).toBeNull();
  });
});

describe("CopilotChat streaming cursor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockAgent.messages = [
      { id: "1", role: "user", content: "Hi" },
      { id: "2", role: "assistant", content: "Hello" },
    ];
    hoisted.mockAgent.isRunning = true;
    hoisted.mockSuggestions = [];
  });

  it("puts the cursor on the streaming reply by default", () => {
    const { getAllByTestId } = render(<CopilotChat />);

    const assistantMessages = getAllByTestId("assistant-message");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].textContent).toBe("Loading...");
  });

  it("keeps the cursor below the messages when inlineCursor is false", () => {
    const { getAllByTestId } = render(<CopilotChat inlineCursor={false} />);

    const assistantMessages = getAllByTestId("assistant-message");
    expect(assistantMessages.map((m) => m.textContent)).toEqual([
      "Hello",
      "Loading...",
    ]);
  });
});
