import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleDebugEvents } from "../handle-debug-events";
import {
  DebugEventBus,
  ɵresetDebugEventFeedWarning,
} from "../../core/debug-event-bus";
import { CopilotRuntime } from "../../core/runtime";
import type { CopilotRuntimeLike } from "../../core/runtime";
import { createCopilotRuntimeHandler } from "../../core/fetch-handler";
import { testAgents } from "../../__tests__/helpers/thread-access-harness";
import type { BaseEvent } from "@ag-ui/client";
import type { ResolvedDebugConfig } from "@copilotkit/shared";

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------------------------- */

const DEBUG_ON: ResolvedDebugConfig = {
  enabled: true,
  events: true,
  lifecycle: true,
  verbose: false,
};

const DEBUG_OFF: ResolvedDebugConfig = {
  enabled: false,
  events: false,
  lifecycle: false,
  verbose: false,
};

function createMockRuntime(
  overrides: {
    debugEventBus?: DebugEventBus;
    debug?: ResolvedDebugConfig;
  } = {},
): Pick<CopilotRuntimeLike, "debugEventBus" | "debug"> {
  return {
    debugEventBus: overrides.debugEventBus ?? new DebugEventBus(),
    debug: overrides.debug ?? DEBUG_ON,
  };
}

function createMockRequest(options: { signal?: AbortSignal } = {}): Request {
  return new Request("http://localhost/cpk-debug-events", {
    method: "GET",
    signal: options.signal,
  });
}

function createTestEvent(): BaseEvent {
  return { type: "custom" } as unknown as BaseEvent;
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

const FEED_DEBUG_VALUES = [
  undefined,
  false,
  true,
  { verbose: false },
  { events: true, lifecycle: true, verbose: true },
] as const;

function setNodeEnv(nodeEnv: string | undefined) {
  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }
}

function expectedStatus(
  nodeEnv: string | undefined,
  debug: (typeof FEED_DEBUG_VALUES)[number],
): number {
  if (nodeEnv === "development") return 200;
  return nodeEnv === "test" && debug ? 200 : 404;
}

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

  describe("feed gate", () => {
    function statusFor(
      nodeEnv: string | undefined,
      debug: ResolvedDebugConfig,
    ): number {
      if (nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = nodeEnv;
      }

      return handleDebugEvents({
        runtime: createMockRuntime({ debug }) as CopilotRuntimeLike,
        request: createMockRequest(),
      }).status;
    }

    it("serves the feed under an explicit development NODE_ENV", () => {
      expect(statusFor("development", DEBUG_OFF)).toBe(200);
    });

    it("refuses the feed when NODE_ENV is unset", () => {
      // A plain `node server.js` sets no NODE_ENV, and that absence is not
      // development.
      expect(statusFor(undefined, DEBUG_OFF)).toBe(404);
    });

    it("refuses the feed in production", () => {
      expect(statusFor("production", DEBUG_OFF)).toBe(404);
    });

    it("refuses the feed under an unrecognized NODE_ENV", () => {
      expect(statusFor("staging", DEBUG_OFF)).toBe(404);
      expect(statusFor("test", DEBUG_OFF)).toBe(404);
    });

    it("serves the feed under debug in test", () => {
      expect(statusFor("test", DEBUG_ON)).toBe(200);
    });

    it.each([undefined, "", "production", "prod", "Production", "staging"])(
      "refuses the feed under debug alone when NODE_ENV=%j",
      (nodeEnv) => {
        expect(statusFor(nodeEnv, DEBUG_ON)).toBe(404);
      },
    );

    it("returns the 404 body, so a hidden route reads as absent", async () => {
      process.env.NODE_ENV = "production";

      const response = handleDebugEvents({
        runtime: createMockRuntime({ debug: DEBUG_OFF }) as CopilotRuntimeLike,
        request: createMockRequest(),
      });

      expect(await response.text()).toBe("Not Found");
    });
  });

  describe("through a constructed runtime", () => {
    const NODE_ENVS = [
      undefined,
      "",
      "production",
      "prod",
      "Production",
      "staging",
      "test",
      "development",
    ];
    function open(options: {
      debug?: (typeof FEED_DEBUG_VALUES)[number];
      exposeDebugEvents?: boolean;
    }) {
      const runtime = new CopilotRuntime({ agents: testAgents(), ...options });
      const handler = createCopilotRuntimeHandler({
        runtime,
        basePath: "/api",
      });
      const abort = new AbortController();
      return handler(
        new Request("http://localhost/api/cpk-debug-events", {
          signal: abort.signal,
        }),
      ).then((response) => {
        abort.abort();
        return { status: response.status, runtime };
      });
    }

    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      ɵresetDebugEventFeedWarning();
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    function feedWarnings(): number {
      return warn.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes("exposeDebugEvents"),
      ).length;
    }

    for (const nodeEnv of NODE_ENVS) {
      for (const debug of FEED_DEBUG_VALUES) {
        const expected = expectedStatus(nodeEnv, debug);
        it(`NODE_ENV=${nodeEnv} debug=${JSON.stringify(debug)} answers ${expected}`, async () => {
          setNodeEnv(nodeEnv);
          const { status, runtime } = await open({ debug });
          expect(status).toBe(expected);
          expect(runtime.debugEventBus !== undefined).toBe(expected === 200);
        });

        it(`NODE_ENV=${nodeEnv} debug=${JSON.stringify(debug)} opens with exposeDebugEvents`, async () => {
          setNodeEnv(nodeEnv);
          expect((await open({ debug, exposeDebugEvents: true })).status).toBe(
            200,
          );
        });
      }
    }

    describe("method handling", () => {
      const post = (options: { exposeDebugEvents?: boolean }) =>
        createCopilotRuntimeHandler({
          runtime: new CopilotRuntime({ agents: testAgents(), ...options }),
          basePath: "/api",
        })(
          new Request("http://localhost/api/cpk-debug-events", {
            method: "POST",
          }),
        );

      it("answers a closed feed 404 on any method", async () => {
        process.env.NODE_ENV = "production";
        const response = await post({});
        expect(response.status).toBe(404);
        expect(response.headers.has("Allow")).toBe(false);
      });

      it("answers 405 on an open feed", async () => {
        process.env.NODE_ENV = "production";
        const response = await post({ exposeDebugEvents: true });
        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("GET");
      });
    });

    it("takes only `true` as the opt-in", async () => {
      setNodeEnv("production");
      const exposeDebugEvents = "true" as unknown as boolean;
      expect((await open({ exposeDebugEvents })).status).toBe(404);
    });

    it("warns once per process when the feed opens outside development and test", async () => {
      setNodeEnv("production");
      await open({ exposeDebugEvents: true });
      await open({ exposeDebugEvents: true });
      expect(feedWarnings()).toBe(1);
    });

    it("warns when the opt-in opens the feed under an unset NODE_ENV", async () => {
      setNodeEnv(undefined);
      await open({ exposeDebugEvents: true });
      expect(feedWarnings()).toBe(1);
    });

    it("does not warn when production keeps the feed closed", async () => {
      setNodeEnv("production");
      await open({ debug: true });
      expect(feedWarnings()).toBe(0);
    });

    it.each(["development", "test"])(
      "does not warn under NODE_ENV=%s",
      async (nodeEnv) => {
        setNodeEnv(nodeEnv);
        await open({ exposeDebugEvents: true });
        expect(feedWarnings()).toBe(0);
      },
    );
  });

  it("returns 503 when debugEventBus is undefined", async () => {
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
