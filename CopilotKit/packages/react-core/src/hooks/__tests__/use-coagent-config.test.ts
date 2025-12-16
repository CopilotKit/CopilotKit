import { renderHook, waitFor } from "@testing-library/react";
import { useCoAgent } from "../use-coagent";
import type { AgentSubscriber } from "@ag-ui/client";

// Mock functions for @copilotkitnext/react
const mockSetState = jest.fn();
const mockRunAgent = jest.fn();
const mockAbortRun = jest.fn();
const mockSubscribe = jest.fn();
const mockSetProperties = jest.fn();

// Store the last subscriber for triggering events
let lastSubscriber: AgentSubscriber | null = null;

const mockAgent = {
  agentId: "test-agent",
  state: { count: 0 },
  isRunning: false,
  threadId: "thread-123",
  setState: mockSetState,
  runAgent: mockRunAgent,
  abortRun: mockAbortRun,
  subscribe: mockSubscribe.mockImplementation((subscriber: AgentSubscriber) => {
    lastSubscriber = subscriber;
    return {
      unsubscribe: jest.fn(),
    };
  }),
};

jest.mock("@copilotkitnext/react", () => ({
  useAgent: jest.fn(() => ({ agent: mockAgent })),
  useCopilotKit: jest.fn(() => ({
    copilotkit: {
      setProperties: mockSetProperties,
    },
  })),
}));

// Mock other dependencies
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
    lastSubscriber = null;
  });

  it("should call setProperties when config changes", async () => {
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
    mockSetProperties.mockClear();

    // Change config
    rerender({ config: { configurable: { model: "gpt-4o" } } });

    // Wait for effect to complete and verify setProperties was called
    await waitFor(() => {
      expect(mockSetProperties).toHaveBeenCalledWith({
        configurable: { model: "gpt-4o" },
      });
    });
  });

  it("should not call setProperties when config is unchanged", () => {
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
    mockSetProperties.mockClear();

    // Re-render with same config reference
    rerender({ config });

    // Should not have called setProperties
    expect(mockSetProperties).not.toHaveBeenCalled();
  });

  it("should handle backward compatibility with configurable prop", async () => {
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
    mockSetProperties.mockClear();

    // Change configurable prop
    rerender({ configurable: { model: "gpt-4o" } });

    // Wait for effect to complete and verify setProperties was called
    await waitFor(() => {
      expect(mockSetProperties).toHaveBeenCalledWith({
        configurable: { model: "gpt-4o" },
      });
    });
  });

  it("should not call setProperties when both config and configurable are undefined", () => {
    renderHook(() =>
      useCoAgent({
        name: "test-agent",
        initialState: { count: 0 },
      }),
    );

    // Should not have called setProperties
    expect(mockSetProperties).not.toHaveBeenCalled();
  });

  it("should handle deeply nested config changes", async () => {
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
    mockSetProperties.mockClear();

    // Change nested config
    rerender({
      config: {
        configurable: {
          model: "gpt-4",
          settings: { temperature: 0.7 }, // Only nested property changed
        },
      },
    });

    // Wait for effect to complete and verify setProperties was called
    await waitFor(() => {
      expect(mockSetProperties).toHaveBeenCalledWith({
        configurable: {
          model: "gpt-4",
          settings: { temperature: 0.7 },
        },
      });
    });
  });

  describe("State Management", () => {
    // Helper to create mock subscriber params
    const createMockParams = (stateOverride: any = {}) => ({
      messages: [],
      state: stateOverride,
      agent: mockAgent as any,
      input: {} as any,
    });

    it("should initialize agent state via onRunInitialized event", () => {
      // Set agent to have NO state (empty object)
      mockAgent.state = {} as any;

      renderHook(() =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 42 },
        }),
      );

      // Verify subscription was created
      expect(mockSubscribe).toHaveBeenCalled();
      expect(lastSubscriber).toBeTruthy();

      // Clear any initial state calls
      mockSetState.mockClear();

      // Trigger onRunInitialized with no run state
      lastSubscriber?.onRunInitialized?.(createMockParams({}));

      // Should set state to initialState
      expect(mockSetState).toHaveBeenCalledWith({ count: 42 });

      // Reset agent state
      mockAgent.state = { count: 0 };
    });

    it("should preserve existing agent state on onRunInitialized", () => {
      // Set agent to have existing state
      mockAgent.state = { count: 100 };

      renderHook(() =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 42 },
        }),
      );

      // Clear any initial state calls
      mockSetState.mockClear();

      // Trigger onRunInitialized with no new state
      lastSubscriber?.onRunInitialized?.(createMockParams({}));

      // Should NOT override existing state
      expect(mockSetState).not.toHaveBeenCalled();

      // Reset agent state
      mockAgent.state = { count: 0 };
    });

    it("should prioritize run state over initialState", () => {
      renderHook(() =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 42 },
        }),
      );

      // Clear any initial state calls
      mockSetState.mockClear();

      // Trigger onRunInitialized with state from the run
      lastSubscriber?.onRunInitialized?.(createMockParams({ count: 999 }));

      // Should use run state, not initialState
      expect(mockSetState).toHaveBeenCalledWith({ count: 999 });
    });

    it("should handle setState with object updates", () => {
      const { result } = renderHook(() =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 0 },
        }),
      );

      // Update state with object
      result.current.setState({ count: 5 });

      // Should merge with existing state
      expect(mockSetState).toHaveBeenCalledWith({ count: 5 });
    });

    it("should handle setState with function updaters", () => {
      // Set current agent state
      mockAgent.state = { count: 10 };

      const { result } = renderHook(() =>
        useCoAgent({
          name: "test-agent",
          initialState: { count: 0 },
        }),
      );

      // Update state with function
      result.current.setState((prev) => ({ count: (prev?.count || 0) + 5 }));

      // Should call function with current state and set result
      expect(mockSetState).toHaveBeenCalledWith({ count: 15 });

      // Reset agent state
      mockAgent.state = { count: 0 };
    });
  });
});
