import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInterrupt } from "../use-interrupt";
import { useCopilotKit } from "../../context";
import { useAgent } from "../use-agent";
import type { Interrupt } from "@ag-ui/client";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../use-agent", () => ({
  useAgent: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseAgent = useAgent as ReturnType<typeof vi.fn>;

type RunFinishedParams =
  | { outcome: "success"; result?: unknown }
  | { outcome: "interrupt"; interrupts: Interrupt[] };

type SubscriptionHandlers = {
  onCustomEvent?: (payload: {
    event: { name: string; value: unknown };
  }) => void;
  onRunStartedEvent?: () => void;
  onRunFinishedEvent?: (params: RunFinishedParams) => void;
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
      pendingInterrupts: [] as Interrupt[],
      addMessage: vi.fn(),
    };

    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runAgent: runAgentMock,
        setInterruptElement: setInterruptElementMock,
      },
    });

    mockUseAgent.mockReturnValue({ agent: mockAgent });
  });

  afterEach(() => {
    // F21: clean up the test-only global installed by the 2nd-interrupt
    // BugHarness so it cannot leak across tests.
    delete (globalThis as { __forceRerender?: () => void }).__forceRerender;
    runAgentMock.mockReset();
  });

  // oxlint-disable-next-line unicorn/consistent-function-scoping
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
    render: renderFn,
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
      render: renderFn,
    });

    return <div data-testid="manual-container">{element}</div>;
  }

  function ChatHarness({
    enabled,
    handler,
    render: renderFn,
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
      render: renderFn,
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
    // oxlint-disable unicorn/no-thenable -- intentionally testing thenable (non-native Promise) behavior
    const thenable = {
      then: (resolve: (value: string) => void) => {
        resolve("thenable-ok");
        return { catch: () => undefined };
      },
    };
    // oxlint-enable unicorn/no-thenable

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

  it("falls back to null result when sync handler throws (no crash)", () => {
    // F3: a synchronous throw from the consumer's handler must NOT escape the
    // hook's effect and crash the React tree. The JSDoc on `handler` states
    // "Rejecting/throwing falls back to `result = null`" — this enforces the
    // sync branch matches the documented contract.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn(() => {
      throw new Error("sync-boom");
    });

    expect(() => {
      render(<Harness renderInChat={false} handler={handler} />);
      emitInterrupt("sync-throw");
    }).not.toThrow();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("interrupt").textContent).toContain(
      "no-result:sync-throw",
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs and falls back to null when async handler rejects", async () => {
    // F3 (companion): the async rejection path was previously swallowed
    // silently. It must log via console.error so the failure is diagnosable
    // while still honoring the documented null-fallback.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Harness
        renderInChat={false}
        handler={() => Promise.reject(new Error("async-boom"))}
      />,
    );

    emitInterrupt("async-throw");

    await waitFor(() => {
      expect(screen.getByTestId("interrupt").textContent).toContain(
        "no-result:async-throw",
      );
    });

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("runs handler exactly once when resolve identity changes mid-interrupt", () => {
    // F4: the handler effect must not re-invoke the consumer handler when
    // only `resolve`'s identity churns (e.g. because the underlying agent or
    // copilotkit reference changes). Pin the handler effect to `pendingEvent`
    // so a single interrupt → a single handler invocation, regardless of how
    // many times resolve's identity flips while the interrupt is pending.
    const handler = vi.fn(({ event }) => `handled:${String(event.value)}`);

    // We render twice with two different `agent` identities. The second
    // useAgent return updates the mock so `resolve` (deps: [agent, copilotkit])
    // gets a new identity. The handler effect must NOT re-run for the same
    // pendingEvent.
    const agentA = { ...mockAgent, id: "agent-a" };
    const agentB = { ...mockAgent, id: "agent-b" };
    mockUseAgent.mockReturnValue({ agent: agentA });

    const { rerender } = render(
      <Harness renderInChat={false} handler={handler} />,
    );

    emitInterrupt("once");
    expect(handler).toHaveBeenCalledTimes(1);

    // Swap the agent identity to churn resolve's identity, then re-render.
    mockUseAgent.mockReturnValue({ agent: agentB });
    act(() => {
      rerender(<Harness renderInChat={false} handler={handler} />);
    });

    // pendingEvent unchanged → handler must NOT fire again.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("treats interrupt as disabled when enabled predicate throws", () => {
    // F5: a throwing enabled predicate must NOT crash the tree at either
    // call site (handler effect or element memo). On throw the interrupt is
    // treated as disabled — no handler invocation, no element rendered.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn(() => "should-not-run");
    const enabled = vi.fn(() => {
      throw new Error("predicate-boom");
    });

    expect(() => {
      render(
        <Harness renderInChat={false} enabled={enabled} handler={handler} />,
      );
      emitInterrupt("filtered");
    }).not.toThrow();

    expect(handler).not.toHaveBeenCalled();
    expect(screen.queryByTestId("interrupt")).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // RESUME-PATH regression: `resolve()` MUST return a Promise that settles
  // only when the underlying `copilotkit.runAgent` call settles. Callers
  // (e.g. the showcase `interrupt-headless` demo's `useHeadlessInterrupt`,
  // or any consumer that wants to chain post-resume UI like the harness
  // DOM settle-check for the confirmation bubble) cannot sequence against
  // the resume run otherwise. The showcase quarantine of `interrupt-headless`
  // cites exactly this failure mode: backend resumes + streams (HTTP 200),
  // but downstream observers can't tell when the resume has actually
  // landed because resolve() returns void instead of a Promise.
  it("resolve returns a Promise that settles when runAgent settles (RESUME-PATH)", async () => {
    // Make runAgent return a manually-controlled promise so we can assert
    // resolve() awaits it rather than fire-and-forget.
    let releaseRunAgent: ((result: { newMessages: never[] }) => void) | null =
      null;
    runAgentMock.mockImplementation(
      () =>
        new Promise((res) => {
          releaseRunAgent = res;
        }),
    );

    let capturedResolve: ((response: unknown) => unknown) | null = null;
    function CaptureHarness() {
      useInterrupt({
        renderInChat: false,
        render: ({ event, resolve }) => {
          capturedResolve = resolve;
          return <button data-testid="interrupt">{String(event.value)}</button>;
        },
      });
      return <div />;
    }

    render(<CaptureHarness />);
    emitInterrupt("resume-me");

    // resolve must exist and must return a thenable.
    expect(capturedResolve).toBeTypeOf("function");
    const returnedFromResolve = capturedResolve!({ approved: true });
    expect(returnedFromResolve).toBeDefined();
    expect(
      returnedFromResolve &&
        typeof (returnedFromResolve as { then?: unknown }).then === "function",
    ).toBe(true);

    // runAgent was dispatched.
    expect(runAgentMock).toHaveBeenCalledTimes(1);

    // Race against a sentinel to assert the returned promise has NOT yet
    // settled (runAgent is still pending). Deterministic regardless of
    // internal microtask-chain depth.
    const before = await Promise.race([
      returnedFromResolve as Promise<unknown>,
      Promise.resolve("pending"),
    ]);
    expect(before).toBe("pending");

    // Settle the runAgent promise and deterministically await the
    // returned promise inside act() so React state updates flush.
    await act(async () => {
      releaseRunAgent!({ newMessages: [] });
      await returnedFromResolve;
    });

    // The returned promise must resolve with the runAgent result, not
    // just settle. A regression where resolve() returns a different
    // settled promise (or `undefined` cast as thenable) would otherwise
    // still pass.
    const value = await returnedFromResolve;
    expect(value).toEqual({ newMessages: [] });
  });

  // RESUME-PATH-REJECT regression (CR Round 3 Fix D): if `runAgent` rejects
  // synchronously / before the run actually starts (network error, auth
  // failure, validation reject), `onRunFailed` may never fire — meaning the
  // popup would stay mounted indefinitely. The framework `resolve` catch
  // MUST clear `pendingEvent` AND rethrow so callers see the error. This
  // test asserts both: rejection propagates, console.error fires, and the
  // popup unmounts (no `interrupt` test-id in the DOM).
  it("resolve rejects when runAgent rejects, logs the failure, and clears pending (RESUME-PATH-REJECT)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejection = new Error("boom");
    runAgentMock.mockImplementationOnce(() => Promise.reject(rejection));

    let capturedResolve: ((response: unknown) => unknown) | null = null;
    function RejectHarness() {
      const element = useInterrupt({
        renderInChat: false,
        render: ({ event, resolve }) => {
          capturedResolve = resolve;
          return <button data-testid="interrupt">{String(event.value)}</button>;
        },
      });
      return <div data-testid="reject-container">{element}</div>;
    }

    render(<RejectHarness />);
    emitInterrupt("reject-me");

    // The popup should currently be mounted (pending event was set).
    expect(screen.queryByTestId("interrupt")).not.toBeNull();
    expect(capturedResolve).toBeTypeOf("function");

    // Call resolve and await rejection inside act so React state flushes.
    const returnedFromResolve = capturedResolve!({
      approved: true,
    }) as Promise<unknown>;

    await act(async () => {
      await expect(returnedFromResolve).rejects.toBe(rejection);
    });

    expect(runAgentMock).toHaveBeenCalledTimes(1);

    // Console.error MUST have been called with the rejection (so callers
    // grepping logs can detect the failure even if they don't `await`).
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("runAgent rejected"),
      rejection,
    );

    // Popup MUST be unmounted — pendingEvent cleared by the catch.
    expect(screen.queryByTestId("interrupt")).toBeNull();

    errorSpy.mockRestore();
  });

  describe("AG-UI standard interrupts", () => {
    const INT: Interrupt = {
      id: "int-1",
      reason: "confirmation",
      message: "Approve?",
    };

    function StandardHarness({
      renderSpy,
    }: {
      renderSpy: ReturnType<typeof vi.fn>;
    }) {
      const element = useInterrupt({
        renderInChat: false,
        render: ({ interrupt, interrupts, resolve, cancel }) => {
          renderSpy({ interrupt, interrupts, resolve, cancel });
          return (
            <div>
              <button
                data-testid="resolve"
                onClick={() => resolve({ ok: true })}
              >
                resolve
              </button>
              <button data-testid="cancel" onClick={() => cancel()}>
                cancel
              </button>
            </div>
          );
        },
      });
      return <div data-testid="standard-container">{element}</div>;
    }

    function fireStandardInterrupt(interrupts: Interrupt[]) {
      (mockAgent as any).pendingInterrupts = interrupts;
      act(() => {
        handlers.onRunStartedEvent?.();
      });
      act(() => {
        handlers.onRunFinishedEvent?.({ outcome: "interrupt", interrupts });
      });
      act(() => {
        handlers.onRunFinalized?.();
      });
    }

    it("surfaces the primary interrupt and full list from outcome:interrupt", () => {
      const renderSpy = vi.fn();
      render(<StandardHarness renderSpy={renderSpy} />);
      fireStandardInterrupt([INT]);

      const lastCall = renderSpy.mock.calls.at(-1)![0];
      expect(lastCall.interrupt).toEqual(INT);
      expect(lastCall.interrupts).toEqual([INT]);
    });

    it("resolve() resumes with a resolved ResumeEntry", async () => {
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });
      const renderSpy = vi.fn();
      render(<StandardHarness renderSpy={renderSpy} />);
      fireStandardInterrupt([INT]);

      await act(async () => {
        screen.getByTestId("resolve").click();
      });

      expect(runAgentMock).toHaveBeenCalledWith({
        agent: mockAgent,
        resume: [
          { interruptId: "int-1", status: "resolved", payload: { ok: true } },
        ],
      });
    });

    it("cancel() resumes with a cancelled ResumeEntry (no payload)", async () => {
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });
      const renderSpy = vi.fn();
      render(<StandardHarness renderSpy={renderSpy} />);
      fireStandardInterrupt([INT]);

      await act(async () => {
        screen.getByTestId("cancel").click();
      });

      expect(runAgentMock).toHaveBeenCalledWith({
        agent: mockAgent,
        resume: [{ interruptId: "int-1", status: "cancelled" }],
      });
    });

    it("persists a tool-result message on resolve so later turns stay well-formed", async () => {
      // A tool-backed interrupt (carries toolCallId). Resolving it must record
      // the result as a tool message in the thread — otherwise the next turn
      // ships a dangling tool call and the model loops on tool-calls.
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });
      const TOOL_INT: Interrupt = {
        id: "int-1",
        reason: "tool_approval",
        toolCallId: "tc-1",
      };
      const calls: any[] = [];
      function ToolHarness() {
        useInterrupt({
          render: ({ resolve }) => {
            calls.push(resolve);
            return <></>;
          },
        });
        return null;
      }
      render(<ToolHarness />);
      fireStandardInterrupt([TOOL_INT]);

      const resolve = calls.at(-1)!;
      await act(async () => {
        await resolve({ approved: true }, "int-1");
      });

      expect(mockAgent.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "tool",
          toolCallId: "tc-1",
          content: JSON.stringify({ approved: true }),
        }),
      );
      expect(runAgentMock).toHaveBeenCalledWith({
        agent: mockAgent,
        resume: [
          {
            interruptId: "int-1",
            status: "resolved",
            payload: { approved: true },
          },
        ],
      });
    });

    it("does not persist a tool message for a custom interrupt without toolCallId", async () => {
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });
      const calls: any[] = [];
      function NoToolHarness() {
        useInterrupt({
          render: ({ resolve }) => {
            calls.push(resolve);
            return <></>;
          },
        });
        return null;
      }
      render(<NoToolHarness />);
      fireStandardInterrupt([INT]); // INT has no toolCallId

      await act(async () => {
        await calls.at(-1)!({ ok: true });
      });

      expect(mockAgent.addMessage).not.toHaveBeenCalled();
      expect(runAgentMock).toHaveBeenCalled();
    });

    it("waits for all interrupts before resuming (multi-interrupt)", async () => {
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });
      const INT2: Interrupt = { id: "int-2", reason: "confirmation" };
      const calls: any[] = [];
      function MultiHarness() {
        useInterrupt({
          render: ({ resolve }) => {
            calls.push(resolve);
            return <></>;
          },
        });
        return null;
      }
      render(<MultiHarness />);
      fireStandardInterrupt([INT, INT2]);

      const resolve = calls.at(-1)!;
      await act(async () => {
        await resolve({ a: 1 }, "int-1");
      });
      expect(runAgentMock).not.toHaveBeenCalled();

      await act(async () => {
        await resolve({ b: 2 }, "int-2");
      });
      expect(runAgentMock).toHaveBeenCalledWith({
        agent: mockAgent,
        resume: [
          { interruptId: "int-1", status: "resolved", payload: { a: 1 } },
          { interruptId: "int-2", status: "resolved", payload: { b: 2 } },
        ],
      });
    });

    it("warns when resolve is called without interruptId while multiple interrupts are open", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const INT2: Interrupt = { id: "int-2", reason: "confirmation" };
      const calls: any[] = [];
      function WarnHarness() {
        useInterrupt({
          render: ({ resolve }) => {
            calls.push(resolve);
            return <></>;
          },
        });
        return null;
      }
      render(<WarnHarness />);
      fireStandardInterrupt([INT, INT2]);

      const resolve = calls.at(-1)!;
      // Call resolve without an interruptId while 2 interrupts are open.
      await act(async () => {
        await resolve({ a: 1 });
      });

      // Warning must have fired.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("2 interrupts are open"),
      );
      // Only primary addressed — runAgent must NOT have been called yet.
      expect(runAgentMock).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("does not resume an expired interrupt", async () => {
      const EXPIRED: Interrupt = {
        id: "int-x",
        reason: "confirmation",
        expiresAt: "2000-01-01T00:00:00.000Z",
      };
      const calls: any[] = [];
      function ExpiredHarness() {
        useInterrupt({
          render: ({ resolve }) => {
            calls.push(resolve);
            return <></>;
          },
        });
        return null;
      }
      render(<ExpiredHarness />);
      fireStandardInterrupt([EXPIRED]);

      await act(async () => {
        await calls.at(-1)!({ ok: true });
      });
      expect(runAgentMock).not.toHaveBeenCalled();
    });

    it("legacy on_interrupt path still resumes via forwardedProps.command", async () => {
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });
      const calls: any[] = [];
      function LegacyHarness() {
        useInterrupt({
          render: ({ event, resolve }) => {
            calls.push({ event, resolve });
            return <></>;
          },
        });
        return null;
      }
      render(<LegacyHarness />);
      act(() => handlers.onRunStartedEvent?.());
      act(() =>
        handlers.onCustomEvent?.({
          event: { name: "on_interrupt", value: "q?" },
        }),
      );
      act(() => handlers.onRunFinalized?.());

      await act(async () => {
        await calls.at(-1)!.resolve({ approved: true });
      });
      expect(runAgentMock).toHaveBeenCalledWith({
        agent: mockAgent,
        forwardedProps: {
          command: { resume: { approved: true }, interruptEvent: "q?" },
        },
      });
    });
  });
});
