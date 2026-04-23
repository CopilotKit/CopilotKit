import { useCopilotKit } from "../providers/CopilotKitProvider";
import { useMemo, useEffect, useReducer, useRef } from "react";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { AbstractAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";

export enum UseAgentUpdate {
  OnMessagesChanged = "OnMessagesChanged",
  OnStateChanged = "OnStateChanged",
  OnRunStatusChanged = "OnRunStatusChanged",
}

const ALL_UPDATES: UseAgentUpdate[] = [
  UseAgentUpdate.OnMessagesChanged,
  UseAgentUpdate.OnStateChanged,
  UseAgentUpdate.OnRunStatusChanged,
];

export interface UseAgentProps {
  agentId?: string;
  updates?: UseAgentUpdate[];
  /**
   * Throttle interval (in milliseconds) for React re-renders triggered by
   * `OnMessagesChanged` notifications. Useful to reduce re-render frequency
   * during high-frequency message updates such as streaming.
   *
   * Uses leading+trailing: first update fires immediately, subsequent updates
   * within the window are coalesced, and a trailing timer ensures the most
   * recent update fires after the window expires. The trailing edge restarts
   * the throttle window, so no two renders occur within `throttleMs` of each
   * other. Cleanup on unmount cancels any pending trailing timer.
   *
   * Must be a non-negative finite number. Negative or non-finite values fall
   * back to unthrottled behavior with a `console.error`. Only affects
   * `OnMessagesChanged` updates — `OnStateChanged` and `OnRunStatusChanged`
   * always fire immediately. If `updates` does not include
   * `OnMessagesChanged`, this property has no effect.
   *
   * Default: `0` (no throttle).
   */
  throttleMs?: number;
}

export function useAgent({ agentId, updates, throttleMs }: UseAgentProps = {}) {
  agentId ??= DEFAULT_AGENT_ID;

  const { copilotkit } = useCopilotKit();
  const providerThrottleMs = copilotkit.defaultThrottleMs;

  const effectiveThrottleMs = useMemo(() => {
    const resolved = throttleMs ?? providerThrottleMs ?? 0;
    if (!Number.isFinite(resolved) || resolved < 0) {
      const source =
        throttleMs !== undefined
          ? "hook-level throttleMs"
          : "provider-level defaultThrottleMs";
      console.error(
        `useAgent: ${source} must be a non-negative finite number, got ${resolved}. Falling back to unthrottled.`,
      );
      return 0;
    }
    return resolved;
  }, [throttleMs, providerThrottleMs]);
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const updateFlags = useMemo(
    () => updates ?? ALL_UPDATES,
    [JSON.stringify(updates)],
  );

  // Cache provisional agents to avoid creating new references on every render
  // while the runtime is still connecting. A new reference would cascade into
  // CopilotChat's connectAgent effect, causing unnecessary HTTP calls.
  const provisionalAgentCache = useRef<Map<string, ProxiedCopilotRuntimeAgent>>(
    new Map(),
  );

  const agent: AbstractAgent = useMemo(() => {
    const existing = copilotkit.getAgent(agentId);
    if (existing) {
      // Real agent found — clear any cached provisional for this ID
      provisionalAgentCache.current.delete(agentId);
      return existing;
    }

    const isRuntimeConfigured = copilotkit.runtimeUrl !== undefined;
    const status = copilotkit.runtimeConnectionStatus;

    // While runtime is not yet synced, return a provisional runtime agent
    if (
      isRuntimeConfigured &&
      (status === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting)
    ) {
      // Return cached provisional if available (keeps reference stable)
      const cached = provisionalAgentCache.current.get(agentId);
      if (cached) {
        // Update headers on the cached agent in case they changed
        cached.headers = { ...copilotkit.headers };
        return cached;
      }

      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId,
        transport: copilotkit.runtimeTransport,
        runtimeMode: "pending",
      });
      // Apply current headers so runs/connects inherit them
      provisional.headers = { ...copilotkit.headers };
      provisionalAgentCache.current.set(agentId, provisional);
      return provisional;
    }

    // Runtime is in Error state — return a provisional agent instead of throwing.
    // The error has already been emitted through the subscriber system
    // (RUNTIME_INFO_FETCH_FAILED). Throwing here would crash the React tree;
    // returning a provisional agent lets onError handlers fire while keeping
    // the app alive.
    if (
      isRuntimeConfigured &&
      status === CopilotKitCoreRuntimeConnectionStatus.Error
    ) {
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId,
        transport: copilotkit.runtimeTransport,
        runtimeMode: "pending",
      });
      provisional.headers = { ...copilotkit.headers };
      return provisional;
    }

    // No runtime configured and agent doesn't exist — this is a configuration error.
    const knownAgents = Object.keys(copilotkit.agents ?? {});
    const runtimePart = isRuntimeConfigured
      ? `runtimeUrl=${copilotkit.runtimeUrl}`
      : "no runtimeUrl";
    throw new Error(
      `useAgent: Agent '${agentId}' not found after runtime sync (${runtimePart}). ` +
        (knownAgents.length
          ? `Known agents: [${knownAgents.join(", ")}]`
          : "No agents registered.") +
        " Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agentId,
    copilotkit.agents,
    copilotkit.runtimeConnectionStatus,
    copilotkit.runtimeUrl,
    copilotkit.runtimeTransport,
    JSON.stringify(copilotkit.headers),
  ]);

  useEffect(() => {
    if (updateFlags.length === 0) return;

    const handlers: Parameters<AbstractAgent["subscribe"]>[0] = {};
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    if (updateFlags.includes(UseAgentUpdate.OnMessagesChanged)) {
      const ms = effectiveThrottleMs;
      if (ms > 0) {
        // Throttled onMessagesChanged: leading+trailing pattern.
        // First notification fires immediately, subsequent ones within the
        // window are coalesced. Trailing timer fires after the window to
        // ensure the final state is rendered.
        let throttleActive = false;
        // Tracks whether a notification arrived during the throttle window,
        // so the trailing timer knows whether a re-render is needed.
        let pending = false;

        const throttledNotify = () => {
          if (!active) return;
          if (!throttleActive) {
            // Leading edge — fire immediately and start the throttle window
            throttleActive = true;
            pending = false;
            forceUpdate();
            timerId = setTimeout(function trailingEdge() {
              timerId = null;
              if (active && pending) {
                // Trailing edge — fire and restart the window
                pending = false;
                forceUpdate();
                timerId = setTimeout(trailingEdge, ms);
              } else {
                // No pending notifications — end the window
                throttleActive = false;
              }
            }, ms);
          } else {
            pending = true;
          }
        };

        handlers.onMessagesChanged = throttledNotify;
      } else {
        handlers.onMessagesChanged = forceUpdate;
      }
    }

    if (updateFlags.includes(UseAgentUpdate.OnStateChanged)) {
      handlers.onStateChanged = forceUpdate;
    }

    if (updateFlags.includes(UseAgentUpdate.OnRunStatusChanged)) {
      handlers.onRunInitialized = forceUpdate;
      handlers.onRunFinalized = forceUpdate;
      handlers.onRunFailed = forceUpdate;
    }

    const subscription = agent.subscribe(handlers);
    return () => {
      active = false;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, forceUpdate, effectiveThrottleMs, updateFlags]);

  return {
    agent,
  };
}
