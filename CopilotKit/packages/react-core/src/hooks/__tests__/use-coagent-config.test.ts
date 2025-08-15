import { renderHook } from "@testing-library/react";
import { useCoAgent } from "../use-coagent";

// Mock the dependencies
const mockSetCoagentStatesWithRef = jest.fn();
const mockAppendMessage = jest.fn();
const mockRunChatCompletion = jest.fn();

jest.mock("../use-copilot-chat_internal", () => ({
  useCopilotChat: () => ({
    appendMessage: mockAppendMessage,
    runChatCompletion: mockRunChatCompletion,
  }),
}));

jest.mock("../use-copilot-runtime-client", () => ({
  useCopilotRuntimeClient: () => ({
    loadAgentState: jest.fn().mockResolvedValue({
      data: { loadAgentState: { state: "{}", threadExists: false } },
      error: null,
    }),
  }),
}));

jest.mock("../../context", () => ({
  useCopilotContext: () => ({
    availableAgents: [],
    coagentStates: {},
    coagentStatesRef: { current: {} },
    setCoagentStatesWithRef: mockSetCoagentStatesWithRef,
    threadId: "test-thread",
    copilotApiConfig: {
      headers: {},
      chatApiEndpoint: "test-endpoint",
      publicApiKey: "test-key",
    },
    showDevConsole: false,
  }),
  useCopilotMessagesContext: () => ({
    messages: [],
  }),
}));

jest.mock("../../components/toast/toast-provider", () => ({
  useToast: () => ({
    setBannerError: jest.fn(),
  }),
}));

jest.mock("../../components/error-boundary/error-utils", () => ({
  useAsyncCallback: (fn: any) => fn,
}));

jest.mock("../../components/copilot-provider/copilot-messages", () => ({
  useMessagesTap: () => ({
    getMessagesFromTap: jest.fn(() => []),
    updateTapMessages: jest.fn(),
  }),
}));

describe("useCoAgent config synchronization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetCoagentStatesWithRef.mockImplementation((updater) => {
      if (typeof updater === "function") {
        updater({});
      }
    });
  });

  it("should call setCoagentStatesWithRef when config changes", () => {
    const { rerender } = renderHook(
      ({ config }) =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 0 },
          config,
        }),
      {
        initialProps: { config: { configurable: { model: "gpt-4" } } },
      },
    );

    // Clear the initial calls
    mockSetCoagentStatesWithRef.mockClear();

    // Change config
    rerender({ config: { configurable: { model: "gpt-4o" } } });

    // Should have called setCoagentStatesWithRef with new config
    expect(mockSetCoagentStatesWithRef).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should not call setCoagentStatesWithRef when config is unchanged", () => {
    const config = { configurable: { model: "gpt-4" } };

    const { rerender } = renderHook(
      ({ config }) =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 0 },
          config,
        }),
      {
        initialProps: { config },
      },
    );

    // Clear the initial calls
    mockSetCoagentStatesWithRef.mockClear();

    // Re-render with same config
    rerender({ config });

    // Should not have called setCoagentStatesWithRef
    expect(mockSetCoagentStatesWithRef).not.toHaveBeenCalled();
  });

  it("should handle backward compatibility with configurable prop", () => {
    const { rerender } = renderHook(
      ({ configurable }) =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 0 },
          configurable,
        }),
      {
        initialProps: { configurable: { model: "gpt-4" } },
      },
    );

    // Clear the initial calls
    mockSetCoagentStatesWithRef.mockClear();

    // Change configurable prop
    rerender({ configurable: { model: "gpt-4o" } });

    // Should have called setCoagentStatesWithRef
    expect(mockSetCoagentStatesWithRef).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should update config while preserving other state properties", () => {
    let capturedUpdater: any = null;

    mockSetCoagentStatesWithRef.mockImplementation((updater) => {
      capturedUpdater = updater;
      return updater;
    });

    const { rerender } = renderHook(
      ({ config }) =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 0 },
          config,
        }),
      {
        initialProps: { config: { configurable: { model: "gpt-4" } } },
      },
    );

    // Clear the initial calls and reset captured updater
    mockSetCoagentStatesWithRef.mockClear();
    capturedUpdater = null;

    // Change config
    rerender({ config: { configurable: { model: "gpt-4o" } } });

    // Should have called setCoagentStatesWithRef
    expect(mockSetCoagentStatesWithRef).toHaveBeenCalledWith(expect.any(Function));
    expect(capturedUpdater).toBeTruthy();

    // Test the updater function behavior
    const prevState = {
      "test-agent": {
        name: "test-agent",
        state: { count: 5 },
        config: { configurable: { model: "gpt-4" } },
        running: true,
        active: true,
        threadId: "thread-123",
        nodeName: "test-node",
        runId: "run-456",
      },
    };

    const newState = capturedUpdater(prevState);

    // Verify the state is updated correctly
    expect(newState).toEqual({
      "test-agent": {
        name: "test-agent",
        state: { count: 5 }, // State preserved
        config: { configurable: { model: "gpt-4o" } }, // Config updated
        running: true, // Other properties preserved
        active: true,
        threadId: "thread-123",
        nodeName: "test-node",
        runId: "run-456",
      },
    });
  });

  it("should create new agent state when agent doesn't exist", () => {
    let capturedUpdater: any = null;

    mockSetCoagentStatesWithRef.mockImplementation((updater) => {
      capturedUpdater = updater;
      return updater;
    });

    const { rerender } = renderHook(
      ({ config }) =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 0 },
          config,
        }),
      {
        initialProps: { config: { configurable: { model: "gpt-4" } } },
      },
    );

    // Clear the initial calls and reset captured updater
    mockSetCoagentStatesWithRef.mockClear();
    capturedUpdater = null;

    // Change config
    rerender({ config: { configurable: { model: "gpt-4o" } } });

    // Should have called setCoagentStatesWithRef
    expect(mockSetCoagentStatesWithRef).toHaveBeenCalledWith(expect.any(Function));
    expect(capturedUpdater).toBeTruthy();

    // Test the updater function behavior with empty previous state
    const prevState = {}; // No existing agent state

    const newState = capturedUpdater(prevState);

    // Verify the state creates a new agent state with default values
    expect(newState).toEqual({
      "test-agent": {
        name: "test-agent",
        state: { count: 0 }, // Uses initialState
        config: { configurable: { model: "gpt-4o" } }, // New config
        running: false, // Default values
        active: false,
        threadId: undefined,
        nodeName: undefined,
        runId: undefined,
      },
    });
  });

  it("should handle deeply nested config changes", () => {
    const { rerender } = renderHook(
      ({ config }) =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 0 },
          config,
        }),
      {
        initialProps: {
          config: {
            configurable: {
              model: "gpt-4",
              settings: { temperature: 0.5 },
            },
          },
        },
      },
    );

    // Clear the initial calls
    mockSetCoagentStatesWithRef.mockClear();

    // Change nested config
    rerender({
      config: {
        configurable: {
          model: "gpt-4",
          settings: { temperature: 0.7 }, // Only nested property changed
        },
      },
    });

    // Should detect the nested change
    expect(mockSetCoagentStatesWithRef).toHaveBeenCalledWith(expect.any(Function));
  });
});
