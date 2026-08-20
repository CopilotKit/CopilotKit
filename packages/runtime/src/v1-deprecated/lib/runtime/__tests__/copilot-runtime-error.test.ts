import type {
  CopilotErrorEvent,
  CopilotRequestContext,
  CopilotErrorHandler,
} from "@copilotkit/shared";
import { Observable } from "rxjs";
import { HttpAgent } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { createCopilotRuntimeHandler } from "../../../../v2/runtime";
import { CopilotRuntime } from "../copilot-runtime";

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
    type ShouldHandleError = (
      onError?: CopilotErrorHandler,
      publicApiKey?: string,
    ) => boolean;

    const shouldHandleError: ShouldHandleError = (onError, publicApiKey) => {
      return Boolean(onError && publicApiKey);
    };

    it("should return true when both onError and publicApiKey are provided", () => {
      const onError = vi.fn();
      const result = shouldHandleError(onError, "valid-api-key");
      expect(result).toBe(true);
    });

    it("should return false when onError is missing", () => {
      const result = shouldHandleError(undefined, "valid-api-key");
      expect(result).toBe(false);
    });

    it("should return false when publicApiKey is missing", () => {
      const onError = vi.fn();
      const result = shouldHandleError(onError, undefined);
      expect(result).toBe(false);
    });

    it("should return false when publicApiKey is empty string", () => {
      const onError = vi.fn();
      const result = shouldHandleError(onError, "");
      expect(result).toBe(false);
    });

    it("should return false when both are missing", () => {
      const result = shouldHandleError(undefined, undefined);
      expect(result).toBe(false);
    });

    it("should extract publicApiKey from headers for both cloud and non-cloud requests", () => {
      // Test the logic we just fixed in the GraphQL resolver
      const mockHeaders = new Map([
        ["x-copilotcloud-public-api-key", "test-key-123"],
      ]);

      // Simulate header extraction logic
      const extractPublicApiKey = (
        headers: Map<string, string>,
        hasCloudConfig: boolean,
      ) => {
        const publicApiKeyFromHeaders = headers.get(
          "x-copilotcloud-public-api-key",
        );
        return publicApiKeyFromHeaders || null;
      };

      // Should work for cloud requests
      const cloudKey = extractPublicApiKey(mockHeaders, true);
      expect(cloudKey).toBe("test-key-123");

      // Should also work for non-cloud requests (this was the bug)
      const nonCloudKey = extractPublicApiKey(mockHeaders, false);
      expect(nonCloudKey).toBe("test-key-123");

      // Both should enable error handling when onError is present
      const onError = vi.fn();
      expect(shouldHandleError(onError, cloudKey)).toBe(true);
      expect(shouldHandleError(onError, nonCloudKey)).toBe(true);
    });
  });

  it("forwards request headers from a failing local runtime", async () => {
    const onError = vi.fn();
    const runner = {
      run: () =>
        new Observable<BaseEvent>((subscriber) => {
          subscriber.error(new Error("local runner failed"));
        }),
      connect: () => new Observable<BaseEvent>(() => {}),
      isRunning: async () => false,
      stop: async () => false,
    };
    const runtime = new CopilotRuntime({
      agents: { default: new HttpAgent({ url: "https://agent.example" }) },
      onError,
      runner,
    });
    const handler = createCopilotRuntimeHandler({ runtime: runtime.instance });

    const response = await handler(
      new Request("https://example.com/agent/default/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "issue-2716-user",
        },
        body: JSON.stringify({
          threadId: "thread-1",
          runId: "run-1",
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        context: expect.objectContaining({
          request: expect.objectContaining({
            headers: expect.objectContaining({
              "x-user-id": "issue-2716-user",
            }),
          }),
        }),
      }),
    );
  });

  it("preserves the response when the rejecting runtime error handler runs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const onError = vi.fn().mockRejectedValue(new Error("callback failed"));
      const runtime = new CopilotRuntime({
        agents: Promise.reject(new Error("agent lookup failed")),
        onError,
      });
      const handler = createCopilotRuntimeHandler({
        runtime: runtime.instance,
      });
      const response = await handler(
        new Request("https://example.com/agent/default/run", {
          method: "POST",
          headers: { "X-User-Id": "issue-2716-user" },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to run agent",
        message: "agent lookup failed",
      });
      expect(onError).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          "CopilotRuntime onError reporting failed:",
          expect.any(Error),
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reports a pre-response agent failure without changing the response", async () => {
    const onError = vi.fn();
    const runtime = new CopilotRuntime({
      agents: Promise.reject(new Error("pre-response failure")),
      onError,
    });
    const handler = createCopilotRuntimeHandler({ runtime: runtime.instance });

    const response = await handler(
      new Request("https://example.com/agent/default/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to run agent",
      message: "pre-response failure",
    });
    expect(onError).toHaveBeenCalledOnce();
  });
});
