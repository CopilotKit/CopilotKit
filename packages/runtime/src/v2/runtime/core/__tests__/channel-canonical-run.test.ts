import { AbstractAgent, EventType } from "@ag-ui/client";
import type { AgentSubscriber, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { createChannel } from "@copilotkit/channels";
import { EMPTY, Observable, of, throwError } from "rxjs";
import { expect, test } from "vitest";
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

  stop(_request: AgentRunnerStopRequest): Promise<boolean> {
    return Promise.resolve(false);
  }
}

async function captureRunCanonical(runner: AgentRunner): Promise<RunCanonical> {
  let captured: RunCanonical | undefined;
  const importer = async (): Promise<ChannelsIntelligenceModule> => ({
    startChannelsOverRealtimeGateway: async (_channels, options) => {
      captured = options.runCanonical;
      return { metadata: {}, stop: async () => {} };
    },
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
      intelligence: new CopilotKitIntelligence({
        apiUrl: "https://runtime.example",
        wsUrl: "wss://runtime.example",
        apiKey: "cpk-42_short_long",
      }),
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
    runnerToken: "runner-token",
    tools: [],
    context: [],
    persistedInputMessages: [],
    execute,
  };
}

test("runCanonical rejects a RUN_ERROR event even when the runner completes", async () => {
  const runner = new TestRunner(() =>
    of({
      type: EventType.RUN_ERROR,
      message: "agent failed",
      code: "AGENT_FAILED",
    }),
  );
  const runCanonical = await captureRunCanonical(runner);

  await expect(runCanonical(runArgs())).rejects.toMatchObject({
    message: "agent failed",
    code: "AGENT_FAILED",
  });
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

test("runCanonical rejects a runner join failure", async () => {
  const runner = new TestRunner(() =>
    throwError(() => new Error("runner join failed")),
  );
  const runCanonical = await captureRunCanonical(runner);

  await expect(runCanonical(runArgs())).rejects.toThrow("runner join failed");
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
      runnerToken: "runner-token",
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
