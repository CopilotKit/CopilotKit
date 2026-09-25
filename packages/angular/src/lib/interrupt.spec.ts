import type {
  AbstractAgent,
  AgentSubscriber,
  Interrupt,
  Message,
  RunAgentResult,
} from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";

import type { InterruptRunOptions } from "./interrupt";
import { InterruptController, InterruptExpiredError } from "./interrupt";
import { assertDefined } from "./utils";

class FakeAgent {
  readonly messages: Message[] = [];
  pendingInterrupts: Interrupt[] = [];
  threadId = "thread-a";
  subscriber?: AgentSubscriber;
  readonly addMessage = vi.fn((message: Message) => {
    this.messages.push(message);
  });

  subscribe(subscriber: AgentSubscriber): { unsubscribe: () => void } {
    this.subscriber = subscriber;
    return { unsubscribe: vi.fn() };
  }
}

const makeInterrupt = (
  id: string,
  overrides: Partial<Interrupt> = {},
): Interrupt => ({
  id,
  reason: "approval",
  message: `Approve ${id}?`,
  ...overrides,
});

function setup(
  options: ConstructorParameters<typeof InterruptController>[2] = {},
) {
  const agent = new FakeAgent();
  let startResume: (() => void) | undefined;
  const run = vi.fn(
    (_agent: AbstractAgent, _options: InterruptRunOptions) =>
      new Promise<RunAgentResult>((resolve) => {
        startResume = () => {
          agent.subscriber?.onRunStartedEvent?.({} as never);
          resolve({ result: null, newMessages: [] });
        };
      }),
  );
  const controller = new InterruptController(run, options);
  controller.connect(agent as unknown as AbstractAgent);
  return {
    agent,
    controller,
    run,
    startResume: () => startResume?.(),
  };
}

function finalizeStandard(
  agent: FakeAgent,
  interrupts: Interrupt[],
  runId = "run-id",
  // The run the event names. On the connect path this differs from the run id
  // of the request that opened the stream.
  eventRunId = runId,
): void {
  agent.subscriber?.onRunFinishedEvent?.({
    outcome: "interrupt",
    interrupts,
    input: { runId },
    event: { runId: eventRunId },
  } as never);
  agent.subscriber?.onRunFinalized?.({ input: { runId } } as never);
}

function finalizeLegacy(
  agent: FakeAgent,
  value: unknown,
  runId = "run-id",
): void {
  agent.subscriber?.onCustomEvent?.({
    event: { name: "on_interrupt", value },
  } as never);
  agent.subscriber?.onRunFinalized?.({ input: { runId } } as never);
}

describe("InterruptController", () => {
  it("prefers standard interrupts and exposes the primary and complete set", () => {
    const { agent, controller } = setup();
    agent.subscriber?.onCustomEvent?.({
      event: { name: "on_interrupt", value: { legacy: true } },
    } as never);
    agent.subscriber?.onRunFinishedEvent?.({
      outcome: "interrupt",
      interrupts: [makeInterrupt("one"), makeInterrupt("two")],
      input: { runId: "run-id" },
      event: { runId: "run-id" },
    } as never);
    agent.subscriber?.onRunFinalized?.({
      input: { runId: "run-id" },
    } as never);

    expect(controller.event()).toEqual({
      name: "on_interrupt",
      value: expect.objectContaining({ id: "one" }),
    });
    expect(controller.interrupt()?.id).toBe("one");
    expect(controller.interrupts().map(({ id }) => id)).toEqual(["one", "two"]);
  });

  it("restores unresolved standard interrupts when reconnecting", () => {
    const agent = new FakeAgent() as FakeAgent & {
      pendingInterrupts: Interrupt[];
    };
    agent.pendingInterrupts = [makeInterrupt("restored")];
    const controller = new InterruptController(vi.fn());

    controller.connect(agent as unknown as AbstractAgent);

    expect(controller.interrupt()?.id).toBe("restored");
  });

  it("accumulates multiple decisions, persists tool results, and resumes once", async () => {
    const { agent, controller, run, startResume } = setup();
    finalizeStandard(agent, [
      makeInterrupt("one", { reason: "tool_call", toolCallId: "tool-one" }),
      makeInterrupt("two", { reason: "tool_call", toolCallId: "tool-two" }),
    ]);

    await controller.cancel("two");
    expect(run).not.toHaveBeenCalled();

    const resumePromise = controller.resolve({ approved: true }, "one");
    const duplicatePromise = controller.resolve({ approved: false }, "one");
    expect(run).toHaveBeenCalledTimes(1);
    expect(controller.hasInterrupt()).toBe(true);
    expect(agent.addMessage).toHaveBeenCalledTimes(2);
    expect(agent.messages).toEqual([
      expect.objectContaining({
        role: "tool",
        toolCallId: "tool-one",
        content: JSON.stringify({ approved: true }),
      }),
      expect.objectContaining({
        role: "tool",
        toolCallId: "tool-two",
        content: JSON.stringify({ status: "cancelled" }),
      }),
    ]);
    expect(run).toHaveBeenCalledWith(agent, {
      runId: "run-id",
      resume: [
        { interruptId: "one", status: "resolved", payload: { approved: true } },
        { interruptId: "two", status: "cancelled" },
      ],
    });

    startResume();
    await Promise.all([resumePromise, duplicatePromise]);
    expect(controller.hasInterrupt()).toBe(false);
  });

  it("preserves the interrupted run id when resuming", async () => {
    const { agent, controller, run, startResume } = setup();
    const interruptControllerSubscriber = agent.subscriber;
    assertDefined(interruptControllerSubscriber);

    const interruptedRunId = "run-awaiting-approval";
    interruptControllerSubscriber.onRunFinishedEvent?.({
      outcome: "interrupt",
      interrupts: [makeInterrupt("approve-refund")],
      input: { runId: interruptedRunId },
      event: { runId: interruptedRunId },
    } as never);
    interruptControllerSubscriber.onRunFinalized?.({
      input: { runId: interruptedRunId },
    } as never);

    const resumePromise = controller.resolve({ approved: true });

    expect(run).toHaveBeenCalledWith(agent, {
      runId: interruptedRunId,
      resume: [
        {
          interruptId: "approve-refund",
          status: "resolved",
          payload: { approved: true },
        },
      ],
    });

    startResume();
    await resumePromise;
  });

  it("does not add tool messages for backend-owned interrupts", async () => {
    const { agent, controller, startResume } = setup();
    finalizeStandard(agent, [
      makeInterrupt("mastra-run::tool-one", {
        reason: "human_approval",
        toolCallId: "tool-one",
      }),
    ]);

    const resume = controller.resolve("approved");
    startResume();
    await resume;

    expect(agent.addMessage).not.toHaveBeenCalled();
  });

  it("resumes legacy events with forwarded command data", async () => {
    const { agent, controller, run, startResume } = setup();
    const value = { proposal: "ship" };
    finalizeLegacy(agent, value);

    const resumePromise = controller.resolve({ approved: true });
    expect(run).toHaveBeenCalledWith(agent, {
      runId: "run-id",
      forwardedProps: {
        command: {
          resume: { approved: true },
          interruptEvent: value,
        },
      },
    });
    expect(controller.hasInterrupt()).toBe(true);
    startResume();
    await resumePromise;
    expect(controller.hasInterrupt()).toBe(false);
  });

  it("rejects expired interrupts without starting a run", async () => {
    const { agent, controller, run } = setup();
    finalizeStandard(agent, [
      makeInterrupt("expired", { expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);

    await controller.resolve("yes");
    expect(run).not.toHaveBeenCalled();
    expect(controller.error()).toBeInstanceOf(InterruptExpiredError);
    expect(controller.hasInterrupt()).toBe(false);
  });

  it("surfaces resume failures, clears state, and does not retry", async () => {
    const agent = new FakeAgent();
    const failure = new Error("resume failed");
    const run = vi.fn().mockRejectedValue(failure);
    const controller = new InterruptController(run);
    controller.connect(agent as unknown as AbstractAgent);
    finalizeStandard(agent, [makeInterrupt("one")]);

    await expect(controller.resolve("yes")).rejects.toBe(failure);
    expect(controller.error()).toBe(failure);
    expect(controller.hasInterrupt()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    await controller.resolve("again");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not let an old resume rejection clear a newer interrupt", async () => {
    const agentA = new FakeAgent();
    const agentB = new FakeAgent();
    let rejectResume: ((error: unknown) => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<RunAgentResult>((_resolve, reject) => {
          rejectResume = reject;
        }),
    );
    const controller = new InterruptController(run);
    controller.connect(agentA as unknown as AbstractAgent);
    finalizeStandard(agentA, [makeInterrupt("old")]);
    const resume = controller.resolve("yes");

    controller.connect(agentB as unknown as AbstractAgent);
    finalizeStandard(agentB, [makeInterrupt("new")]);
    const failure = new Error("old resume failed");
    rejectResume?.(failure);

    await expect(resume).rejects.toBe(failure);
    expect(controller.interrupt()?.id).toBe("new");
    expect(controller.error()).toBeNull();
  });

  it("guards predicate and async preprocessing failures", async () => {
    const predicateError = new Error("predicate failed");
    const predicate = setup({
      enabled: () => {
        throw predicateError;
      },
    });
    finalizeLegacy(predicate.agent, { proposal: "hidden" });
    expect(predicate.controller.hasInterrupt()).toBe(false);
    expect(predicate.controller.error()).toBe(predicateError);

    const asyncPredicateError = new Error("async predicate failed");
    const asyncPredicate = setup({
      enabled: async () => {
        throw asyncPredicateError;
      },
    });
    finalizeLegacy(asyncPredicate.agent, { proposal: "also hidden" });
    await Promise.resolve();
    await Promise.resolve();
    expect(asyncPredicate.controller.hasInterrupt()).toBe(false);
    expect(asyncPredicate.controller.error()).toBe(asyncPredicateError);

    const handlerError = new Error("handler failed");
    const handler = setup({
      handler: async () => {
        throw handlerError;
      },
    });
    finalizeLegacy(handler.agent, { proposal: "visible" });
    await Promise.resolve();
    await Promise.resolve();
    expect(handler.controller.hasInterrupt()).toBe(true);
    expect(handler.controller.result()).toBeNull();
    expect(handler.controller.error()).toBe(handlerError);
  });

  it("leaves rejected interrupts for another controller", async () => {
    const { agent, controller, run } = setup({
      enabled: () => false,
    });
    finalizeStandard(agent, [makeInterrupt("other-controller")]);

    await controller.resolve("yes");
    await controller.cancel();

    expect(run).not.toHaveBeenCalled();
    expect(controller.hasInterrupt()).toBe(false);
  });

  it("rejects stale-thread decisions and clears failed runs", async () => {
    const { agent, controller, run } = setup();
    finalizeStandard(agent, [makeInterrupt("one")]);
    agent.threadId = "thread-b";
    await controller.resolve("yes");

    expect(run).not.toHaveBeenCalled();
    expect(controller.hasInterrupt()).toBe(false);

    finalizeStandard(agent, [makeInterrupt("two")]);
    agent.subscriber?.onRunFailed?.({
      error: new Error("run failed"),
    } as never);
    expect(controller.hasInterrupt()).toBe(false);
    expect(controller.error()).toEqual(new Error("run failed"));
  });
  // OSS-1131: committing only at `onRunFinalized` meant the connect path —
  // where finalize fires at socket teardown, not once per replayed run —
  // surfaced nothing, and a legacy gate had no durable record to recover from.
  describe("recovery after a lost event or a reconnect", () => {
    it("shows a standard gate from RUN_FINISHED on a stream that never finalizes", () => {
      const { agent, controller } = setup();

      agent.subscriber?.onRunFinishedEvent?.({
        outcome: "interrupt",
        interrupts: [makeInterrupt("replayed")],
        input: { runId: "run-id" },
        event: { runId: "run-id" },
      } as never);

      expect(controller.interrupt()?.id).toBe("replayed");
    });

    it("shows a legacy gate from RUN_FINISHED on a stream that never finalizes", () => {
      const { agent, controller } = setup();

      agent.subscriber?.onCustomEvent?.({
        event: { name: "on_interrupt", value: "approve?" },
      } as never);
      agent.subscriber?.onRunFinishedEvent?.({
        outcome: "success",
        input: { runId: "run-id" },
        event: { runId: "run-id" },
      } as never);

      expect(controller.event()).toEqual({
        name: "on_interrupt",
        value: "approve?",
      });
    });

    it("restores an unresolved legacy interrupt when reconnecting", () => {
      const { agent } = setup();
      finalizeLegacy(agent, "approve?");

      const next = new InterruptController(vi.fn());
      next.connect(agent as unknown as AbstractAgent);

      expect(next.event()).toEqual({
        name: "on_interrupt",
        value: "approve?",
      });
    });

    it("forgets a legacy interrupt once a new run starts", () => {
      const { agent } = setup();
      finalizeLegacy(agent, "approve?");
      agent.subscriber?.onRunStartedEvent?.({} as never);

      const next = new InterruptController(vi.fn());
      next.connect(agent as unknown as AbstractAgent);

      expect(next.hasInterrupt()).toBe(false);
    });
    it("resumes the replayed run, not the connection that replayed it", async () => {
      // A reconnect opens one long-lived request and replays the run that
      // paused. `input.runId` names the connection; only the event names the
      // run the backend is waiting on.
      const { agent, controller, run, startResume } = setup();
      finalizeStandard(
        agent,
        [makeInterrupt("approve-refund")],
        "connection-123",
        "original-run",
      );

      const resumePromise = controller.resolve({ approved: true });
      expect(run).toHaveBeenCalledWith(
        agent,
        expect.objectContaining({ runId: "original-run" }),
      );
      startResume();
      await resumePromise;
    });

    it("resumes a legacy gate with the run that raised it", async () => {
      const { agent, controller, run, startResume } = setup();
      finalizeLegacy(agent, "approve?", "gated-run");

      const resumePromise = controller.resolve({ approved: true });
      expect(run).toHaveBeenCalledWith(
        agent,
        expect.objectContaining({ runId: "gated-run" }),
      );
      startResume();
      await resumePromise;
    });

    it("does not restore thread A's legacy gate inside thread B", () => {
      // One agent instance serves every conversation. A's approval prompt must
      // not surface while the app shows B, because answering it there would
      // resume A.
      const { agent } = setup();
      finalizeLegacy(agent, "approve A?");

      agent.threadId = "thread-b";
      const next = new InterruptController(vi.fn());
      next.connect(agent as unknown as AbstractAgent);

      expect(next.hasInterrupt()).toBe(false);
    });

    it("restores thread A's legacy gate when the app returns to thread A", () => {
      const { agent } = setup();
      finalizeLegacy(agent, "approve A?");

      agent.threadId = "thread-b";
      const inOther = new InterruptController(vi.fn());
      inOther.connect(agent as unknown as AbstractAgent);
      expect(inOther.hasInterrupt()).toBe(false);

      agent.threadId = "thread-a";
      const back = new InterruptController(vi.fn());
      back.connect(agent as unknown as AbstractAgent);

      expect(back.event()).toEqual({
        name: "on_interrupt",
        value: "approve A?",
      });
    });
  });
});
