import {
  categorizeError,
  isLLMProviderError,
  isAgentError,
  isNetworkError,
  isActionExecutionError,
  CopilotRuntimeError,
  ErrorHandler,
  ErrorHandlerResult,
  errorCategorizerRegistry,
} from "../../types/error-types";

describe("Error Handling System", () => {
  beforeEach(() => {
    // Clear the registry to ensure clean tests - no LLM provider categorizers registered
    (errorCategorizerRegistry as any).categorizers = [];
  });

  it("should demonstrate smart error categorization with fallback behavior", () => {
    // Test various real-world error scenarios
    // Note: Without provider-specific categorizers, string-based errors fall back to generic categorization
    const testCases = [
      {
        input: new Error("Unauthorized: Invalid API key"),
        expected: { category: "runtime", type: "internal_error" }, // Falls back without provider categorizer
      },
      {
        input: new Error("Rate limit exceeded"),
        expected: { category: "runtime", type: "internal_error" }, // Falls back without provider categorizer
      },
      {
        input: new Error("Quota limit reached"),
        expected: { category: "runtime", type: "internal_error" }, // Falls back without provider categorizer
      },
      {
        input: new Error("fetch failed"),
        expected: { category: "network", type: "connection_failed" }, // Generic pattern matching works
      },
      {
        input: new Error("Request timeout"),
        expected: { category: "network", type: "timeout" }, // Updated to network timeout
      },
      {
        input: new Error("CORS policy blocked"),
        expected: { category: "security", type: "cors_error" },
      },
      {
        input: new Error("Some unknown error"),
        expected: { category: "runtime", type: "internal_error" },
      },
    ];

    testCases.forEach(({ input, expected }) => {
      const categorized = categorizeError(input, { threadId: "test-123" });
      expect(categorized.category).toBe(expected.category);
      expect(categorized.type).toBe(expected.type);
      expect(categorized.threadId).toBe("test-123");
      expect(categorized.originalError).toBe(input);
      expect(categorized.timestamp).toBeDefined();
    });
  });

  it("should support type-safe error handling workflows", async () => {
    const capturedErrors: CopilotRuntimeError[] = [];

    // Example error handler that demonstrates the workflow
    const errorHandler: ErrorHandler = async (
      error: CopilotRuntimeError,
    ): Promise<ErrorHandlerResult> => {
      capturedErrors.push(error);

      // Type-safe error handling with discriminated unions
      if (isLLMProviderError(error)) {
        switch (error.type) {
          case "auth_failed":
            console.log(`Auth failed for ${error.provider || "unknown provider"}`);
            return "handled"; // We handle auth errors
          case "quota_exceeded":
            console.log(`Quota exceeded, retrying with fallback`);
            return "handled"; // We handle quota errors
          case "rate_limited":
            if (error.retryAfter) {
              console.log(`Rate limited, retry after ${error.retryAfter}s`);
            }
            return "default"; // Let system handle rate limiting
          default:
            return "default";
        }
      }

      if (isAgentError(error)) {
        switch (error.type) {
          case "not_found":
            console.log(`Agent not found: ${error.agentName}`);
            return "handled";
          case "execution_failed":
            console.log(`Agent ${error.agentName} failed: ${error.message}`);
            return "default"; // Let system show error
          default:
            return "default";
        }
      }

      if (isNetworkError(error)) {
        console.log(`Network issue: ${error.message}`);
        // Always let system handle network errors
        return "default";
      }

      if (isActionExecutionError(error)) {
        console.log(`Action ${error.actionName} failed`);
        if (error.userMessage) {
          // Has safe user message, let system show it
          return "default";
        } else {
          // No safe message, we'll handle it
          return "handled";
        }
      }

      // For all other errors, use default handling
      return "default";
    };

    // Test different error scenarios
    // Without provider categorizers, auth errors fall back to runtime errors
    const authError = categorizeError(new Error("Unauthorized: Invalid API key"), {
      threadId: "thread-1",
    });
    const result1 = await errorHandler(authError);
    expect(result1).toBe("default"); // Changed from "handled" since it's now a runtime error
    expect(isLLMProviderError(authError)).toBe(false); // No longer categorized as LLM provider error

    const networkError = categorizeError(new Error("fetch failed"), { threadId: "thread-2" });
    const result2 = await errorHandler(networkError);
    expect(result2).toBe("default");
    expect(isNetworkError(networkError)).toBe(true);

    // Without provider categorizers, quota errors fall back to runtime errors
    const quotaError = categorizeError(new Error("Quota limit exceeded"), { threadId: "thread-3" });
    const result3 = await errorHandler(quotaError);
    expect(result3).toBe("default"); // Changed from "handled" since it's now a runtime error
    expect(isLLMProviderError(quotaError)).toBe(false); // No longer categorized as LLM provider error

    expect(capturedErrors).toHaveLength(3);
    expect(capturedErrors.every((e) => e.timestamp)).toBe(true);
  });

  it("should enrich errors with context", () => {
    const originalError = new Error("Test error");
    const context = {
      threadId: "thread-123",
      runId: "run-456",
      url: "https://api.example.com",
    };

    const enriched = categorizeError(originalError, context);

    expect(enriched.threadId).toBe("thread-123");
    expect(enriched.url).toBe("https://api.example.com");
    expect(enriched.timestamp).toBeDefined();
    expect(enriched.originalError).toBe(originalError);
    expect(enriched.message).toBe("Test error");
  });

  it("should handle specific LLM provider error patterns with fallback behavior", () => {
    // Without provider-specific categorizers, these all fall back to runtime/generic categorization
    const testCases = [
      {
        error: new Error("OpenAI API error: Incorrect API key provided"),
        expectedType: "internal_error", // Falls back to runtime error
        expectedCategory: "runtime",
      },
      {
        error: new Error("You exceeded your current quota"),
        expectedType: "internal_error", // Falls back to runtime error
        expectedCategory: "runtime",
      },
      {
        error: new Error("Rate limit reached for requests"),
        expectedType: "internal_error", // Falls back to runtime error
        expectedCategory: "runtime",
      },
      {
        error: new Error("The model `gpt-5` does not exist"),
        expectedType: "internal_error", // Falls back to runtime error
        expectedCategory: "runtime",
      },
    ];

    testCases.forEach(({ error, expectedType, expectedCategory }) => {
      const categorized = categorizeError(error);
      expect(categorized.category).toBe(expectedCategory);
      expect(categorized.type).toBe(expectedType);
    });
  });

  it("should handle agent-specific error enrichment", () => {
    const agentError = categorizeError(new Error("Agent execution failed"), {
      threadId: "thread-123",
    });

    // Simulate the runtime enriching with agent context
    if (isAgentError(agentError)) {
      agentError.agentName = "support-agent";
      agentError.nodeName = "process-request";
    }

    expect(agentError.category).toBe("runtime"); // Generic error becomes runtime
    expect(isAgentError(agentError)).toBe(false); // Not enriched since it's not categorized as agent error

    // But if we manually create an agent error:
    const specificAgentError: CopilotRuntimeError = {
      category: "agent",
      type: "execution_failed",
      message: "Agent failed",
      timestamp: Date.now(),
      threadId: "thread-123",
      agentName: "support-agent",
      nodeName: "process-request",
    };

    expect(isAgentError(specificAgentError)).toBe(true);
    if (isAgentError(specificAgentError)) {
      expect(specificAgentError.agentName).toBe("support-agent");
      expect(specificAgentError.nodeName).toBe("process-request");
    }
  });

  it("should provide actionable error messages", () => {
    // This demonstrates what enhanced error messages would look like
    const errorCases = [
      {
        category: "llm_provider" as const,
        type: "auth_failed" as const,
        suggestion: "Please check your API key configuration",
      },
      {
        category: "llm_provider" as const,
        type: "quota_exceeded" as const,
        suggestion:
          "You have exceeded your API quota. Please upgrade your plan or wait for quota reset",
      },
      {
        category: "network" as const,
        type: "connection_failed" as const,
        suggestion: "Network connection failed. Please check your internet connection",
      },
      {
        category: "agent" as const,
        type: "not_found" as const,
        suggestion: "The requested agent was not found. Please check available agents",
      },
    ];

    errorCases.forEach(({ category, type, suggestion }) => {
      // This is what our runtime error handling would do
      const mockError: CopilotRuntimeError = {
        category,
        type: type as any,
        message: "Mock error",
        timestamp: Date.now(),
      };

      // Verify type guards work
      expect(
        category === "llm_provider"
          ? isLLMProviderError(mockError)
          : !isLLMProviderError(mockError),
      ).toBe(true);
      expect(category === "agent" ? isAgentError(mockError) : !isAgentError(mockError)).toBe(true);
      expect(category === "network" ? isNetworkError(mockError) : !isNetworkError(mockError)).toBe(
        true,
      );

      // In real implementation, these suggestions would be built into the error handling
      console.log(`${category}:${type} -> ${suggestion}`);
    });
  });
});
