import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useMemo, useEffect, useReducer, useRef } from "react";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkitnext/core";

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
  threadId?: string;
  updates?: UseAgentUpdate[];
}

/**
 * Clone a registry agent for per-thread isolation.
 * Copies agent configuration (transport, headers, etc.) but resets conversation
 * state (messages, threadId, state) so each thread starts fresh.
 */
function cloneForThread(
  source: AbstractAgent,
  threadId: string,
  headers: Record<string, string>,
): AbstractAgent {
  const clone = source.clone();
  if (clone === source) {
    throw new Error(
      `useAgent: ${source.constructor.name}.clone() returned the same instance. ` +
        `clone() must return a new, independent object.`,
    );
  }
  clone.threadId = threadId;
  clone.setMessages([]);
  clone.setState({});
  if (clone instanceof HttpAgent) {
    clone.headers = { ...headers };
  }
  return clone;
}

export function useAgent({ agentId, threadId, updates }: UseAgentProps = {}) {
  agentId ??= DEFAULT_AGENT_ID;

  const { copilotkit } = useCopilotKit();
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

  // When threadId is provided, each (agentId, threadId) pair gets its own
  // cloned agent instance so that messages and state are isolated.
  // Each entry stores { source, clone } so we can detect when the registry
  // agent is replaced (e.g. after reconnect or hot-reload) and invalidate the
  // stale clone rather than silently returning it with the old configuration.
  const threadAgentCache = useRef<
    Map<string, { source: AbstractAgent; clone: AbstractAgent }>
  >(new Map());

  const agent: AbstractAgent = useMemo(() => {
    // Use a composite key when threadId is provided so that different threads
    // for the same agent get independent instances.
    const cacheKey = threadId ? `${agentId}:${threadId}` : agentId;

    const existing = copilotkit.getAgent(agentId);
    if (existing) {
      // Real agent found — clear any cached provisionals for this key and the
      // bare agentId key (handles the case where a provisional was created
      // before threadId was available, then the component re-renders with one).
      provisionalAgentCache.current.delete(cacheKey);
      provisionalAgentCache.current.delete(agentId);

      if (!threadId) {
        // No threadId — return the shared registry agent (original behavior)
        return existing;
      }

      // threadId provided — return a per-thread clone.
      // Check source reference: if the registry agent was replaced (reconnect,
      // hot-reload, config change) invalidate the cached clone so the new
      // configuration is picked up rather than silently using stale state.
      const entry = threadAgentCache.current.get(cacheKey);
      if (entry && entry.source === existing) {
        return entry.clone; // headers kept fresh by useEffect below
      }

      const clone = cloneForThread(existing, threadId, copilotkit.headers);
      threadAgentCache.current.set(cacheKey, { source: existing, clone });
      return clone;
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
      const cached = provisionalAgentCache.current.get(cacheKey);
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
      if (threadId) {
        provisional.threadId = threadId;
      }
      provisionalAgentCache.current.set(cacheKey, provisional);
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
      if (threadId) {
        provisional.threadId = threadId;
      }
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
    threadId,
    copilotkit.agents,
    copilotkit.runtimeConnectionStatus,
    copilotkit.runtimeUrl,
    copilotkit.runtimeTransport,
    JSON.stringify(copilotkit.headers),
  ]);

  useEffect(() => {
    if (updateFlags.length === 0) {
      return;
    }

    const handlers: Parameters<AbstractAgent["subscribe"]>[0] = {};

    if (updateFlags.includes(UseAgentUpdate.OnMessagesChanged)) {
      // Content stripping for immutableContent renderers is handled by CopilotKitCoreReact
      handlers.onMessagesChanged = () => {
        forceUpdate();
      };
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
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, forceUpdate, JSON.stringify(updateFlags)]);

  // Keep HttpAgent headers fresh without mutating inside useMemo, which is
  // unsafe in concurrent mode (React may invoke useMemo multiple times and
  // discard intermediate results, but mutations always land).
  useEffect(() => {
    if (agent instanceof HttpAgent) {
      agent.headers = { ...copilotkit.headers };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, JSON.stringify(copilotkit.headers)]);

  // Release per-thread clones on unmount so agents holding event listeners,
  // WebSocket connections, or timers don't accumulate indefinitely.
  useEffect(() => {
    return () => {
      threadAgentCache.current.clear();
    };
  }, []);

  return {
    agent,
  };
}
