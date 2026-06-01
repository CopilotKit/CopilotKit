import { describe, it, expect, vi } from "vitest";
import { CopilotRuntime } from "../copilot-runtime";

describe("onAfterRequest middleware (#2124)", () => {
  it("should pass hookParams to onAfterRequest, not an empty object", async () => {
    const onAfterRequest = vi.fn();

    const runtime = new CopilotRuntime({
      middleware: {
        onAfterRequest,
      },
    });

    // Access the internal afterRequestMiddleware function
    const afterRequestMw = runtime.instance.afterRequestMiddleware;
    expect(afterRequestMw).toBeDefined();

    // Simulate calling the middleware with hookParams (as the v2 runtime would)
    const fakeHookParams = {
      runtime: {} as any,
      response: new Response("test"),
      path: "/api/copilotkit",
      messages: [
        { id: "msg-1", role: "user", content: "Hi there" },
        { id: "msg-2", role: "assistant", content: "Hello" },
        { id: "msg-3", role: "tool", content: "result", toolCallId: "tc-1" },
      ],
      threadId: "thread-123",
      runId: "run-456",
    };

    await (afterRequestMw as Function)(fakeHookParams);

    expect(onAfterRequest).toHaveBeenCalledTimes(1);

    const callArg = onAfterRequest.mock.calls[0][0];

    // Should NOT be called with an empty object
    expect(callArg).not.toEqual({});

    // Verify all OnAfterRequestOptions fields are present
    expect(callArg).toHaveProperty("threadId", "thread-123");
    expect(callArg).toHaveProperty("runId", "run-456");
    expect(callArg).toHaveProperty("url", "/api/copilotkit");
    expect(callArg).toHaveProperty("properties");
    expect(callArg.properties).toEqual({});

    // Verify message splitting: user messages → inputMessages, others → outputMessages
    expect(callArg.inputMessages).toHaveLength(1);
    expect(callArg.inputMessages[0]).toMatchObject({
      id: "msg-1",
      role: "user",
    });

    expect(callArg.outputMessages).toHaveLength(2);
    expect(callArg.outputMessages[0]).toMatchObject({
      id: "msg-2",
      role: "assistant",
    });
    expect(callArg.outputMessages[1]).toMatchObject({
      id: "msg-3",
      role: "tool",
    });
  });

  it("should handle undefined messages gracefully", async () => {
    const onAfterRequest = vi.fn();

    const runtime = new CopilotRuntime({
      middleware: {
        onAfterRequest,
      },
    });

    const afterRequestMw = runtime.instance.afterRequestMiddleware;

    const fakeHookParams = {
      runtime: {} as any,
      response: new Response("test"),
      path: "/api/copilotkit",
      // messages intentionally omitted (undefined)
      threadId: "thread-789",
    };

    await (afterRequestMw as Function)(fakeHookParams);

    expect(onAfterRequest).toHaveBeenCalledTimes(1);

    const callArg = onAfterRequest.mock.calls[0][0];
    expect(callArg.threadId).toBe("thread-789");
    expect(callArg.inputMessages).toEqual([]);
    expect(callArg.outputMessages).toEqual([]);
  });

  it("should default threadId to empty string when undefined", async () => {
    const onAfterRequest = vi.fn();

    const runtime = new CopilotRuntime({
      middleware: {
        onAfterRequest,
      },
    });

    const afterRequestMw = runtime.instance.afterRequestMiddleware;

    const fakeHookParams = {
      runtime: {} as any,
      response: new Response("test"),
      path: "/api/copilotkit",
      messages: [],
      // threadId intentionally omitted
    };

    await (afterRequestMw as Function)(fakeHookParams);

    expect(onAfterRequest).toHaveBeenCalledTimes(1);

    const callArg = onAfterRequest.mock.calls[0][0];
    expect(callArg.threadId).toBe("");
    expect(callArg.runId).toBeUndefined();
  });
});
