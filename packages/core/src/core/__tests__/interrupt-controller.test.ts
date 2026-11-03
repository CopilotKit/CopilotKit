import type {
  AbstractAgent,
  AgentSubscriber,
  Interrupt,
  Message,
  RunAgentResult,
} from "@ag-ui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopilotKitCore } from "../core";
import {
  ɵInterruptController,
  ɵInterruptExpiredError,
} from "../interrupt-controller";
import type { ɵInterruptControllerOptions } from "../interrupt-controller";
import type { CopilotKitCoreRunAgentParams } from "../run-handler";
import { ɵgetAgentInterruptState } from "../../interrupt-state";

class FakeAgent {
  readonly messages: Message[] = [];
  pendingInterrupts: Interrupt[] = [];
  threadId = "thread-a";
  subscriber?: AgentSubscriber;
  readonly unsubscribe = vi.fn();
  readonly addMessage = vi.fn((message: Message) => {
    this.messages.push(message);
  });

  subscribe(subscriber: AgentSubscriber): { unsubscribe: () => void } {
    this.subscriber = subscriber;
    return { unsubscribe: this.unsubscribe };
  }

  get asAgent(): AbstractAgent {
    return this as unknown as AbstractAgent;
  }
}

const makeInterrupt = (
  id: string,
  overrides: Partial<Interrupt> = {},
): Interrupt => ({ id, reason: "approval", ...overrides });

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

/** Flush the microtasks that settle async predicates and handlers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

function setup(options: ɵInterruptControllerOptions = {}) {
  const agent = new FakeAgent();
  let finishResume: (() => void) | undefined;
  const runAgent = vi.fn(
    (_params: CopilotKitCoreRunAgentParams) =>
      new Promise<RunAgentResult>((resolve) => {
        finishResume = () => {
          agent.subscriber?.onRunStartedEvent?.({} as never);
          resolve({ result: null, newMessages: [] });
        };
      }),
  );
  const controller = new ɵInterruptController({ runAgent }, options);
  controller.connect(agent.asAgent);
  return { agent, controller, runAgent, finishResume: () => finishResume?.() };
}

describe("ɵInterruptController", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes render props for the primary and complete standard set", () => {
    const { agent, controller } = setup();
    finalizeStandard(agent, [makeInterrupt("one"), makeInterrupt("two")]);

    const props = controller.getSnapshot().renderProps;
    expect(props?.event).toEqual({
      name: "on_interrupt",
      value: expect.objectContaining({ id: "one" }),
    });
    expect(props?.interrupt?.id).toBe("one");
    expect(props?.interrupts.map(({ id }) => id)).toEqual(["one", "two"]);
    expect(props?.resolve).toBe(controller.resolve);
  });

  it("prefers standard interrupts when one run carries both kinds", () => {
    const { agent, controller } = setup();
    agent.subscriber?.onCustomEvent?.({
      event: { name: "on_interrupt", value: "legacy" },
    } as never);
    finalizeStandard(agent, [makeInterrupt("std")]);
    expect(controller.getSnapshot().pending?.kind).toBe("standard");
  });

  it("keeps snapshot identity until something changes and notifies subscribers", () => {
    const { agent, controller } = setup();
    const listener = vi.fn();
    controller.subscribe(listener);
    const empty = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(empty);

    finalizeStandard(agent, [makeInterrupt("one")]);
    const pending = controller.getSnapshot();
    expect(pending).not.toBe(empty);
    expect(controller.getSnapshot()).toBe(pending);
    expect(listener).toHaveBeenCalled();
  });

  it("picks up the agent's pending interrupts when it connects", () => {
    const agent = new FakeAgent();
    agent.pendingInterrupts = [makeInterrupt("restored")];
    const controller = new ɵInterruptController({ runAgent: vi.fn() });
    controller.connect(agent.asAgent);
    expect(controller.getSnapshot().renderProps?.interrupt?.id).toBe(
      "restored",
    );
  });

  it("accumulates answers, appends tool results and resumes once", async () => {
    const { agent, controller, runAgent, finishResume } = setup();
    finalizeStandard(agent, [
      makeInterrupt("one", { reason: "tool_call", toolCallId: "tool-one" }),
      makeInterrupt("two", { reason: "tool_call", toolCallId: "tool-two" }),
    ]);

    await controller.cancel("two");
    expect(runAgent).not.toHaveBeenCalled();

    const first = controller.resolve({ approved: true }, "one");
    const duplicate = controller.resolve({ approved: false }, "one");
    expect(runAgent).toHaveBeenCalledTimes(1);
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
    expect(runAgent).toHaveBeenCalledWith({
      agent,
      resume: [
        { interruptId: "one", status: "resolved", payload: { approved: true } },
        { interruptId: "two", status: "cancelled" },
      ],
    });

    finishResume();
    await Promise.all([first, duplicate]);
    expect(controller.getSnapshot().renderProps).toBeNull();
  });

  it("adopts a frontend tool result already in the history", async () => {
    const { agent, controller, runAgent, finishResume } = setup();
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
    const resumed = controller.resolve("allow", "approval");
    expect(agent.addMessage).not.toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalledWith({
      agent,
      resume: [
        { interruptId: "chart-i", status: "resolved", payload: "" },
        { interruptId: "approval", status: "resolved", payload: "allow" },
      ],
    });
    finishResume();
    await resumed;
  });

  it("ignores an answer for an already completed frontend tool call", async () => {
    const { agent, controller, runAgent } = setup();
    agent.messages.push({
      id: "saved",
      role: "tool",
      toolCallId: "chart",
      content: "done",
    });
    finalizeStandard(agent, [
      makeInterrupt("chart-i", { reason: "tool_call", toolCallId: "chart" }),
      makeInterrupt("approval"),
    ]);
    await controller.resolve("again", "chart-i");
    expect(runAgent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("already completed frontend tool call"),
    );
  });

  it("warns when an answer omits the id while several interrupts are open", async () => {
    const { agent, controller } = setup();
    finalizeStandard(agent, [makeInterrupt("one"), makeInterrupt("two")]);
    await controller.resolve("yes");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "called without an interruptId while 2 interrupts are open",
      ),
    );
  });

  it("ignores an unknown interrupt id", async () => {
    const { agent, controller, runAgent } = setup();
    finalizeStandard(agent, [makeInterrupt("one")]);
    await controller.resolve("yes", "missing");
    expect(runAgent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown interrupt id missing"),
    );
  });

  it("resumes a legacy interrupt with forwardedProps.command", async () => {
    const { agent, controller, runAgent, finishResume } = setup();
    finalizeLegacy(agent, { proposal: "ship" });
    const resumed = controller.resolve({ approved: true });
    expect(runAgent).toHaveBeenCalledWith({
      agent,
      forwardedProps: {
        command: {
          resume: { approved: true },
          interruptEvent: { proposal: "ship" },
        },
      },
    });
    finishResume();
    await resumed;
    expect(controller.getSnapshot().pending).toBeNull();
  });

  it("dismisses a legacy interrupt on cancel without a run", async () => {
    const { agent, controller, runAgent } = setup();
    finalizeLegacy(agent, "value");
    await controller.cancel();
    expect(runAgent).not.toHaveBeenCalled();
    expect(controller.getSnapshot().pending).toBeNull();
  });

  it("does not resume an expired interrupt and stores the expiry error", async () => {
    const { agent, controller, runAgent } = setup();
    finalizeStandard(agent, [
      makeInterrupt("old", { expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    await controller.resolve("yes");
    expect(runAgent).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toBeInstanceOf(
      ɵInterruptExpiredError,
    );
    expect(controller.getSnapshot().pending).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("interrupt old expired at"),
    );
  });

  it("resumes when only a cancelled interrupt has expired", async () => {
    const { agent, controller, runAgent, finishResume } = setup();
    finalizeStandard(agent, [
      makeInterrupt("old", { expiresAt: "2000-01-01T00:00:00.000Z" }),
      makeInterrupt("live"),
    ]);
    await controller.cancel("old");
    const resumed = controller.resolve("yes", "live");
    expect(runAgent).toHaveBeenCalledWith({
      agent,
      resume: [
        { interruptId: "old", status: "cancelled" },
        { interruptId: "live", status: "resolved", payload: "yes" },
      ],
    });
    finishResume();
    await resumed;
  });

  it("clears state and rethrows when the resume run fails, without retrying", async () => {
    const agent = new FakeAgent();
    const failure = new Error("resume failed");
    const runAgent = vi.fn().mockRejectedValue(failure);
    const controller = new ɵInterruptController({ runAgent });
    controller.connect(agent.asAgent);
    finalizeStandard(agent, [makeInterrupt("one")]);

    await expect(controller.resolve("yes")).rejects.toBe(failure);
    expect(controller.getSnapshot()).toMatchObject({
      pending: null,
      error: failure,
    });
    await controller.resolve("again");
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("clears state when the runner throws synchronously", async () => {
    const agent = new FakeAgent();
    const failure = new Error("sync");
    const controller = new ɵInterruptController({
      runAgent: () => {
        throw failure;
      },
    });
    controller.connect(agent.asAgent);
    finalizeLegacy(agent, "value");
    await expect(controller.resolve("yes")).rejects.toBe(failure);
    expect(controller.getSnapshot().pending).toBeNull();
  });

  it("does not let an old resume failure clear a newer interrupt", async () => {
    const agentA = new FakeAgent();
    const agentB = new FakeAgent();
    let rejectResume: ((error: unknown) => void) | undefined;
    const controller = new ɵInterruptController({
      runAgent: () =>
        new Promise<RunAgentResult>((_resolve, reject) => {
          rejectResume = reject;
        }),
    });
    controller.connect(agentA.asAgent);
    finalizeStandard(agentA, [makeInterrupt("old")]);
    const resume = controller.resolve("yes");

    controller.connect(agentB.asAgent);
    finalizeStandard(agentB, [makeInterrupt("new")]);
    const failure = new Error("old");
    rejectResume?.(failure);

    await expect(resume).rejects.toBe(failure);
    expect(controller.getSnapshot().renderProps?.interrupt?.id).toBe("new");
    expect(controller.getSnapshot().error).toBeNull();
  });

  it("clears pending state on a run failure and on a RUN_ERROR event", () => {
    const { agent, controller } = setup();
    finalizeStandard(agent, [makeInterrupt("one")]);
    agent.subscriber?.onRunFailed?.({ error: new Error("failed") } as never);
    expect(controller.getSnapshot()).toMatchObject({
      pending: null,
      error: new Error("failed"),
    });

    finalizeStandard(agent, [makeInterrupt("two")]);
    agent.subscriber?.onRunErrorEvent?.({
      event: { message: "boom" },
    } as never);
    expect(controller.getSnapshot()).toMatchObject({
      pending: null,
      error: new Error("boom"),
    });
  });

  it("drops an interrupt when the agent's thread changed before the answer", async () => {
    const { agent, controller, runAgent } = setup();
    finalizeStandard(agent, [makeInterrupt("one")]);
    agent.threadId = "thread-b";
    await controller.resolve("yes");
    expect(runAgent).not.toHaveBeenCalled();
    expect(controller.getSnapshot().pending).toBeNull();
  });

  it("clears the interrupt when the host switches threads", () => {
    const { agent, controller } = setup();
    finalizeStandard(agent, [makeInterrupt("one")]);
    controller.setThreadId("thread-a");
    expect(controller.getSnapshot().pending).not.toBeNull();
    controller.setThreadId("thread-b");
    expect(controller.getSnapshot().pending).toBeNull();
  });

  it("keeps shared decisions when a reconnect replays RUN_STARTED", () => {
    const { agent, controller } = setup();
    const interrupts = [makeInterrupt("one"), makeInterrupt("two")];
    agent.pendingInterrupts = interrupts;
    finalizeStandard(agent, interrupts);
    void controller.resolve("early", "one");
    const shared = ɵgetAgentInterruptState(agent.asAgent, interrupts);

    agent.subscriber?.onRunStartedEvent?.({ input: {} } as never);
    expect(ɵgetAgentInterruptState(agent.asAgent, interrupts)).toBe(shared);

    agent.subscriber?.onRunStartedEvent?.({
      input: { resume: [] },
    } as never);
    expect(ɵgetAgentInterruptState(agent.asAgent, interrupts)).not.toBe(shared);
  });

  it("rejects an invalid batch instead of throwing into the agent", () => {
    const { agent, controller } = setup();
    expect(() =>
      finalizeStandard(agent, [makeInterrupt("dup"), makeInterrupt("dup")]),
    ).not.toThrow();
    expect(controller.getSnapshot().pending).toBeNull();
    expect(controller.getSnapshot().error).toBeInstanceOf(Error);
  });

  describe("enabled and handler", () => {
    it("hides and ignores an interrupt that `enabled` rejects", async () => {
      const { agent, controller, runAgent } = setup({ enabled: () => false });
      finalizeStandard(agent, [makeInterrupt("other")]);
      expect(controller.getSnapshot()).toMatchObject({
        accepted: false,
        renderProps: null,
      });
      await controller.resolve("yes");
      await controller.cancel();
      expect(runAgent).not.toHaveBeenCalled();
    });

    it("waits for an async `enabled`", async () => {
      const { agent, controller } = setup({
        enabled: async () => true,
      });
      finalizeLegacy(agent, "value");
      expect(controller.getSnapshot().renderProps).toBeNull();
      await flush();
      expect(controller.getSnapshot().renderProps?.event.value).toBe("value");
    });

    it.each([
      [
        "a sync throw",
        () => {
          throw new Error("predicate");
        },
      ],
      ["a rejection", async () => Promise.reject(new Error("predicate"))],
    ])("treats %s from `enabled` as disabled", async (_label, enabled) => {
      const { agent, controller } = setup({ enabled });
      finalizeLegacy(agent, "value");
      await flush();
      expect(controller.getSnapshot()).toMatchObject({
        accepted: false,
        renderProps: null,
        error: new Error("predicate"),
      });
    });

    it("passes the handler's sync and async value as `result`", async () => {
      const sync = setup({ handler: () => "ready" });
      finalizeLegacy(sync.agent, "value");
      expect(sync.controller.getSnapshot().renderProps?.result).toBe("ready");

      const handler = vi.fn(async () => "later");
      const async = setup({ handler });
      finalizeStandard(async.agent, [makeInterrupt("one")]);
      expect(async.controller.getSnapshot().renderProps?.result).toBeNull();
      await flush();
      expect(async.controller.getSnapshot().renderProps?.result).toBe("later");
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          interrupt: expect.objectContaining({ id: "one" }),
          resolve: async.controller.resolve,
          cancel: async.controller.cancel,
        }),
      );
    });

    it.each([
      [
        "a sync throw",
        () => {
          throw new Error("handler");
        },
      ],
      ["a rejection", async () => Promise.reject(new Error("handler"))],
    ])(
      "keeps the interrupt visible with a null result after %s",
      async (_label, handler) => {
        const { agent, controller } = setup({ handler });
        finalizeLegacy(agent, "value");
        await flush();
        expect(controller.getSnapshot()).toMatchObject({
          accepted: true,
          result: null,
          error: new Error("handler"),
        });
        expect(controller.getSnapshot().renderProps).not.toBeNull();
      },
    );

    it("drops a stale async handler result after a new run starts", async () => {
      let finish: ((value: string) => void) | undefined;
      const { agent, controller } = setup({
        handler: () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      });
      finalizeLegacy(agent, "first");
      agent.subscriber?.onRunStartedEvent?.({} as never);
      finish?.("stale");
      await flush();
      expect(controller.getSnapshot().result).toBeNull();
    });
  });

  it("stops following the agent on disconnect and can connect again", () => {
    const { agent, controller } = setup();
    finalizeStandard(agent, [makeInterrupt("one")]);
    controller.disconnect();
    expect(agent.unsubscribe).toHaveBeenCalled();
    expect(controller.getSnapshot().pending).toBeNull();

    controller.connect(agent.asAgent);
    finalizeStandard(agent, [makeInterrupt("two")]);
    expect(controller.getSnapshot().renderProps?.interrupt?.id).toBe("two");
  });

  it("stops notifying after dispose", () => {
    const { agent, controller } = setup();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.dispose();
    listener.mockClear();
    controller.connect(agent.asAgent);
    finalizeStandard(agent, [makeInterrupt("one")]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("CopilotKitCore interrupt payload slot", () => {
  it("stores the payload and notifies listeners only on change", () => {
    const core = new CopilotKitCore({});
    const listener = vi.fn();
    const unsubscribe = core.ɵsubscribeToInterruptPayload(listener);
    const payload = { kind: "element" };

    core.ɵsetInterruptPayload(payload);
    core.ɵsetInterruptPayload(payload);
    expect(core.ɵinterruptPayload).toBe(payload);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    core.ɵsetInterruptPayload(null);
    expect(core.ɵinterruptPayload).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    core.dispose();
  });
});
