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
import { SvelteMap } from "svelte/reactivity";

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
  SvelteMap<string, AbstractAgent>
>();
const globalThreadCloneConsumers = new WeakMap<
  AbstractAgent,
  SvelteMap<string, number>
>();

const MAX_CLONES_PER_AGENT = 50;

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
  return clone;
}

function applyProviderHeaders(
  core: CopilotKitContextValue["copilotkit"],
  target: AbstractAgent | null | undefined,
  headers: Readonly<Record<string, string>>,
): void {
  if (target instanceof HttpAgent) {
    if (typeof core.applyHeadersToAgent === "function") {
      core.applyHeadersToAgent(target);
    } else {
      // Structural test doubles and older compatible cores may not expose the
      // merge helper. Preserve existing agent headers in that fallback path.
      target.headers = { ...target.headers, ...headers };
    }
  }
}

function getOrCreateThreadClone(
  core: CopilotKitContextValue["copilotkit"],
  source: AbstractAgent,
  threadId: string,
  headers: Readonly<Record<string, string>>,
): AbstractAgent {
  let byThread = globalThreadCloneMap.get(source);
  if (!byThread) {
    byThread = new SvelteMap();
    globalThreadCloneMap.set(source, byThread);
  }
  const existing = byThread.get(threadId);
  if (existing) {
    existing.threadId = threadId;
    applyProviderHeaders(core, existing, headers);
    return existing;
  }
  const clone = cloneForThread(source, threadId);
  applyProviderHeaders(core, clone, headers);
  if (byThread.size >= MAX_CLONES_PER_AGENT) {
    const consumers = globalThreadCloneConsumers.get(source);
    const evictable = [...byThread.keys()].find(
      (candidate) => !consumers?.get(candidate),
    );
    if (evictable !== undefined) byThread.delete(evictable);
  }
  byThread.set(threadId, clone);
  return clone;
}

function retainThreadClone(source: AbstractAgent, threadId: string): void {
  let consumers = globalThreadCloneConsumers.get(source);
  if (!consumers) {
    consumers = new SvelteMap();
    globalThreadCloneConsumers.set(source, consumers);
  }
  consumers.set(threadId, (consumers.get(threadId) ?? 0) + 1);
}

function releaseThreadClone(source: AbstractAgent, threadId: string): void {
  const consumers = globalThreadCloneConsumers.get(source);
  const count = consumers?.get(threadId);
  if (count === undefined) return;
  if (count <= 1) consumers?.delete(threadId);
  else consumers?.set(threadId, count - 1);

  const byThread = globalThreadCloneMap.get(source);
  while (byThread && byThread.size > MAX_CLONES_PER_AGENT) {
    const evictable = [...byThread.keys()].find(
      (candidate) => !consumers?.get(candidate),
    );
    if (evictable === undefined) break;
    byThread.delete(evictable);
  }
}

export function createAgent(props: CreateAgentProps = {}) {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("createAgent must be used within CopilotKitProvider");
  }

  const agentId = $derived(props.agentId ?? DEFAULT_AGENT_ID);
  const threadId = $derived(props.threadId);
  const updateFlags = $derived(props.updates ?? ALL_UPDATES);
  const hookThrottleMs = $derived(props.throttleMs);

  let agent = $state<AbstractAgent | null>(null);
  let agentIdentity: AbstractAgent | null = null;
  let agentRevision = $state(0);
  let agentInstanceRevision = $state(0);
  let messages = $state<Message[]>([]);
  let isRunning = $state(false);
  let subscriptionAgent = $state<AbstractAgent | null>(null);
  const provisionalAgentCache = new SvelteMap<
    string,
    {
      agent: ProxiedCopilotRuntimeAgent;
      runtimeUrl: string;
      transport: CopilotKitContextValue["runtimeTransport"];
    }
  >();
  let ownedClone: { source: AbstractAgent; threadId: string } | null = null;

  function releaseOwnedClone(): void {
    if (!ownedClone) return;
    releaseThreadClone(ownedClone.source, ownedClone.threadId);
    ownedClone = null;
  }

  function setResolvedAgent(next: AbstractAgent): void {
    if (agentIdentity !== next) agentInstanceRevision += 1;
    agentIdentity = next;
    agent = next;
  }

  const resolveAgent = () => {
    const id = agentId;
    const resolvedThreadId = threadId;
    const cacheKey = resolvedThreadId ? `${id}:${resolvedThreadId}` : id;
    const core = context.copilotkit;
    const runtimeUrl = context.runtimeUrl;
    const status = context.runtimeConnectionStatus;
    const transport = context.runtimeTransport;
    const headers = context.headers;
    const registered = context.agents ?? {};
    // Reactive registry wins over mutable core fields. getAgent remains the
    // core lookup when the provider has not published the agent yet.
    const coreAgent = core.getAgent(id);
    const existing = registered[id] ?? coreAgent;
    if (existing) {
      provisionalAgentCache.delete(cacheKey);
      provisionalAgentCache.delete(id);
      applyProviderHeaders(core, existing, headers);
      let resolvedAgent: AbstractAgent;
      if (resolvedThreadId) {
        if (
          ownedClone &&
          (ownedClone.source !== existing ||
            ownedClone.threadId !== resolvedThreadId)
        ) {
          releaseOwnedClone();
        }
        resolvedAgent = getOrCreateThreadClone(
          core,
          existing,
          resolvedThreadId,
          headers,
        );
        if (
          !ownedClone ||
          ownedClone.source !== existing ||
          ownedClone.threadId !== resolvedThreadId
        ) {
          retainThreadClone(existing, resolvedThreadId);
          ownedClone = { source: existing, threadId: resolvedThreadId };
        }
      } else {
        releaseOwnedClone();
        resolvedAgent = existing;
      }
      setResolvedAgent(resolvedAgent);
      messages = [...(resolvedAgent.messages ?? [])];
      isRunning = resolvedAgent.isRunning ?? false;
      subscriptionAgent = resolvedAgent;
      return;
    }

    const isRuntimeConfigured = runtimeUrl !== undefined;

    if (
      isRuntimeConfigured &&
      (status === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting ||
        status === CopilotKitCoreRuntimeConnectionStatus.Error)
    ) {
      releaseOwnedClone();
      let cached = provisionalAgentCache.get(cacheKey);
      if (
        cached &&
        (cached.runtimeUrl !== runtimeUrl || cached.transport !== transport)
      ) {
        provisionalAgentCache.delete(cacheKey);
        cached = undefined;
      }
      if (cached) {
        applyProviderHeaders(core, cached.agent, headers);
        if (resolvedThreadId) {
          cached.agent.threadId = resolvedThreadId;
        }
        setResolvedAgent(cached.agent);
        messages = [...(cached.agent.messages ?? [])];
        isRunning = cached.agent.isRunning ?? false;
        subscriptionAgent = cached.agent;
        return;
      }
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: runtimeUrl!,
        agentId: id,
        transport,
        runtimeMode: "pending",
      });
      applyProviderHeaders(core, provisional, headers);
      if (resolvedThreadId) {
        provisional.threadId = resolvedThreadId;
      }
      provisionalAgentCache.set(cacheKey, {
        agent: provisional,
        runtimeUrl: runtimeUrl!,
        transport,
      });
      setResolvedAgent(provisional);
      messages = [...(provisional.messages ?? [])];
      isRunning = provisional.isRunning ?? false;
      subscriptionAgent = provisional;
      return;
    }

    releaseOwnedClone();
    const knownAgents = Object.keys(registered);
    const runtimePart = isRuntimeConfigured
      ? `runtimeUrl=${runtimeUrl}`
      : "no runtimeUrl";
    throw new Error(
      `createAgent: Agent '${id}' not found after runtime sync (${runtimePart}). ` +
        (knownAgents.length
          ? `Known agents: [${knownAgents.join(", ")}]`
          : "No agents registered."),
    );
  };

  $effect(() => {
    resolveAgent();
  });

  $effect(() => () => releaseOwnedClone());

  $effect(() => {
    // Track the provider getter so updates rerun this effect. The core owns
    // the merge baseline and preserves each HttpAgent's construction headers.
    const headers = context.headers;
    const core = context.copilotkit;
    applyProviderHeaders(core, subscriptionAgent, headers);
    for (const registered of Object.values(context.agents ?? {})) {
      applyProviderHeaders(core, registered, headers);
      const clones = globalThreadCloneMap.get(registered);
      if (!clones) continue;
      for (const clone of clones.values()) {
        applyProviderHeaders(core, clone, headers);
      }
    }
    for (const provisional of provisionalAgentCache.values()) {
      applyProviderHeaders(core, provisional.agent, headers);
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
    get agentInstanceVersion() {
      return agentInstanceRevision;
    },
    get messages() {
      return messages;
    },
    get isRunning() {
      return isRunning;
    },
  };
}
