import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useAgent, UseAgentUpdate } from "../use-agent";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkitnext/core";

vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

type SubscriptionHandlers = {
  onRunInitialized?: (...args: unknown[]) => void;
  onRunFinalized?: (...args: unknown[]) => void;
  onRunFailed?: (...args: unknown[]) => void;
  onReasoningStartEvent?: () => void;
  onReasoningEndEvent?: () => void;
  onToolCallStartEvent?: (payload: {
    event: { toolCallName: string; toolCallId: string };
  }) => void;
  onToolCallEndEvent?: () => void;
  onTextMessageStartEvent?: () => void;
  onTextMessageEndEvent?: () => void;
};

describe("useAgent streamingStatus", () => {
  let subscribeMock: ReturnType<typeof vi.fn>;
  let unsubscribeMock: ReturnType<typeof vi.fn>;
  let handlers: SubscriptionHandlers;

  beforeEach(() => {
    handlers = {};
    unsubscribeMock = vi.fn();
    subscribeMock = vi.fn((nextHandlers: SubscriptionHandlers) => {
      handlers = nextHandlers;
      return { unsubscribe: unsubscribeMock };
    });

    const mockAgent = {
      subscribe: subscribeMock,
      agentId: "test-agent",
      threadId: "thread-1",
      isRunning: false,
      runAgent: vi.fn(),
      description: "test",
    };

    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        getAgent: () => mockAgent,
        runtimeUrl: "http://localhost:3000/api/copilotkit",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        runtimeTransport: "rest",
        headers: {},
        agents: { "test-agent": mockAgent },
      },
      executingToolCallIds: new Set(),
    });
  });

  function Harness({ updates }: { updates?: UseAgentUpdate[] }) {
    const { streamingStatus } = useAgent({
      agentId: "test-agent",
      updates,
    });
    return (
      <div
        data-testid="status"
        data-phase={streamingStatus.phase}
        data-running={String(streamingStatus.isRunning)}
        data-tool={streamingStatus.toolName ?? ""}
        data-toolcallid={streamingStatus.toolCallId ?? ""}
      >
        {streamingStatus.phase}|{String(streamingStatus.isRunning)}|
        {streamingStatus.toolName ?? "null"}
      </div>
    );
  }

  it("starts with idle phase and isRunning false", () => {
    render(<Harness />);
    const el = screen.getByTestId("status");
    expect(el.dataset.phase).toBe("idle");
    expect(el.dataset.running).toBe("false");
    expect(el.dataset.tool).toBe("");
  });

  it("subscribes on mount and unsubscribes on unmount", () => {
    const { unmount } = render(<Harness />);
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(handlers.onReasoningStartEvent).toBeTypeOf("function");
    expect(handlers.onToolCallStartEvent).toBeTypeOf("function");
    expect(handlers.onTextMessageStartEvent).toBeTypeOf("function");

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("transitions to isRunning=true on onRunInitialized", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    const el = screen.getByTestId("status");
    expect(el.dataset.running).toBe("true");
    expect(el.dataset.phase).toBe("idle");
  });

  it("transitions to reasoning phase on onReasoningStartEvent", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() => handlers.onReasoningStartEvent?.());
    expect(screen.getByTestId("status").dataset.phase).toBe("reasoning");
  });

  it("returns to idle on onReasoningEndEvent", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() => handlers.onReasoningStartEvent?.());
    act(() => handlers.onReasoningEndEvent?.());
    expect(screen.getByTestId("status").dataset.phase).toBe("idle");
  });

  it("transitions to tool_calling with toolName on onToolCallStartEvent", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() =>
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "sayHello", toolCallId: "tc-123" },
      }),
    );
    const el = screen.getByTestId("status");
    expect(el.dataset.phase).toBe("tool_calling");
    expect(el.dataset.tool).toBe("sayHello");
    expect(el.dataset.toolcallid).toBe("tc-123");
  });

  it("clears toolName and returns to idle on onToolCallEndEvent", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() =>
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "sayHello", toolCallId: "tc-123" },
      }),
    );
    act(() => handlers.onToolCallEndEvent?.());
    const el = screen.getByTestId("status");
    expect(el.dataset.phase).toBe("idle");
    expect(el.dataset.tool).toBe("");
    expect(el.dataset.toolcallid).toBe("");
  });

  it("transitions to streaming on onTextMessageStartEvent", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() => handlers.onTextMessageStartEvent?.());
    expect(screen.getByTestId("status").dataset.phase).toBe("streaming");
  });

  it("returns to idle on onTextMessageEndEvent", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() => handlers.onTextMessageStartEvent?.());
    act(() => handlers.onTextMessageEndEvent?.());
    expect(screen.getByTestId("status").dataset.phase).toBe("idle");
  });

  it("resets to full idle on onRunFinalized", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() => handlers.onReasoningStartEvent?.());
    act(() => handlers.onRunFinalized?.());
    const el = screen.getByTestId("status");
    expect(el.dataset.phase).toBe("idle");
    expect(el.dataset.running).toBe("false");
  });

  it("resets to full idle on onRunFailed", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() =>
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "fetch", toolCallId: "tc-999" },
      }),
    );
    act(() => handlers.onRunFailed?.());
    const el = screen.getByTestId("status");
    expect(el.dataset.phase).toBe("idle");
    expect(el.dataset.running).toBe("false");
    expect(el.dataset.tool).toBe("");
  });

  it("does not subscribe to phase events when OnStreamingPhaseChanged is excluded", () => {
    render(
      <Harness
        updates={[
          UseAgentUpdate.OnMessagesChanged,
          UseAgentUpdate.OnRunStatusChanged,
        ]}
      />,
    );
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    const registeredHandlers = subscribeMock.mock
      .calls[0]?.[0] as SubscriptionHandlers;
    expect(registeredHandlers.onReasoningStartEvent).toBeUndefined();
    expect(registeredHandlers.onToolCallStartEvent).toBeUndefined();
    expect(registeredHandlers.onTextMessageStartEvent).toBeUndefined();
  });

  it("clears toolName when transitioning from tool_calling to reasoning", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() =>
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "fetch", toolCallId: "tc-789" },
      }),
    );
    expect(screen.getByTestId("status").dataset.tool).toBe("fetch");

    act(() => handlers.onReasoningStartEvent?.());

    const el = screen.getByTestId("status");
    expect(el.dataset.phase).toBe("reasoning");
    expect(el.dataset.tool).toBe("");
    expect(el.dataset.toolcallid).toBe("");
  });

  it("clears toolName when transitioning from tool_calling to streaming", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() =>
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "search", toolCallId: "tc-abc" },
      }),
    );
    expect(screen.getByTestId("status").dataset.tool).toBe("search");

    act(() => handlers.onTextMessageStartEvent?.());

    const el = screen.getByTestId("status");
    expect(el.dataset.phase).toBe("streaming");
    expect(el.dataset.tool).toBe("");
    expect(el.dataset.toolcallid).toBe("");
  });

  it("ignores out-of-order reasoning end while in tool_calling phase", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() =>
      handlers.onToolCallStartEvent?.({
        event: { toolCallName: "fetch", toolCallId: "tc-456" },
      }),
    );
    const elBefore = screen.getByTestId("status");
    expect(elBefore.dataset.phase).toBe("tool_calling");
    expect(elBefore.dataset.tool).toBe("fetch");

    act(() => handlers.onReasoningEndEvent?.());

    const elAfter = screen.getByTestId("status");
    expect(elAfter.dataset.phase).toBe("tool_calling");
    expect(elAfter.dataset.tool).toBe("fetch");
  });

  it("ignores out-of-order tool call end while in streaming phase", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() => handlers.onTextMessageStartEvent?.());
    const elBefore = screen.getByTestId("status");
    expect(elBefore.dataset.phase).toBe("streaming");

    act(() => handlers.onToolCallEndEvent?.());

    const elAfter = screen.getByTestId("status");
    expect(elAfter.dataset.phase).toBe("streaming");
  });

  it("ignores out-of-order text message end while in idle phase", () => {
    render(<Harness />);
    act(() => handlers.onRunInitialized?.());
    act(() => handlers.onTextMessageStartEvent?.());
    act(() => handlers.onTextMessageEndEvent?.());
    const elBefore = screen.getByTestId("status");
    expect(elBefore.dataset.phase).toBe("idle");

    act(() => handlers.onTextMessageEndEvent?.());

    const elAfter = screen.getByTestId("status");
    expect(elAfter.dataset.phase).toBe("idle");
  });
});
