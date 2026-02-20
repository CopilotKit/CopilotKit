import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInterrupt } from "../use-interrupt";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useAgent } from "../use-agent";

vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../use-agent", () => ({
  useAgent: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseAgent = useAgent as ReturnType<typeof vi.fn>;

type SubscriptionHandlers = {
  onCustomEvent?: (payload: {
    event: { name: string; value: unknown };
  }) => void;
  onRunStartedEvent?: () => void;
  onRunFinalized?: () => void;
  onRunFailed?: () => void;
};

describe("useInterrupt", () => {
  let runAgentMock: ReturnType<typeof vi.fn>;
  let setInterruptElementMock: ReturnType<typeof vi.fn>;
  let unsubscribeMock: ReturnType<typeof vi.fn>;
  let subscribeMock: ReturnType<typeof vi.fn>;
  let handlers: SubscriptionHandlers;
  let mockAgent: Record<string, unknown>;

  beforeEach(() => {
    runAgentMock = vi.fn();
    setInterruptElementMock = vi.fn();
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

    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runAgent: runAgentMock,
        setInterruptElement: setInterruptElementMock,
      },
    });

    mockUseAgent.mockReturnValue({ agent: mockAgent });
  });

  function Harness({
    enabled,
    handler,
    renderInChat,
    renderSpy,
  }: {
    enabled?: (event: { name: string; value: unknown }) => boolean;
    handler?: (props: {
      event: { name: string; value: unknown };
      resolve: (response: unknown) => void;
    }) => unknown;
    renderInChat?: boolean;
    renderSpy?: ReturnType<typeof vi.fn>;
  }) {
    const renderInterrupt = ({
      event,
      result,
      resolve,
    }: {
      event: { name: string; value: unknown };
      result: unknown;
      resolve: (response: unknown) => void;
    }) => {
      renderSpy?.({ event, result, resolve });
      return (
        <button
          data-testid="interrupt"
          onClick={() => resolve({ approved: true, value: event.value })}
        >
          {String(result ?? "no-result")}:{String(event.value)}
        </button>
      );
    };

    if (renderInChat === false) {
      return (
        <ManualHarness
          enabled={enabled}
          handler={handler}
          render={renderInterrupt}
        />
      );
    }

    return (
      <ChatHarness
        enabled={enabled}
        handler={handler}
        render={renderInterrupt}
      />
    );
  }

  function ManualHarness({
    enabled,
    handler,
    render,
  }: {
    enabled?: (event: { name: string; value: unknown }) => boolean;
    handler?: (props: {
      event: { name: string; value: unknown };
      resolve: (response: unknown) => void;
    }) => unknown;
    render: (props: {
      event: { name: string; value: unknown };
      result: unknown;
      resolve: (response: unknown) => void;
    }) => React.ReactElement;
  }) {
    const element = useInterrupt({
      enabled,
      handler,
      renderInChat: false,
      render,
    });

    return <div data-testid="manual-container">{element}</div>;
  }

  function ChatHarness({
    enabled,
    handler,
    render,
  }: {
    enabled?: (event: { name: string; value: unknown }) => boolean;
    handler?: (props: {
      event: { name: string; value: unknown };
      resolve: (response: unknown) => void;
    }) => unknown;
    render: (props: {
      event: { name: string; value: unknown };
      result: unknown;
      resolve: (response: unknown) => void;
    }) => React.ReactElement;
  }) {
    useInterrupt({
      enabled,
      handler,
      render,
    });

    return <div data-testid="manual-container" />;
  }

  function emitInterrupt(value: unknown) {
    act(() => {
      handlers.onCustomEvent?.({
        event: { name: "on_interrupt", value },
      });
      handlers.onRunFinalized?.();
    });
  }

  it("subscribes on mount and unsubscribes on unmount", () => {
    const { unmount } = render(<Harness renderInChat={false} />);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(handlers.onCustomEvent).toBeTypeOf("function");
    expect(handlers.onRunStartedEvent).toBeTypeOf("function");
    expect(handlers.onRunFinalized).toBeTypeOf("function");
    expect(handlers.onRunFailed).toBeTypeOf("function");

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("ignores non-interrupt custom events", () => {
    render(<Harness renderInChat={false} />);

    act(() => {
      handlers.onCustomEvent?.({
        event: { name: "not_interrupt", value: "x" },
      });
      handlers.onRunFinalized?.();
    });

    expect(screen.queryByTestId("interrupt")).toBeNull();
  });

  it("renders interrupt only after run finalized", () => {
    render(<Harness renderInChat={false} />);

    act(() => {
      handlers.onCustomEvent?.({
        event: { name: "on_interrupt", value: "pending" },
      });
    });
    expect(screen.queryByTestId("interrupt")).toBeNull();

    act(() => {
      handlers.onRunFinalized?.();
    });
    expect(screen.getByTestId("interrupt").textContent).toContain("pending");
  });

  it("clears pending interrupt on run start", () => {
    render(<Harness renderInChat={false} />);

    emitInterrupt("first");
    expect(screen.getByTestId("interrupt").textContent).toContain("first");

    act(() => {
      handlers.onRunStartedEvent?.();
    });

    expect(screen.queryByTestId("interrupt")).toBeNull();
  });

  it("resolve clears UI and resumes agent with response payload", () => {
    render(<Harness renderInChat={false} />);

    emitInterrupt("approve-me");
    act(() => {
      screen.getByTestId("interrupt").click();
    });

    expect(screen.queryByTestId("interrupt")).toBeNull();
    expect(runAgentMock).toHaveBeenCalledTimes(1);
    expect(runAgentMock).toHaveBeenCalledWith({
      agent: mockAgent,
      forwardedProps: {
        command: {
          resume: { approved: true, value: "approve-me" },
        },
      },
    });
  });

  it("does not render and does not run handler when enabled returns false", () => {
    const handler = vi.fn(() => "should-not-run");
    render(
      <Harness renderInChat={false} enabled={() => false} handler={handler} />,
    );

    emitInterrupt("blocked");

    expect(screen.queryByTestId("interrupt")).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("renders with null result when no handler is provided", () => {
    render(<Harness renderInChat={false} />);

    emitInterrupt("no-handler");

    expect(screen.getByTestId("interrupt").textContent).toContain(
      "no-result:no-handler",
    );
  });

  it("uses sync handler result in render", () => {
    render(
      <Harness
        renderInChat={false}
        handler={({ event }) => `handled:${String(event.value)}`}
      />,
    );

    emitInterrupt("sync");

    expect(screen.getByTestId("interrupt").textContent).toContain(
      "handled:sync",
    );
  });

  it("uses async handler resolved value in render", async () => {
    render(
      <Harness
        renderInChat={false}
        handler={({ event }) => Promise.resolve(`async:${String(event.value)}`)}
      />,
    );

    emitInterrupt("value");

    await waitFor(() => {
      expect(screen.getByTestId("interrupt").textContent).toContain(
        "async:value",
      );
    });
  });

  it("falls back to null result when async handler rejects", async () => {
    render(
      <Harness
        renderInChat={false}
        handler={() => Promise.reject(new Error("boom"))}
      />,
    );

    emitInterrupt("reject");

    await waitFor(() => {
      expect(screen.getByTestId("interrupt").textContent).toContain(
        "no-result:reject",
      );
    });
  });

  it("accepts thenable handler results (non-native Promise)", async () => {
    const thenable = {
      then: (resolve: (value: string) => void) => {
        resolve("thenable-ok");
        return { catch: () => undefined };
      },
    };

    render(<Harness renderInChat={false} handler={() => thenable} />);

    emitInterrupt("thenable");

    await waitFor(() => {
      expect(screen.getByTestId("interrupt").textContent).toContain(
        "thenable-ok:thenable",
      );
    });
  });

  it("publishes interrupt element to chat by default and clears on unmount", async () => {
    const renderSpy = vi.fn();
    const { unmount } = render(<Harness renderSpy={renderSpy} />);

    emitInterrupt("chat");

    await waitFor(() => {
      expect(renderSpy).toHaveBeenCalled();
      expect(setInterruptElementMock).toHaveBeenCalled();
    });

    const latestCallArg = setInterruptElementMock.mock.calls.at(-1)?.[0];
    expect(React.isValidElement(latestCallArg)).toBe(true);

    unmount();
    expect(setInterruptElementMock.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("does not publish to chat and returns manual element when renderInChat is false", () => {
    render(<Harness renderInChat={false} />);

    emitInterrupt("manual");

    expect(screen.getByTestId("interrupt").textContent).toContain("manual");
    expect(setInterruptElementMock).not.toHaveBeenCalled();
  });

  it("discards local interrupt when run fails before finalize", () => {
    render(<Harness renderInChat={false} />);

    act(() => {
      handlers.onCustomEvent?.({
        event: { name: "on_interrupt", value: "lost" },
      });
      handlers.onRunFailed?.();
      handlers.onRunFinalized?.();
    });

    expect(screen.queryByTestId("interrupt")).toBeNull();
  });

  it("keeps the latest interrupt when multiple interrupts arrive within one run", () => {
    render(<Harness renderInChat={false} />);

    act(() => {
      handlers.onCustomEvent?.({
        event: { name: "on_interrupt", value: "first" },
      });
      handlers.onCustomEvent?.({
        event: { name: "on_interrupt", value: "second" },
      });
      handlers.onRunFinalized?.();
    });

    expect(screen.getByTestId("interrupt").textContent).toContain("second");
  });
});
