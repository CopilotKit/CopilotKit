import {
  CopilotTraceEvent,
  CopilotKitError,
  CopilotKitErrorCode,
  CopilotTraceHandler,
} from "@copilotkit/shared";

describe("CopilotRuntime onTrace types", () => {
  let mockTraceHandler: jest.Mock;

  beforeEach(() => {
    mockTraceHandler = jest.fn();
  });

  describe("type definitions", () => {
    it("should define CopilotTraceHandler type correctly", () => {
      const handler: CopilotTraceHandler = mockTraceHandler;
      expect(handler).toBeDefined();
      expect(typeof handler).toBe("function");
    });

    it("should define CopilotTraceEvent with all required fields", () => {
      const traceEvent: CopilotTraceEvent = {
        type: "error",
        timestamp: Date.now(),
        context: {
          threadId: "test-thread",
          source: "runtime",
          request: {
            operation: "processRuntimeRequest",
            startTime: Date.now(),
          },
        },
        error: new CopilotKitError({
          message: "Test error",
          code: CopilotKitErrorCode.UNKNOWN,
        }),
      };

      expect(traceEvent.type).toBe("error");
      expect(traceEvent.timestamp).toBeDefined();
      expect(traceEvent.context.source).toBe("runtime");
      expect(traceEvent.error).toBeDefined();
    });

    it("should support all trace event types", () => {
      const eventTypes: CopilotTraceEvent["type"][] = [
        "error",
        "request",
        "response",
        "agent_state",
        "action",
        "message",
        "performance",
      ];

      eventTypes.forEach((type) => {
        const event: CopilotTraceEvent = {
          type,
          timestamp: Date.now(),
          context: { source: "runtime" },
        };
        expect(event.type).toBe(type);
      });
    });
  });

  describe("constructor params type", () => {
    it("should accept onTrace in constructor params type", () => {
      // This tests the type definition without importing the actual runtime class
      type ConstructorParams = {
        onTrace?: CopilotTraceHandler;
      };

      const params: ConstructorParams = {
        onTrace: mockTraceHandler,
      };

      expect(params.onTrace).toBe(mockTraceHandler);
    });
  });

  describe("publicApiKey gating logic", () => {
    it("should define gating helper function type", () => {
      type ShouldTrace = (onTrace?: CopilotTraceHandler, publicApiKey?: string) => boolean;

      const shouldTrace: ShouldTrace = (onTrace, publicApiKey) => {
        return Boolean(onTrace && publicApiKey);
      };

      expect(shouldTrace(mockTraceHandler, "ck_pub_test")).toBe(true);
      expect(shouldTrace(mockTraceHandler, undefined)).toBe(false);
      expect(shouldTrace(undefined, "ck_pub_test")).toBe(false);
    });
  });

  describe("trace context validation", () => {
    it("should validate complete trace context structure", () => {
      const fullContext = {
        threadId: "test-thread-123",
        runId: "test-run-456",
        source: "runtime" as const,
        request: {
          operation: "processRuntimeRequest",
          method: "POST",
          url: "https://api.example.com/copilotkit",
          path: "/copilotkit",
          headers: { "Content-Type": "application/json" },
          body: { messages: [] },
          startTime: Date.now(),
        },
        response: {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "Content-Type": "application/json" },
          body: { error: "EmptyAdapter error" },
          endTime: Date.now(),
          latency: 1200,
        },
        agent: {
          name: "test-agent",
          nodeName: "start",
          state: { step: 1 },
        },
        messages: {
          input: [{ id: "1", content: "test" }],
          output: [{ id: "2", content: "response" }],
          messageCount: 2,
        },
        technical: {
          userAgent: "Mozilla/5.0...",
          host: "api.example.com",
          environment: "test",
          version: "1.0.0",
          stackTrace: "Error: Test error\n  at ...",
        },
        performance: {
          requestDuration: 1200,
          streamingDuration: 800,
          actionExecutionTime: 400,
          memoryUsage: 45.2,
        },
        metadata: {
          customField: "customValue",
          debugInfo: { detailed: true },
        },
      };

      const traceEvent: CopilotTraceEvent = {
        type: "error",
        timestamp: Date.now(),
        context: fullContext,
        error: new CopilotKitError({
          message: "Test error with full context",
          code: CopilotKitErrorCode.UNKNOWN,
        }),
      };

      expect(traceEvent.context.threadId).toBe("test-thread-123");
      expect(traceEvent.context.agent?.name).toBe("test-agent");
      expect(traceEvent.context.performance?.requestDuration).toBe(1200);
      expect(traceEvent.context.metadata?.customField).toBe("customValue");
    });
  });
});
