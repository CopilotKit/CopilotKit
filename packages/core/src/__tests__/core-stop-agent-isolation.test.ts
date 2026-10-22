import { describe, it, expect } from "vitest";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../core";
import {
  MockAgent,
  createToolCallMessage,
  createAssistantMessage,
  createTool,
} from "./test-utils";

/**
 * Stopping one agent must only affect that agent's run. Two agents running on
 * one core (e.g. two chats with different agentIds) used to share a single
 * run abort controller and run depth.
 */

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** An agent whose first run calls `toolName` and whose follow-up replies. */
function agentWithTool(id: string, toolName: string) {
  const agent = new MockAgent({ agentId: id, threadId: `thread-${id}` });
  agent.setNewMessages([createToolCallMessage(toolName)]);
  let calls = 0;
  agent.runAgentCallback = () => {
    if (++calls === 2) {
      agent.setNewMessages([createAssistantMessage({ content: "done" })]);
    }
  };
  return agent;
}

/** Two agents, each with a follow-up tool that waits until released. */
function setup() {
  const core = new CopilotKitCore({});
  const A = agentWithTool("A", "toolA");
  const B = agentWithTool("B", "toolB");
  core.addAgent__unsafe_dev_only({ id: "A", agent: A as any });
  core.addAgent__unsafe_dev_only({ id: "B", agent: B as any });

  const release = { A: deferred(), B: deferred() };
  const entered = { A: deferred(), B: deferred() };
  const signals: Record<"A" | "B", AbortSignal | undefined> = {
    A: undefined,
    B: undefined,
  };
  for (const key of ["A", "B"] as const) {
    core.addTool(
      createTool({
        name: `tool${key}`,
        followUp: true,
        handler: async (_args: unknown, context: any) => {
          signals[key] = context.signal;
          entered[key].resolve();
          await release[key].promise;
          return "ok";
        },
      }),
    );
  }
  return { core, A, B, release, entered, signals };
}

/** An agent whose run reports a genuine (non-abort) RUN_ERROR. */
function failingAgent(id: string) {
  const agent = new MockAgent({ agentId: id, threadId: `thread-${id}` });
  const reportError = async (_input: unknown, subscriber?: any) => {
    await subscriber?.onRunErrorEvent?.({
      event: {
        type: "RUN_ERROR",
        message: "backend failed",
        code: "bad_request",
      },
      messages: [],
      state: {},
      agent,
      input: {},
    });
    return { newMessages: [] };
  };
  (agent as any).runAgent = reportError;
  (agent as any).connectAgent = reportError;
  (agent as any).detachActiveRun = async () => {};
  return agent;
}

describe("CopilotKitCore - stopAgent is scoped to one agent", () => {
  it("stopping A does not abort B when both runs start together", async () => {
    const { core, A, B, release, entered, signals } = setup();
    const runA = core.runAgent({ agent: A as any });
    const runB = core.runAgent({ agent: B as any });
    await Promise.all([entered.A.promise, entered.B.promise]);

    core.stopAgent({ agent: A as any });
    const bAbortedByStopA = signals.B!.aborted;
    release.A.resolve();
    release.B.resolve();
    await Promise.all([runA, runB]);

    expect(signals.A!.aborted).toBe(true);
    expect(bAbortedByStopA).toBe(false);
    expect(A.runAgentCalls).toHaveLength(1); // A's follow-up is suppressed
    expect(B.runAgentCalls).toHaveLength(2); // B's follow-up still runs
  });

  it("stopping B does not abort A when B starts while A is running", async () => {
    const { core, A, B, release, entered, signals } = setup();
    const runA = core.runAgent({ agent: A as any });
    await entered.A.promise;
    const runB = core.runAgent({ agent: B as any });
    await entered.B.promise;

    core.stopAgent({ agent: B as any });
    const aAbortedByStopB = signals.A!.aborted;
    release.A.resolve();
    release.B.resolve();
    await Promise.all([runA, runB]);

    expect(signals.B!.aborted).toBe(true);
    expect(aAbortedByStopB).toBe(false);
    expect(A.runAgentCalls).toHaveLength(2);
    expect(B.runAgentCalls).toHaveLength(1);
  });

  it("agent.abortRun() aborts a run that started while another agent was running", async () => {
    const { core, A, B, release, entered, signals } = setup();
    const runA = core.runAgent({ agent: A as any });
    await entered.A.promise;
    const runB = core.runAgent({ agent: B as any });
    await entered.B.promise;

    (B as any).abortRun();
    const bAborted = signals.B!.aborted;
    const aAborted = signals.A!.aborted;
    release.A.resolve();
    release.B.resolve();
    await Promise.all([runA, runB]);

    expect(bAborted).toBe(true);
    expect(aAborted).toBe(false);
  });

  it("reports another agent's RUN_ERROR while a stopped agent is still running", async () => {
    const { core, A, release, entered } = setup();
    const errors: string[] = [];
    core.subscribe({ onError: (event) => void errors.push(event.code) });

    const runA = core.runAgent({ agent: A as any });
    await entered.A.promise;
    core.stopAgent({ agent: A as any });

    const failing = failingAgent("C");
    core.addAgent__unsafe_dev_only({ id: "C", agent: failing as any });
    await core.runAgent({ agent: failing as any });
    release.A.resolve();
    await runA;

    expect(errors).toContain(CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT);
  });

  it("reports a RUN_ERROR after a stopped run has finished", async () => {
    const { core, A, release, entered } = setup();
    const errors: string[] = [];
    core.subscribe({ onError: (event) => void errors.push(event.code) });

    const runA = core.runAgent({ agent: A as any });
    await entered.A.promise;
    core.stopAgent({ agent: A as any });
    release.A.resolve();
    await runA;

    const failing = failingAgent("C");
    core.addAgent__unsafe_dev_only({ id: "C", agent: failing as any });
    await core.connectAgent({ agent: failing as any });

    expect(errors).toContain(CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT);
  });

  it("stopAgent still aborts an overlapping run on the same agent after the first run ends", async () => {
    const { core, agent, release, entered, signals } = sameAgentSetup();

    const firstRun = core.runAgent({ agent: agent as any });
    await entered.first.promise;
    const secondRun = core.runAgent({ agent: agent as any });
    await entered.second.promise;
    release.first.resolve();
    await firstRun;

    core.stopAgent({ agent: agent as any });
    const secondAborted = signals.second!.aborted;
    release.second.resolve();
    await secondRun;

    expect(secondAborted).toBe(true);
  });

  it("agent.abortRun() still aborts an overlapping run on the same agent after the first run ends", async () => {
    const { core, agent, release, entered, signals } = sameAgentSetup();
    const originalAbortRun = agent.abortRun;

    const firstRun = core.runAgent({ agent: agent as any });
    await entered.first.promise;
    const secondRun = core.runAgent({ agent: agent as any });
    await entered.second.promise;
    release.first.resolve();
    await firstRun;

    (agent as any).abortRun();
    const secondAborted = signals.second!.aborted;
    release.second.resolve();
    await secondRun;

    expect(secondAborted).toBe(true);
    expect(agent.abortRun).toBe(originalAbortRun);
  });

  it("two runs started in the same tick on one agent install the abortRun intercept once", async () => {
    const { core, agent, release, entered, signals } = sameAgentSetup();
    const originalAbortRun = agent.abortRun;

    const firstRun = core.runAgent({ agent: agent as any });
    const secondRun = core.runAgent({ agent: agent as any });
    await Promise.all([entered.first.promise, entered.second.promise]);

    (agent as any).abortRun();
    const aborted = [signals.first!.aborted, signals.second!.aborted];
    release.first.resolve();
    release.second.resolve();
    await Promise.all([firstRun, secondRun]);

    expect(aborted).toEqual([true, true]);
    expect(originalAbortRun).toHaveBeenCalledTimes(1);
    expect(agent.abortRun).toBe(originalAbortRun);
  });

  it("a new run after Stop gets a fresh controller while the stopped run's tool is still pending", async () => {
    const { core, agent, release, entered, signals } = sameAgentSetup();

    // The first tool ignores its signal, so the stopped run is still in
    // flight when the user sends the next message.
    const stoppedRun = core.runAgent({ agent: agent as any });
    await entered.first.promise;
    core.stopAgent({ agent: agent as any });

    release.second.resolve();
    await core.runAgent({ agent: agent as any });
    release.first.resolve();
    await stoppedRun;

    expect(signals.first!.aborted).toBe(true);
    // The next run's tool executed, under a signal the old Stop did not abort.
    expect(signals.second).toBeDefined();
    expect(signals.second!.aborted).toBe(false);
  });

  it("stopAgent aborts the stopped run and a newer overlapping run on the same agent", async () => {
    const { core, agent, release, entered, signals } = sameAgentSetup();

    const firstRun = core.runAgent({ agent: agent as any });
    await entered.first.promise;
    const secondRun = core.runAgent({ agent: agent as any });
    await entered.second.promise;

    core.stopAgent({ agent: agent as any });
    const aborted = [signals.first!.aborted, signals.second!.aborted];
    release.first.resolve();
    release.second.resolve();
    await Promise.all([firstRun, secondRun]);

    expect(aborted).toEqual([true, true]);
  });
});

/** One agent whose first run calls `first` and whose second run calls `second`. */
function sameAgentSetup() {
  const core = new CopilotKitCore({});
  const agent = new MockAgent({ agentId: "A", threadId: "thread-A" });
  core.addAgent__unsafe_dev_only({ id: "A", agent: agent as any });
  let calls = 0;
  agent.runAgentCallback = () => {
    calls++;
    agent.setNewMessages([
      createToolCallMessage(calls === 1 ? "first" : "second"),
    ]);
  };

  const release = { first: deferred(), second: deferred() };
  const entered = { first: deferred(), second: deferred() };
  const signals: Record<"first" | "second", AbortSignal | undefined> = {
    first: undefined,
    second: undefined,
  };
  for (const name of ["first", "second"] as const) {
    core.addTool(
      createTool({
        name,
        followUp: false,
        handler: async (_args: unknown, context: any) => {
          signals[name] = context.signal;
          entered[name].resolve();
          await release[name].promise;
          return "ok";
        },
      }),
    );
  }
  return { core, agent, release, entered, signals };
}
