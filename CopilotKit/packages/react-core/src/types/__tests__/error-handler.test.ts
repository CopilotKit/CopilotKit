import {
  CopilotClientError,
  CopilotComponentError,
  CopilotNetworkError,
  CopilotRuntimeError,
  CopilotValidationError,
  CopilotAuthError,
  DataProcessingError,
  categorizeCopilotError,
  isCopilotComponentError,
  isCopilotNetworkError,
  isCopilotRuntimeError,
  isCopilotValidationError,
  isCopilotAuthError,
  createCopilotError,
} from "../error-handler";

describe("Error Type Guards", () => {
  it("should correctly identify component errors", () => {
    const error: CopilotComponentError = {
      category: "component",
      type: "render_failed",
      message: "Component failed to render",
      timestamp: Date.now(),
    };

    expect(isCopilotComponentError(error)).toBe(true);
    expect(isCopilotNetworkError(error)).toBe(false);
    expect(isCopilotRuntimeError(error)).toBe(false);
    expect(isCopilotValidationError(error)).toBe(false);
    expect(isCopilotAuthError(error)).toBe(false);
  });

  it("should correctly identify network errors", () => {
    const error: CopilotNetworkError = {
      category: "network",
      type: "connection_failed",
      message: "Network connection failed",
      timestamp: Date.now(),
    };

    expect(isCopilotNetworkError(error)).toBe(true);
    expect(isCopilotComponentError(error)).toBe(false);
    expect(isCopilotRuntimeError(error)).toBe(false);
    expect(isCopilotValidationError(error)).toBe(false);
    expect(isCopilotAuthError(error)).toBe(false);
  });

  it("should correctly identify runtime errors", () => {
    const error: CopilotClientError = {
      category: "runtime",
      type: "internal_error",
      message: "Runtime error occurred",
      timestamp: Date.now(),
    };

    expect(isCopilotRuntimeError(error)).toBe(true);
    expect(isCopilotComponentError(error)).toBe(false);
    expect(isCopilotNetworkError(error)).toBe(false);
    expect(isCopilotValidationError(error)).toBe(false);
    expect(isCopilotAuthError(error)).toBe(false);
  });

  it("should correctly identify validation errors", () => {
    const validationError: DataProcessingError = {
      category: "data_processing",
      type: "validation_failed",
      message: "Validation failed",
      timestamp: Date.now(),
      data: { field: "apiKey", expectedType: "string" },
    };

    expect(isCopilotValidationError(validationError)).toBe(true);
    expect(isCopilotComponentError(validationError)).toBe(false);
  });

  it("should correctly identify auth errors", () => {
    const error: CopilotAuthError = {
      category: "security",
      type: "invalid_token",
      message: "Invalid API key",
      timestamp: Date.now(),
    };

    expect(isCopilotAuthError(error)).toBe(true);
    expect(isCopilotComponentError(error)).toBe(false);
    expect(isCopilotNetworkError(error)).toBe(false);
    expect(isCopilotRuntimeError(error)).toBe(false);
    expect(isCopilotValidationError(error)).toBe(false);
  });
});

describe("Unified Error Categorization", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(123456789);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should use runtime categorization for fetch errors", () => {
    const error = new Error("fetch failed");
    const categorized = categorizeCopilotError(error, { threadId: "test-thread" });

    // Uses unified categorization from runtime (not client-side string matching)
    expect(categorized.category).toBe("network");
    expect(categorized.type).toBe("connection_failed");
    expect(categorized.message).toBe("fetch failed");
    expect(categorized.threadId).toBe("test-thread");
    expect(categorized.timestamp).toBe(123456789);

    // Now we expect a serialized error object, not the original Error instance
    expect(categorized.originalError).toBeDefined();
    expect((categorized.originalError as any).message).toBe("fetch failed");
    expect((categorized.originalError as any).name).toBe("Error");
  });

  it("should use runtime categorization for network errors", () => {
    const error = new Error("request timeout");
    const categorized = categorizeCopilotError(error);

    expect(categorized.category).toBe("network");
    expect(categorized.type).toBe("timeout");
    expect(categorized.message).toBe("request timeout");
  });

  it("should use runtime categorization with fallback", () => {
    const error = new Error("Some unknown error");
    const categorized = categorizeCopilotError(error);

    // Runtime categorization defaults to runtime error, not component
    expect(categorized.category).toBe("runtime");
    expect(categorized.type).toBe("internal_error");
    expect(categorized.message).toBe("Some unknown error");
  });

  it("should handle non-Error objects", () => {
    const error = "String error";
    const categorized = categorizeCopilotError(error);

    expect(categorized.category).toBe("runtime");
    expect(categorized.type).toBe("internal_error");
    expect(categorized.message).toBe("String error");
    expect(categorized.originalError).toBeUndefined();
  });

  it("should include context information", () => {
    const error = new Error("Test error");
    const context = {
      threadId: "thread-123",
      runId: "run-456",
    };
    const categorized = categorizeCopilotError(error, context);

    expect(categorized.threadId).toBe("thread-123");
    expect(categorized.runId).toBe("run-456");
  });
});

describe("OriginalError Serialization (Regression Prevention)", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(123456789);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should NEVER serialize originalError as empty object {}", () => {
    const originalError = new Error("Test error message");
    const categorized = categorizeCopilotError(originalError);

    // Test JSON serialization (the main issue we're preventing)
    const serialized = JSON.stringify(categorized);
    const parsed = JSON.parse(serialized);

    // CRITICAL: originalError should contain actual error details, not {}
    expect(parsed.originalError).toBeDefined();
    expect(parsed.originalError).not.toEqual({});
    expect(parsed.originalError.message).toBe("Test error message");
    expect(parsed.originalError.name).toBe("Error");
  });
});

describe("Client Error Creators", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(123456789);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should create invalid API key errors", () => {
    const error = createCopilotError.invalidApiKey();

    expect(error.category).toBe("security");
    expect(error.type).toBe("invalid_token");
    expect(error.message).toBe("Invalid API key provided");
    expect(error.timestamp).toBe(123456789);
  });

  it("should create invalid API key errors with custom message", () => {
    const customMessage = "Custom API key error";
    const error = createCopilotError.invalidApiKey(customMessage);

    expect(error.category).toBe("security");
    expect(error.type).toBe("invalid_token");
    expect(error.message).toBe(customMessage);
  });

  it("should create network timeout errors", () => {
    const error = createCopilotError.networkTimeout("/api/test", 5000);

    expect(error.category).toBe("network");
    expect(error.type).toBe("timeout");
    expect(error.endpoint).toBe("/api/test");
    expect(error.message).toBe("Request to /api/test timed out after 5000ms");
    expect(error.timestamp).toBe(123456789);
  });

  it("should create network timeout errors with default values", () => {
    const error = createCopilotError.networkTimeout();

    expect(error.category).toBe("network");
    expect(error.type).toBe("timeout");
    expect(error.message).toBe("Request to server timed out after 30000ms");
  });

  it("should create component failed errors", () => {
    const originalError = new Error("Original error");
    const error = createCopilotError.componentFailed("TestComponent", originalError);

    expect(error.category).toBe("component");
    expect(error.type).toBe("render_failed");
    expect(error.componentName).toBe("TestComponent");
    expect(error.originalError).toBe(originalError);
    expect(error.message).toBe("Original error");
  });

  it("should create hook errors", () => {
    const originalError = new Error("Hook error");
    const error = createCopilotError.hookError("useTestHook", originalError);

    expect(error.category).toBe("component");
    expect(error.type).toBe("hook_error");
    expect(error.hookName).toBe("useTestHook");
    expect(error.originalError).toBe(originalError);
    expect(error.message).toBe("Hook error");
  });

  it("should create actionFailed errors", () => {
    const originalError = new Error("Action failed");
    const error = createCopilotError.actionFailed("testAction", originalError);

    expect(error.category).toBe("runtime");
    expect(error.type).toBe("internal_error");
    expect(error.message).toContain("testAction");
    expect(error.originalError).toBe(originalError);
  });

  it("should create agentFailed errors", () => {
    const originalError = new Error("Agent failed");
    const error = createCopilotError.agentFailed("testAgent", originalError);

    expect(error.category).toBe("runtime");
    expect(error.type).toBe("internal_error");
    expect(error.message).toContain("testAgent");
    expect(error.originalError).toBe(originalError);
  });

  it("should create missingConfig errors", () => {
    const error = createCopilotError.missingConfig("apiKey", "string");

    expect(error.category).toBe("data_processing");
    expect(error.type).toBe("validation_failed");
    expect((error as DataProcessingError).data?.field).toBe("apiKey");
    expect((error as DataProcessingError).data?.expectedType).toBe("string");
  });

  it("should create missingConfig errors without expectedType", () => {
    const error = createCopilotError.missingConfig("apiKey");

    expect(error.category).toBe("data_processing");
    expect(error.type).toBe("validation_failed");
    expect((error as DataProcessingError).data?.field).toBe("apiKey");
    expect((error as DataProcessingError).data?.expectedType).toBeUndefined();
  });
});
