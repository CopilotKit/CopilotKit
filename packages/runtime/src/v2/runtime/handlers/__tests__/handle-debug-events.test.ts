import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleDebugEvents } from "../handle-debug-events";
import { DebugEventBus } from "../../core/debug-event-bus";
import type { CopilotRuntimeLike } from "../../core/runtime";
import type { BaseEvent } from "@ag-ui/client";

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------------------------- */

function createMockRuntime(
  overrides: { debugEventBus?: DebugEventBus } = {},
): Pick<CopilotRuntimeLike, "debugEventBus"> {
  return {
    debugEventBus: overrides.debugEventBus ?? new DebugEventBus(),
  };
}

function createMockRequest(options: { signal?: AbortSignal } = {}): Request {
  return new Request("http://localhost/cpk-debug-events", {
    method: "GET",
    signal: options.signal,
  });
}

function createTestEvent(): BaseEvent {
  return { type: "custom" } as BaseEvent;
}

async function readNextSSELine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let accumulated = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    accumulated += decoder.decode(value, { stream: true });
    if (accumulated.includes("\n\n")) return accumulated;
  }
  return accumulated;
}

/* ------------------------------------------------------------------------------------------------
 * Tests
 * --------------------------------------------------------------------------------------------- */

describe("handleDebugEvents", () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });

  it("returns 404 when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";

    const runtime = createMockRuntime();
    const request = createMockRequest();

    const response = handleDebugEvents({
      runtime: runtime as CopilotRuntimeLike,
      request,
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("returns 503 when debugEventBus is undefined", async () => {
    process.env.NODE_ENV = "test";

    const runtime = createMockRuntime({ debugEventBus: undefined });
    // Remove the property so it's truly undefined
    delete (runtime as Record<string, unknown>).debugEventBus;

    const request = createMockRequest();

    const response = handleDebugEvents({
      runtime: runtime as CopilotRuntimeLike,
      request,
    });

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Debug event bus not available");
  });

  it("returns correct SSE response headers", () => {
    process.env.NODE_ENV = "test";

    const runtime = createMockRuntime();
    const request = createMockRequest();

    const response = handleDebugEvents({
      runtime: runtime as CopilotRuntimeLike,
      request,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });

  it("streams events as SSE data lines when bus broadcasts", async () => {
    process.env.NODE_ENV = "test";

    const bus = new DebugEventBus();
    const runtime = createMockRuntime({ debugEventBus: bus });
    const request = createMockRequest();

    const response = handleDebugEvents({
      runtime: runtime as CopilotRuntimeLike,
      request,
    });

    const reader = response.body!.getReader();

    // Read and discard the initial ": connected" SSE comment
    const comment = await readNextSSELine(reader);
    expect(comment).toMatch(/^: connected/);

    // Broadcast an event through the bus
    bus.broadcast(createTestEvent(), {
      agentId: "agent-1",
      threadId: "thread-1",
      runId: "run-1",
    });

    const line = await readNextSSELine(reader);

    // The line should be "data: {json}\n\n"
    expect(line).toMatch(/^data: \{.*\}\n\n$/);

    const parsed = JSON.parse(line.replace("data: ", "").trim());
    expect(parsed.agentId).toBe("agent-1");
    expect(parsed.threadId).toBe("thread-1");
    expect(parsed.runId).toBe("run-1");
    expect(parsed.event).toEqual(createTestEvent());
    expect(typeof parsed.timestamp).toBe("number");

    reader.releaseLock();
  });

  it("unsubscribes from bus when request is aborted", async () => {
    process.env.NODE_ENV = "test";

    const bus = new DebugEventBus();
    const runtime = createMockRuntime({ debugEventBus: bus });

    const abortController = new AbortController();
    const request = createMockRequest({ signal: abortController.signal });

    handleDebugEvents({
      runtime: runtime as CopilotRuntimeLike,
      request,
    });

    // Before abort, the bus should have one listener
    expect(bus.listenerCount).toBe(1);

    // Abort the request
    abortController.abort();

    // After abort, the listener should be cleaned up
    expect(bus.listenerCount).toBe(0);
  });
});
