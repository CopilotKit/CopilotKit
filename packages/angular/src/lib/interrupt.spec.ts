import type {
  AbstractAgent,
  AgentSubscriber,
  Interrupt,
  Message,
  RunAgentResult,
} from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";

import { InterruptController, InterruptExpiredError } from "./interrupt";
import type { InterruptRunOptions } from "./interrupt";

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

function finalizeStandard(agent: FakeAgent, interrupts: Interrupt[]): void {
  agent.subscriber?.onRunFinishedEvent?.({
    outcome: "interrupt",
    interrupts,
  } as never);
  agent.subscriber?.onRunFinalized?.({} as never);
}

function finalizeLegacy(agent: FakeAgent, value: unknown): void {
  agent.subscriber?.onCustomEvent?.({
    event: { name: "on_interrupt", value },
  } as never);
  agent.subscriber?.onRunFinalized?.({} as never);
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
    } as never);
    agent.subscriber?.onRunFinalized?.({} as never);

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
      makeInterrupt("one", { toolCallId: "tool-one" }),
      makeInterrupt("two", { toolCallId: "tool-two" }),
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
      resume: [
        { interruptId: "one", status: "resolved", payload: { approved: true } },
        { interruptId: "two", status: "cancelled" },
      ],
    });

    startResume();
    await Promise.all([resumePromise, duplicatePromise]);
    expect(controller.hasInterrupt()).toBe(false);
  });

  it("resumes legacy events with forwarded command data", async () => {
    const { agent, controller, run, startResume } = setup();
    const value = { proposal: "ship" };
    finalizeLegacy(agent, value);

    const resumePromise = controller.resolve({ approved: true });
    expect(run).toHaveBeenCalledWith(agent, {
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

  it("clears pending state on thread changes and failed runs", () => {
    const { agent, controller } = setup();
    finalizeStandard(agent, [makeInterrupt("one")]);
    controller.setThreadId("thread-b");
    expect(controller.hasInterrupt()).toBe(false);

    finalizeStandard(agent, [makeInterrupt("two")]);
    agent.subscriber?.onRunFailed?.({
      error: new Error("run failed"),
    } as never);
    expect(controller.hasInterrupt()).toBe(false);
    expect(controller.error()).toEqual(new Error("run failed"));
  });
});
