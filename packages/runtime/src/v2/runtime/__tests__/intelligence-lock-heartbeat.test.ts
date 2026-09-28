import type { BaseEvent, RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { AbstractAgent } from "@ag-ui/client";
import type { Subscriber } from "rxjs";
import { EMPTY, Observable } from "rxjs";
import { expect, test, vi } from "vitest";

import { CopilotIntelligenceRuntime } from "../core/runtime";
import { handleIntelligenceRun } from "../handlers/intelligence/run";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
} from "../runner/agent-runner";
import { AgentRunner } from "../runner/agent-runner";

class HeartbeatTestAgent extends AbstractAgent {
  readonly abortRun = vi.fn();

  async runAgent(): Promise<RunAgentResult> {
    return { result: undefined, newMessages: [] };
  }

  clone(): AbstractAgent {
    return new HeartbeatTestAgent();
  }

  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

class ControllableRunner extends AgentRunner {
  private subscriber?: Subscriber<BaseEvent>;

  run(_request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      this.subscriber = subscriber;
    });
  }

  connect(_request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return EMPTY;
  }

  async isRunning(_request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return false;
  }

  async stop(_request: AgentRunnerStopRequest): Promise<boolean> {
    return false;
  }

  complete(): void {
    if (!this.subscriber) {
      throw new Error("Runner has not started.");
    }
    this.subscriber.complete();
  }
}

class DeferredRenewalIntelligence extends CopilotKitIntelligence {
  readonly renewalStarted: Promise<void>;
  private markRenewalStarted!: () => void;
  private rejectPendingRenewal?: (error: Error) => void;

  constructor() {
    super({
      apiKey: "test-api-key",
      apiUrl: "https://intelligence.example",
      wsUrl: "wss://intelligence.example",
    });

    this.renewalStarted = new Promise((resolve) => {
      this.markRenewalStarted = resolve;
    });
  }

  override async getOrCreateThread() {
    return {
      thread: { id: "thread-1", name: "Thread One" },
      created: false,
    };
  }

  override async getThreadMessages() {
    return { messages: [] };
  }

  override async ɵacquireThreadLock(): ReturnType<
    CopilotKitIntelligence["ɵacquireThreadLock"]
  > {
    return {
      threadId: "thread-1",
      runId: "run-1",
      joinToken: "join-token-1",
    };
  }

  override async ɵrenewThreadLock() {
    this.markRenewalStarted();
    return new Promise<{ ttlSeconds: number }>((_resolve, reject) => {
      this.rejectPendingRenewal = reject;
    });
  }

  rejectRenewal(error: Error): void {
    if (!this.rejectPendingRenewal) {
      throw new Error("No renewal is pending.");
    }
    this.rejectPendingRenewal(error);
  }
}

test("does not abort a completed run when an in-flight lock renewal fails", async () => {
  vi.useFakeTimers();
  const agent = new HeartbeatTestAgent();
  const runner = new ControllableRunner();
  const intelligence = new DeferredRenewalIntelligence();
  const dispatch = vi.spyOn(runner, "run");
  const renew = vi.spyOn(intelligence, "ɵrenewThreadLock");
  const runtime = new CopilotIntelligenceRuntime({
    agents: { "test-agent": agent },
    intelligence,
    identifyUser: async () => ({ id: "user-1", name: "User One" }),
    lockHeartbeatIntervalSeconds: 1,
    lockTtlSeconds: 5,
  });
  runtime.runner = runner;
  const input: RunAgentInput = {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
  };

  try {
    const response = await handleIntelligenceRun({
      runtime,
      request: new Request("https://runtime.example/agent/test-agent/run"),
      agentId: "test-agent",
      agent,
      input,
    });
    expect(renew).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await intelligence.renewalStarted;
    runner.complete();

    intelligence.rejectRenewal(new Error("lost lock"));
    await Promise.resolve();
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(dispatch.mock.calls[0][0].executionInput).toBeUndefined();
    expect(agent.abortRun).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  {
    version: 1,
    status: "unavailable",
    message: "Re-import with Replace",
    code: "IMPORT_EXECUTION_CONTEXT_MISSING",
  },
  {
    version: 1,
    status: "ready",
    source: "adk",
    agentId: "test-agent",
    threadId: "native",
    context: { userId: "native-user" },
  },
  {
    version: 1,
    status: "ready",
    source: "langgraph",
    agentId: "wrong-agent",
    threadId: "native",
    context: {},
  },
])(
  "rejects unresolved imported continuation before dispatch: %j",
  async (nativeExecution) => {
    const agent = new HeartbeatTestAgent();
    const runner = new ControllableRunner();
    const run = vi.spyOn(runner, "run");
    const intelligence = new DeferredRenewalIntelligence();
    const lockResponse = {
      threadId: "thread-1",
      runId: "run-1",
      joinToken: "join-token",
      nativeExecution,
    };
    vi.spyOn(intelligence, "ɵacquireThreadLock").mockResolvedValue(
      lockResponse,
    );
    const cleanup = vi
      .spyOn(intelligence, "ɵcleanupThreadLock")
      .mockResolvedValue();
    const runtime = new CopilotIntelligenceRuntime({
      agents: { "test-agent": agent },
      intelligence,
      identifyUser: async () => ({ id: "user-1", name: "User One" }),
    });
    runtime.runner = runner;
    const response = await handleIntelligenceRun({
      runtime,
      request: new Request("https://runtime.example/agent/test-agent/run"),
      agentId: "test-agent",
      agent,
      input: {
        threadId: "thread-1",
        runId: "run-1",
        messages: [],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "IMPORTED_CONTINUATION_UNAVAILABLE",
      message: expect.any(String),
    });
    expect(run).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith({
      threadId: "thread-1",
      runId: "run-1",
    });
  },
);

test("prepares framework context on the mapped agent and preserves canonical run ownership", async () => {
  const agent = new HeartbeatTestAgent();
  const runner = new ControllableRunner();
  const run = vi.spyOn(runner, "run");
  const intelligence = new DeferredRenewalIntelligence();
  const lockResponse = {
    threadId: "thread-1",
    runId: "run-1",
    joinToken: "join-token",
    nativeExecution: {
      version: 1,
      status: "ready",
      source: "adk",
      agentId: "test-agent",
      threadId: "native",
      context: {
        userId: "original-user",
        appName: "app",
        sessionId: "session",
      },
    },
  };
  vi.spyOn(intelligence, "ɵacquireThreadLock").mockResolvedValue(lockResponse);
  const order: string[] = [];
  vi.spyOn(intelligence, "getThreadMessages").mockImplementation(async () => {
    order.push("history");
    return { messages: [] };
  });
  vi.spyOn(intelligence, "ɵrenewThreadLock").mockImplementation(async () => {
    order.push("renew");
    return { ttlSeconds: 5 };
  });
  const prepareImportedThread = vi.fn(
    ({
      input,
      execution,
    }: {
      input: RunAgentInput;
      execution: { context: Record<string, string> };
    }) => {
      order.push("prepare");
      input.state.nested.value = "native-only";
      input.messages[0].content = "native-only";
      input.forwardedProps.nested.value = "native-only";
      input.forwardedProps = { userId: execution.context.userId };
      input.runId = "must-not-change-canonical-run";
    },
  );
  const runtime = new CopilotIntelligenceRuntime({
    agents: { "test-agent": agent },
    intelligence,
    identifyUser: async () => ({ id: "user-1", name: "User One" }),
    prepareImportedThread,
  });
  runtime.runner = runner;
  const input: RunAgentInput = {
    threadId: "thread-1",
    runId: "run-1",
    messages: [{ id: "user-message", role: "user", content: "canonical" }],
    state: { nested: { value: "canonical" } },
    tools: [],
    context: [],
    forwardedProps: { nested: { value: "canonical" } },
  };
  const response = await handleIntelligenceRun({
    runtime,
    request: new Request("https://runtime.example/agent/test-agent/run"),
    agentId: "test-agent",
    agent,
    input,
  });
  runner.complete();
  expect(response.status).toBe(200);
  expect(prepareImportedThread).toHaveBeenCalledOnce();
  expect(order).toEqual(["prepare", "history", "renew"]);
  expect(run.mock.calls[0][0]).toMatchObject({
    threadId: "thread-1",
    input,
    executionInput: {
      threadId: "native",
      runId: "run-1",
      forwardedProps: { userId: "original-user" },
    },
  });
  expect(input.forwardedProps).toEqual({ nested: { value: "canonical" } });
  expect(input.state).toEqual({ nested: { value: "canonical" } });
  expect(input.messages[0].content).toBe("canonical");
});

test("rejects dispatch when delayed preparation outlives canonical lock ownership", async () => {
  const agent = new HeartbeatTestAgent();
  const runner = new ControllableRunner();
  const run = vi.spyOn(runner, "run");
  const intelligence = new DeferredRenewalIntelligence();
  const nativeExecution = {
    version: 1,
    status: "ready",
    source: "adk",
    agentId: "test-agent",
    threadId: "native",
    context: { userId: "original-user" },
  };
  vi.spyOn(intelligence, "ɵacquireThreadLock").mockResolvedValue({
    threadId: "thread-1",
    runId: "run-1",
    joinToken: "join-token",
    nativeExecution,
  });
  const renew = vi
    .spyOn(intelligence, "ɵrenewThreadLock")
    .mockRejectedValue(new Error("lease expired during preparation"));
  const cleanup = vi
    .spyOn(intelligence, "ɵcleanupThreadLock")
    .mockResolvedValue();
  let finishPreparation!: () => void;
  let preparationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    preparationStarted = resolve;
  });
  const prepareImportedThread = async () => {
    preparationStarted();
    await new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
  };
  const runtime = new CopilotIntelligenceRuntime({
    agents: { "test-agent": agent },
    intelligence,
    identifyUser: async () => ({ id: "user-1", name: "User One" }),
    prepareImportedThread,
  });
  runtime.runner = runner;
  const pending = handleIntelligenceRun({
    runtime,
    request: new Request("https://runtime.example/agent/test-agent/run"),
    agentId: "test-agent",
    agent,
    input: {
      threadId: "thread-1",
      runId: "run-1",
      messages: [],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    },
  });
  await started;
  expect(run).not.toHaveBeenCalled();
  expect(renew).not.toHaveBeenCalled();
  finishPreparation();
  const response = await pending;
  // Ensure the old implementation does not leave its controllable run/timer open.
  if (run.mock.calls.length) runner.complete();
  expect(response.status).toBe(409);
  expect(renew).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: "thread-1", runId: "run-1" }),
  );
  expect(run).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledWith({
    threadId: "thread-1",
    runId: "run-1",
  });
});
