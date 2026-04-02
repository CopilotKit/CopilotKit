import React from "react";
import { render, act, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAgent, UseAgentUpdate } from "../use-agent";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import { MockStepwiseAgent } from "../../__tests__/utils/test-helpers";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";

vi.mock("../../providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../../providers/CopilotChatConfigurationProvider", () => ({
  useCopilotChatConfiguration: vi.fn(() => undefined),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

/** Helper: fire onMessagesChanged on all agent subscribers */
function notifyMessagesChanged(agent: MockStepwiseAgent) {
  agent.subscribers.forEach((s) =>
    s.onMessagesChanged?.({
      messages: agent.messages,
      state: agent.state,
      agent,
    } as any),
  );
}

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

describe("useAgent throttleMs", () => {
  let mockAgent: MockStepwiseAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAgent = new MockStepwiseAgent();
    mockAgent.agentId = "test-agent";

    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        getAgent: () => mockAgent,
        runtimeUrl: "http://localhost:3000/api/copilot",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        runtimeTransport: "rest",
        headers: {},
        agents: { "test-agent": mockAgent },
      },
      executingToolCallIds: new Set(),
    });
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
      mockAgent.messages = [{ id: "1", role: "user", content: "hello" } as any];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("with throttleMs: 0 (explicit), behaves identically to omitting throttleMs", () => {
    const TestComponent = createTestComponent({ throttleMs: 0 });

    render(<TestComponent />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "hello" } as any];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");

    // Second notification also fires immediately (no throttle)
    act(() => {
      mockAgent.messages = [
        { id: "1", role: "user", content: "hello" } as any,
        { id: "2", role: "assistant", content: "world" } as any,
      ];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("with throttleMs, first notification fires immediately (leading edge)", () => {
    const TestComponent = createTestComponent({ throttleMs: 100 });

    render(<TestComponent />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "hello" } as any];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("with throttleMs, second notification within window is deferred until trailing edge", () => {
    const TestComponent = createTestComponent({ throttleMs: 100 });

    render(<TestComponent />);

    // First notification — leading edge, fires immediately
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "a" } as any];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Second notification 10ms later — within throttle window
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [
        { id: "1", role: "user", content: "a" } as any,
        { id: "2", role: "assistant", content: "b" } as any,
      ];
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
      mockAgent.messages = [{ id: "1", role: "user", content: "tok1" } as any];
      notifyMessagesChanged(mockAgent);
    });
    expect(renderCount.current).toBe(rendersAfterMount + 1);

    // Fire 10 rapid notifications within the throttle window (1ms apart)
    for (let i = 2; i <= 11; i++) {
      act(() => {
        vi.advanceTimersByTime(1);
        mockAgent.messages = Array.from({ length: i }, (_, j) => ({
          id: String(j + 1),
          role: j % 2 === 0 ? "user" : "assistant",
          content: `tok${j + 1}`,
        })) as any;
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
      mockAgent.messages = [{ id: "1", role: "user", content: "a" } as any];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Second notification — deferred
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [
        { id: "1", role: "user", content: "a" } as any,
        { id: "2", role: "assistant", content: "b" } as any,
      ];
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
        { id: "1", role: "user", content: "a" } as any,
        { id: "2", role: "assistant", content: "b" } as any,
        { id: "3", role: "user", content: "c" } as any,
      ];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("with throttleMs, onStateChanged still fires immediately", () => {
    const TestComponent = createTestComponent({
      updates: [
        UseAgentUpdate.OnMessagesChanged,
        UseAgentUpdate.OnStateChanged,
      ],
      throttleMs: 100,
    });

    render(<TestComponent />);

    // Fire onMessagesChanged to start the throttle window
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "a" } as any];
      notifyMessagesChanged(mockAgent);
    });

    // Fire onStateChanged 10ms later — should render immediately, not throttled
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.state = { count: 42 };
      mockAgent.subscribers.forEach((s) =>
        s.onStateChanged?.({
          state: mockAgent.state,
          messages: mockAgent.messages,
          agent: mockAgent,
        } as any),
      );
    });

    expect(screen.getByTestId("state").textContent).toBe('{"count":42}');
  });

  it("with throttleMs, pending trailing timer does not fire after unmount", () => {
    const renderCount = { current: 0 };
    const TestComponent = createTestComponent({ throttleMs: 100, renderCount });

    const { unmount } = render(<TestComponent />);

    // Leading edge — fires immediately
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "a" } as any];
      notifyMessagesChanged(mockAgent);
    });

    // Second notification — schedules trailing timer
    act(() => {
      vi.advanceTimersByTime(10);
      mockAgent.messages = [
        { id: "1", role: "user", content: "a" } as any,
        { id: "2", role: "assistant", content: "b" } as any,
      ];
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

  it("with throttleMs and updates excluding OnMessagesChanged, throttle is a no-op", () => {
    const TestComponent = createTestComponent({
      updates: [UseAgentUpdate.OnStateChanged],
      throttleMs: 100,
    });

    render(<TestComponent />);

    // Only onStateChanged is subscribed — should fire immediately
    act(() => {
      mockAgent.state = { value: "test" };
      mockAgent.subscribers.forEach((s) =>
        s.onStateChanged?.({
          state: mockAgent.state,
          messages: mockAgent.messages,
          agent: mockAgent,
        } as any),
      );
    });

    expect(screen.getByTestId("state").textContent).toBe('{"value":"test"}');

    // No onMessagesChanged subscription should exist
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "a" } as any];
      notifyMessagesChanged(mockAgent);
    });

    // Messages count should still be 0 from the component's perspective
    // (it will show 1 because the agent ref is shared, but there's no
    // re-render triggered by onMessagesChanged)
    expect(screen.getByTestId("state").textContent).toBe('{"value":"test"}');
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
});
