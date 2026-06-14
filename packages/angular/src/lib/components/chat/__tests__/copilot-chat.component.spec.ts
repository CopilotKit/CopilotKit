/**
 * CopilotChat component tests — run-control parity with React v2.
 *
 * These tests exercise the PRODUCTION code paths in `CopilotChat` directly,
 * rather than duplicating its internal logic in test fixtures.  They mirror
 * the React v2 test coverage for:
 *
 *  - submitInput() serialisation: waits for `activeRunCompletionPromise`
 *    before calling `core.runAgent()`.
 *  - stopCurrentRun(): calls `core.stopAgent()` first.
 *  - stopCurrentRun() fallback: calls `agent.abortRun()` when `stopAgent`
 *    throws.
 *  - canStopRun guard: stop is only active when running AND messages exist.
 *  - stopCurrentRun early-exit: no-ops when `canStopRun` is false.
 */
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  computed,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChat } from "../copilot-chat";
import type { Message } from "@ag-ui/client";

// ---------------------------------------------------------------------------
// Helpers / Stubs
// ---------------------------------------------------------------------------

/** Minimal stub for an agent that is RunCompletionAware. */
function makeRunAwareAgent(options?: {
  isRunning?: boolean;
  activeRunCompletionPromise?: Promise<void>;
  messages?: Message[];
}) {
  return {
    isRunning: options?.isRunning ?? false,
    activeRunCompletionPromise: options?.activeRunCompletionPromise,
    messages: options?.messages ?? [],
    threadId: "thread-test",
    addMessage: vi.fn(),
    abortRun: vi.fn(),
    run: vi.fn(),
    connect: vi.fn(),
    detachActiveRun: vi.fn().mockResolvedValue(undefined),
    subscribers: [],
    isCopilotKitAgent: true,
  } as any;
}

/**
 * Builds a minimal CopilotKit core stub whose `runAgent` and `stopAgent`
 * methods are mockable spy functions.
 */
function makeCoreMock() {
  return {
    runAgent: vi.fn().mockResolvedValue(undefined),
    stopAgent: vi.fn(),
    connectAgent: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  };
}

/** Builds a minimal agentStore signal stub. */
function makeAgentStoreSignal(agent: ReturnType<typeof makeRunAwareAgent>) {
  const _isRunning = signal(agent.isRunning as boolean);
  const _messages = signal<Message[]>(agent.messages);

  const store = {
    agent,
    isRunning: () => _isRunning(),
    messages: () => _messages(),
    _isRunning,
    _messages,
  };

  return signal(store);
}

/**
 * Creates a CopilotChat instance with all heavy Angular dependencies stubbed
 * so tests can call its methods directly without a live DOM.
 */
function makeCopilotChat(
  agent: ReturnType<typeof makeRunAwareAgent>,
  coreMock: ReturnType<typeof makeCoreMock>,
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const injector = TestBed.inject(EnvironmentInjector);
  const agentStoreSignal = makeAgentStoreSignal(agent);

  const chat = runInInjectionContext(injector, () => {
    const instance = new (CopilotChat as any)();
    return instance;
  }) as CopilotChat;

  // Inject the stub agentStore and core
  (chat as any).agentStore = agentStoreSignal;
  (chat as any).copilotKit = { core: coreMock };
  // Provide no-op cdr
  (chat as any).cdr = { markForCheck: vi.fn() };

  return { chat, agentStoreSignal, coreMock };
}

// ---------------------------------------------------------------------------
// submitInput() serialisation — mirrors React v2 waitForActiveRunToSettle
// ---------------------------------------------------------------------------
describe("CopilotChat.submitInput — serialisation (production code)", () => {
  it("calls runAgent ONLY AFTER activeRunCompletionPromise resolves when a run is in flight", async () => {
    let resolveRun!: () => void;
    const runCompletion = new Promise<void>((r) => {
      resolveRun = r;
    });

    const agent = makeRunAwareAgent({
      isRunning: true,
      activeRunCompletionPromise: runCompletion,
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });

    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);

    // Sync agent.isRunning with the agentStore signal
    agentStoreSignal().agent.isRunning = true;

    const callOrder: string[] = [];
    const originalRunAgent = coreMock.runAgent;
    coreMock.runAgent = vi.fn(async () => {
      callOrder.push("runAgent-called");
      return originalRunAgent();
    });

    // Kick off submitInput — it should pause at waitForActiveRunToSettle
    const submitPromise = chat.submitInput("hello world");

    // Give microtasks a chance to flush without resolving the run
    await Promise.resolve();
    await Promise.resolve();

    expect(
      coreMock.runAgent,
      "runAgent must not be called before the active run resolves",
    ).not.toHaveBeenCalled();

    // Resolve the in-flight run
    resolveRun();
    await submitPromise;

    expect(
      coreMock.runAgent,
      "runAgent must be called after activeRunCompletionPromise resolves",
    ).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["runAgent-called"]);
  });

  it("calls runAgent immediately when no run is in flight (no activeRunCompletionPromise)", async () => {
    const agent = makeRunAwareAgent({
      isRunning: false,
      activeRunCompletionPromise: undefined,
      messages: [],
    });

    const coreMock = makeCoreMock();
    const { chat } = makeCopilotChat(agent, coreMock);

    await chat.submitInput("immediate send");

    expect(coreMock.runAgent).toHaveBeenCalledTimes(1);
  });

  it("calls runAgent immediately when agent is not RunCompletionAware (no property)", async () => {
    // Agent without activeRunCompletionPromise property at all
    const agent = makeRunAwareAgent({ isRunning: true });
    delete (agent as any).activeRunCompletionPromise;

    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);
    agentStoreSignal().agent.isRunning = true;

    await chat.submitInput("send without aware");

    expect(coreMock.runAgent).toHaveBeenCalledTimes(1);
  });

  it("proceeds with runAgent even when the in-flight run rejects", async () => {
    let rejectRun!: (err: Error) => void;
    const runCompletion = new Promise<void>((_, r) => {
      rejectRun = r;
    });

    const agent = makeRunAwareAgent({
      isRunning: true,
      activeRunCompletionPromise: runCompletion,
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });

    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);
    agentStoreSignal().agent.isRunning = true;

    const submitPromise = chat.submitInput("follow-up");
    await Promise.resolve();

    expect(coreMock.runAgent).not.toHaveBeenCalled();

    // Reject the in-flight run — submitInput should still proceed
    rejectRun(new Error("run failed"));
    await submitPromise;

    expect(
      coreMock.runAgent,
      "runAgent must still be called after a rejected in-flight run",
    ).toHaveBeenCalledTimes(1);
  });

  it("addMessage is called with the trimmed user text before runAgent", async () => {
    const agent = makeRunAwareAgent({ isRunning: false, messages: [] });
    const coreMock = makeCoreMock();
    const { chat } = makeCopilotChat(agent, coreMock);

    const callOrder: string[] = [];
    agent.addMessage = vi.fn(() => {
      callOrder.push("addMessage");
    });
    coreMock.runAgent = vi.fn(async () => {
      callOrder.push("runAgent");
    });

    await chat.submitInput("  trimmed  ");

    expect(callOrder).toEqual(["addMessage", "runAgent"]);
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "  trimmed  " }),
    );
  });

  it("does nothing when the value is empty or whitespace only", async () => {
    const agent = makeRunAwareAgent({ isRunning: false, messages: [] });
    const coreMock = makeCoreMock();
    const { chat } = makeCopilotChat(agent, coreMock);

    await chat.submitInput("   ");

    expect(agent.addMessage).not.toHaveBeenCalled();
    expect(coreMock.runAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// stopCurrentRun() — mirrors React v2 stopCurrentRun
// ---------------------------------------------------------------------------
describe("CopilotChat.stopCurrentRun", () => {
  it("calls core.stopAgent with the current agent", () => {
    const agent = makeRunAwareAgent({
      isRunning: true,
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);

    // Ensure canStopRun would be true
    agentStoreSignal()._isRunning.set(true);
    agentStoreSignal()._messages.set([{ id: "m1", role: "user", content: "hi" }]);

    chat.stopCurrentRun();

    expect(coreMock.stopAgent).toHaveBeenCalledTimes(1);
    expect(coreMock.stopAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent }),
    );
  });

  it("falls back to agent.abortRun() when core.stopAgent throws", () => {
    const agent = makeRunAwareAgent({
      isRunning: true,
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const coreMock = makeCoreMock();
    coreMock.stopAgent = vi.fn(() => {
      throw new Error("stopAgent not supported");
    });

    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);
    agentStoreSignal()._isRunning.set(true);
    agentStoreSignal()._messages.set([{ id: "m1", role: "user", content: "hi" }]);

    // Should not throw — fallback to abortRun
    expect(() => chat.stopCurrentRun()).not.toThrow();

    expect(agent.abortRun).toHaveBeenCalledTimes(1);
  });

  it("does not throw when both stopAgent and abortRun throw", () => {
    const agent = makeRunAwareAgent({
      isRunning: true,
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    agent.abortRun = vi.fn(() => {
      throw new Error("abortRun also failed");
    });

    const coreMock = makeCoreMock();
    coreMock.stopAgent = vi.fn(() => {
      throw new Error("stopAgent failed");
    });

    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);
    agentStoreSignal()._isRunning.set(true);
    agentStoreSignal()._messages.set([{ id: "m1", role: "user", content: "hi" }]);

    expect(() => chat.stopCurrentRun()).not.toThrow();
  });

  it("does nothing when no agent is present", () => {
    const agent = makeRunAwareAgent({
      isRunning: true,
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);
    agentStoreSignal()._isRunning.set(true);
    agentStoreSignal()._messages.set([{ id: "m1", role: "user", content: "hi" }]);

    // Remove agent from store
    (agentStoreSignal() as any).agent = null;

    expect(() => chat.stopCurrentRun()).not.toThrow();
    expect(coreMock.stopAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// canStopRun guard — mirrors React v2 shouldAllowStop = isRunning && hasMessages
// ---------------------------------------------------------------------------
describe("CopilotChat.canStopRun (shouldAllowStop parity)", () => {
  it("is false when not running (even with messages)", () => {
    const agent = makeRunAwareAgent({ isRunning: false, messages: [] });
    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);

    agentStoreSignal()._isRunning.set(false);
    agentStoreSignal()._messages.set([{ id: "m1", role: "user", content: "hi" }]);

    expect((chat as any).canStopRun()).toBe(false);
  });

  it("is false when running but no messages yet (welcome screen guard)", () => {
    const agent = makeRunAwareAgent({ isRunning: true, messages: [] });
    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);

    agentStoreSignal()._isRunning.set(true);
    agentStoreSignal()._messages.set([]); // no messages yet

    expect((chat as any).canStopRun()).toBe(false);
  });

  it("is true when running AND messages exist", () => {
    const agent = makeRunAwareAgent({
      isRunning: true,
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);

    agentStoreSignal()._isRunning.set(true);
    agentStoreSignal()._messages.set([{ id: "m1", role: "user", content: "hi" }]);

    expect((chat as any).canStopRun()).toBe(true);
  });

  it("stopCurrentRun no-ops when canStopRun is false (not running + no messages)", () => {
    const agent = makeRunAwareAgent({ isRunning: false, messages: [] });
    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);

    agentStoreSignal()._isRunning.set(false);
    agentStoreSignal()._messages.set([]);

    chat.stopCurrentRun();

    expect(coreMock.stopAgent).not.toHaveBeenCalled();
    expect(agent.abortRun).not.toHaveBeenCalled();
  });

  it("stopCurrentRun no-ops when running but thread has no messages yet", () => {
    const agent = makeRunAwareAgent({ isRunning: true, messages: [] });
    const coreMock = makeCoreMock();
    const { chat, agentStoreSignal } = makeCopilotChat(agent, coreMock);

    agentStoreSignal()._isRunning.set(true);
    agentStoreSignal()._messages.set([]); // no messages

    chat.stopCurrentRun();

    expect(coreMock.stopAgent).not.toHaveBeenCalled();
    expect(agent.abortRun).not.toHaveBeenCalled();
  });
});
