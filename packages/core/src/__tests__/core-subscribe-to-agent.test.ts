import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AbstractAgent,
  EventType,
  type AgentSubscriberParams,
  type RunAgentInput,
  type RunErrorEvent,
  type BaseEvent,
} from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import {
  CopilotKitCore,
  CopilotKitCoreErrorCode,
  type SubscribeToAgentSubscriber,
} from "../core";

// ---------------------------------------------------------------------------
// Minimal mock agent that extends AbstractAgent for subscribe() support
// ---------------------------------------------------------------------------

class TestAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_INPUT: RunAgentInput = {
  threadId: "t-1",
  runId: "r-1",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {},
};

function notifyMessagesChanged(agent: TestAgent) {
  agent.subscribers.forEach((s) =>
    s.onMessagesChanged?.({
      messages: agent.messages,
      state: agent.state,
      agent,
    }),
  );
}

function notifyStateChanged(agent: TestAgent) {
  agent.subscribers.forEach((s) =>
    s.onStateChanged?.({
      state: agent.state,
      messages: agent.messages,
      agent,
    }),
  );
}

function notifyLifecycle(
  agent: TestAgent,
  event:
    | "onRunInitialized"
    | "onRunFinalized"
    | "onRunFailed"
    | "onRunErrorEvent",
) {
  const base: AgentSubscriberParams = {
    messages: agent.messages,
    state: agent.state,
    agent,
    input: RUN_INPUT,
  };
  if (event === "onRunFailed") {
    const params = { ...base, error: new Error("run failed") };
    agent.subscribers.forEach((s) => s.onRunFailed?.(params));
  } else if (event === "onRunErrorEvent") {
    const errorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: "backend error",
    };
    agent.subscribers.forEach((s) =>
      s.onRunErrorEvent?.({ ...base, event: errorEvent }),
    );
  } else {
    agent.subscribers.forEach((s) => s[event]?.(base));
  }
}

function userMsg(id: string, content: string) {
  return { id, role: "user" as const, content };
}

/** Silence console.error and return the spy for assertions. Caller must restore. */
function silenceConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CopilotKitCore.subscribeToAgentWithOptions", () => {
  let core: CopilotKitCore;
  let agent: TestAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    core = new CopilotKitCore({});
    agent = new TestAgent({});
    agent.agentId = "test-agent";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Unthrottled passthrough
  // -------------------------------------------------------------------------

  it("without throttle, passes subscriber through directly", () => {
    const onMessages = vi.fn();
    const onState = vi.fn();

    core.subscribeToAgentWithOptions(agent, {
      onMessagesChanged: onMessages,
      onStateChanged: onState,
    });

    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    agent.state = { x: 1 };
    notifyStateChanged(agent);
    expect(onState).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Leading edge
  // -------------------------------------------------------------------------

  it("with throttle, first notification fires immediately (leading edge)", () => {
    const onMessages = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 100 },
    );

    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    expect(onMessages).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Trailing edge
  // -------------------------------------------------------------------------

  it("with throttle, second notification is deferred to trailing edge", () => {
    const onMessages = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 100 },
    );

    // Leading edge
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Within window — deferred
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Trailing edge fires
    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(2);
    // Should receive the latest params
    expect(onMessages.mock.calls[1][0].messages).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Trailing-edge re-arm
  // -------------------------------------------------------------------------

  it("trailing edge re-arms the throttle window when new events arrive during flush", () => {
    const onMessages = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 100 },
    );

    // Leading edge
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Deferred
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // Trailing edge fires at t=100
    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(2);

    // Notification during re-armed window should be deferred, not leading
    agent.messages = [userMsg("1", "a"), userMsg("2", "b"), userMsg("3", "c")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(2); // Still deferred

    // Fires at t=200
    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(3);
    expect(onMessages.mock.calls[2][0].messages).toHaveLength(3);

    // Window closes when no further events arrive
    vi.advanceTimersByTime(100);

    // New leading edge after window closed
    agent.messages = [userMsg("4", "d")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(4); // Fires immediately
  });

  // -------------------------------------------------------------------------
  // Burst coalescing
  // -------------------------------------------------------------------------

  it("coalesces rapid bursts into leading + trailing", () => {
    const onMessages = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 100 },
    );

    // Leading
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    // 5 rapid updates within window
    for (let i = 2; i <= 6; i++) {
      agent.messages = [...agent.messages, userMsg(String(i), `m${i}`)];
      notifyMessagesChanged(agent);
    }

    expect(onMessages).toHaveBeenCalledTimes(1); // Only leading

    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(2); // + trailing
    expect(onMessages.mock.calls[1][0].messages).toHaveLength(6);
  });

  // -------------------------------------------------------------------------
  // Shared window: messages then state
  // -------------------------------------------------------------------------

  it("onStateChanged shares throttle window with onMessagesChanged", () => {
    const onMessages = vi.fn();
    const onState = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages, onStateChanged: onState },
      { throttleMs: 100 },
    );

    // Leading edge — messages
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Within window — state is deferred
    agent.state = { count: 42 };
    notifyStateChanged(agent);
    expect(onState).toHaveBeenCalledTimes(0);

    // Trailing edge fires state
    vi.advanceTimersByTime(100);
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState.mock.calls[0][0].state).toEqual({ count: 42 });
  });

  // -------------------------------------------------------------------------
  // Shared window: state then messages (bidirectional)
  // -------------------------------------------------------------------------

  it("onMessagesChanged deferred when onStateChanged starts the window", () => {
    const onMessages = vi.fn();
    const onState = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages, onStateChanged: onState },
      { throttleMs: 100 },
    );

    // Leading edge — state
    agent.state = { count: 1 };
    notifyStateChanged(agent);
    expect(onState).toHaveBeenCalledTimes(1);

    // Within window — messages deferred
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(0);

    // Trailing edge
    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Both pending on trailing edge
  // -------------------------------------------------------------------------

  it("flushes both messages and state when both are pending at trailing edge", () => {
    const onMessages = vi.fn();
    const onState = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages, onStateChanged: onState },
      { throttleMs: 100 },
    );

    // Leading edge — messages fires
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Both pending within window
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);
    agent.state = { x: 1 };
    notifyStateChanged(agent);

    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledTimes(0);

    // Trailing edge flushes both
    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Run lifecycle events always fire immediately
  // -------------------------------------------------------------------------

  it.each([
    "onRunInitialized",
    "onRunFinalized",
    "onRunFailed",
    "onRunErrorEvent",
  ] as const)("%s fires immediately during throttle window", (event) => {
    const onMessages = vi.fn();
    const callback = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages, [event]: callback },
      { throttleMs: 100 },
    );

    // Start throttle window
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    // Run lifecycle — should fire immediately (not throttled)
    notifyLifecycle(agent, event);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Only subscribed callbacks are wrapped
  // -------------------------------------------------------------------------

  it("with only onStateChanged subscribed, first fires on leading edge", () => {
    const onState = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onStateChanged: onState },
      { throttleMs: 100 },
    );

    agent.state = { v: 1 };
    notifyStateChanged(agent);
    expect(onState).toHaveBeenCalledTimes(1);

    // Second within window — deferred
    agent.state = { v: 2 };
    notifyStateChanged(agent);
    expect(onState).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(onState).toHaveBeenCalledTimes(2);
    expect(onState.mock.calls[1][0].state).toEqual({ v: 2 });
  });

  // -------------------------------------------------------------------------
  // Unsubscribe clears pending timer
  // -------------------------------------------------------------------------

  it("unsubscribe clears pending trailing timer", () => {
    const onMessages = vi.fn();

    const sub = core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 100 },
    );

    // Leading edge
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Pending update
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // Unsubscribe before trailing fires
    sub.unsubscribe();

    vi.advanceTimersByTime(200);
    // Should NOT have fired the trailing edge
    expect(onMessages).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes the subscription from the agent", () => {
    const countBefore = agent.subscribers.length;

    const sub = core.subscribeToAgentWithOptions(agent, {
      onMessagesChanged: vi.fn(),
    });

    expect(agent.subscribers.length).toBe(countBefore + 1);

    sub.unsubscribe();
    expect(agent.subscribers.length).toBe(countBefore);
  });

  // -------------------------------------------------------------------------
  // Resolution cascade
  // -------------------------------------------------------------------------

  it("options.throttleMs takes precedence over defaultThrottleMs", () => {
    core.setDefaultThrottleMs(200);
    const onMessages = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 50 },
    );

    // Leading
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // At 50ms the trailing should fire (using throttleMs, not defaultThrottleMs)
    vi.advanceTimersByTime(50);
    expect(onMessages).toHaveBeenCalledTimes(2);
  });

  it("falls back to defaultThrottleMs when options.throttleMs is undefined", () => {
    core.setDefaultThrottleMs(100);
    const onMessages = vi.fn();

    core.subscribeToAgentWithOptions(agent, { onMessagesChanged: onMessages });

    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // Should be throttled at 100ms
    vi.advanceTimersByTime(50);
    expect(onMessages).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    expect(onMessages).toHaveBeenCalledTimes(2);
  });

  it("throttleMs=0 explicitly disables throttling even with defaultThrottleMs", () => {
    core.setDefaultThrottleMs(100);
    const onMessages = vi.fn();

    // `??` (not `||`): 0 must override the default, not fall through
    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 0 },
    );

    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // Both fire immediately — no throttling
    expect(onMessages).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Invalid values
  // -------------------------------------------------------------------------

  it.each([
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
    { label: "-1", value: -1 },
    { label: "-Infinity", value: -Infinity },
  ])(
    "invalid throttleMs ($label) falls back to unthrottled with console.error",
    ({ value }) => {
      const errorSpy = silenceConsoleError();
      const onMessages = vi.fn();

      core.subscribeToAgentWithOptions(
        agent,
        { onMessagesChanged: onMessages },
        { throttleMs: value },
      );

      agent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(agent);

      agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
      notifyMessagesChanged(agent);

      // Unthrottled — both fire
      expect(onMessages).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("must be a non-negative finite number"),
        expect.any(Error),
      );

      errorSpy.mockRestore();
    },
  );

  // -------------------------------------------------------------------------
  // Exception safety
  // -------------------------------------------------------------------------

  it("exception in onMessagesChanged does not prevent onStateChanged from flushing", () => {
    const errorSpy = silenceConsoleError();
    const onState = vi.fn();
    const onMessages = vi.fn().mockImplementation(() => {
      throw new Error("callback boom");
    });

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages, onStateChanged: onState },
      { throttleMs: 100 },
    );

    // Leading edge — onMessagesChanged throws, but should be caught
    agent.messages = [userMsg("1", "a")];
    agent.state = { x: 1 };
    notifyMessagesChanged(agent);
    notifyStateChanged(agent);

    // State was pending during the window. Advance to trailing edge.
    vi.advanceTimersByTime(100);
    expect(onState).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onMessagesChanged callback threw"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  it("exception in callback does not permanently deadlock the throttle", () => {
    const errorSpy = silenceConsoleError();
    let callCount = 0;
    const onMessages = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error("first call boom");
    });

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 100 },
    );

    // First call throws on leading edge
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Window should still be active — pending update
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // Trailing edge — should still fire (throttle not deadlocked)
    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(2);

    // Another full cycle should also work
    vi.advanceTimersByTime(100); // window ends
    agent.messages = [userMsg("1", "a"), userMsg("2", "b"), userMsg("3", "c")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(3);

    errorSpy.mockRestore();
  });

  it("async rejection in callback is caught and logged", async () => {
    const errorSpy = silenceConsoleError();
    const onMessages = vi.fn().mockImplementation(() => {
      return Promise.reject(new Error("async boom"));
    });

    core.subscribeToAgentWithOptions(agent, {
      onMessagesChanged: onMessages,
    });

    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    // Flush microtasks so the .catch() handler runs
    await vi.advanceTimersByTimeAsync(0);

    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onMessagesChanged callback rejected"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Unthrottled path exception safety
  // -------------------------------------------------------------------------

  it("unthrottled: exception in onMessagesChanged does not prevent onStateChanged", () => {
    const errorSpy = silenceConsoleError();
    const onState = vi.fn();
    const onMessages = vi.fn().mockImplementation(() => {
      throw new Error("unthrottled boom");
    });

    core.subscribeToAgentWithOptions(agent, {
      onMessagesChanged: onMessages,
      onStateChanged: onState,
    });

    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    // onMessagesChanged threw, but notification loop should survive
    agent.state = { x: 1 };
    notifyStateChanged(agent);
    expect(onState).toHaveBeenCalledTimes(1);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onMessagesChanged callback threw"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Re-entrant notifications during flush
  // -------------------------------------------------------------------------

  it("re-entrant notification during flush is captured and deferred", () => {
    type MessagesChangedParams = Parameters<
      NonNullable<SubscribeToAgentSubscriber["onMessagesChanged"]>
    >[0];
    const onMessages = vi
      .fn()
      .mockImplementation((params: MessagesChangedParams) => {
        // On the first trailing-edge flush, synchronously trigger another
        // notification on the same agent — this tests re-entrancy safety.
        if (params.messages.length === 2) {
          agent.messages = [
            userMsg("1", "a"),
            userMsg("2", "b"),
            userMsg("3", "c"),
          ];
          notifyMessagesChanged(agent);
        }
      });

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 100 },
    );

    // Leading edge
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Deferred within window
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // Trailing edge fires — callback triggers re-entrant notification which
    // fires immediately as a new leading edge (Pacer considers the previous
    // window expired after the trailing fires).
    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(3);
    expect(onMessages.mock.calls[1][0].messages).toHaveLength(2);
    expect(onMessages.mock.calls[2][0].messages).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Multiple simultaneous subscriptions
  // -------------------------------------------------------------------------

  it("two subscriptions to the same agent maintain independent throttle windows", () => {
    const onMessagesA = vi.fn();
    const onMessagesB = vi.fn();

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessagesA },
      { throttleMs: 50 },
    );

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessagesB },
      { throttleMs: 200 },
    );

    // Both fire on leading edge
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessagesA).toHaveBeenCalledTimes(1);
    expect(onMessagesB).toHaveBeenCalledTimes(1);

    // Deferred within both windows
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);
    expect(onMessagesA).toHaveBeenCalledTimes(1);
    expect(onMessagesB).toHaveBeenCalledTimes(1);

    // Sub A trailing edge fires at 50ms, sub B still waiting
    vi.advanceTimersByTime(50);
    expect(onMessagesA).toHaveBeenCalledTimes(2);
    expect(onMessagesB).toHaveBeenCalledTimes(1);

    // Sub B trailing edge fires at 200ms
    vi.advanceTimersByTime(150);
    expect(onMessagesB).toHaveBeenCalledTimes(2);
  });

  it("unsubscribing one subscription does not affect the other", () => {
    const onMessagesA = vi.fn();
    const onMessagesB = vi.fn();

    const subA = core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessagesA },
      { throttleMs: 100 },
    );

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessagesB },
      { throttleMs: 100 },
    );

    // Leading edge for both
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessagesA).toHaveBeenCalledTimes(1);
    expect(onMessagesB).toHaveBeenCalledTimes(1);

    // Unsubscribe A
    subA.unsubscribe();

    // New notification — only B should receive
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    vi.advanceTimersByTime(100);
    expect(onMessagesA).toHaveBeenCalledTimes(1); // no more calls
    expect(onMessagesB).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Unsubscribe during flush prevents sibling callback
  // -------------------------------------------------------------------------

  it("unsubscribe called inside onMessagesChanged prevents onStateChanged from firing", () => {
    let subHandle: { unsubscribe: () => void };
    const onMessages = vi.fn().mockImplementation(() => {
      subHandle.unsubscribe();
    });
    const onState = vi.fn();

    subHandle = core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages, onStateChanged: onState },
      { throttleMs: 100 },
    );

    // Leading edge — onMessagesChanged fires and unsubscribes
    agent.messages = [userMsg("1", "a")];
    agent.state = { x: 1 };
    notifyMessagesChanged(agent);
    notifyStateChanged(agent);

    expect(onMessages).toHaveBeenCalledTimes(1);

    // Trailing edge — onStateChanged should NOT fire (unsubscribed)
    vi.advanceTimersByTime(100);
    expect(onState).toHaveBeenCalledTimes(0);
  });

  it("unthrottled: exception in run lifecycle callback is caught", () => {
    const errorSpy = silenceConsoleError();
    const onRunInit = vi.fn().mockImplementation(() => {
      throw new Error("lifecycle boom");
    });

    core.subscribeToAgentWithOptions(agent, {
      onRunInitialized: onRunInit,
    });

    notifyLifecycle(agent, "onRunInitialized");
    expect(onRunInit).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onRunInitialized callback threw"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // emitError / onError integration
  // -------------------------------------------------------------------------

  it("subscriber callback failure emits SUBSCRIBER_CALLBACK_FAILED through onError", async () => {
    const errorSpy = silenceConsoleError();
    const onError = vi.fn();
    core.subscribe({ onError });

    const onMessages = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });

    core.subscribeToAgentWithOptions(agent, { onMessagesChanged: onMessages });

    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);

    // emitError is async — flush microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        code: CopilotKitCoreErrorCode.SUBSCRIBER_CALLBACK_FAILED,
        context: expect.objectContaining({
          agentId: "test-agent",
          callback: "onMessagesChanged",
        }),
      }),
    );

    errorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Unsubscribe + throw combination
  // -------------------------------------------------------------------------

  it("unsubscribe + throw in onMessagesChanged still prevents onStateChanged from firing", () => {
    const errorSpy = silenceConsoleError();
    let subHandle: { unsubscribe: () => void };
    const onMessages = vi.fn().mockImplementation(() => {
      subHandle.unsubscribe();
      throw new Error("throw after unsubscribe");
    });
    const onState = vi.fn();

    subHandle = core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages, onStateChanged: onState },
      { throttleMs: 100 },
    );

    // Leading edge — onMessagesChanged unsubscribes then throws
    agent.messages = [userMsg("1", "a")];
    agent.state = { x: 1 };
    notifyMessagesChanged(agent);
    notifyStateChanged(agent);

    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onMessagesChanged callback threw"),
      expect.any(Error),
    );

    // Trailing edge — onStateChanged should NOT fire (unsubscribed)
    vi.advanceTimersByTime(100);
    expect(onState).toHaveBeenCalledTimes(0);

    errorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // guardAll drops unsupported keys with warning
  // -------------------------------------------------------------------------

  it("unsupported callback keys are dropped with console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onEvent = vi.fn();

    // Intentional `as any`: simulates a JS consumer passing an unsupported
    // callback key — verifies guardAll strips it at runtime.
    core.subscribeToAgentWithOptions(agent, {
      onMessagesChanged: vi.fn(),
      onEvent,
    } as any);

    // Verify the unsupported key was stripped — accessing a property the type
    // system correctly says doesn't exist on AgentSubscriber
    agent.subscribers.forEach(
      (s: any) => s.onEvent?.({ type: "test" }), // eslint-disable-line @typescript-eslint/no-explicit-any
    );

    // onEvent should never have been called — it was stripped
    expect(onEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('callback "onEvent" is not supported'),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Async rejection during throttled trailing-edge flush
  // -------------------------------------------------------------------------

  it("async rejection during trailing-edge flush is caught and logged", async () => {
    const errorSpy = silenceConsoleError();
    let callCount = 0;
    const onMessages = vi.fn().mockImplementation(() => {
      callCount++;
      // Second call (trailing edge) returns a rejected promise
      if (callCount === 2) {
        return Promise.reject(new Error("trailing async boom"));
      }
    });

    core.subscribeToAgentWithOptions(
      agent,
      { onMessagesChanged: onMessages },
      { throttleMs: 100 },
    );

    // Leading edge — succeeds
    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(1);

    // Deferred within window
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // Trailing edge — triggers async rejection
    vi.advanceTimersByTime(100);
    expect(onMessages).toHaveBeenCalledTimes(2);

    // Flush microtasks so the .catch() handler runs
    await vi.advanceTimersByTimeAsync(0);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onMessagesChanged callback rejected"),
      expect.any(Error),
    );

    // Throttle should not be deadlocked — window closes, next fires on leading edge
    vi.advanceTimersByTime(100);
    agent.messages = [userMsg("3", "c")];
    notifyMessagesChanged(agent);
    expect(onMessages).toHaveBeenCalledTimes(3);

    errorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // setDefaultThrottleMs(undefined) clears throttle for new subscriptions
  // -------------------------------------------------------------------------

  it("clearing defaultThrottleMs with undefined makes new subscriptions unthrottled", () => {
    core.setDefaultThrottleMs(100);
    const onMessagesThrottled = vi.fn();

    // First subscription — throttled via defaultThrottleMs
    const sub1 = core.subscribeToAgentWithOptions(agent, {
      onMessagesChanged: onMessagesThrottled,
    });

    agent.messages = [userMsg("1", "a")];
    notifyMessagesChanged(agent);
    agent.messages = [userMsg("1", "a"), userMsg("2", "b")];
    notifyMessagesChanged(agent);

    // Second update is deferred (throttled)
    expect(onMessagesThrottled).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(onMessagesThrottled).toHaveBeenCalledTimes(2);
    sub1.unsubscribe();

    // Clear the default
    core.setDefaultThrottleMs(undefined);

    // Second subscription — should be unthrottled
    const onMessagesUnthrottled = vi.fn();
    core.subscribeToAgentWithOptions(agent, {
      onMessagesChanged: onMessagesUnthrottled,
    });

    agent.messages = [userMsg("3", "c")];
    notifyMessagesChanged(agent);
    agent.messages = [userMsg("3", "c"), userMsg("4", "d")];
    notifyMessagesChanged(agent);

    // Both fire immediately — no throttling
    expect(onMessagesUnthrottled).toHaveBeenCalledTimes(2);
  });
});
