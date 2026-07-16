import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";
import { getContext } from "svelte";

export enum CreateAgentUpdate {
  OnMessagesChanged = "OnMessagesChanged",
  OnStateChanged = "OnStateChanged",
  OnRunStatusChanged = "OnRunStatusChanged",
}

const ALL_UPDATES: CreateAgentUpdate[] = [
  CreateAgentUpdate.OnMessagesChanged,
  CreateAgentUpdate.OnStateChanged,
  CreateAgentUpdate.OnRunStatusChanged,
];

export interface CreateAgentProps {
  agentId?: string;
  threadId?: string;
  updates?: CreateAgentUpdate[];
  throttleMs?: number;
}

export const globalThreadCloneMap = new WeakMap<
  AbstractAgent,
  Map<string, AbstractAgent>
>();

export function getThreadClone(
  registryAgent: AbstractAgent | undefined | null,
  threadId: string | undefined | null,
): AbstractAgent | undefined {
  if (!registryAgent || !threadId) return undefined;
  return globalThreadCloneMap.get(registryAgent)?.get(threadId);
}

function cloneForThread(
  source: AbstractAgent,
  threadId: string,
  headers: Record<string, string>,
): AbstractAgent {
  const clone = source.clone();
  if (clone === source) {
    throw new Error(
      `createAgent: ${source.constructor.name}.clone() returned the same instance. ` +
        "clone() must return a new, independent object.",
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

function getOrCreateThreadClone(
  source: AbstractAgent,
  threadId: string,
  headers: Record<string, string>,
): AbstractAgent {
  let byThread = globalThreadCloneMap.get(source);
  if (!byThread) {
    byThread = new Map();
    globalThreadCloneMap.set(source, byThread);
  }
  const existing = byThread.get(threadId);
  if (existing) {
    existing.threadId = threadId;
    if (existing instanceof HttpAgent) {
      existing.headers = { ...headers };
    }
    return existing;
  }
  const clone = cloneForThread(source, threadId, headers);
  byThread.set(threadId, clone);
  return clone;
}

export function createAgent(props: CreateAgentProps = {}) {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("createAgent must be used within CopilotKitProvider");
  }

  let agentId = $derived(props.agentId ?? DEFAULT_AGENT_ID);
  let threadId = $derived(props.threadId);
  let updateFlags = $derived(props.updates ?? ALL_UPDATES);
  let hookThrottleMs = $derived(props.throttleMs);

  let agent = $state<AbstractAgent | null>(null);
  let agentRevision = $state(0);
  let messages = $state<Message[]>([]);
  let isRunning = $state(false);
  let subscriptionAgent = $state<AbstractAgent | null>(null);
  let provisionalAgentCache = new Map<string, ProxiedCopilotRuntimeAgent>();

  let resolveAgent = () => {
    const id = agentId;
    const resolvedThreadId = threadId;
    const cacheKey = resolvedThreadId ? `${id}:${resolvedThreadId}` : id;
    const core = context.copilotkit;
    const existing = core.getAgent(id);
    if (existing) {
      provisionalAgentCache.delete(cacheKey);
      provisionalAgentCache.delete(id);
      const resolvedAgent = resolvedThreadId
        ? getOrCreateThreadClone(existing, resolvedThreadId, core.headers)
        : existing;
      agent = resolvedAgent;
      messages = [...(resolvedAgent.messages ?? [])];
      isRunning = resolvedAgent.isRunning ?? false;
      subscriptionAgent = resolvedAgent;
      return;
    }

    const isRuntimeConfigured = core.runtimeUrl !== undefined;
    const status = core.runtimeConnectionStatus;

    if (
      isRuntimeConfigured &&
      (status === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting ||
        status === CopilotKitCoreRuntimeConnectionStatus.Error)
    ) {
      const cached = provisionalAgentCache.get(cacheKey);
      if (cached) {
        cached.headers = { ...core.headers };
        if (resolvedThreadId) {
          cached.threadId = resolvedThreadId;
        }
        agent = cached;
        messages = [...(cached.messages ?? [])];
        isRunning = cached.isRunning ?? false;
        subscriptionAgent = cached;
        return;
      }
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: core.runtimeUrl!,
        agentId: id,
        transport: core.runtimeTransport,
        runtimeMode: "pending",
      });
      provisional.headers = { ...core.headers };
      if (resolvedThreadId) {
        provisional.threadId = resolvedThreadId;
      }
      provisionalAgentCache.set(cacheKey, provisional);
      agent = provisional;
      messages = [...(provisional.messages ?? [])];
      isRunning = provisional.isRunning ?? false;
      subscriptionAgent = provisional;
      return;
    }

    const knownAgents = Object.keys(core.agents ?? {});
    const runtimePart = isRuntimeConfigured
      ? `runtimeUrl=${core.runtimeUrl}`
      : "no runtimeUrl";
    throw new Error(
      `createAgent: Agent '${id}' not found after runtime sync (${runtimePart}). ` +
        (knownAgents.length
          ? `Known agents: [${knownAgents.join(", ")}]`
          : "No agents registered."),
    );
  };

  $effect(() => {
    let _ = [
      agentId,
      context.copilotkit.agents,
      context.copilotkit.runtimeConnectionStatus,
      context.copilotkit.runtimeUrl,
      context.copilotkit.runtimeTransport,
      JSON.stringify(
        Object.entries(context.copilotkit.headers ?? {}).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
      threadId,
    ];
    resolveAgent();
  });

  $effect(() => {
    if (!subscriptionAgent) return;
    if (subscriptionAgent instanceof HttpAgent) {
      subscriptionAgent.headers = { ...context.copilotkit.headers };
    }
  });

  $effect(() => {
    const a = subscriptionAgent;
    const flags = updateFlags;
    const core = context.copilotkit;
    if (!a || flags.length === 0) return;

    let active = true;
    let batchScheduled = false;
    const batchedRefresh = () => {
      if (!active) return;
      if (!batchScheduled) {
        batchScheduled = true;
        queueMicrotask(() => {
          batchScheduled = false;
          if (active) {
            agentRevision += 1;
          }
        });
      }
    };

    const handlers: SubscribeToAgentSubscriber = {};

    if (flags.includes(CreateAgentUpdate.OnMessagesChanged)) {
      handlers.onMessagesChanged = () => {
        if (active) {
          messages = (a.messages ?? []).map((m) => ({ ...m }));
          isRunning = a.isRunning ?? false;
          agentRevision += 1;
        }
      };
    }

    if (flags.includes(CreateAgentUpdate.OnStateChanged)) {
      handlers.onStateChanged = batchedRefresh;
    }

    if (flags.includes(CreateAgentUpdate.OnRunStatusChanged)) {
      handlers.onRunInitialized = () => {
        if (active) {
          isRunning = true;
          agent = a;
          agentRevision += 1;
        }
      };
      handlers.onRunFinalized = () => {
        if (active) {
          isRunning = false;
          agent = a;
          messages = (a.messages ?? []).map((m) => ({ ...m }));
          agentRevision += 1;
        }
      };
      handlers.onRunFailed = () => {
        if (active) {
          isRunning = false;
          agent = a;
          messages = (a.messages ?? []).map((m) => ({ ...m }));
          agentRevision += 1;
        }
      };
      handlers.onRunErrorEvent = () => {
        if (active) {
          isRunning = false;
          agent = a;
          messages = (a.messages ?? []).map((m) => ({ ...m }));
          agentRevision += 1;
        }
      };
    }

    const subscription = core.subscribeToAgentWithOptions(a, handlers, {
      throttleMs: hookThrottleMs,
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  });

  return {
    get agent() {
      void agentRevision;
      return agent;
    },
    get messages() {
      return messages;
    },
    get isRunning() {
      return isRunning;
    },
  };
}
