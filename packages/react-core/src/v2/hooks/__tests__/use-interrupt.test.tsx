import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInterrupt } from "../use-interrupt";
import { useCopilotKit } from "../../context";
import { useAgent } from "../use-agent";

vi.mock("../../context", () => ({
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

  it("resolve resumes agent with response payload and keeps card mounted until run starts", () => {
    // The card MUST stay mounted across resolve() so the resume-run's first
    // tokens stream into the interrupt UI; onRunStartedEvent (fired by the
    // resume run) is the legitimate clear path. Previously the hook
    // synchronously cleared pendingEvent inside resolve, which forced
    // consumers to wrap resolve() in a 500ms setTimeout to keep the card
    // mounted long enough.
    render(<Harness renderInChat={false} />);

    emitInterrupt("approve-me");
    act(() => {
      screen.getByTestId("interrupt").click();
    });

    // Card still mounted — the resume run will clear it via onRunStartedEvent.
    expect(screen.queryByTestId("interrupt")).not.toBeNull();
    expect(runAgentMock).toHaveBeenCalledTimes(1);
    expect(runAgentMock).toHaveBeenCalledWith({
      agent: mockAgent,
      forwardedProps: {
        command: {
          resume: { approved: true, value: "approve-me" },
          interruptEvent: "approve-me",
        },
      },
    });

    // Once the resume run actually starts, the card unmounts.
    act(() => {
      handlers.onRunStartedEvent?.();
    });
    expect(screen.queryByTestId("interrupt")).toBeNull();
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

  it("renders the second interrupt card in the same thread", async () => {
    // Reproduces the 2nd-interrupt bug: in a single thread, after resolving
    // the first interrupt and a new run completes with another interrupt,
    // the chat subscriber must latch a NON-null element carrying the 2nd
    // interrupt's value. The bug is the publish effect's cleanup pushing
    // null on every dep churn (config.render is a new identity every render),
    // so the LAST publish observed by the chat subscriber after the 2nd
    // interrupt arrives is `null` rather than the new element.
    //
    // We simulate the real consumer pattern: an inline render lambda whose
    // identity changes on every parent render. We force extra parent renders
    // after the 2nd interrupt arrives so the publish effect's cleanup runs
    // AFTER the last non-null publish (which is what unmounts the card in
    // production).
    function BugHarness() {
      const [, setNonce] = React.useState(0);
      // Expose a way to force re-renders to mimic parent re-rendering after
      // the interrupt has been published.
      (globalThis as { __forceRerender?: () => void }).__forceRerender = () =>
        setNonce((n) => n + 1);

      useInterrupt({
        // Inline render lambda → new identity every render.
        render: ({ event, resolve }) => (
          <button
            data-testid="interrupt"
            onClick={() => resolve({ approved: true, value: event.value })}
          >
            {String(event.value)}
          </button>
        ),
      });
      return <div />;
    }

    const { unmount } = render(<BugHarness />);

    // --- Interrupt #1 ---
    act(() => {
      handlers.onCustomEvent?.({
        event: { name: "on_interrupt", value: "first" },
      });
      handlers.onRunFinalized?.();
    });

    await waitFor(() => {
      const last1 = setInterruptElementMock.mock.calls.at(-1)?.[0];
      expect(last1).not.toBeNull();
      expect(React.isValidElement(last1)).toBe(true);
    });

    // Resolve the first interrupt (mimic clicking the card's resolve button).
    const firstElement = setInterruptElementMock.mock.calls
      .map((c) => c[0])
      .filter((el) => el != null)
      .at(-1) as React.ReactElement<{ onClick: () => void }>;
    act(() => {
      firstElement.props.onClick();
    });

    // --- Resume run starts + 2nd interrupt arrives in same thread ---
    act(() => {
      handlers.onRunStartedEvent?.();
    });
    act(() => {
      handlers.onCustomEvent?.({
        event: { name: "on_interrupt", value: "second" },
      });
      handlers.onRunFinalized?.();
    });

    // Force a parent re-render AFTER the 2nd interrupt published. This
    // mimics a parent component re-rendering (e.g. due to chat-subscriber
    // state churn) while the interrupt is still pending. With the bug,
    // config.render's new identity causes the element memo to recompute,
    // which re-runs the publish effect — and its cleanup pushes a stale
    // `null` AFTER the latest non-null element, leaving the chat subscriber
    // latched to null. The card never mounts.
    act(() => {
      (globalThis as { __forceRerender?: () => void }).__forceRerender?.();
    });

    // After all renders settle, the chat subscriber must LAST see a non-null
    // element carrying the 2nd interrupt's value.
    await waitFor(() => {
      const last = setInterruptElementMock.mock.calls.at(-1)?.[0];
      expect(last).not.toBeNull();
      expect(React.isValidElement(last)).toBe(true);
      const el = last as React.ReactElement<{ children: React.ReactNode }>;
      expect(String(el.props.children)).toContain("second");
    });

    // Stronger assertion: after the 2nd interrupt finalized, NO publish call
    // should clear the element to null. The publish effect must not nullify
    // on dep churn — only on true unmount (covered separately).
    const callsAfterSecondFinalize = setInterruptElementMock.mock.calls
      .map((c, i) => ({ value: c[0], index: i }))
      .filter((c) => {
        if (c.value == null) return false;
        const el = c.value as React.ReactElement<{
          children: React.ReactNode;
        }>;
        return String(el.props.children).includes("second");
      });
    const firstSecondIdx = callsAfterSecondFinalize[0]?.index ?? -1;
    expect(firstSecondIdx).toBeGreaterThanOrEqual(0);
    const tail = setInterruptElementMock.mock.calls
      .slice(firstSecondIdx)
      .map((c) => c[0]);
    expect(tail.some((v) => v === null)).toBe(false);

    unmount();
  });
});
