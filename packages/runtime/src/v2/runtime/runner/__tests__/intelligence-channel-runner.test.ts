import { describe, it, expect } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EMPTY, Observable } from "rxjs";
import type {
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
import type { ChannelDeliveryEnvelope } from "../channel-preflight";
import { InMemorySelectionPinStore } from "../execute-channel-turn";
import { IntelligenceChannelRunner } from "../intelligence-channel-runner";
import type {
  ChannelConnectivity,
  ChannelDelivery,
} from "../intelligence-channel-runner";

class NoopAgent extends AbstractAgent {
  clone(): AbstractAgent {
    return new NoopAgent();
  }
  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

/** Runs the turn body immediately and completes. */
class TurnRunner extends AgentRunner {
  execute(request: AgentRunnerExecuteRequest): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      const controller: AgentTurnController = {
        signal: new AbortController().signal,
        runAgent: async () => {},
      };
      request
        .turn(controller)
        .then(() => observer.complete())
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

function fakeBinding(name: string): RuntimeChannelBinding {
  return {
    channel: { name } as never,
    async selectAgent(): Promise<ChannelAgentSelection> {
      return { key: "named:default" };
    },
    async resolveAgent(): Promise<AbstractAgent> {
      return new NoopAgent();
    },
    async decideConcurrency(
      _c: ChannelConcurrencyContext,
    ): Promise<ChannelConcurrencyDecision> {
      return "replace";
    },
  };
}

/** Fake connectivity whose deliveries are driven manually by the test. */
class FakeConnectivity implements ChannelConnectivity {
  startedChannels?: readonly string[];
  stopped = false;
  private onDelivery?: (d: ChannelDelivery) => Promise<void>;

  start(
    channelNames: readonly string[],
    onDelivery: (d: ChannelDelivery) => Promise<void>,
  ): Promise<{ stop(): Promise<void> }> {
    this.startedChannels = channelNames;
    this.onDelivery = onDelivery;
    return Promise.resolve({
      stop: () => {
        this.stopped = true;
        return Promise.resolve();
      },
    });
  }

  /** Push a delivery through the wired handler. */
  deliver(d: ChannelDelivery): Promise<void> {
    return this.onDelivery!(d);
  }
}

const envelope = (
  channelName: string,
  overrides: Partial<ChannelDeliveryEnvelope> = {},
): ChannelDeliveryEnvelope => ({
  kind: "turn",
  turnId: "turn-1",
  channelName,
  platform: "slack",
  conversationKey: "C1:U1",
  text: "hi",
  ...overrides,
});

const runInput = (): RunAgentInput => ({
  threadId: "thr_1",
  runId: "run_1",
  messages: [],
  state: {},
  tools: [],
  context: [],
});

function makeDelivery(
  channelName: string,
  spies: { acks: string[]; nacks: string[]; ranTurns: number },
): ChannelDelivery {
  return {
    envelope: envelope(channelName),
    threadId: "thr_1",
    runId: "run_1",
    turnKey: `${channelName}:turn-1`,
    input: runInput(),
    runTurn: async () => {
      spies.ranTurns++;
    },
    ack: async () => {
      spies.acks.push("ack");
    },
    nack: async (reason: string) => {
      spies.nacks.push(reason);
    },
  };
}

describe("IntelligenceChannelRunner", () => {
  it("routes a delivery through preflight + execute, then acks", async () => {
    const connectivity = new FakeConnectivity();
    const runner = new IntelligenceChannelRunner({
      connectivity,
      pins: new InMemorySelectionPinStore(),
    });
    const control = runner.start({
      bindings: [fakeBinding("support")],
      agentRunner: new TurnRunner(),
    });
    await control.ready();

    const spies = { acks: [] as string[], nacks: [] as string[], ranTurns: 0 };
    await connectivity.deliver(makeDelivery("support", spies));

    expect(connectivity.startedChannels).toEqual(["support"]);
    expect(spies.ranTurns).toBe(1);
    expect(spies.acks).toEqual(["ack"]);
    expect(spies.nacks).toEqual([]);
  });

  it("nacks a delivery for an unknown channel without running", async () => {
    const connectivity = new FakeConnectivity();
    const runner = new IntelligenceChannelRunner({
      connectivity,
      pins: new InMemorySelectionPinStore(),
    });
    runner.start({
      bindings: [fakeBinding("support")],
      agentRunner: new TurnRunner(),
    });

    const spies = { acks: [] as string[], nacks: [] as string[], ranTurns: 0 };
    await connectivity.deliver(makeDelivery("ghost", spies));

    expect(spies.ranTurns).toBe(0);
    expect(spies.acks).toEqual([]);
    expect(spies.nacks[0]).toMatch(/ghost/);
  });

  it("nacks (does not ack) when the turn fails", async () => {
    const connectivity = new FakeConnectivity();
    const runner = new IntelligenceChannelRunner({
      connectivity,
      pins: new InMemorySelectionPinStore(),
    });
    runner.start({
      bindings: [fakeBinding("support")],
      agentRunner: new TurnRunner(),
    });

    const spies = { acks: [] as string[], nacks: [] as string[], ranTurns: 0 };
    const delivery: ChannelDelivery = {
      ...makeDelivery("support", spies),
      runTurn: async () => {
        throw new Error("render blew up");
      },
    };
    await connectivity.deliver(delivery);

    expect(spies.acks).toEqual([]);
    expect(spies.nacks[0]).toMatch(/render blew up/);
  });

  it("stop() tears down connectivity and reports stopped", async () => {
    const connectivity = new FakeConnectivity();
    const runner = new IntelligenceChannelRunner({
      connectivity,
      pins: new InMemorySelectionPinStore(),
    });
    const control = runner.start({
      bindings: [fakeBinding("support")],
      agentRunner: new TurnRunner(),
    });
    await control.ready();

    await control.stop();

    expect(connectivity.stopped).toBe(true);
    expect(control.status().overall).toBe("stopped");
  });

  it("reports online once ready", async () => {
    const connectivity = new FakeConnectivity();
    const runner = new IntelligenceChannelRunner({
      connectivity,
      pins: new InMemorySelectionPinStore(),
    });
    const control = runner.start({
      bindings: [fakeBinding("support")],
      agentRunner: new TurnRunner(),
    });
    await control.ready();

    const status = control.status();
    expect(status.overall).toBe("online");
    expect(status.channels).toEqual({ support: "online" });
  });
});
