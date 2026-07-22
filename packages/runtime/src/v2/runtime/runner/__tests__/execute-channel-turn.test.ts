import { describe, it, expect } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EMPTY, Observable } from "rxjs";
import type {
  ChannelAgentRouteContext,
  ChannelAgentSelection,
  ChannelConcurrencyContext,
  ChannelConcurrencyDecision,
} from "@copilotkit/channels";
import { AgentRunner } from "../agent-runner";
import type {
  AgentRunnerConnectRequest,
  AgentRunnerExecuteRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
  AgentTurnController,
} from "../agent-runner";
import type { RuntimeChannelBinding } from "../channel-runner";
import {
  executeChannelTurn,
  InMemorySelectionPinStore,
} from "../execute-channel-turn";

class NoopAgent extends AbstractAgent {
  constructor(readonly tag = "noop") {
    super();
  }
  clone(): AbstractAgent {
    return new NoopAgent(this.tag);
  }
  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

/**
 * A fake AgentRunner whose execute() synchronously invokes the turn body with a
 * controller, then completes. Records each inner runAgent call.
 */
class FakeExecuteRunner extends AgentRunner {
  readonly executeCalls: AgentRunnerExecuteRequest[] = [];
  readonly innerRuns: Array<{ agent: AbstractAgent; input: RunAgentInput }> =
    [];
  executeError?: Error;

  execute(request: AgentRunnerExecuteRequest): Observable<BaseEvent> {
    this.executeCalls.push(request);
    return new Observable<BaseEvent>((observer) => {
      const controller: AgentTurnController = {
        signal: new AbortController().signal,
        runAgent: async ({ agent, input }) => {
          this.innerRuns.push({ agent, input });
        },
      };
      request
        .turn(controller)
        .then(() => {
          if (this.executeError) {
            observer.error(this.executeError);
          } else {
            observer.next({
              type: EventType.RUN_FINISHED,
              threadId: request.threadId,
              runId: request.runId,
            } as BaseEvent);
            observer.complete();
          }
        })
        .catch((err) => observer.error(err));
    });
  }

  run(_r: AgentRunnerRunRequest): Observable<BaseEvent> {
    return EMPTY;
  }
  connect(_r: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return EMPTY;
  }
  isRunning(_r: AgentRunnerIsRunningRequest): Promise<boolean> {
    return Promise.resolve(false);
  }
  stop(_r: AgentRunnerStopRequest): Promise<boolean | undefined> {
    return Promise.resolve(false);
  }
}

interface BindingSpy {
  binding: RuntimeChannelBinding;
  selectCalls: ChannelAgentRouteContext[];
  resolveCalls: Array<{
    selectionKey: string;
    threadId: string;
    runId: string;
  }>;
  events: string[];
}

function makeBinding(opts?: {
  selectionKey?: string;
  selectError?: Error;
  resolveError?: Error;
  concurrency?: ChannelConcurrencyDecision;
}): BindingSpy {
  const selectCalls: ChannelAgentRouteContext[] = [];
  const resolveCalls: Array<{
    selectionKey: string;
    threadId: string;
    runId: string;
  }> = [];
  const events: string[] = [];
  const binding: RuntimeChannelBinding = {
    channel: { name: "support" } as never,
    async selectAgent(ctx): Promise<ChannelAgentSelection> {
      selectCalls.push(ctx);
      events.push("select");
      if (opts?.selectError) throw opts.selectError;
      return { key: opts?.selectionKey ?? "named:default" };
    },
    async resolveAgent(input): Promise<AbstractAgent> {
      resolveCalls.push(input);
      events.push("resolve");
      if (opts?.resolveError) throw opts.resolveError;
      return new NoopAgent();
    },
    async decideConcurrency(
      _ctx: ChannelConcurrencyContext,
    ): Promise<ChannelConcurrencyDecision> {
      return opts?.concurrency ?? "replace";
    },
  };
  return { binding, selectCalls, resolveCalls, events };
}

const routeContext = (): ChannelAgentRouteContext => ({
  channelName: "support",
  platform: "slack",
  turnId: "turn-1",
  conversation: { key: "C1:U1", kind: "direct_message" },
  event: { kind: "message", text: "hi" },
  signal: new AbortController().signal,
});

const input = (): RunAgentInput => ({
  threadId: "thr_1",
  runId: "run_1",
  messages: [],
  state: {},
  tools: [],
  context: [],
});

describe("executeChannelTurn", () => {
  it("selects, pins, then resolves within the fenced outer run", async () => {
    const runner = new FakeExecuteRunner();
    const pins = new InMemorySelectionPinStore();
    const spy = makeBinding({ selectionKey: "named:billing" });
    const runTurnAgents: AbstractAgent[] = [];

    await executeChannelTurn(runner, pins, {
      binding: spy.binding,
      turnKey: "support:turn-1",
      threadId: "thr_1",
      runId: "run_1",
      routeContext: routeContext(),
      input: input(),
      runTurn: async (agent, controller) => {
        runTurnAgents.push(agent);
        await controller.runAgent({ agent, input: input() });
      },
    });

    expect(spy.selectCalls).toHaveLength(1);
    expect(runner.executeCalls).toHaveLength(1);
    expect(spy.resolveCalls).toEqual([
      { selectionKey: "named:billing", threadId: "thr_1", runId: "run_1" },
    ]);
    expect(runner.innerRuns).toHaveLength(1);
    expect(runTurnAgents[0]).toBeInstanceOf(NoopAgent);
    // The key is pinned BEFORE the agent is resolved/run.
    expect(spy.events).toEqual(["select", "resolve"]);
    await expect(pins.get("support:turn-1")).resolves.toBe("named:billing");
  });

  it("reuses the pinned key on retry — never re-selects", async () => {
    const runner = new FakeExecuteRunner();
    const pins = new InMemorySelectionPinStore();
    await pins.set("support:turn-1", "named:travis");
    const spy = makeBinding({ selectionKey: "named:should-not-be-used" });

    await executeChannelTurn(runner, pins, {
      binding: spy.binding,
      turnKey: "support:turn-1",
      threadId: "thr_1",
      runId: "run_1",
      routeContext: routeContext(),
      input: input(),
      runTurn: async () => {},
    });

    expect(spy.selectCalls).toHaveLength(0);
    expect(spy.resolveCalls[0]?.selectionKey).toBe("named:travis");
  });

  it("pins before running, so a failed run keeps the same selection on retry", async () => {
    const runner = new FakeExecuteRunner();
    runner.executeError = new Error("transport blip");
    const pins = new InMemorySelectionPinStore();
    const spy = makeBinding({ selectionKey: "named:billing" });

    await expect(
      executeChannelTurn(runner, pins, {
        binding: spy.binding,
        turnKey: "support:turn-1",
        threadId: "thr_1",
        runId: "run_1",
        routeContext: routeContext(),
        input: input(),
        runTurn: async () => {},
      }),
    ).rejects.toThrow("transport blip");

    // The selection was pinned before the run failed — a retry reuses it.
    await expect(pins.get("support:turn-1")).resolves.toBe("named:billing");
  });

  it("fails loud without pinning or running when selection fails", async () => {
    const runner = new FakeExecuteRunner();
    const pins = new InMemorySelectionPinStore();
    const spy = makeBinding({ selectError: new Error("no agent named ghost") });

    await expect(
      executeChannelTurn(runner, pins, {
        binding: spy.binding,
        turnKey: "support:turn-1",
        threadId: "thr_1",
        runId: "run_1",
        routeContext: routeContext(),
        input: input(),
        runTurn: async () => {},
      }),
    ).rejects.toThrow("no agent named ghost");

    expect(runner.executeCalls).toHaveLength(0);
    await expect(pins.get("support:turn-1")).resolves.toBeUndefined();
  });
});

describe("InMemorySelectionPinStore", () => {
  it("round-trips a pinned key and returns undefined for unknown turns", async () => {
    const pins = new InMemorySelectionPinStore();
    await expect(pins.get("unknown")).resolves.toBeUndefined();
    await pins.set("t1", "named:a");
    await expect(pins.get("t1")).resolves.toBe("named:a");
  });
});
