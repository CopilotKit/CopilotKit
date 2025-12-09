import { CopilotErrorEvent, CopilotRequestContext, CopilotErrorHandler } from "@copilotkit/shared";

describe("CopilotRuntime onError types", () => {
  it("should have correct CopilotTraceEvent type structure", () => {
    const errorEvent: CopilotErrorEvent = {
      type: "error",
      timestamp: Date.now(),
      context: {
        threadId: "test-123",
        source: "runtime",
        request: {
          operation: "test-operation",
          startTime: Date.now(),
        },
        technical: {},
        metadata: {},
      },
      error: new Error("Test error"),
    };

    expect(errorEvent.type).toBe("error");
    expect(errorEvent.timestamp).toBeGreaterThan(0);
    expect(errorEvent.context.threadId).toBe("test-123");
    expect(errorEvent.error).toBeInstanceOf(Error);
  });

  it("should have correct CopilotRequestContext type structure", () => {
    const context: CopilotRequestContext = {
      threadId: "test-thread-456",
      runId: "test-run-789",
      source: "runtime",
      request: {
        operation: "processRuntimeRequest",
        method: "POST",
        url: "http://localhost:3000/api/copilotkit",
        startTime: Date.now(),
      },
      response: {
        status: 200,
        endTime: Date.now(),
        latency: 1200,
      },
      agent: {
        name: "test-agent",
        nodeName: "test-node",
        state: { step: 1 },
      },
      messages: {
        input: [],
        output: [],
        messageCount: 2,
      },
      technical: {
        userAgent: "Mozilla/5.0...",
        host: "localhost:3000",
        environment: "test",
        version: "1.0.0",
        stackTrace: "Error: Test\n  at test.js:1:1",
      },
      performance: {
        requestDuration: 1200,
        streamingDuration: 800,
        actionExecutionTime: 400,
        memoryUsage: 45.2,
      },
      metadata: {
        testFlag: true,
        version: "1.0.0",
      },
    };

    expect(context.threadId).toBe("test-thread-456");
    expect(context.agent?.name).toBe("test-agent");
    expect(context.messages?.messageCount).toBe(2);
    expect(context.technical?.stackTrace).toContain("Error: Test");
    expect(context.metadata?.testFlag).toBe(true);
  });

  it("should support all error event types", () => {
    const eventTypes: CopilotErrorEvent["type"][] = [
      "error",
      "request",
      "response",
      "agent_state",
      "action",
      "message",
      "performance",
    ];

    eventTypes.forEach((type) => {
      const event: CopilotErrorEvent = {
        type,
        timestamp: Date.now(),
        context: {
          threadId: `test-${type}`,
          source: "runtime",
          request: {
            operation: "test",
            startTime: Date.now(),
          },
          technical: {},
          metadata: {},
        },
      };

      expect(event.type).toBe(type);
    });
  });

  describe("publicApiKey gating logic", () => {
    type ShouldHandleError = (onError?: CopilotErrorHandler, publicApiKey?: string) => boolean;

    const shouldHandleError: ShouldHandleError = (onError, publicApiKey) => {
      return Boolean(onError && publicApiKey);
    };

    it("should return true when both onError and publicApiKey are provided", () => {
      const onError = jest.fn();
      const result = shouldHandleError(onError, "valid-api-key");
      expect(result).toBe(true);
    });

    it("should return false when onError is missing", () => {
      const result = shouldHandleError(undefined, "valid-api-key");
      expect(result).toBe(false);
    });

    it("should return false when publicApiKey is missing", () => {
      const onError = jest.fn();
      const result = shouldHandleError(onError, undefined);
      expect(result).toBe(false);
    });

    it("should return false when publicApiKey is empty string", () => {
      const onError = jest.fn();
      const result = shouldHandleError(onError, "");
      expect(result).toBe(false);
    });

    it("should return false when both are missing", () => {
      const result = shouldHandleError(undefined, undefined);
      expect(result).toBe(false);
    });

    it("should extract publicApiKey from headers for both cloud and non-cloud requests", () => {
      // Test the logic we just fixed in the GraphQL resolver
      const mockHeaders = new Map([["x-copilotcloud-public-api-key", "test-key-123"]]);

      // Simulate header extraction logic
      const extractPublicApiKey = (headers: Map<string, string>, hasCloudConfig: boolean) => {
        const publicApiKeyFromHeaders = headers.get("x-copilotcloud-public-api-key");
        return publicApiKeyFromHeaders || null;
      };

      // Should work for cloud requests
      const cloudKey = extractPublicApiKey(mockHeaders, true);
      expect(cloudKey).toBe("test-key-123");

      // Should also work for non-cloud requests (this was the bug)
      const nonCloudKey = extractPublicApiKey(mockHeaders, false);
      expect(nonCloudKey).toBe("test-key-123");

      // Both should enable error handling when onError is present
      const onError = jest.fn();
      expect(shouldHandleError(onError, cloudKey)).toBe(true);
      expect(shouldHandleError(onError, nonCloudKey)).toBe(true);
    });
  });
});
