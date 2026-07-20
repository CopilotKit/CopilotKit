import { useCopilotKit } from "../context";
import { useMemo, useEffect, useReducer, useRef } from "react";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";

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
  /**
   * Agent to bind to. Resolution precedence: this property, then the surrounding
   * chat configuration's agentId, then the global default.
   */
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
  // Resolve agentId mirroring CopilotChat's precedence: an explicit prop wins,
  // then the surrounding chat configuration's agentId, then the global default.
  // Without the chat-config fallback, a useAgent() consumer rendered inside a
  // <CopilotChat agentId="..."> subtree resolves to 'default' and throws once
  // the runtime has synced only a non-default agent (#5533).
  const chatConfig = useCopilotChatConfiguration();
  const resolvedAgentId = agentId ?? chatConfig?.agentId ?? DEFAULT_AGENT_ID;

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

  const { agent, isReady } = useMemo<{
    agent: AbstractAgent;
    isReady: boolean;
  }>(() => {
    const existing = copilotkit.getAgent(resolvedAgentId);
    if (existing) {
      // Real agent found — clear any cached provisional for this ID
      provisionalAgentCache.current.delete(resolvedAgentId);
      return { agent: existing, isReady: true };
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
      const cached = provisionalAgentCache.current.get(resolvedAgentId);
      if (cached) {
        // Update headers on the cached agent in case they changed
        copilotkit.applyHeadersToAgent(cached);
        return { agent: cached, isReady: false };
      }

      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId: resolvedAgentId,
        transport: copilotkit.runtimeTransport,
        runtimeMode: "pending",
      });
      // Apply current headers so runs/connects inherit them
      copilotkit.applyHeadersToAgent(provisional);
      provisionalAgentCache.current.set(resolvedAgentId, provisional);
      return { agent: provisional, isReady: false };
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
      const cached = provisionalAgentCache.current.get(resolvedAgentId);
      if (cached) {
        copilotkit.applyHeadersToAgent(cached);
        return { agent: cached, isReady: false };
      }
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId: resolvedAgentId,
        transport: copilotkit.runtimeTransport,
        runtimeMode: "pending",
      });
      copilotkit.applyHeadersToAgent(provisional);
      provisionalAgentCache.current.set(resolvedAgentId, provisional);
      return { agent: provisional, isReady: false };
    }

    // No runtime configured and agent doesn't exist — this is a configuration error.
    const knownAgents = Object.keys(copilotkit.agents ?? {});
    const runtimePart = isRuntimeConfigured
      ? `runtimeUrl=${copilotkit.runtimeUrl}`
      : "no runtimeUrl";
    throw new Error(
      `useAgent: Agent '${resolvedAgentId}' not found after runtime sync (${runtimePart}). ` +
        (knownAgents.length
          ? `Known agents: [${knownAgents.join(", ")}]`
          : "No agents registered.") +
        " Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resolvedAgentId,
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
      handlers.onMessagesChanged = batchedForceUpdate;
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
      // Merge core headers on top of the agent's own headers rather than
      // replacing them, so per-agent headers (e.g. an Authorization for a
      // self-hosted backend) are preserved (see #5635).
      copilotkit.applyHeadersToAgent(agent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, JSON.stringify(copilotkit.headers)]);

  // Propagate the caller-supplied threadId from the chat configuration onto
  // the agent. AbstractAgent's constructor auto-mints a UUID when no threadId
  // is passed, so without this sync the agent ships its own random UUID in
  // /agent/run, /agent/connect, /agent/stop — diverging from the threadId the
  // app code reads via useThreads/useCopilotChatConfiguration. Gated on
  // hasExplicitThreadId so a ThreadsProvider-minted placeholder UUID doesn't
  // overwrite the auto-minted agent UUID (both are random and useless to the
  // backend; the explicit gate keeps the agent's UUID stable across renders).
  const configThreadId = chatConfig?.threadId;
  const configHasExplicitThreadId = chatConfig?.hasExplicitThreadId;
  useEffect(() => {
    if (!configHasExplicitThreadId || !configThreadId) return;
    agent.threadId = configThreadId;
  }, [agent, configThreadId, configHasExplicitThreadId]);

  return {
    agent,
    /**
     * Whether `agent` is the real, runtime-synced (or locally-registered) agent
     * rather than a provisional stand-in returned while the runtime is still
     * connecting (or in an error state).
     *
     * `agent` is always a fully-constructed `AbstractAgent`, so calling
     * `agent.subscribe(...)`, `agent.setState(...)`, etc. is always safe. But
     * while `isReady` is `false` the instance is a placeholder that will be
     * swapped for the real agent once the runtime `/info` sync resolves, at
     * which point `agent` changes reference and dependent effects re-run.
     * Guard on `isReady` when you only want to act against the real agent —
     * e.g. subscribing to run-lifecycle events you don't want to miss during
     * the provisional window (#5000).
     */
    isReady,
  };
}
