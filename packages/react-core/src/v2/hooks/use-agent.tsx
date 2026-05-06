import { useCopilotKit } from "../providers/CopilotKitProvider";
import { useMemo, useEffect, useReducer, useRef } from "react";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
  type SubscribeToAgentSubscriber,
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
   * Throttle interval (in milliseconds) for re-renders triggered by
   * `onMessagesChanged` and `onStateChanged` notifications. Useful to reduce
   * re-render frequency during high-frequency streaming updates.
   *
   * Uses a leading+trailing pattern with a shared window — first update
   * fires immediately, subsequent updates within the window are coalesced,
   * and a trailing timer ensures the most recent update fires after the
   * window expires. See `CopilotKitCore.subscribeToAgentWithOptions` in `@copilotkit/core`
   * for details.
   *
   * Resolved as: `throttleMs ?? provider defaultThrottleMs ?? 0`.
   * Passing `throttleMs={0}` explicitly disables throttling even when the
   * provider specifies a non-zero `defaultThrottleMs`.
   *
   * Run lifecycle callbacks (`onRunInitialized`, `onRunFinalized`,
   * `onRunFailed`, `onRunErrorEvent`) always fire immediately.
   *
   * @default undefined
   * When unset, inherits from the provider's `defaultThrottleMs`;
   * if that is also unset, the effective value is `0` (no throttle).
   */
  throttleMs?: number;
}

export function useAgent({ agentId, updates, throttleMs }: UseAgentProps = {}) {
  agentId ??= DEFAULT_AGENT_ID;

  const { copilotkit } = useCopilotKit();
  // Read the provider-level default so it appears in the effect's dep array.
  // subscribeToAgentWithOptions reads it from the core instance, but React needs the dep
  // to know when to re-subscribe.
  const providerThrottleMs = copilotkit.defaultThrottleMs;

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
      const cached = provisionalAgentCache.current.get(agentId);
      if (cached) {
        cached.headers = { ...copilotkit.headers };
        return cached;
      }
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId,
        transport: copilotkit.runtimeTransport,
        runtimeMode: "pending",
      });
      provisional.headers = { ...copilotkit.headers };
      provisionalAgentCache.current.set(agentId, provisional);
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

    let active = true;
    const handlers: SubscribeToAgentSubscriber = {};

    // Microtask-batched forceUpdate: coalesces multiple synchronous
    // notifications (e.g. OnStateChanged + OnRunStatusChanged firing in the
    // same tick) into a single React re-render. This prevents the scroll
    // jumping described in #3499 where rapid unbatched forceUpdate calls
    // cause brief content height fluctuations during streaming.
    let batchScheduled = false;
    const batchedForceUpdate = () => {
      if (!active) return;
      if (!batchScheduled) {
        batchScheduled = true;
        queueMicrotask(() => {
          batchScheduled = false;
          if (active) {
            forceUpdate();
          }
        });
      }
    };

    if (updateFlags.includes(UseAgentUpdate.OnMessagesChanged)) {
      handlers.onMessagesChanged = forceUpdate;
    }

    if (updateFlags.includes(UseAgentUpdate.OnStateChanged)) {
      handlers.onStateChanged = batchedForceUpdate;
    }

    if (updateFlags.includes(UseAgentUpdate.OnRunStatusChanged)) {
      handlers.onRunInitialized = batchedForceUpdate;
      handlers.onRunFinalized = batchedForceUpdate;
      handlers.onRunFailed = batchedForceUpdate;
      // Protocol-level RUN_ERROR event (distinct from onRunFailed which
      // handles local exceptions like network errors).
      handlers.onRunErrorEvent = batchedForceUpdate;
    }

    const subscription = copilotkit.subscribeToAgentWithOptions(
      agent,
      handlers,
      {
        throttleMs,
      },
    );
    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, forceUpdate, throttleMs, providerThrottleMs, updateFlags]);

  // Keep HttpAgent headers fresh without mutating inside useMemo, which is
  // unsafe in concurrent mode (React may invoke useMemo multiple times and
  // discard intermediate results, but mutations always land).
  useEffect(() => {
    if (agent instanceof HttpAgent) {
      agent.headers = { ...copilotkit.headers };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, JSON.stringify(copilotkit.headers)]);

  return {
    agent,
  };
}
