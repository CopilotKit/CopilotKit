import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { CopilotKitCore } from "@copilotkit/core";
import { from } from "rxjs";
import type {
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
): void {
  agent.subscriber?.onRunFinishedEvent?.({
    outcome: "interrupt",
    interrupts,
    input: { runId },
  } as never);
  agent.subscriber?.onRunFinalized?.({ input: { runId } } as never);
}

function finalizeLegacy(agent: FakeAgent, value: unknown): void {
  agent.subscriber?.onCustomEvent?.({
    event: { name: "on_interrupt", value },
  } as never);
  agent.subscriber?.onRunFinalized?.({} as never);
}

describe("InterruptController", () => {
  it.each(["resolve", "cancel"])(
    "%s preserves existing frontend results in a mixed interrupt batch",
    async (action) => {
      const { agent, controller, run, startResume } = setup();
      agent.messages.push({
        id: "saved",
        role: "tool",
        toolCallId: "chart",
        content: "",
      });
      finalizeStandard(agent, [
        makeInterrupt("chart-i", { reason: "tool_call", toolCallId: "chart" }),
        makeInterrupt("approval"),
      ]);
      const resumed =
        action === "resolve"
          ? controller.resolve("allow", "approval")
          : controller.cancel("approval");
      expect(agent.addMessage).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledExactlyOnceWith(agent, {
        resume: [
          { interruptId: "chart-i", status: "resolved", payload: "" },
          action === "resolve"
            ? { interruptId: "approval", status: "resolved", payload: "allow" }
            : { interruptId: "approval", status: "cancelled" },
        ],
      });
      startResume();
      await resumed;
    },
  );

  it("prefers standard interrupts and exposes the primary and complete set", () => {
    const { agent, controller } = setup();
    agent.subscriber?.onCustomEvent?.({
      event: { name: "on_interrupt", value: { legacy: true } },
    } as never);
    agent.subscriber?.onRunFinishedEvent?.({
      outcome: "interrupt",
      interrupts: [makeInterrupt("one"), makeInterrupt("two")],
      input: { runId: "run-id" },
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
    expect(controller.hasInterrupt()).toBe(false);
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

  it("uses a fresh run ID when resuming", async () => {
    const { agent, controller, run, startResume } = setup();
    const interruptControllerSubscriber = agent.subscriber;
    assertDefined(interruptControllerSubscriber);

    const interruptedRunId = "run-awaiting-approval";
    interruptControllerSubscriber.onRunFinishedEvent?.({
      outcome: "interrupt",
      interrupts: [makeInterrupt("approve-refund")],
      input: { runId: interruptedRunId },
    } as never);
    interruptControllerSubscriber.onRunFinalized?.({
      input: { runId: interruptedRunId },
    } as never);

    const resumePromise = controller.resolve({ approved: true });

    expect(run).toHaveBeenCalledWith(agent, {
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

  it.each(["resolve", "cancel"] as const)(
    "forwards explicit %s for saved failed tools",
    async (action) => {
      const { agent, controller, run, startResume } = setup();
      agent.messages.push({
        id: "error",
        role: "tool",
        toolCallId: "failed-call",
        content: "old failure",
        error: "failure",
      });
      finalizeStandard(agent, [
        makeInterrupt("failed", {
          reason: "tool_call",
          toolCallId: "failed-call",
        }),
      ]);
      const resumed =
        action === "resolve"
          ? controller.resolve("replacement", "failed")
          : controller.cancel("failed");
      expect(run).toHaveBeenCalledWith(agent, {
        resume: [
          action === "resolve"
            ? {
                interruptId: "failed",
                status: "resolved",
                payload: "replacement",
              }
            : { interruptId: "failed", status: "cancelled" },
        ],
      });
      expect(agent.addMessage).not.toHaveBeenCalled();
      expect(agent.messages).toHaveLength(1);
      startResume();
      await resumed;
    },
  );

  it("forwards cancellation after expiry", async () => {
    const { agent, controller, run, startResume } = setup();
    finalizeStandard(agent, [
      makeInterrupt("expired", { expiresAt: "2000-01-01T00:00:00Z" }),
    ]);
    const resumed = controller.cancel("expired");
    expect(run).toHaveBeenCalledWith(agent, {
      resume: [{ interruptId: "expired", status: "cancelled" }],
    });
    startResume();
    await resumed;
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
});

/** Actual wire agent exercises the controller/core handoff, not a mocked runner. */
class MixedInterruptAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  /** Create an isolated wire agent with a stable thread identity. */
  constructor() {
    super({ agentId: "mixed", threadId: "thread" });
  }
  /** Record resume input and emit the next scripted run. */
  run(input: RunAgentInput) {
    this.inputs.push(structuredClone(input));
    return this.events(input, this.inputs.length === 1 && !input.resume);
  }
  /** Replay the interrupted run when reconnecting. */
  protected connect(input: RunAgentInput) {
    return this.events(input, true);
  }
  /** Build the scripted mixed frontend-tool and approval event sequence. */
  private events(input: RunAgentInput, interrupted: boolean) {
    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ];
    if (interrupted)
      events.push({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          {
            id: "call",
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "chart",
                type: "function",
                function: { name: "chart", arguments: "{}" },
              },
            ],
          },
        ],
      });
    events.push({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      ...(interrupted
        ? {
            outcome: {
              type: "interrupt",
              interrupts: [
                { id: "chart-i", reason: "tool_call", toolCallId: "chart" },
                { id: "approval", reason: "approval" },
              ],
            },
          }
        : {}),
    });
    return from(events);
  }
}

describe("controller/core batch ownership", () => {
  it.each([
    ["resolve", "approval-first"],
    ["cancel", "approval-first"],
    ["resolve", "frontend-first"],
    ["cancel", "frontend-first"],
  ])("%s continues once with %s completion", async (action, order) => {
    const agent = new MixedInterruptAgent();
    const core = new CopilotKitCore({});
    let finish!: (value: string) => void;
    const answer = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const handler = vi.fn(() => answer);
    core.addTool({ name: "chart", description: "chart", handler });
    const controller = new InterruptController((targetAgent, options) =>
      core.runAgent({ agent: targetAgent, ...options }),
    );
    controller.connect(agent);
    const running = core.runAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    if (order === "frontend-first") {
      finish("");
      await running;
    }
    if (action === "resolve") await controller.resolve("allow", "approval");
    else await controller.cancel("approval");
    if (order === "approval-first") {
      expect(agent.inputs).toHaveLength(1);
      finish("");
      await running;
    }
    expect(agent.inputs).toHaveLength(2);
    expect(agent.inputs[1]!.resume).toEqual([
      { interruptId: "chart-i", status: "resolved", payload: "" },
      action === "resolve"
        ? { interruptId: "approval", status: "resolved", payload: "allow" }
        : { interruptId: "approval", status: "cancelled" },
    ]);
    expect(
      agent.inputs[1]!.messages.filter((m) => m.role === "tool"),
    ).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
    controller.destroy();
  });
});

it("retains an early approval when its controller is destroyed before tool completion", async () => {
  const agent = new MixedInterruptAgent();
  const core = new CopilotKitCore({});
  let finish!: (value: string) => void;
  const answer = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const handler = vi.fn(() => answer);
  core.addTool({ name: "chart", handler });
  const controller = new InterruptController((targetAgent, options) =>
    core.runAgent({ agent: targetAgent, ...options }),
  );
  controller.connect(agent);
  const running = core.runAgent({ agent });
  await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  await controller.resolve("allow", "approval");
  controller.destroy();
  finish("");
  await running;
  expect(agent.inputs).toHaveLength(2);
  expect(agent.inputs[1]!.resume).toContainEqual({
    interruptId: "approval",
    status: "resolved",
    payload: "allow",
  });
});

it.each(["resolve", "cancel"])(
  "%s ignores an explicitly targeted completed call and leaves the approval available",
  async (action) => {
    const { agent, controller, run, startResume } = setup();
    agent.messages.push({
      id: "saved",
      role: "tool",
      toolCallId: "chart",
      content: "",
    });
    finalizeStandard(agent, [
      makeInterrupt("chart-i", { reason: "tool_call", toolCallId: "chart" }),
      makeInterrupt("approval"),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    if (action === "resolve") await controller.resolve("approve", "chart-i");
    else await controller.cancel("chart-i");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("already completed"),
    );
    expect(run).not.toHaveBeenCalled();
    expect(agent.addMessage).not.toHaveBeenCalled();
    const resumed = controller.resolve("allow", "approval");
    expect(run).toHaveBeenCalledTimes(1);
    startResume();
    await resumed;
    warn.mockRestore();
  },
);

it("resets shared decisions for direct SDK resumes reusing interrupt IDs", async () => {
  class RepeatingAgent extends AbstractAgent {
    inputs: RunAgentInput[] = [];
    /** Create an isolated wire agent with a stable thread identity. */
    constructor() {
      super({ agentId: "repeat", threadId: "thread" });
    }
    /** Record resume input and emit the next scripted run. */
    run(input: RunAgentInput) {
      this.inputs.push(input);
      return from<BaseEvent[]>([
        {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
          outcome: {
            type: "interrupt",
            interrupts: [makeInterrupt("approval")],
          },
        },
      ]);
    }
  }
  const agent = new RepeatingAgent();
  const controller = new InterruptController((target, options) =>
    target.runAgent(options),
  );
  controller.connect(agent);
  await agent.runAgent();
  await controller.resolve("first", "approval");
  await controller.resolve("second", "approval");
  expect(agent.inputs).toHaveLength(3);
  expect(agent.inputs[2]!.resume).toEqual([
    { interruptId: "approval", status: "resolved", payload: "second" },
  ]);
  controller.destroy();
});

it("preserves an early approval and the handler owner across same-thread replay", async () => {
  const agent = new MixedInterruptAgent();
  const core = new CopilotKitCore({});
  let finish!: (value: string) => void;
  const answer = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const handler = vi.fn(() => answer);
  core.addTool({ name: "chart", type: "human-in-the-loop", handler });
  const controller = new InterruptController((target, options) =>
    core.runAgent({ agent: target, ...options }),
  );
  controller.connect(agent);
  await core.connectAgent({ agent });
  await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  await controller.resolve("allow", "approval");
  await core.connectAgent({ agent });
  finish("");
  await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
  expect(agent.inputs[0]!.resume).toEqual([
    { interruptId: "chart-i", status: "resolved", payload: "" },
    { interruptId: "approval", status: "resolved", payload: "allow" },
  ]);
  expect(handler).toHaveBeenCalledTimes(1);
  controller.destroy();
});

it.each(["resolve", "cancel"])(
  "implicit %s advances the view through unanswered entries across replay",
  async (action) => {
    const { agent, controller, run, startResume } = setup();
    const interrupts = [
      makeInterrupt("chart-i", { reason: "tool_call", toolCallId: "chart" }),
      makeInterrupt("a"),
      makeInterrupt("b"),
    ];
    agent.messages.push({
      id: "saved",
      role: "tool",
      toolCallId: "chart",
      content: "raw",
    });
    agent.pendingInterrupts = interrupts;
    finalizeStandard(agent, interrupts);
    expect(controller.interrupt()?.id).toBe("a");
    expect(controller.event()?.value).toEqual(interrupts[1]);
    expect(controller.view()?.interrupts).toEqual(interrupts);
    if (action === "resolve") await controller.resolve("yes");
    else await controller.cancel();
    expect(controller.view()?.interrupt?.id).toBe("b");
    agent.subscriber?.onRunStartedEvent?.({} as never);
    agent.messages.length = 0;
    finalizeStandard(agent, interrupts);
    expect(controller.event()?.value).toEqual(interrupts[2]);
    const resumed = controller.resolve("last");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1].resume).toEqual([
      { interruptId: "chart-i", status: "resolved", payload: "raw" },
      action === "resolve"
        ? { interruptId: "a", status: "resolved", payload: "yes" }
        : { interruptId: "a", status: "cancelled" },
      { interruptId: "b", status: "resolved", payload: "last" },
    ]);
    expect(controller.view()).toBeNull();
    startResume();
    await resumed;
    await controller.cancel();
    expect(run).toHaveBeenCalledTimes(1);
  },
);

it("hides an all-answered batch without claiming its continuation", async () => {
  const { agent, controller, run } = setup();
  agent.messages.push({
    id: "saved",
    role: "tool",
    toolCallId: "chart",
    content: "",
  });
  finalizeStandard(agent, [
    makeInterrupt("chart-i", { reason: "tool_call", toolCallId: "chart" }),
  ]);
  expect(controller.view()).toBeNull();
  expect(controller.hasInterrupt()).toBe(false);
  await controller.resolve();
  await controller.cancel();
  expect(run).not.toHaveBeenCalled();
});

it("updates another controller when shared decisions advance the prompt", async () => {
  const { agent, controller, run, startResume } = setup();
  const interrupts = [makeInterrupt("a"), makeInterrupt("b")];
  agent.pendingInterrupts = interrupts;
  finalizeStandard(agent, interrupts);
  const other = new InterruptController(run);
  other.connect(agent as unknown as AbstractAgent);
  await controller.resolve("yes");
  expect(other.interrupt()?.id).toBe("b");
  expect(other.event()?.value).toEqual(interrupts[1]);
  const resumed = other.cancel();
  expect(controller.view()).toBeNull();
  expect(run).toHaveBeenCalledTimes(1);
  startResume();
  await resumed;
  controller.destroy();
  other.destroy();
});

it("updates filtering, preparation, and view when a frontend result arrives", () => {
  const agent = new FakeAgent();
  const enabled = vi.fn(() => true);
  const handler = vi.fn(({ interrupt }) => interrupt?.id);
  const controller = new InterruptController(vi.fn(), { enabled, handler });
  controller.connect(agent as unknown as AbstractAgent);
  const interrupts = [
    makeInterrupt("chart-i", { reason: "tool_call", toolCallId: "chart" }),
    makeInterrupt("approval"),
  ];
  finalizeStandard(agent, interrupts);
  expect(controller.interrupt()).toEqual(interrupts[0]);
  agent.messages.push({
    id: "saved",
    role: "tool",
    toolCallId: "chart",
    content: "done",
  });
  agent.subscriber?.onMessagesChanged?.({} as never);
  expect(controller.interrupt()).toEqual(interrupts[1]);
  expect(controller.event()?.value).toEqual(interrupts[1]);
  expect(controller.result()).toBe("approval");
  expect(enabled.mock.calls.at(-1)?.[0].value).toEqual(interrupts[1]);
  expect(handler.mock.calls.at(-1)?.[0].event.value).toEqual(interrupts[1]);
  controller.destroy();
});

it("keeps the next prompt's preparation when a synchronous handler answers the previous prompt", () => {
  const agent = new FakeAgent();
  const run = vi.fn();
  const controller = new InterruptController(run, {
    handler: ({ interrupt, resolve }) => {
      if (interrupt?.id === "a") void resolve("yes");
      return `prepared ${interrupt?.id}`;
    },
  });
  controller.connect(agent as unknown as AbstractAgent);
  finalizeStandard(agent, [makeInterrupt("a"), makeInterrupt("b")]);
  expect(controller.interrupt()?.id).toBe("b");
  expect(controller.result()).toBe("prepared b");
  expect(run).not.toHaveBeenCalled();
  controller.destroy();
});
