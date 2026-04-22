import React from "react";
import { render, act, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAgent, UseAgentUpdate } from "../use-agent";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import { MockStepwiseAgent } from "../../__tests__/utils/test-helpers";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { Message } from "@ag-ui/core";
import type { RunAgentInput } from "@ag-ui/client";

vi.mock("../../providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../../providers/CopilotChatConfigurationProvider", () => ({
  useCopilotChatConfiguration: vi.fn(() => undefined),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Message factories — eliminates `as any` on every message literal
// ---------------------------------------------------------------------------

function userMsg(id: string, content = `msg-${id}`): Message {
  return { id, role: "user" as const, content };
}

function assistantMsg(id: string, content = `msg-${id}`): Message {
  return { id, role: "assistant" as const, content };
}

/** Create N alternating user/assistant messages (ids "1" … "N") */
function createMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0
      ? userMsg(String(i + 1), `tok${i + 1}`)
      : assistantMsg(String(i + 1), `tok${i + 1}`),
  );
}

// ---------------------------------------------------------------------------
// Subscriber notification helpers
// ---------------------------------------------------------------------------

/** Helper: fire onMessagesChanged on all agent subscribers */
function notifyMessagesChanged(agent: MockStepwiseAgent) {
  agent.subscribers.forEach((s) =>
    s.onMessagesChanged?.({
      messages: agent.messages,
      state: agent.state,
      agent,
    }),
  );
}

/** Helper: fire onStateChanged on all agent subscribers */
function notifyStateChanged(agent: MockStepwiseAgent) {
  agent.subscribers.forEach((s) =>
    s.onStateChanged?.({
      state: agent.state,
      messages: agent.messages,
      agent,
    }),
  );
}

function createMockRunAgentInput(
  overrides?: Partial<RunAgentInput>,
): RunAgentInput {
  return {
    threadId: "t-1",
    runId: "r-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  };
}

/** Helper: fire onRunInitialized on all agent subscribers */
function notifyRunInitialized(agent: MockStepwiseAgent) {
  agent.subscribers.forEach((s) =>
    s.onRunInitialized?.({
      messages: agent.messages,
      state: agent.state,
      agent,
      input: createMockRunAgentInput(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Test component factory
// ---------------------------------------------------------------------------

/** Helper: create a test component that tracks render count */
function createTestComponent(
  options: {
    updates?: UseAgentUpdate[];
    throttleMs?: number;
    renderCount?: { current: number };
  } = {},
) {
  const {
    updates = [UseAgentUpdate.OnMessagesChanged],
    throttleMs,
    renderCount,
  } = options;

  return function TestComponent() {
    if (renderCount) renderCount.current++;
    const { agent } = useAgent({
      agentId: "test-agent",
      updates,
      throttleMs,
    });
    return (
      <>
        <div data-testid="count">{agent.messages.length}</div>
        <div data-testid="state">{JSON.stringify(agent.state)}</div>
      </>
    );
  };
}

/** Factory for the mock return value of useCopilotKit.
 *  Uses a real CopilotKitCore instance so subscribeToAgentWithOptions (with its throttle
 *  logic) is exercised end-to-end rather than mocked. */
function createMockContext(
  agent: MockStepwiseAgent,
  overrides: { defaultThrottleMs?: number } = {},
) {
  const core = new CopilotKitCore({
    runtimeUrl: "http://localhost:3000/api/copilot",
  });
  if (overrides.defaultThrottleMs !== undefined) {
    core.setDefaultThrottleMs(overrides.defaultThrottleMs);
  }
  return {
    copilotkit: {
      getAgent: () => agent,
      runtimeUrl: "http://localhost:3000/api/copilot",
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeTransport: "rest",
      headers: {},
      agents: { [String(agent.agentId)]: agent },
      defaultThrottleMs: core.defaultThrottleMs,
      subscribeToAgentWithOptions: core.subscribeToAgentWithOptions.bind(core),
    },
    executingToolCallIds: new Set(),
  };
}

describe("useAgent throttleMs", () => {
  let mockAgent: MockStepwiseAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAgent = new MockStepwiseAgent();
    mockAgent.agentId = "test-agent";

    mockUseCopilotKit.mockReturnValue(createMockContext(mockAgent));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("without throttleMs, component reflects latest messages after notification", () => {
    const TestComponent = createTestComponent();

    render(<TestComponent />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      mockAgent.messages = [userMsg("1", "hello")];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("with throttleMs: 0 (explicit), behaves identically to omitting throttleMs", () => {
    const TestComponent = createTestComponent({ throttleMs: 0 });

    render(<TestComponent />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      mockAgent.messages = [userMsg("1", "hello")];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");

    // Second notification also fires immediately (no throttle)
    act(() => {
      mockAgent.messages = [userMsg("1", "hello"), assistantMsg("2", "world")];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("with throttleMs, first notification fires immediately (leading edge)", () => {
    const TestComponent = createTestComponent({ throttleMs: 100 });

    render(<TestComponent />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      mockAgent.messages = [userMsg("1", "hello")];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("with throttleMs, second notification within window is deferred until trailing edge", () => {
    const TestComponent = createTestComponent({ throttleMs: 100 });

    render(<TestComponent />);

    // First notification — leading edge, fires immediately
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Second notification 10ms later — within throttle window
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
      notifyMessagesChanged(mockAgent);
    });

    // The throttle should have deferred this — component still shows 1
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Advance past the throttle window — trailing edge fires
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("with throttleMs, rapid burst of many notifications results in exactly 2 renders (leading + trailing)", () => {
    const renderCount = { current: 0 };
    const TestComponent = createTestComponent({ throttleMs: 100, renderCount });

    render(<TestComponent />);
    const rendersAfterMount = renderCount.current;

    // Leading edge — fires immediately
    act(() => {
      mockAgent.messages = [userMsg("1", "tok1")];
      notifyMessagesChanged(mockAgent);
    });
    expect(renderCount.current).toBe(rendersAfterMount + 1);

    // Fire 10 rapid notifications within the throttle window (1ms apart)
    for (let i = 2; i <= 11; i++) {
      act(() => {
        vi.advanceTimersByTime(1);
        mockAgent.messages = createMessages(i);
        notifyMessagesChanged(mockAgent);
      });
    }

    // Should still be at leading-edge render count (burst was coalesced)
    expect(renderCount.current).toBe(rendersAfterMount + 1);
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Advance past the throttle window — trailing edge fires once
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(renderCount.current).toBe(rendersAfterMount + 2);
    expect(screen.getByTestId("count").textContent).toBe("11");
  });

  it("with throttleMs, new notification after trailing edge fires immediately (new cycle)", () => {
    const TestComponent = createTestComponent({ throttleMs: 100 });

    render(<TestComponent />);

    // Leading edge
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Second notification — deferred
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
      notifyMessagesChanged(mockAgent);
    });

    // Trailing edge fires
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");

    // New notification well after the window — should fire immediately as a new leading edge
    act(() => {
      vi.advanceTimersByTime(200);
      mockAgent.messages = [
        userMsg("1", "a"),
        assistantMsg("2", "b"),
        userMsg("3", "c"),
      ];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("with throttleMs, onStateChanged is also throttled (shared window)", async () => {
    const TestComponent = createTestComponent({
      updates: [
        UseAgentUpdate.OnMessagesChanged,
        UseAgentUpdate.OnStateChanged,
      ],
      throttleMs: 100,
    });

    render(<TestComponent />);

    // Fire onMessagesChanged to start the throttle window (leading edge)
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Fire onStateChanged 10ms later — should be deferred (within throttle window)
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.state = { count: 42 };
      notifyStateChanged(mockAgent);
    });

    // State update is pending, not yet rendered
    expect(screen.getByTestId("state").textContent).toBe("{}");

    // Trailing edge fires after the window — await so microtask from
    // batchedForceUpdate flushes and triggers the React re-render.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTestId("state").textContent).toBe('{"count":42}');
  });

  it("with throttleMs, pending trailing timer does not fire after unmount", () => {
    const renderCount = { current: 0 };
    const TestComponent = createTestComponent({ throttleMs: 100, renderCount });

    const { unmount } = render(<TestComponent />);

    // Leading edge — fires immediately
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });

    // Second notification — schedules trailing timer
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
      notifyMessagesChanged(mockAgent);
    });

    const countBeforeUnmount = renderCount.current;

    // Unmount before trailing fires
    unmount();

    // Advancing past the window should NOT cause additional renders
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(renderCount.current).toBe(countBeforeUnmount);
  });

  it("with throttleMs and only OnStateChanged subscribed, first state fires on leading edge", async () => {
    const TestComponent = createTestComponent({
      updates: [UseAgentUpdate.OnStateChanged],
      throttleMs: 100,
    });

    render(<TestComponent />);

    // First onStateChanged fires immediately (leading edge) — await so
    // microtask from batchedForceUpdate flushes.
    await act(async () => {
      mockAgent.state = { value: "test" };
      notifyStateChanged(mockAgent);
    });

    expect(screen.getByTestId("state").textContent).toBe('{"value":"test"}');

    // No onMessagesChanged subscription should exist — messages notification
    // does nothing because the handler was never registered.
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("state").textContent).toBe('{"value":"test"}');
  });

  it.each([
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
    { label: "-1", value: -1 },
    { label: "-Infinity", value: -Infinity },
  ])(
    "with invalid throttleMs ($label), falls back to unthrottled and warns",
    ({ value }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const TestComponent = createTestComponent({ throttleMs: value });

      render(<TestComponent />);

      // Should warn about the invalid value
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "throttleMs must be a non-negative finite number",
        ),
        expect.any(Error),
      );

      // Should behave as unthrottled — every notification fires immediately
      act(() => {
        mockAgent.messages = [userMsg("1", "a")];
        notifyMessagesChanged(mockAgent);
      });
      expect(screen.getByTestId("count").textContent).toBe("1");

      act(() => {
        mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
        notifyMessagesChanged(mockAgent);
      });
      expect(screen.getByTestId("count").textContent).toBe("2");
    },
  );

  it("trailing-edge render reflects the latest messages, not stale data", () => {
    const TestComponent = createTestComponent({ throttleMs: 100 });
    render(<TestComponent />);

    // Leading edge
    act(() => {
      mockAgent.messages = [userMsg("1", "A")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Multiple deferred notifications with increasing messages
    act(() => {
      vi.advanceTimersByTime(20);
      mockAgent.messages = [userMsg("1", "A"), assistantMsg("2", "B")];
      notifyMessagesChanged(mockAgent);
    });

    act(() => {
      vi.advanceTimersByTime(20);
      mockAgent.messages = [
        userMsg("1", "A"),
        assistantMsg("2", "B"),
        assistantMsg("3", "C"),
      ];
      notifyMessagesChanged(mockAgent);
    });

    // Still deferred
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Trailing edge fires — must show all 3 messages (latest state)
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("trailing edge fires at exactly throttleMs after the leading edge", () => {
    const TestComponent = createTestComponent({ throttleMs: 100 });
    render(<TestComponent />);

    // Leading edge at T=0
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Deferred notification at T=40
    act(() => {
      vi.advanceTimersByTime(40);
      mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // At T=99, trailing has NOT fired yet
    act(() => {
      vi.advanceTimersByTime(59);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // At T=100, trailing fires
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("changing throttleMs cleans up pending timers from the previous configuration", () => {
    function DynamicThrottleComponent({ throttleMs }: { throttleMs: number }) {
      const { agent } = useAgent({
        agentId: "test-agent",
        updates: [UseAgentUpdate.OnMessagesChanged],
        throttleMs,
      });
      return <div data-testid="count">{agent.messages.length}</div>;
    }

    const { rerender } = render(<DynamicThrottleComponent throttleMs={200} />);

    // Leading edge
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Deferred notification — pending timer set for 200ms
    act(() => {
      vi.advanceTimersByTime(50);
      mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Change throttleMs — effect re-runs, old 200ms timer should be cleaned up
    rerender(<DynamicThrottleComponent throttleMs={50} />);

    // New notification fires as leading edge under the new 50ms throttle
    act(() => {
      mockAgent.messages = [
        userMsg("1", "a"),
        assistantMsg("2", "b"),
        userMsg("3", "c"),
      ];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("3");

    // Advance past what would have been the old 200ms trailing edge —
    // no ghost render should occur from the old timer
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("notification immediately after trailing edge is throttled (trailing restarts the window)", () => {
    const renderCount = { current: 0 };
    const TestComponent = createTestComponent({ throttleMs: 100, renderCount });

    render(<TestComponent />);
    const rendersAfterMount = renderCount.current;

    // T=0: Leading edge fires immediately
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(renderCount.current).toBe(rendersAfterMount + 1);
    expect(screen.getByTestId("count").textContent).toBe("1");

    // T=10: Deferred notification — schedules trailing
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
      notifyMessagesChanged(mockAgent);
    });

    // T=100: Trailing fires (render #2) and restarts window
    act(() => {
      vi.advanceTimersByTime(90);
    });
    expect(renderCount.current).toBe(rendersAfterMount + 2);
    expect(screen.getByTestId("count").textContent).toBe("2");

    // T=101: Notification 1ms after trailing — should be DEFERRED (within new window), not immediate
    act(() => {
      vi.advanceTimersByTime(1);
      mockAgent.messages = [
        userMsg("1", "a"),
        assistantMsg("2", "b"),
        userMsg("3", "c"),
      ];
      notifyMessagesChanged(mockAgent);
    });
    // Still 2 — the notification was deferred, not a new leading edge
    expect(renderCount.current).toBe(rendersAfterMount + 2);
    expect(screen.getByTestId("count").textContent).toBe("2");

    // T=200: New trailing fires (render #3)
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(renderCount.current).toBe(rendersAfterMount + 3);
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("cleans up all subscriptions after unmount", () => {
    const TestComponent = createTestComponent({
      updates: [
        UseAgentUpdate.OnMessagesChanged,
        UseAgentUpdate.OnStateChanged,
      ],
      throttleMs: 100,
    });

    const subscriberCountBefore = mockAgent.subscribers.length;
    const { unmount } = render(<TestComponent />);

    // Should have added subscriber(s)
    expect(mockAgent.subscribers.length).toBeGreaterThan(subscriberCountBefore);

    unmount();

    // All subscriptions should be cleaned up
    expect(mockAgent.subscribers.length).toBe(subscriberCountBefore);
  });

  it("single notification within window does not trigger a trailing re-render", () => {
    const renderCount = { current: 0 };
    const TestComponent = createTestComponent({ throttleMs: 100, renderCount });

    render(<TestComponent />);
    const rendersAfterMount = renderCount.current;

    // Leading edge — fires immediately
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(renderCount.current).toBe(rendersAfterMount + 1);

    // Advance well past the throttle window — no trailing should fire
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // No additional render since there was no second notification
    expect(renderCount.current).toBe(rendersAfterMount + 1);
  });

  it("with throttleMs, onRunInitialized still fires immediately during throttle window", async () => {
    const renderCount = { current: 0 };
    const TestComponent = createTestComponent({
      updates: [
        UseAgentUpdate.OnMessagesChanged,
        UseAgentUpdate.OnRunStatusChanged,
      ],
      throttleMs: 100,
      renderCount,
    });

    render(<TestComponent />);
    const rendersAfterMount = renderCount.current;

    // Fire onMessagesChanged to start the throttle window
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(renderCount.current).toBe(rendersAfterMount + 1);

    // Fire onRunInitialized 10ms later — fires via microtask batch
    await act(async () => {
      vi.advanceTimersByTime(10);
      notifyRunInitialized(mockAgent);
    });

    // Run status notification fires via microtask batch
    expect(renderCount.current).toBe(rendersAfterMount + 2);
  });

  it("changing throttleMs from positive to 0 disables throttling immediately", () => {
    function DynamicThrottleComponent({ throttleMs }: { throttleMs: number }) {
      const { agent } = useAgent({
        agentId: "test-agent",
        updates: [UseAgentUpdate.OnMessagesChanged],
        throttleMs,
      });
      return <div data-testid="count">{agent.messages.length}</div>;
    }

    const { rerender } = render(<DynamicThrottleComponent throttleMs={200} />);

    // Leading edge with throttle active
    act(() => {
      mockAgent.messages = [userMsg("1", "a")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Deferred notification — within throttle window
    act(() => {
      vi.advanceTimersByTime(50);
      mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Switch to unthrottled
    rerender(<DynamicThrottleComponent throttleMs={0} />);

    // Both notifications should fire immediately now
    act(() => {
      mockAgent.messages = [
        userMsg("1", "a"),
        assistantMsg("2", "b"),
        userMsg("3", "c"),
      ];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("3");

    // Second immediate notification also fires (no coalescing)
    act(() => {
      mockAgent.messages = [
        userMsg("1", "a"),
        assistantMsg("2", "b"),
        userMsg("3", "c"),
        assistantMsg("4", "d"),
      ];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("4");
  });
});

describe("useAgent defaultThrottleMs from provider", () => {
  let mockAgent: MockStepwiseAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAgent = new MockStepwiseAgent();
    mockAgent.agentId = "test-agent";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses provider defaultThrottleMs when no explicit throttleMs is passed", () => {
    mockUseCopilotKit.mockReturnValue(
      createMockContext(mockAgent, { defaultThrottleMs: 100 }),
    );

    const TestComponent = createTestComponent({ throttleMs: undefined });

    render(<TestComponent />);

    // Leading edge — fires immediately
    act(() => {
      mockAgent.messages = [userMsg("1", "hello")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Second notification within 100ms window — should be deferred (throttled)
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [userMsg("1", "hello"), assistantMsg("2", "world")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Trailing edge fires after 100ms
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("explicit throttleMs overrides provider defaultThrottleMs", () => {
    mockUseCopilotKit.mockReturnValue(
      createMockContext(mockAgent, { defaultThrottleMs: 5000 }),
    );

    // Explicit throttleMs=100 should override provider's 5000
    const TestComponent = createTestComponent({ throttleMs: 100 });

    render(<TestComponent />);

    // Leading edge
    act(() => {
      mockAgent.messages = [userMsg("1", "hello")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Deferred within 100ms window
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [userMsg("1", "hello"), assistantMsg("2", "world")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // At 100ms trailing fires (not waiting for provider's 5000ms)
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("without provider defaultThrottleMs or explicit throttleMs, behaves unthrottled", () => {
    mockUseCopilotKit.mockReturnValue(createMockContext(mockAgent));

    const TestComponent = createTestComponent({});

    render(<TestComponent />);

    act(() => {
      mockAgent.messages = [userMsg("1", "hello")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Immediately fires — no throttle
    act(() => {
      mockAgent.messages = [userMsg("1", "hello"), assistantMsg("2", "world")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("explicit throttleMs: 0 overrides non-zero provider defaultThrottleMs (opt-out)", () => {
    mockUseCopilotKit.mockReturnValue(
      createMockContext(mockAgent, { defaultThrottleMs: 500 }),
    );

    const TestComponent = createTestComponent({ throttleMs: 0 });

    render(<TestComponent />);

    // Both notifications fire immediately — throttleMs: 0 means no throttle
    act(() => {
      mockAgent.messages = [userMsg("1", "hello")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => {
      mockAgent.messages = [userMsg("1", "hello"), assistantMsg("2", "world")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it.each([
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
    { label: "-1", value: -1 },
    { label: "-Infinity", value: -Infinity },
  ])(
    "with invalid provider defaultThrottleMs ($label), falls back to unthrottled and warns",
    ({ value }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockUseCopilotKit.mockReturnValue(
        createMockContext(mockAgent, { defaultThrottleMs: value }),
      );

      const TestComponent = createTestComponent({ throttleMs: undefined });

      render(<TestComponent />);

      // The core setter rejects invalid values and logs an error
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("must be a non-negative finite number"),
        expect.any(Error),
      );

      // Should behave as unthrottled (setter rejected the value)
      act(() => {
        mockAgent.messages = [userMsg("1", "a")];
        notifyMessagesChanged(mockAgent);
      });
      expect(screen.getByTestId("count").textContent).toBe("1");

      act(() => {
        mockAgent.messages = [userMsg("1", "a"), assistantMsg("2", "b")];
        notifyMessagesChanged(mockAgent);
      });
      expect(screen.getByTestId("count").textContent).toBe("2");
    },
  );

  it("dynamically changing provider defaultThrottleMs updates throttle behavior", () => {
    // Start with 200ms throttle from provider
    mockUseCopilotKit.mockReturnValue(
      createMockContext(mockAgent, { defaultThrottleMs: 200 }),
    );

    const TestComponent = createTestComponent({ throttleMs: undefined });
    const { rerender } = render(<TestComponent />);

    // Leading edge fires immediately
    act(() => {
      mockAgent.messages = [userMsg("1", "hello")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Deferred within 200ms window
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [userMsg("1", "hello"), assistantMsg("2", "world")];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Flush trailing edge
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");

    // Change provider default to 50ms
    mockUseCopilotKit.mockReturnValue(
      createMockContext(mockAgent, { defaultThrottleMs: 50 }),
    );
    rerender(<TestComponent />);

    // Leading edge fires immediately
    act(() => {
      mockAgent.messages = [
        userMsg("1", "hello"),
        assistantMsg("2", "world"),
        userMsg("3", "new"),
      ];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("3");

    // Deferred within 50ms window
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [
        userMsg("1", "hello"),
        assistantMsg("2", "world"),
        userMsg("3", "new"),
        assistantMsg("4", "reply"),
      ];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("3");

    // Trailing fires after only 50ms (not 200ms)
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByTestId("count").textContent).toBe("4");
  });
});

describe("CopilotKitCore.setDefaultThrottleMs", () => {
  it("stores valid values", () => {
    const core = new CopilotKitCore({});
    core.setDefaultThrottleMs(100);
    expect(core.defaultThrottleMs).toBe(100);
  });

  it("stores 0", () => {
    const core = new CopilotKitCore({});
    core.setDefaultThrottleMs(100);
    core.setDefaultThrottleMs(0);
    expect(core.defaultThrottleMs).toBe(0);
  });

  it("stores undefined", () => {
    const core = new CopilotKitCore({});
    core.setDefaultThrottleMs(100);
    core.setDefaultThrottleMs(undefined);
    expect(core.defaultThrottleMs).toBeUndefined();
  });

  it.each([
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
    { label: "-1", value: -1 },
    { label: "-Infinity", value: -Infinity },
  ])(
    "rejects invalid value ($label) and preserves previous value",
    ({ value }) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const core = new CopilotKitCore({});
      core.setDefaultThrottleMs(200);
      core.setDefaultThrottleMs(value);
      expect(core.defaultThrottleMs).toBe(200);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("must be a non-negative finite number"),
        expect.any(Error),
      );
      errorSpy.mockRestore();
    },
  );
});
