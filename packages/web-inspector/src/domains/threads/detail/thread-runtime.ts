import type {
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
  ThreadDebuggerProvider,
} from "../../../shared/thread-debugger/types.js";
import { getThreadInspectionUrl } from "./provider.js";

/** Resolves the request headers each time a request is sent (#1937). */
export type InspectorHeadersResolver = () =>
  | Record<string, string>
  | Promise<Record<string, string>>;

export type ThreadResourceRequest = {
  runtimeUrl: string;
  threadId: string;
  resolveHeaders: InspectorHeadersResolver;
  signal: AbortSignal;
};

export type RuntimeEventsFetchResult =
  | { status: "available"; events: ThreadDebuggerEvent[] }
  | { status: "not-available" };

export type RuntimeStateFetchResult =
  | { status: "available"; state: Record<string, unknown> | null }
  | { status: "not-available" };

async function fetchThreadResource(
  resource: "messages" | "events" | "state",
  options: ThreadResourceRequest,
): Promise<Response> {
  return fetch(
    getThreadInspectionUrl(options.runtimeUrl, options.threadId, resource),
    {
      headers: { ...(await options.resolveHeaders()) },
      signal: options.signal,
    },
  );
}

export async function fetchRuntimeMessages(
  options: ThreadResourceRequest,
): Promise<ThreadDebuggerMessage[]> {
  const response = await fetchThreadResource("messages", options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: { messages: ThreadDebuggerMessage[] } = await response.json();
  return data.messages;
}

export async function fetchRuntimeEvents(
  options: ThreadResourceRequest,
): Promise<RuntimeEventsFetchResult> {
  const response = await fetchThreadResource("events", options);
  if (response.status === 501) return { status: "not-available" };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: { events: ThreadDebuggerEvent[] } = await response.json();
  return { status: "available", events: data.events };
}

export async function fetchRuntimeState(
  options: ThreadResourceRequest,
): Promise<RuntimeStateFetchResult> {
  const response = await fetchThreadResource("state", options);
  if (response.status === 501) return { status: "not-available" };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: { state: Record<string, unknown> | null } = await response.json();
  return { status: "available", state: data.state ?? null };
}

/** Loads messages from the host provider when it has them, else the runtime. */
export function loadThreadMessages(
  provider: ThreadDebuggerProvider | null,
  request: ThreadResourceRequest,
): Promise<ThreadDebuggerMessage[]> {
  return provider?.getMessages
    ? provider.getMessages(request.threadId, { signal: request.signal })
    : fetchRuntimeMessages(request);
}

/** Loads events from the host provider when it has them, else the runtime. */
export async function loadThreadEvents(
  provider: ThreadDebuggerProvider | null,
  request: ThreadResourceRequest,
): Promise<RuntimeEventsFetchResult> {
  if (!provider?.getEvents) return fetchRuntimeEvents(request);
  const events = await provider.getEvents(request.threadId, {
    signal: request.signal,
  });
  return { status: "available", events };
}

/** Loads state from the host provider when it has it, else the runtime. */
export async function loadThreadState(
  provider: ThreadDebuggerProvider | null,
  request: ThreadResourceRequest,
): Promise<RuntimeStateFetchResult> {
  if (!provider?.getState) return fetchRuntimeState(request);
  const state = await provider.getState(request.threadId, {
    signal: request.signal,
  });
  return { status: "available", state };
}
