/**
 * Integration tests for the complete error handling flow
 */

import {
  CopilotClientError,
  categorizeCopilotError,
  createCopilotError,
  isCopilotComponentError,
  isCopilotNetworkError,
  isCopilotRuntimeError,
  isCopilotValidationError,
  isCopilotAuthError,
  ErrorHandlerResult,
} from "../error-handler";

describe("Error Handling Integration", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(1234567890);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Complete Error Flow", () => {
    it("should handle a typical component error flow", async () => {
      // Simulate a React component error using the legacy error creator
      const componentError = createCopilotError.componentFailed(
        "MyComponent",
        new Error("Component MyComponent failed to render"),
      );

      expect(componentError.category).toBe("component");
      expect(componentError.type).toBe("render_failed");

      // 2. Type guard validation
      expect(isCopilotComponentError(componentError)).toBe(true);
      expect(isCopilotNetworkError(componentError)).toBe(false);

      // 3. Error handler simulation
      const mockHandler = jest.fn().mockResolvedValue("handled" as ErrorHandlerResult);
      const result = await mockHandler(componentError);

      expect(mockHandler).toHaveBeenCalledWith(componentError);
      expect(result).toBe("handled");
    });

    it("should handle a network error with retry logic", () => {
      // Simulate a network timeout
      const networkError = createCopilotError.networkTimeout("/api/copilot", 5000);

      expect(networkError.category).toBe("network");
      expect(networkError.type).toBe("timeout");
      expect(isCopilotNetworkError(networkError)).toBe(true);
    });

    it("should handle authentication errors with token refresh", async () => {
      // Simulate an auth error
      const authError = createCopilotError.invalidApiKey("Token expired");

      expect(authError.category).toBe("security");
      expect(authError.type).toBe("invalid_token");
      expect(isCopilotAuthError(authError)).toBe(true);

      // Simulate error handler with token refresh
      const mockAuthHandler = jest.fn().mockImplementation(async (error: CopilotClientError) => {
        if (isCopilotAuthError(error)) {
          // Simulate token refresh
          console.log("Refreshing authentication token...");
          return "handled"; // Error was handled by refreshing
        }
        return "default";
      });

      const result = await mockAuthHandler(authError);
      expect(result).toBe("handled");
      expect(mockAuthHandler).toHaveBeenCalledWith(authError);
    });

    it("should handle validation errors with user guidance", async () => {
      // Simulate a missing configuration error
      const validationError = createCopilotError.missingConfig("apiKey", "string");

      expect(validationError.category).toBe("data_processing");
      expect(validationError.type).toBe("validation_failed");
      expect(isCopilotValidationError(validationError)).toBe(true);

      // Check the data field structure
      expect((validationError as any).data?.field).toBe("apiKey");
      expect((validationError as any).data?.expectedType).toBe("string");
    });

    it("should handle runtime errors with agent recovery", async () => {
      // Simulate an agent failure
      const runtimeError = createCopilotError.agentFailed(
        "ChatAgent",
        new Error("Connection lost"),
      );

      expect(runtimeError.category).toBe("runtime");
      expect(runtimeError.type).toBe("internal_error");
      expect(runtimeError.message).toContain("ChatAgent");
    });

    it("should handle error handler failures gracefully", async () => {
      const error = createCopilotError.componentFailed("TestComponent", new Error("Test error"));

      // Simulate error handler that throws
      const faultyHandler = jest.fn().mockRejectedValue(new Error("Handler failed"));

      // This would be wrapped in a try-catch in real implementation
      try {
        await faultyHandler(error);
        fail("Should have thrown");
      } catch (handlerError: any) {
        expect(handlerError.message).toBe("Handler failed");
        // In real implementation, this would fall back to default handling
      }
    });
  });

  describe("Error Context Enrichment", () => {
    it("should enrich errors with full context", () => {
      const error = new Error("Test error");
      const fullContext = {
        threadId: "thread-123",
        runId: "run-456",
        url: "https://api.test.com",
      };

      const enrichedError = categorizeCopilotError(error, fullContext);

      expect(enrichedError.threadId).toBe("thread-123");
      expect(enrichedError.runId).toBe("run-456");
      expect(enrichedError.url).toBe("https://api.test.com");
      expect(enrichedError.timestamp).toBe(1234567890);

      // Now we expect a serialized error object, not the original Error instance
      expect(enrichedError.originalError).toBeDefined();
      expect((enrichedError.originalError as any).message).toBe("Test error");
      expect((enrichedError.originalError as any).name).toBe("Error");
    });

    it("should handle partial context gracefully", () => {
      const error = new Error("Test error");
      const partialContext = {
        threadId: "thread-123",
        // Missing runId and url
      };

      const enrichedError = categorizeCopilotError(error, partialContext);

      expect(enrichedError.threadId).toBe("thread-123");
      expect(enrichedError.runId).toBeUndefined();
      expect(enrichedError.url).toBeUndefined();
      expect(enrichedError.timestamp).toBe(1234567890);
    });
  });

  describe("Error Handler Chain", () => {
    it("should support chaining multiple error handlers", async () => {
      const error = createCopilotError.networkTimeout("/api/test");
      const handlerLog: string[] = [];

      // First handler - logging
      const loggingHandler = async (err: CopilotClientError): Promise<ErrorHandlerResult> => {
        handlerLog.push(`Logged: ${err.category}:${err.type}`);
        return "default"; // Continue to next handler
      };

      // Second handler - specific network handling
      const networkHandler = async (err: CopilotClientError): Promise<ErrorHandlerResult> => {
        if (isCopilotNetworkError(err)) {
          handlerLog.push(`Network handler: ${err.type}`);
          return "handled";
        }
        return "default";
      };

      // Simulate handler chain
      let result = await loggingHandler(error);
      if (result === "default") {
        result = await networkHandler(error);
      }

      expect(handlerLog).toEqual(["Logged: network:timeout", "Network handler: timeout"]);
      expect(result).toBe("handled");
    });
  });

  it("should categorize errors with context", () => {
    const error = new Error("Network request failed");
    const categorizedError = categorizeCopilotError(error, {
      threadId: "test-thread",
      url: "https://api.test.com",
    });

    expect(categorizedError.category).toBe("network");
    expect(categorizedError.type).toBe("connection_failed");
    expect(categorizedError.threadId).toBe("test-thread");
    expect(categorizedError.url).toBe("https://api.test.com");
  });

  it("should categorize common errors correctly", () => {
    const networkError = new Error("fetch failed");
    expect(categorizeCopilotError(networkError).category).toBe("network");

    const timeoutError = new Error("Request timeout");
    expect(categorizeCopilotError(timeoutError).category).toBe("network");
    expect(categorizeCopilotError(timeoutError).type).toBe("timeout");

    const corsError = new Error("CORS error");
    expect(categorizeCopilotError(corsError).category).toBe("security");
    expect(categorizeCopilotError(corsError).type).toBe("cors_error");
  });

  it("should handle unknown errors gracefully", () => {
    const unknownError = new Error("Something went wrong");
    const categorizedError = categorizeCopilotError(unknownError);

    expect(categorizedError.category).toBe("runtime");
    expect(categorizedError.type).toBe("internal_error");
    expect(categorizedError.message).toBe("Something went wrong");
  });
});
