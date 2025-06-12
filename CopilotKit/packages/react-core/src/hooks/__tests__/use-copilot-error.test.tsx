/* eslint-env jest */
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { useCopilotError, useCopilotErrorBoundary } from "../use-copilot-error";
import { CopilotContext } from "../../context/copilot-context";
import {
  CopilotRuntimeError,
  ComponentError,
  NetworkError,
  DataProcessingError,
  RuntimeError,
} from "../../types/error-handler";

// Mock the CopilotContext
const createMockContext = (handleError = jest.fn()) => {
  // Create a unique context object that won't equal emptyCopilotContext
  const context = {
    // Add a unique identifier to ensure this context is never equal to emptyCopilotContext
    __isTestContext: true,
    // Essential error handling
    handleError,
    // Required context properties (can be minimal for tests)
    actions: {},
    chatComponentsCache: { current: { actions: {}, coAgentStateRenders: {} } },
    getFunctionCallHandler: jest.fn(),
    setAction: jest.fn(),
    removeAction: jest.fn(),
    coAgentStateRenders: {},
    setCoAgentStateRender: jest.fn(),
    removeCoAgentStateRender: jest.fn(),
    getContextString: jest.fn(),
    addContext: jest.fn(),
    removeContext: jest.fn(),
    getAllContext: jest.fn(),
    // Additional properties that may be needed
    addDocumentContext: jest.fn(),
    removeDocumentContext: jest.fn(),
    getDocumentsContext: jest.fn(),
    messages: [],
    setMessages: jest.fn(),
    isLoading: false,
    setIsLoading: jest.fn(),
    chatSuggestionConfiguration: {},
    addChatSuggestionConfiguration: jest.fn(),
    removeChatSuggestionConfiguration: jest.fn(),
    // Chat properties
    chatInstructions: "",
    setChatInstructions: jest.fn(),
    additionalInstructions: [],
    setAdditionalInstructions: jest.fn(),
    copilotApiConfig: {
      chatApiEndpoint: "http://test.com",
      headers: {},
    },
    showDevConsole: false,
    coagentStates: {},
    setCoagentStates: jest.fn(),
    coagentStatesRef: { current: {} },
    setCoagentStatesWithRef: jest.fn(),
    agentSession: null,
    setAgentSession: jest.fn(),
    forwardedParameters: {},
    agentLock: null,
    threadId: "test-thread",
    setThreadId: jest.fn(),
    runId: null,
    setRunId: jest.fn(),
    chatAbortControllerRef: { current: null },
    runtimeClient: {},
    availableAgents: [],
    authStates_c: {},
    setAuthStates_c: jest.fn(),
    authConfig_c: undefined,
    extensions: {},
    setExtensions: jest.fn(),
    langGraphInterruptAction: null,
    setLangGraphInterruptAction: jest.fn(),
    removeLangGraphInterruptAction: jest.fn(),
    onError: undefined,
  };

  // Ensure this is a completely different object reference
  Object.defineProperty(context, "__testContextMarker", {
    value: Math.random(),
    writable: false,
  });

  return context;
};

const ContextWrapper = ({ children, mockContext }: any) => (
  <CopilotContext.Provider value={mockContext}>{children}</CopilotContext.Provider>
);

// Helper to render a hook with the mocked CopilotContext
function renderWithContext<T>(hook: () => T, mockContext: any) {
  let result: any;
  act(() => {
    result = renderHook(hook, {
      wrapper: ({ children }) => ContextWrapper({ children, mockContext }),
    });
  });
  return result.result;
}

describe("useCopilotError", () => {
  let mockHandleError: jest.Mock;
  let mockContext: any;

  beforeEach(() => {
    mockHandleError = jest.fn();
    mockContext = createMockContext(mockHandleError);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should call context handleError with component name", async () => {
    const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

    expect(result.current).not.toBeNull();

    const testError = new Error("Test error");

    await act(async () => {
      await result.current.handleError(testError);
    });

    expect(mockHandleError).toHaveBeenCalledWith(testError, {
      componentName: "TestComponent",
    });
  });

  it("should call context handleError with additional context", async () => {
    const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

    expect(result.current).not.toBeNull();

    const testError = new Error("Test error");
    const additionalContext = { customData: "test" };

    await act(async () => {
      await result.current.handleError(testError, additionalContext as any);
    });

    expect(mockHandleError).toHaveBeenCalledWith(testError, {
      componentName: "TestComponent",
      customData: "test",
    });
  });

  it("should work without component name", async () => {
    const result = renderWithContext(() => useCopilotError(), mockContext);

    expect(result.current).not.toBeNull();

    const testError = new Error("Test error");

    await act(async () => {
      await result.current.handleError(testError);
    });

    expect(mockHandleError).toHaveBeenCalledWith(testError, {});
  });

  describe("createError helpers", () => {
    it("should create hook errors", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const originalError = new Error("Hook failed");
      const error = result.current.createError.hookError("useTestHook", originalError);

      expect(error.category).toBe("component");
      expect(error.type).toBe("hook_error");
      expect((error as ComponentError).hookName).toBe("useTestHook");
      expect(error.originalError).toBe(originalError);
    });

    it("should create action failed errors", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const originalError = new Error("Action failed");
      const error = result.current.createError.actionFailed("testAction", originalError);

      expect(error.category).toBe("runtime");
      expect(error.type).toBe("internal_error");
      expect(error.message).toContain("testAction");
      expect(error.originalError).toBe(originalError);
    });

    it("should create component failed errors with component name", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const originalError = new Error("Component failed");
      const error = result.current.createError.componentFailed(originalError);

      expect(error.category).toBe("component");
      expect(error.type).toBe("render_failed");
      expect((error as ComponentError).componentName).toBe("TestComponent");
      expect(error.originalError).toBe(originalError);
    });

    it("should create network timeout errors", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const error = result.current.createError.networkTimeout("/api/test", 5000);

      expect(error.category).toBe("network");
      expect(error.type).toBe("timeout");
      expect((error as NetworkError).endpoint).toBe("/api/test");
    });

    it("should create invalid API key errors", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const error = result.current.createError.invalidApiKey("Custom message");

      expect(error.category).toBe("security");
      expect(error.type).toBe("invalid_token");
      expect(error.message).toBe("Custom message");
    });

    it("should create missing config errors", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const error = result.current.createError.missingConfig("apiKey", "string");

      expect(error.category).toBe("data_processing");
      expect(error.type).toBe("validation_failed");
      expect((error as DataProcessingError).data?.field).toBe("apiKey");
    });

    it("should create agent failed errors", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const originalError = new Error("Agent failed");
      const error = result.current.createError.agentFailed("testAgent", originalError);

      expect(error.category).toBe("runtime");
      expect(error.type).toBe("internal_error");
      expect(error.message).toContain("testAgent");
      expect(error.originalError).toBe(originalError);
    });
  });

  describe("type guards", () => {
    it("should expose type guard functions", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      expect(typeof result.current.isComponentError).toBe("function");
      expect(typeof result.current.isNetworkError).toBe("function");
      expect(typeof result.current.isRuntimeError).toBe("function");
      expect(typeof result.current.isValidationError).toBe("function");
      expect(typeof result.current.isAuthError).toBe("function");
    });

    it("should correctly identify error types", () => {
      const result = renderWithContext(() => useCopilotError("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const componentError: ComponentError = {
        category: "component",
        type: "hook_error",
        message: "Test error",
        componentName: "TestComponent",
        hookName: "testHook",
        timestamp: Date.now(),
      };

      expect(result.current.isComponentError(componentError)).toBe(true);
      expect(result.current.isNetworkError(componentError)).toBe(false);
    });
  });
});

describe("useCopilotErrorBoundary", () => {
  let mockHandleError: jest.Mock;
  let mockContext: any;

  beforeEach(() => {
    mockHandleError = jest.fn();
    mockContext = createMockContext(mockHandleError);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("wrapAsync", () => {
    it("should wrap async functions and handle errors", async () => {
      const result = renderWithContext(() => useCopilotErrorBoundary("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const mockAsyncFn = jest.fn().mockRejectedValue(new Error("Async error"));
      const wrappedFn = result.current.wrapAsync(mockAsyncFn);

      await act(async () => {
        const returnValue = await wrappedFn("arg1", "arg2");
        expect(returnValue).toBeUndefined(); // Should return void when error is handled
      });

      expect(mockAsyncFn).toHaveBeenCalledWith("arg1", "arg2");
      expect(mockHandleError).toHaveBeenCalled();
    });

    it("should return the result when no error occurs", async () => {
      const result = renderWithContext(() => useCopilotErrorBoundary("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const mockAsyncFn = jest.fn().mockResolvedValue("success");
      const wrappedFn = result.current.wrapAsync(mockAsyncFn);

      let returnValue: any;
      await act(async () => {
        returnValue = await wrappedFn("arg1", "arg2");
      });

      expect(returnValue).toBe("success");
      expect(mockAsyncFn).toHaveBeenCalledWith("arg1", "arg2");
      expect(mockHandleError).not.toHaveBeenCalled();
    });
  });

  describe("wrapSync", () => {
    it("should wrap sync functions and handle errors", () => {
      const result = renderWithContext(() => useCopilotErrorBoundary("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const mockSyncFn = jest.fn().mockImplementation(() => {
        throw new Error("Sync error");
      });
      const wrappedFn = result.current.wrapSync(mockSyncFn);

      act(() => {
        const returnValue = wrappedFn("arg1", "arg2");
        expect(returnValue).toBeUndefined(); // Should return void when error is handled
      });

      expect(mockSyncFn).toHaveBeenCalledWith("arg1", "arg2");
      expect(mockHandleError).toHaveBeenCalled();
    });

    it("should return the result when no error occurs", () => {
      const result = renderWithContext(() => useCopilotErrorBoundary("TestComponent"), mockContext);

      expect(result.current).not.toBeNull();

      const mockSyncFn = jest.fn().mockReturnValue("success");
      const wrappedFn = result.current.wrapSync(mockSyncFn);

      let returnValue: any;
      act(() => {
        returnValue = wrappedFn("arg1", "arg2");
      });

      expect(returnValue).toBe("success");
      expect(mockSyncFn).toHaveBeenCalledWith("arg1", "arg2");
      expect(mockHandleError).not.toHaveBeenCalled();
    });
  });

  it("should expose handleError from useCopilotError", async () => {
    const result = renderWithContext(() => useCopilotErrorBoundary("TestComponent"), mockContext);

    expect(result.current).not.toBeNull();

    const testError = new Error("Test error");

    await act(async () => {
      await result.current.handleError(testError);
    });

    expect(mockHandleError).toHaveBeenCalledWith(testError, {
      componentName: "TestComponent",
    });
  });
});
