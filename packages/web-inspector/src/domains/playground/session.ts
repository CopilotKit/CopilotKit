import type { AbstractAgent, AgentSubscriber, Message } from "@ag-ui/client";
import type { ThreadDebuggerMessage } from "../../shared/thread-debugger/types.js";
import { mapThreadMessagesToPlayground } from "./message-adapter.js";
import type { PlaygroundMessage, PlaygroundState } from "./state.js";

export interface PlaygroundSessionCleanup {
  agent: AbstractAgent | null;
  unsubscribe: (() => void) | null;
  wasRunning: boolean;
}

export interface CreatePlaygroundSessionOptions {
  agents: Readonly<Record<string, AbstractAgent>>;
  preferredAgentId?: string;
  runtimeMode: string;
  showEphemeralNotice: boolean;
  seedMessages?: Message[];
  seedState?: unknown;
  createThreadId: () => string;
  getAgent?: (agentId: string) => AbstractAgent | undefined;
}

export interface PlaygroundSessionResult {
  agent: AbstractAgent;
  agentId: string;
}

export interface PlaygroundThreadSource {
  id: string;
  agentId: string;
}

export interface PlaygroundThreadLoadResult {
  threadId: string;
  agentId: string;
  messages: PlaygroundMessage[];
  threadState: unknown;
}

export function resolvePlaygroundAgentId(
  agents: Readonly<Record<string, AbstractAgent>>,
  preferredAgentId?: string,
): string | null {
  if (
    preferredAgentId &&
    preferredAgentId !== "all-agents" &&
    agents[preferredAgentId]
  ) {
    return preferredAgentId;
  }
  return Object.keys(agents)[0] ?? null;
}

export function clearPlaygroundSession(
  state: PlaygroundState,
): PlaygroundSessionCleanup {
  const cleanup = {
    agent: state.agent,
    unsubscribe: state.agentUnsubscribe,
    wasRunning: state.isRunning,
  };
  state.sessionGeneration += 1;
  state.loadGeneration += 1;
  state.runGeneration += 1;
  state.agent = null;
  state.agentId = null;
  state.agentUnsubscribe = null;
  state.messages = [];
  state.isRunning = false;
  state.runStartedAt = null;
  state.isLoadingThread = false;
  state.reasoningDurations.clear();
  return cleanup;
}

export function createPlaygroundSession(
  state: PlaygroundState,
  options: CreatePlaygroundSessionOptions,
): PlaygroundSessionResult | null {
  state.error = null;
  state.sourceThreadId = null;
  state.showEphemeralNotice =
    options.showEphemeralNotice && options.runtimeMode !== "intelligence";

  const agentId = resolvePlaygroundAgentId(
    options.agents,
    options.preferredAgentId,
  );
  const sourceAgent = agentId
    ? (options.getAgent?.(agentId) ?? options.agents[agentId])
    : undefined;
  if (!agentId || !sourceAgent) {
    return null;
  }

  const agent: AbstractAgent = sourceAgent.clone();
  agent.threadId = options.createThreadId();
  agent.setMessages(options.seedMessages ?? []);
  agent.setState(options.seedState ?? {});
  state.agent = agent;
  state.agentId = agentId;
  return { agent, agentId };
}

function isCurrentSession(
  state: PlaygroundState,
  agent: AbstractAgent,
  generation: number,
): boolean {
  return state.agent === agent && state.sessionGeneration === generation;
}

export function createPlaygroundSubscriber(
  state: PlaygroundState,
  agent: AbstractAgent,
  actions: { syncMessages: () => void; requestUpdate: () => void },
): AgentSubscriber {
  const generation = state.sessionGeneration;
  const setError = (message: string): void => {
    if (!isCurrentSession(state, agent, generation)) return;
    state.error = message;
    actions.requestUpdate();
  };
  const syncMessages = (): void => {
    if (!isCurrentSession(state, agent, generation)) return;
    actions.syncMessages();
  };
  return {
    onMessagesChanged: syncMessages,
    onActivitySnapshotEvent: syncMessages,
    onActivityDeltaEvent: syncMessages,
    onRunErrorEvent: ({ event }) =>
      setError(
        typeof event.message === "string"
          ? event.message
          : "The agent run failed.",
      ),
    onRunFailed: ({ error }) => setError(error.message),
  };
}

export function syncPlaygroundMessages(
  state: PlaygroundState,
  agent: AbstractAgent,
  normalize: (messages: unknown) => PlaygroundMessage[] | null,
): boolean {
  if (state.agent !== agent) return false;
  state.messages = normalize(agent.messages) ?? [];
  return true;
}

export async function runPlaygroundAgent(
  state: PlaygroundState,
  actions: {
    runAgent: (agent: AbstractAgent) => Promise<unknown>;
    syncMessages: () => void;
    requestUpdate: () => void;
    now?: () => number;
  },
): Promise<void> {
  const agent = state.agent;
  if (!agent || state.isRunning) return;

  const now = actions.now ?? Date.now;
  const sessionGeneration = state.sessionGeneration;
  const runGeneration = ++state.runGeneration;
  state.isRunning = true;
  state.runStartedAt = now();
  state.error = null;
  actions.requestUpdate();

  try {
    await actions.runAgent(agent);
  } catch (error) {
    if (
      isCurrentSession(state, agent, sessionGeneration) &&
      state.runGeneration === runGeneration
    ) {
      state.error =
        error instanceof Error ? error.message : "The agent run failed.";
    }
  } finally {
    if (
      !isCurrentSession(state, agent, sessionGeneration) ||
      state.runGeneration !== runGeneration
    ) {
      return;
    }
    state.isRunning = false;
    actions.syncMessages();
    let reasoningMessage: PlaygroundMessage | undefined;
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      if (state.messages[index]?.role === "reasoning") {
        reasoningMessage = state.messages[index];
        break;
      }
    }
    if (reasoningMessage?.id && state.runStartedAt !== null) {
      state.reasoningDurations.set(
        reasoningMessage.id,
        now() - state.runStartedAt,
      );
    }
    state.runStartedAt = null;
    actions.requestUpdate();
  }
}

function isThreadDebuggerToolCall(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const id = Reflect.get(value, "id");
  const name = Reflect.get(value, "name");
  const args = Reflect.get(value, "args");
  return (
    typeof id === "string" &&
    typeof name === "string" &&
    (typeof args === "string" ||
      (typeof args === "object" && args !== null && !Array.isArray(args)))
  );
}

function isThreadDebuggerMessage(
  value: unknown,
): value is ThreadDebuggerMessage {
  if (typeof value !== "object" || value === null) return false;
  const id = Reflect.get(value, "id");
  const role = Reflect.get(value, "role");
  const content = Reflect.get(value, "content");
  const toolCalls = Reflect.get(value, "toolCalls");
  return (
    typeof id === "string" &&
    typeof role === "string" &&
    (content === undefined || typeof content === "string") &&
    (toolCalls === undefined ||
      (Array.isArray(toolCalls) && toolCalls.every(isThreadDebuggerToolCall)))
  );
}

function readThreadMessages(body: unknown): ThreadDebuggerMessage[] {
  if (typeof body !== "object" || body === null) return [];
  const messages = Reflect.get(body, "messages");
  return Array.isArray(messages)
    ? messages.filter(isThreadDebuggerMessage)
    : [];
}

function readThreadState(body: unknown): unknown {
  return typeof body === "object" && body !== null
    ? (Reflect.get(body, "state") ?? {})
    : {};
}

export async function loadPlaygroundThread(
  state: PlaygroundState,
  input: {
    thread: PlaygroundThreadSource;
    runtimeUrl: string;
    headers: Readonly<Record<string, string>>;
    fetch: typeof globalThis.fetch;
    requestUpdate: () => void;
  },
): Promise<PlaygroundThreadLoadResult | null> {
  const sessionGeneration = state.sessionGeneration;
  const loadGeneration = ++state.loadGeneration;
  const isCurrent = () =>
    state.sessionGeneration === sessionGeneration &&
    state.loadGeneration === loadGeneration;
  state.isLoadingThread = true;
  state.error = null;
  input.requestUpdate();

  try {
    const baseUrl = input.runtimeUrl.replace(/\/+$/, "");
    const encodedThreadId = encodeURIComponent(input.thread.id);
    const [messagesResponse, stateResponse] = await Promise.all([
      input.fetch(`${baseUrl}/threads/${encodedThreadId}/messages`, {
        headers: { ...input.headers },
      }),
      input.fetch(`${baseUrl}/threads/${encodedThreadId}/state`, {
        headers: { ...input.headers },
      }),
    ]);
    if (!messagesResponse.ok) {
      throw new Error(
        `Failed to load thread (HTTP ${messagesResponse.status}).`,
      );
    }
    const messagesBody: unknown = await messagesResponse.json();
    const stateBody: unknown = stateResponse.ok
      ? await stateResponse.json()
      : { state: {} };
    if (!isCurrent()) return null;
    return {
      threadId: input.thread.id,
      agentId: input.thread.agentId,
      messages: mapThreadMessagesToPlayground(readThreadMessages(messagesBody)),
      threadState: readThreadState(stateBody),
    };
  } catch (error) {
    if (isCurrent()) {
      state.error =
        error instanceof Error ? error.message : "Failed to load thread.";
    }
    return null;
  } finally {
    if (isCurrent()) {
      state.isLoadingThread = false;
      input.requestUpdate();
    }
  }
}
