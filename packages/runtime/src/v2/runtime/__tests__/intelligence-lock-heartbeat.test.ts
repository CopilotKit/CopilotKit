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

  override async ɵacquireThreadLock() {
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
    await vi.advanceTimersByTimeAsync(1_000);
    await intelligence.renewalStarted;
    runner.complete();

    intelligence.rejectRenewal(new Error("lost lock"));
    await Promise.resolve();
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(agent.abortRun).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
