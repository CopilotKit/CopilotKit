import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamingStatus } from "../use-streaming-status";
import { useAgent } from "../use-agent";

vi.mock("../use-agent", () => ({
  useAgent: vi.fn(),
}));

const mockUseAgent = useAgent as ReturnType<typeof vi.fn>;

type SubscriptionHandlers = {
  onRunInitialized?: () => void;
  onRunFinalized?: () => void;
  onRunFailed?: () => void;
  onReasoningStartEvent?: () => void;
  onReasoningEndEvent?: () => void;
  onToolCallStartEvent?: (payload: {
    event: { toolCallName: string; toolCallId: string };
  }) => void;
  onToolCallEndEvent?: () => void;
  onTextMessageStartEvent?: () => void;
  onTextMessageEndEvent?: () => void;
};

describe("useStreamingStatus", () => {
  let unsubscribeMock: ReturnType<typeof vi.fn>;
  let subscribeMock: ReturnType<typeof vi.fn>;
  let handlers: SubscriptionHandlers;
  let mockAgent: Record<string, unknown>;

  beforeEach(() => {
    unsubscribeMock = vi.fn();
    handlers = {};

    subscribeMock = vi.fn((nextHandlers: SubscriptionHandlers) => {
      handlers = nextHandlers;
      return { unsubscribe: unsubscribeMock };
    });

    mockAgent = {
      subscribe: subscribeMock,
      id: "test-agent",
    };

    mockUseAgent.mockReturnValue({ agent: mockAgent });
  });

  function Harness({ agentId }: { agentId?: string } = {}) {
    const status = useStreamingStatus({ agentId });
    return (
      <div>
        <span data-testid="phase">{status.phase}</span>
        <span data-testid="isRunning">{String(status.isRunning)}</span>
        <span data-testid="toolName">{status.toolName ?? "null"}</span>
        <span data-testid="toolCallId">{status.toolCallId ?? "null"}</span>
      </div>
    );
  }

  it("subscribes on mount and unsubscribes on unmount", () => {
    const { unmount } = render(<Harness />);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(handlers.onRunInitialized).toBeTypeOf("function");
    expect(handlers.onRunFinalized).toBeTypeOf("function");
    expect(handlers.onRunFailed).toBeTypeOf("function");
    expect(handlers.onToolCallStartEvent).toBeTypeOf("function");
    expect(handlers.onTextMessageStartEvent).toBeTypeOf("function");

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("starts with idle phase and isRunning false", () => {
    render(<Harness />);

    expect(screen.getByTestId("phase").textContent).toBe("idle");
    expect(screen.getByTestId("isRunning").textContent).toBe("false");
    expect(screen.getByTestId("toolName").textContent).toBe("null");
    expect(screen.getByTestId("toolCallId").textContent).toBe("null");
  });

  it("transitions to isRunning=true on onRunInitialized", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
    });

    expect(screen.getByTestId("isRunning").textContent).toBe("true");
    expect(screen.getByTestId("phase").textContent).toBe("idle");
  });

  it("transitions to reasoning phase on onReasoningStartEvent", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onReasoningStartEvent?.();
    });

    expect(screen.getByTestId("phase").textContent).toBe("reasoning");
    expect(screen.getByTestId("isRunning").textContent).toBe("true");
  });

  it("returns to idle phase on onReasoningEndEvent", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onReasoningStartEvent?.();
    });
    expect(screen.getByTestId("phase").textContent).toBe("reasoning");

    act(() => {
      handlers.onReasoningEndEvent?.();
    });
    expect(screen.getByTestId("phase").textContent).toBe("idle");
    expect(screen.getByTestId("isRunning").textContent).toBe("true");
  });

  it("transitions to tool_calling with toolName on onToolCallStartEvent", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "sayHello", toolCallId: "call-123" },
      });
    });

    expect(screen.getByTestId("phase").textContent).toBe("tool_calling");
    expect(screen.getByTestId("toolName").textContent).toBe("sayHello");
    expect(screen.getByTestId("toolCallId").textContent).toBe("call-123");
    expect(screen.getByTestId("isRunning").textContent).toBe("true");
  });

  it("clears toolName and returns to idle on onToolCallEndEvent", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "sayHello", toolCallId: "call-123" },
      });
    });
    expect(screen.getByTestId("phase").textContent).toBe("tool_calling");

    act(() => {
      handlers.onToolCallEndEvent?.();
    });

    expect(screen.getByTestId("phase").textContent).toBe("idle");
    expect(screen.getByTestId("toolName").textContent).toBe("null");
    expect(screen.getByTestId("toolCallId").textContent).toBe("null");
    expect(screen.getByTestId("isRunning").textContent).toBe("true");
  });

  it("transitions to streaming on onTextMessageStartEvent", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onTextMessageStartEvent?.();
    });

    expect(screen.getByTestId("phase").textContent).toBe("streaming");
    expect(screen.getByTestId("isRunning").textContent).toBe("true");
  });

  it("returns to idle phase on onTextMessageEndEvent", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onTextMessageStartEvent?.();
    });
    expect(screen.getByTestId("phase").textContent).toBe("streaming");

    act(() => {
      handlers.onTextMessageEndEvent?.();
    });

    expect(screen.getByTestId("phase").textContent).toBe("idle");
    expect(screen.getByTestId("isRunning").textContent).toBe("true");
  });

  it("resets to full idle on onRunFinalized", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onTextMessageStartEvent?.();
    });
    expect(screen.getByTestId("isRunning").textContent).toBe("true");

    act(() => {
      handlers.onRunFinalized?.();
    });

    expect(screen.getByTestId("phase").textContent).toBe("idle");
    expect(screen.getByTestId("isRunning").textContent).toBe("false");
    expect(screen.getByTestId("toolName").textContent).toBe("null");
    expect(screen.getByTestId("toolCallId").textContent).toBe("null");
  });

  it("resets to full idle on onRunFailed", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "failingTool", toolCallId: "call-999" },
      });
    });
    expect(screen.getByTestId("isRunning").textContent).toBe("true");
    expect(screen.getByTestId("toolName").textContent).toBe("failingTool");

    act(() => {
      handlers.onRunFailed?.();
    });

    expect(screen.getByTestId("phase").textContent).toBe("idle");
    expect(screen.getByTestId("isRunning").textContent).toBe("false");
    expect(screen.getByTestId("toolName").textContent).toBe("null");
    expect(screen.getByTestId("toolCallId").textContent).toBe("null");
  });

  it("handles rapid phase transitions correctly", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onReasoningStartEvent?.();
      handlers.onReasoningEndEvent?.();
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "search", toolCallId: "call-1" },
      });
      handlers.onToolCallEndEvent?.();
      handlers.onTextMessageStartEvent?.();
    });

    expect(screen.getByTestId("phase").textContent).toBe("streaming");
    expect(screen.getByTestId("isRunning").textContent).toBe("true");
    expect(screen.getByTestId("toolName").textContent).toBe("null");
  });

  it("ignores out-of-order reasoning end when in tool_calling phase", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "search", toolCallId: "call-1" },
      });
    });
    expect(screen.getByTestId("phase").textContent).toBe("tool_calling");

    // A stale reasoning end should not knock us out of tool_calling
    act(() => {
      handlers.onReasoningEndEvent?.();
    });
    expect(screen.getByTestId("phase").textContent).toBe("tool_calling");
    expect(screen.getByTestId("toolName").textContent).toBe("search");
  });

  it("ignores out-of-order text message end when in reasoning phase", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onReasoningStartEvent?.();
    });
    expect(screen.getByTestId("phase").textContent).toBe("reasoning");

    act(() => {
      handlers.onTextMessageEndEvent?.();
    });
    expect(screen.getByTestId("phase").textContent).toBe("reasoning");
  });

  it("ignores out-of-order tool call end when in streaming phase", () => {
    render(<Harness />);

    act(() => {
      handlers.onRunInitialized?.();
      handlers.onTextMessageStartEvent?.();
    });
    expect(screen.getByTestId("phase").textContent).toBe("streaming");

    act(() => {
      handlers.onToolCallEndEvent?.();
    });
    expect(screen.getByTestId("phase").textContent).toBe("streaming");
  });

  it("re-subscribes when agent instance changes", () => {
    const { rerender } = render(<Harness />);
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    const newSubscribeMock = vi.fn((nextHandlers: SubscriptionHandlers) => {
      handlers = nextHandlers;
      return { unsubscribe: unsubscribeMock };
    });
    const newMockAgent = { subscribe: newSubscribeMock, id: "new-agent" };
    mockUseAgent.mockReturnValue({ agent: newMockAgent });

    rerender(<Harness agentId="new-agent" />);

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(newSubscribeMock).toHaveBeenCalledTimes(1);
  });
});
