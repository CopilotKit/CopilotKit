import type { AbstractAgent, AgentSubscriber, Message } from "@ag-ui/client";
import {
  mapThreadMessagesToAgent,
  mapThreadMessagesToPlayground,
} from "./message-adapter.js";
import type { PlaygroundThreadMessage } from "./message-adapter.js";
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
  agentMessages: Message[];
  threadState: unknown;
}

export interface PlaygroundThreadLoadInput {
  thread: PlaygroundThreadSource;
  runtimeUrl: string;
  headers: Readonly<Record<string, string>>;
  fetch: typeof globalThis.fetch;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function assertSecureAuthenticatedRuntime(
  runtimeUrl: string,
  headers: Readonly<Record<string, string>>,
): void {
  if (Object.keys(headers).length === 0) return;

  let parsedRuntimeUrl: URL;
  try {
    parsedRuntimeUrl = new URL(runtimeUrl, globalThis.location?.href);
  } catch {
    throw new Error(
      "Authenticated thread loading requires an absolute HTTPS runtime URL.",
    );
  }

  if (
    parsedRuntimeUrl.protocol === "https:" ||
    (parsedRuntimeUrl.protocol === "http:" &&
      isLoopbackHostname(parsedRuntimeUrl.hostname))
  ) {
    return;
  }

  throw new Error(
    "Authenticated thread loading requires HTTPS outside localhost.",
  );
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

function isInputContentSource(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const type = Reflect.get(value, "type");
  const mimeType = Reflect.get(value, "mimeType");
  return (
    (type === "url" || type === "data") &&
    typeof Reflect.get(value, "value") === "string" &&
    (type === "url"
      ? mimeType === undefined || typeof mimeType === "string"
      : typeof mimeType === "string")
  );
}

function isInputContentPart(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const type = Reflect.get(value, "type");
  if (type === "text") return typeof Reflect.get(value, "text") === "string";
  if (type === "binary") {
    return (
      typeof Reflect.get(value, "mimeType") === "string" &&
      ["id", "url", "data"].some(
        (key) => typeof Reflect.get(value, key) === "string",
      )
    );
  }
  return (
    (type === "image" ||
      type === "audio" ||
      type === "video" ||
      type === "document") &&
    isInputContentSource(Reflect.get(value, "source"))
  );
}

function isUserMessageContent(
  value: unknown,
): value is Extract<Message, { role: "user" }>["content"] {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every(isInputContentPart))
  );
}

function isThreadDebuggerMessage(
  value: unknown,
): value is PlaygroundThreadMessage {
  if (typeof value !== "object" || value === null) return false;
  const id = Reflect.get(value, "id");
  const role = Reflect.get(value, "role");
  const content = Reflect.get(value, "content");
  const toolCalls = Reflect.get(value, "toolCalls");
  return (
    typeof id === "string" &&
    typeof role === "string" &&
    (content === undefined ||
      typeof content === "string" ||
      (role === "user" && isUserMessageContent(content))) &&
    (toolCalls === undefined ||
      (Array.isArray(toolCalls) && toolCalls.every(isThreadDebuggerToolCall)))
  );
}

function readThreadMessages(body: unknown): PlaygroundThreadMessage[] {
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
  input: PlaygroundThreadLoadInput & {
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
    const loaded = await loadPlaygroundThreadSnapshot(input);
    if (!isCurrent()) return null;
    return loaded;
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

export async function loadPlaygroundThreadSnapshot(
  input: PlaygroundThreadLoadInput,
) {
  assertSecureAuthenticatedRuntime(input.runtimeUrl, input.headers);
  const baseUrl = input.runtimeUrl.replace(/\/+$/, "");
  const encodedThreadId = encodeURIComponent(input.thread.id);
  const [messagesResponse, stateResponse] = await Promise.all([
    input.fetch(`${baseUrl}/threads/${encodedThreadId}/messages`, {
      headers: { ...input.headers },
      redirect: "error",
    }),
    input.fetch(`${baseUrl}/threads/${encodedThreadId}/state`, {
      headers: { ...input.headers },
      redirect: "error",
    }),
  ]);
  if (!messagesResponse.ok) {
    throw new Error(`Failed to load thread (HTTP ${messagesResponse.status}).`);
  }
  const messagesBody: unknown = await messagesResponse.json();
  const stateBody: unknown = stateResponse.ok
    ? await stateResponse.json()
    : { state: {} };
  const threadMessages = readThreadMessages(messagesBody);
  return {
    threadId: input.thread.id,
    agentId: input.thread.agentId,
    messages: mapThreadMessagesToPlayground(threadMessages),
    agentMessages: mapThreadMessagesToAgent(threadMessages),
    threadState: readThreadState(stateBody),
  };
}
