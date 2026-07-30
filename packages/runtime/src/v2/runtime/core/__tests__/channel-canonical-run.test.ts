import { AbstractAgent, EventType } from "@ag-ui/client";
import type { AgentSubscriber, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { createChannel } from "@copilotkit/channels";
import { EMPTY, Observable, of, throwError } from "rxjs";
import { expect, test, vi } from "vitest";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import { AgentRunner } from "../../runner/agent-runner";
import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
} from "../../runner/agent-runner";
import { InMemoryAgentRunner } from "../../runner/in-memory";
import { defaultActivateChannel } from "../channel-manager";
import type { ChannelsIntelligenceModule } from "../channel-manager";

type RunCanonical = Parameters<
  ChannelsIntelligenceModule["startChannelsOverRealtimeGateway"]
>[1]["runCanonical"];

const canonicalIdentity = {
  threadId: "canonical-thread",
  runId: "canonical-run",
};

class NoopAgent extends AbstractAgent {
  run(_input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
}

class TestRunner extends AgentRunner {
  constructor(
    private readonly runFactory: (
      request: AgentRunnerRunRequest,
    ) => Observable<BaseEvent>,
    private readonly stopRun: (
      request: AgentRunnerStopRequest,
    ) => Promise<boolean> = async () => false,
  ) {
    super();
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return this.runFactory(request);
  }

  connect(_request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return EMPTY;
  }

  isRunning(_request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return Promise.resolve(false);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean> {
    return this.stopRun(request);
  }
}

async function captureRunCanonical(
  runner: AgentRunner,
  options: {
    intelligence?: CopilotKitIntelligence;
    lockHeartbeatIntervalSeconds?: number;
    lockTtlSeconds?: number;
  } = {},
): Promise<RunCanonical> {
  let captured: RunCanonical | undefined;
  const importer = async (): Promise<ChannelsIntelligenceModule> => ({
    startChannelsOverRealtimeGateway: async (_channels, options) => {
      captured = options.runCanonical;
      return { metadata: {}, stop: async () => {} };
    },
  });

  const intelligence =
    options.intelligence ??
    new CopilotKitIntelligence({
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
      apiKey: "cpk-42_short_long",
    });
  vi.spyOn(intelligence, "ɵacquireThreadLock").mockResolvedValue({
    ...canonicalIdentity,
    joinToken: "join_token_not_used_by_channels",
  });

  await defaultActivateChannel(
    {
      wsUrl: "wss://runtime.example",
      apiUrl: "https://runtime.example",
      apiKey: "cpk-42_short_long",
      projectId: 42,
      channelName: "support",
      adapter: "slack",
      runtimeInstanceId: "rti_test",
    },
    createChannel({ name: "support" }),
    importer,
    undefined,
    {
      runner,
      intelligence,
      ...(options.lockHeartbeatIntervalSeconds !== undefined
        ? {
            lockHeartbeatIntervalSeconds: options.lockHeartbeatIntervalSeconds,
          }
        : {}),
      ...(options.lockTtlSeconds !== undefined
        ? { lockTtlSeconds: options.lockTtlSeconds }
        : {}),
    },
  );

  if (!captured) throw new Error("runCanonical was not configured");
  return captured;
}

function runArgs(
  execute: (
    subscriber: AgentSubscriber,
    identity?: typeof canonicalIdentity,
  ) => Promise<{ iterations: number; interrupted: boolean }> = async () => ({
    iterations: 1,
    interrupted: false,
  }),
): Parameters<RunCanonical>[0] {
  return {
    agent: new NoopAgent(),
    ...canonicalIdentity,
    userId: "app-user-1",
    agentId: "support-agent",
    tools: [],
    context: [],
    persistedInputMessages: [],
    execute,
  };
}

test("runCanonical rejects a RUN_ERROR event even when the runner completes", async () => {
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });
  const cleanup = vi
    .spyOn(intelligence, "ɵcleanupThreadLock")
    .mockResolvedValue(undefined);
  const runner = new TestRunner(() =>
    of({
      type: EventType.RUN_ERROR,
      message: "agent failed",
      code: "AGENT_FAILED",
    }),
  );
  const runCanonical = await captureRunCanonical(runner, { intelligence });

  await expect(runCanonical(runArgs())).rejects.toMatchObject({
    message: "agent failed",
    code: "AGENT_FAILED",
  });
  expect(cleanup).toHaveBeenCalledWith(canonicalIdentity);
});

test("runCanonical renews the standard thread lock until the run settles", async () => {
  vi.useFakeTimers();
  try {
    const intelligence = new CopilotKitIntelligence({
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
      apiKey: "cpk-42_short_long",
    });
    const renew = vi.spyOn(intelligence, "ɵrenewThreadLock").mockResolvedValue({
      ttlSeconds: 120,
    });
    let completeRun: (() => void) | undefined;
    const runner = new TestRunner(
      () =>
        new Observable<BaseEvent>((observer) => {
          completeRun = () => observer.complete();
        }),
    );
    const runCanonical = await captureRunCanonical(runner, {
      intelligence,
      lockHeartbeatIntervalSeconds: 1,
      lockTtlSeconds: 120,
    });

    const running = runCanonical(runArgs());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(renew).toHaveBeenCalledWith({
      threadId: canonicalIdentity.threadId,
      runId: canonicalIdentity.runId,
      ttlSeconds: 120,
    });

    completeRun?.();
    await running;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(renew).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("runCanonical stops the standard runner when lock renewal fails", async () => {
  vi.useFakeTimers();
  try {
    const intelligence = new CopilotKitIntelligence({
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
      apiKey: "cpk-42_short_long",
    });
    vi.spyOn(intelligence, "ɵrenewThreadLock").mockRejectedValue(
      new Error("thread lock lost"),
    );
    let completeRun: (() => void) | undefined;
    const stopRun = vi.fn(async () => {
      completeRun?.();
      return true;
    });
    const runner = new TestRunner(
      () =>
        new Observable<BaseEvent>((observer) => {
          completeRun = () => observer.complete();
        }),
      stopRun,
    );
    const runCanonical = await captureRunCanonical(runner, {
      intelligence,
      lockHeartbeatIntervalSeconds: 1,
      lockTtlSeconds: 120,
    });

    const running = runCanonical(runArgs());
    const failed = expect(running).rejects.toThrow("thread lock lost");
    await vi.advanceTimersByTimeAsync(1_000);

    await failed;
    expect(stopRun).toHaveBeenCalledWith({
      threadId: canonicalIdentity.threadId,
    });
  } finally {
    vi.useRealTimers();
  }
});

test("runCanonical passes canonical identity into the outer Channel loop", async () => {
  const runner = new TestRunner(
    (request) =>
      new Observable<BaseEvent>((observer) => {
        void request.agent
          .runAgent(request.input, {
            onEvent: ({ event }) => observer.next(event),
          })
          .then(
            () => observer.complete(),
            (error: unknown) => observer.error(error),
          );
      }),
  );
  const runCanonical = await captureRunCanonical(runner);
  let observedIdentity: typeof canonicalIdentity | undefined;

  await runCanonical(
    runArgs(async (_subscriber, identity) => {
      observedIdentity = identity;
      return { iterations: 2, interrupted: false };
    }),
  );

  expect(observedIdentity).toEqual(canonicalIdentity);
});

test("runCanonical acquires the standard lock and uses the runner project key", async () => {
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });
  let request: AgentRunnerRunRequest | undefined;
  const runner = new TestRunner((value) => {
    request = value;
    return EMPTY;
  });
  const runCanonical = await captureRunCanonical(runner, { intelligence });

  await runCanonical(runArgs());

  expect(intelligence.ɵacquireThreadLock).toHaveBeenCalledWith({
    threadId: canonicalIdentity.threadId,
    runId: canonicalIdentity.runId,
    userId: "app-user-1",
    agentId: "support-agent",
    ttlSeconds: 20,
  });
  expect(request).not.toHaveProperty("authToken");
});

test("runCanonical returns a deferred delivery error only after the runner records RUN_FINISHED", async () => {
  const recordedEvents: BaseEvent[] = [];
  let runnerCompleted = false;
  const runner = new TestRunner(
    (request) =>
      new Observable<BaseEvent>((observer) => {
        void request.agent
          .runAgent(request.input, {
            onEvent: ({ event }) => {
              recordedEvents.push(event);
              observer.next(event);
            },
          })
          .then(
            () => {
              runnerCompleted = true;
              observer.complete();
            },
            (error: unknown) => observer.error(error),
          );
      }),
  );
  const runCanonical = await captureRunCanonical(runner);
  const deliveryError = new Error("provider delivery failed");

  const result = await runCanonical(
    runArgs(async (subscriber, identity) => {
      if (!identity) throw new Error("canonical identity is missing");
      const input: RunAgentInput = {
        ...identity,
        messages: [],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      };
      for (const type of [
        EventType.RUN_STARTED,
        EventType.RUN_FINISHED,
      ] as const) {
        await subscriber.onEvent?.({
          event: { type, ...identity },
          messages: [],
          state: {},
          agent: new NoopAgent(),
          input,
        });
      }
      return {
        iterations: 1,
        interrupted: false,
        deliveryError,
      };
    }),
  );

  expect(runnerCompleted).toBe(true);
  expect(result).toEqual({
    iterations: 1,
    interrupted: false,
    deliveryError,
  });
  expect(recordedEvents.map(({ type }) => type)).toEqual([
    EventType.RUN_STARTED,
    EventType.RUN_FINISHED,
  ]);
});

test("runCanonical rejects a runner join failure", async () => {
  const runner = new TestRunner(() =>
    throwError(() => new Error("runner join failed")),
  );
  const runCanonical = await captureRunCanonical(runner);

  await expect(runCanonical(runArgs())).rejects.toThrow("runner join failed");
});

test("runCanonical cleans up the lock when the runner cannot start", async () => {
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });
  const cleanup = vi
    .spyOn(intelligence, "ɵcleanupThreadLock")
    .mockResolvedValue(undefined);
  const runner = new TestRunner(() => {
    throw new Error("runner startup failed");
  });
  const runCanonical = await captureRunCanonical(runner, { intelligence });

  await expect(runCanonical(runArgs())).rejects.toThrow(
    "runner startup failed",
  );
  expect(cleanup).toHaveBeenCalledWith(canonicalIdentity);
});

test("runCanonical cleans up the lock after a successful runner stream", async () => {
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });
  const cleanup = vi
    .spyOn(intelligence, "ɵcleanupThreadLock")
    .mockResolvedValue(undefined);
  const runner = new TestRunner(() => EMPTY);
  const runCanonical = await captureRunCanonical(runner, { intelligence });

  await runCanonical(runArgs());

  expect(cleanup).toHaveBeenCalledWith(canonicalIdentity);
});

test("runCanonical rejects an outer agent error completed by the standard runner", async () => {
  const runCanonical = await captureRunCanonical(new InMemoryAgentRunner());
  const agent = new NoopAgent();
  const threadId = "standard-runner-thread";
  const runId = "standard-runner-run";

  await expect(
    runCanonical({
      agent,
      threadId,
      runId,
      userId: "app-user-1",
      agentId: "support-agent",
      tools: [],
      context: [],
      persistedInputMessages: [],
      execute: async (subscriber, identity) => {
        if (!identity) throw new Error("canonical identity is missing");
        const errorEvent: BaseEvent = {
          type: EventType.RUN_ERROR,
          ...identity,
          message: "outer agent failed",
          code: "OUTER_FAILED",
        };
        const input: RunAgentInput = {
          ...identity,
          messages: agent.messages,
          state: agent.state,
          tools: [],
          context: [],
          forwardedProps: {},
        };
        await subscriber.onEvent?.({
          event: errorEvent,
          messages: agent.messages,
          state: agent.state,
          agent,
          input,
        });
        throw Object.assign(new Error("outer agent failed"), {
          code: "OUTER_FAILED",
        });
      },
    }),
  ).rejects.toMatchObject({
    message: "outer agent failed",
    code: "OUTER_FAILED",
  });
});
