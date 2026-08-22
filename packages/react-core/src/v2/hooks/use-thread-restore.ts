import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { isThreadRestoreAware } from "@copilotkit/core";
import type { ThreadRestoreState } from "@copilotkit/core";
import type { AbstractAgent } from "@ag-ui/client";
import { useAgent } from "./use-agent";

export type UseThreadRestoreResult = ThreadRestoreState & {
  /**
   * Clears the failed restore cursor, requests a fresh credential, and
   * reconnects the current conversation from its complete retained history.
   * Concurrent calls share the same in-flight recovery in core.
   */
  reloadConversation: () => Promise<void>;
};

export interface UseThreadRestoreOptions {
  /** Agent to observe. Falls back to the surrounding chat configuration. */
  agentId?: string;
}

/**
 * Observes the current agent's thread-restore lifecycle.
 *
 * Agents that do not implement reliable restore are reported as `ready`, so
 * custom interfaces remain compatible with older runtimes and non-Intelligence
 * agents.
 */
export function useThreadRestore(
  options: UseThreadRestoreOptions = {},
): UseThreadRestoreResult {
  const { agent } = useAgent({ agentId: options.agentId, updates: [] });
  return useThreadRestoreForAgent(agent);
}

/** @internal Reuses an agent already resolved by a composed component. */
export function useThreadRestoreForAgent(
  agent: AbstractAgent,
): UseThreadRestoreResult {
  const legacyReadyState = useMemo<ThreadRestoreState>(
    () => ({ status: "ready", threadId: agent.threadId }),
    [agent],
  );
  const snapshotCacheRef = useRef<{
    agent: typeof agent;
    state: ThreadRestoreState;
  } | null>(null);

  const subscribe = useCallback(
    (listener: () => void) =>
      isThreadRestoreAware(agent)
        ? agent.subscribeToThreadRestore(listener)
        : () => {},
    [agent],
  );
  const getSnapshot = useCallback(() => {
    const nextState = isThreadRestoreAware(agent)
      ? agent.getThreadRestoreState()
      : legacyReadyState;
    const cached = snapshotCacheRef.current;
    if (
      cached?.agent === agent &&
      threadRestoreStatesEqual(cached.state, nextState)
    ) {
      return cached.state;
    }
    snapshotCacheRef.current = { agent, state: nextState };
    return nextState;
  }, [agent, legacyReadyState]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const reloadConversation = useCallback(async () => {
    if (isThreadRestoreAware(agent)) {
      await agent.forceFullRestore();
    }
  }, [agent]);

  return useMemo(
    () => ({ ...state, reloadConversation }),
    [state, reloadConversation],
  );
}

function threadRestoreStatesEqual(
  left: ThreadRestoreState,
  right: ThreadRestoreState,
): boolean {
  if (
    left.status !== right.status ||
    left.threadId !== right.threadId ||
    left.restoreAttemptId !== right.restoreAttemptId
  ) {
    return false;
  }
  if (left.status === "restoring" && right.status === "restoring") {
    return left.elapsedMs === right.elapsedMs;
  }
  if (left.status === "failed" && right.status === "failed") {
    return left.error === right.error;
  }
  return left.status === "ready" && right.status === "ready";
}
