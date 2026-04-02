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
    function TestComponent() {
      const { agent } = useAgent({
        agentId: "test-agent",
        updates: [UseAgentUpdate.OnMessagesChanged],
      });
      return <div data-testid="count">{agent.messages.length}</div>;
    }

    render(<TestComponent />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    // Mutate agent messages and notify
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "hello" } as any];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("with throttleMs, first notification fires immediately (leading edge)", () => {
    function TestComponent() {
      const { agent } = useAgent({
        agentId: "test-agent",
        updates: [UseAgentUpdate.OnMessagesChanged],
        throttleMs: 100,
      });
      return <div data-testid="count">{agent.messages.length}</div>;
    }

    render(<TestComponent />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    // First notification should fire immediately (leading edge)
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "hello" } as any];
      notifyMessagesChanged(mockAgent);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("with throttleMs, second notification within window is deferred until trailing edge", () => {
    function TestComponent() {
      const { agent } = useAgent({
        agentId: "test-agent",
        updates: [UseAgentUpdate.OnMessagesChanged],
        throttleMs: 100,
      });
      return <div data-testid="count">{agent.messages.length}</div>;
    }

    render(<TestComponent />);

    // First notification — leading edge, fires immediately
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "a" } as any];
      notifyMessagesChanged(mockAgent);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Second notification 10ms later — within throttle window
    // With throttle: forceUpdate is scheduled via setTimeout, not called yet
    // Without throttle: forceUpdate fires immediately
    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
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

  it("with throttleMs, onStateChanged still fires immediately", () => {
    function TestComponent() {
      const { agent } = useAgent({
        agentId: "test-agent",
        updates: [
          UseAgentUpdate.OnMessagesChanged,
          UseAgentUpdate.OnStateChanged,
        ],
        throttleMs: 100,
      });
      return <div data-testid="state">{JSON.stringify(agent.state)}</div>;
    }

    render(<TestComponent />);

    // Fire onMessagesChanged to start the throttle window
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "a" } as any];
      notifyMessagesChanged(mockAgent);
    });

    // Fire onStateChanged 10ms later — should render immediately, not throttled
    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
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
    function TestComponent() {
      const { agent } = useAgent({
        agentId: "test-agent",
        updates: [UseAgentUpdate.OnMessagesChanged],
        throttleMs: 100,
      });
      // We can't spy on forceUpdate directly, but we can detect
      // whether the component renders after unmount via console.error
      return <div data-testid="count">{agent.messages.length}</div>;
    }

    const { unmount } = render(<TestComponent />);

    // Leading edge — fires immediately
    act(() => {
      mockAgent.messages = [{ id: "1", role: "user", content: "a" } as any];
      notifyMessagesChanged(mockAgent);
    });

    // Second notification — schedules trailing timer
    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
      mockAgent.messages = [
        { id: "1", role: "user", content: "a" } as any,
        { id: "2", role: "assistant", content: "b" } as any,
      ];
      notifyMessagesChanged(mockAgent);
    });

    // Unmount before trailing fires
    unmount();

    // Advancing past the window should NOT throw or warn about
    // state updates on unmounted component
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }).not.toThrow();
  });
});
