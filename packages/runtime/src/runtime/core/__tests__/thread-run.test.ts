import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EMPTY, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CopilotKitIntelligence,
  PlatformRequestError,
} from "../../intelligence-platform/client";
import type { AgentRunner } from "../../runner/agent-runner";
import { runWithThreadLock } from "../thread-run";

class IdleAgent extends AbstractAgent {
  run(_input: RunAgentInput) {
    return EMPTY;
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const intelligence = new CopilotKitIntelligence({
    apiKey: "cpk-42_short_long",
  });
  vi.spyOn(intelligence, "ɵacquireThreadLock").mockResolvedValue({
    threadId: "thread",
    runId: "run",
    joinToken: "join",
    ttlSeconds: 20,
  });
  vi.spyOn(intelligence, "ɵrenewThreadLock").mockRejectedValue(
    new PlatformRequestError("lock lost", 409, false),
  );
  const cleanup = vi
    .spyOn(intelligence, "ɵcleanupThreadLock")
    .mockImplementation(() => new Promise<void>(() => {}));
  const events = new Subject<BaseEvent>();
  const runner: AgentRunner = {
    run: vi.fn(() => events),
    stop: vi.fn(() => new Promise<boolean>(() => {})),
    connect: vi.fn(() => EMPTY),
    isRunning: vi.fn(async () => true),
  };
  const agent = new IdleAgent();
  const start = () => ({
    agent,
    input: {
      threadId: "thread",
      runId: "run",
      messages: [],
      state: {},
      tools: [],
      context: [],
    },
  });
  return { intelligence, cleanup, events, runner, start };
}

describe("one deadline for a stopped Thread run", () => {
  it.each([true, false])(
    "keeps the lost lock's deadline when cleanup answers: %s",
    async (cleanupAnswers) => {
      const { intelligence, cleanup, events, runner, start } = setup();
      if (cleanupAnswers) cleanup.mockResolvedValue(undefined);
      let outcome: unknown = "pending";
      const running = runWithThreadLock({
        intelligence,
        runner,
        start,
        acquire: {
          threadId: "thread",
          runId: "run",
          userId: "user",
          agentId: "agent",
        },
        lock: { ttlSeconds: 20, heartbeatIntervalSeconds: 0.1 },
        stopTimeoutMs: 1_000,
      }).then((value) => {
        outcome = value;
      });
      await vi.advanceTimersByTimeAsync(100); // The heartbeat loses the lock.
      expect(runner.stop).toHaveBeenCalledOnce();
      setTimeout(() => events.complete(), 800);
      await vi.advanceTimersByTimeAsync(999);
      expect(outcome).toBe("pending");
      expect(cleanup).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toMatchObject({
        lockLost: { error: expect.any(PlatformRequestError) },
      });
      await running;
      if (!cleanupAnswers) {
        expect(cleanup.mock.calls[0]?.[0].signal?.aborted).toBe(true);
      }
    },
  );

  it("does not add another cleanup timeout after the stream's stop deadline", async () => {
    const { intelligence, cleanup, runner, start } = setup();
    const controller = new AbortController();
    let outcome: unknown = "pending";
    const running = runWithThreadLock({
      intelligence,
      runner,
      start,
      acquire: {
        threadId: "thread",
        runId: "run",
        userId: "user",
        agentId: "agent",
      },
      lock: { ttlSeconds: 20, heartbeatIntervalSeconds: 15 },
      signal: controller.signal,
      stopTimeoutMs: 1_000,
    }).catch((error) => {
      outcome = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ reason: "stop_timeout" });
    await running;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cleanup.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });
});
