import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadRestoreError } from "@copilotkit/core";
import type { ThreadRestoreState } from "@copilotkit/core";
import { useThreadRestore } from "../use-thread-restore";

const useAgent = vi.fn();

vi.mock("../use-agent", () => ({
  useAgent: (...args: unknown[]) => useAgent(...args),
}));

function createRestoreAwareAgent(initialState: ThreadRestoreState) {
  let state = initialState;
  const listeners = new Set<() => void>();
  const forceFullRestore = vi.fn(async () => {});

  return {
    getThreadRestoreState: () => state,
    subscribeToThreadRestore: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    forceFullRestore,
    setState(nextState: ThreadRestoreState) {
      state = nextState;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("useThreadRestore", () => {
  beforeEach(() => {
    useAgent.mockReset();
  });

  it("subscribes to the agent restore store and exposes progress", () => {
    const agent = createRestoreAwareAgent({
      status: "ready",
      threadId: "thread-1",
    });
    useAgent.mockReturnValue({ agent, isReady: true });

    const { result } = renderHook(() =>
      useThreadRestore({ agentId: "research" }),
    );

    expect(useAgent).toHaveBeenCalledWith({ agentId: "research", updates: [] });
    expect(result.current).toMatchObject({
      status: "ready",
      threadId: "thread-1",
    });

    act(() => {
      agent.setState({
        status: "restoring",
        threadId: "thread-1",
        restoreAttemptId: "restore-1",
        elapsedMs: 5_000,
      });
    });

    expect(result.current).toMatchObject({
      status: "restoring",
      restoreAttemptId: "restore-1",
      elapsedMs: 5_000,
    });
  });

  it("exposes a typed failed state and delegates reloadConversation", async () => {
    const error = new ThreadRestoreError({
      restoreAttemptId: "restore-support-123",
      code: "timeout",
      retryable: true,
      retryAction: "reload_conversation",
    });
    const agent = createRestoreAwareAgent({
      status: "failed",
      threadId: "thread-1",
      restoreAttemptId: error.restoreAttemptId,
      error,
    });
    useAgent.mockReturnValue({ agent, isReady: true });

    const { result } = renderHook(() => useThreadRestore());

    expect(result.current).toMatchObject({ status: "failed", error });
    await act(() => result.current.reloadConversation());
    expect(agent.forceFullRestore).toHaveBeenCalledTimes(1);
  });

  it("treats agents without restore support as ready", () => {
    useAgent.mockReturnValue({
      agent: { threadId: "legacy-thread" },
      isReady: true,
    });

    const { result } = renderHook(() => useThreadRestore());

    expect(result.current).toMatchObject({
      status: "ready",
      threadId: "legacy-thread",
    });
  });

  it("stabilizes equivalent snapshots from pre-delegate proxy agents", () => {
    useAgent.mockReturnValue({
      agent: {
        threadId: "proxy-thread",
        getThreadRestoreState: () => ({
          status: "ready" as const,
          threadId: "proxy-thread",
        }),
        subscribeToThreadRestore: () => () => {},
        forceFullRestore: vi.fn(),
      },
      isReady: false,
    });

    const { result } = renderHook(() => useThreadRestore());

    expect(result.current).toMatchObject({
      status: "ready",
      threadId: "proxy-thread",
    });
  });
});
