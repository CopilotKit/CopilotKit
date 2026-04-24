/**
 * Telemetry lifecycle tests for `packages/runtime/src/v2/runtime/handlers/intelligence/run.ts`.
 *
 * intelligence/run.ts fires three events across the agent run lifecycle:
 *   - oss.runtime.agent_execution_stream_started  (line 126, after thread lock)
 *   - oss.runtime.agent_execution_stream_errored  (inside runner subscribe's error handler)
 *   - oss.runtime.agent_execution_stream_ended    (inside runner subscribe's complete handler)
 *
 * This test verifies each fires under the expected condition. It's paired
 * with sse-response-telemetry.test.ts which covers the SSE path of the
 * same event names — kept separate so a regression in one file fails only
 * its own test.
 */
import { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { Observable } from "rxjs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handleRunAgent } from "../handlers/handle-run";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { telemetry } from "../telemetry";
import type { CopilotRuntime } from "../core/runtime";

// --- Minimal helpers (mirroring handle-run.test.ts's intelligence block) ---

interface MockIntelligencePlatform {
  [key: string]: ((...args: any[]) => any) | undefined;
}

function makeAgent(): AbstractAgent {
  const makeClone = () =>
    ({
      clone: vi.fn(() => makeClone()),
      setMessages: vi.fn(),
      setState: vi.fn(),
      threadId: undefined,
      headers: {},
      runAgent: vi.fn().mockResolvedValue(undefined),
    }) as unknown as AbstractAgent;
  const agent: any = {
    clone: vi.fn(() => makeClone()),
    setMessages: vi.fn(),
    setState: vi.fn(),
    threadId: undefined,
    headers: {},
    runAgent: vi.fn().mockResolvedValue(undefined),
  };
  return agent as AbstractAgent;
}

function makeIntelligenceRuntime(
  runObservable: Observable<BaseEvent>,
  extraPlatform: MockIntelligencePlatform = {},
): CopilotRuntime {
  const runner = Object.create(IntelligenceAgentRunner.prototype);
  runner.run = vi.fn(() => runObservable);

  const platform: MockIntelligencePlatform = {
    getOrCreateThread: vi.fn().mockResolvedValue({
      thread: { id: "thread-1", name: null },
      created: false,
    }),
    getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
    ɵacquireThreadLock: vi
      .fn()
      .mockResolvedValue({ joinToken: "jt-1", joinCode: "jc-1" }),
    ɵrenewThreadLock: vi.fn().mockResolvedValue(undefined),
    ...extraPlatform,
  };

  return {
    agents: Promise.resolve({ "my-agent": makeAgent() }),
    transcriptionService: undefined,
    beforeRequestMiddleware: undefined,
    afterRequestMiddleware: undefined,
    runner,
    mode: "intelligence",
    generateThreadNames: false,
    intelligence: platform,
    identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "User One" }),
    lockTtlSeconds: 20,
    lockHeartbeatIntervalSeconds: 15,
  } as unknown as CopilotRuntime;
}

function makeRunRequest(): Request {
  return new Request("https://example.com/agent/my-agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  });
}

// --- Tests ---

describe("intelligence/run.ts — telemetry lifecycle", () => {
  let captureSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
    // Swallow the logger.error that fires on simulated agent errors.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    captureSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("fires agent_execution_stream_started once thread lock is acquired", async () => {
    // Observable that never completes — so only stream_started should fire.
    const never = new Observable<BaseEvent>(() => {});
    const runtime = makeIntelligenceRuntime(never);

    await handleRunAgent({
      runtime,
      request: makeRunRequest(),
      agentId: "my-agent",
    });

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_started",
      {},
    );
    // And NOT the other two
    expect(captureSpy).not.toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_errored",
      expect.anything(),
    );
    expect(captureSpy).not.toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_ended",
      expect.anything(),
    );
  });

  it("fires agent_execution_stream_ended when runner.run observable completes", async () => {
    // Observable that completes immediately.
    const completing = new Observable<BaseEvent>((subscriber) => {
      subscriber.complete();
    });
    const runtime = makeIntelligenceRuntime(completing);

    await handleRunAgent({
      runtime,
      request: makeRunRequest(),
      agentId: "my-agent",
    });

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_started",
      {},
    );
    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_ended",
      {},
    );
  });

  it("fires agent_execution_stream_errored when runner.run observable errors", async () => {
    const failing = new Observable<BaseEvent>((subscriber) => {
      subscriber.error(new Error("agent exploded"));
    });
    const runtime = makeIntelligenceRuntime(failing);

    await handleRunAgent({
      runtime,
      request: makeRunRequest(),
      agentId: "my-agent",
    });

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_started",
      {},
    );
    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_errored",
      expect.objectContaining({ error: "agent exploded" }),
    );
  });
});
