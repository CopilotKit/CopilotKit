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
      messages: [{ id: "msg-1", role: "assistant", content: "Hello" }],
      threadId: "thread-123",
      runId: "run-456",
    };

    await (afterRequestMw as Function)(fakeHookParams);

    // The onAfterRequest callback should have been called
    expect(onAfterRequest).toHaveBeenCalledTimes(1);

    // CRITICAL: It should NOT be called with an empty object
    const callArg = onAfterRequest.mock.calls[0][0];
    expect(callArg).not.toEqual({});

    // It should receive the hookParams (or at least threadId/messages)
    expect(callArg).toHaveProperty("threadId", "thread-123");
    expect(callArg).toHaveProperty("runId", "run-456");
  });
});
