import type {
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
} from "../../../shared/thread-debugger/types.js";
import { getThreadInspectionUrl } from "./provider.js";

type RuntimeRequestOptions = {
  runtimeUrl: string;
  threadId: string;
  headers: Record<string, string>;
  signal: AbortSignal;
};

export type RuntimeEventsFetchResult =
  | { status: "available"; events: ThreadDebuggerEvent[] }
  | { status: "not-available" };

export type RuntimeStateFetchResult =
  | { status: "available"; state: Record<string, unknown> | null }
  | { status: "not-available" };

function fetchThreadResource(
  resource: "messages" | "events" | "state",
  options: RuntimeRequestOptions,
): Promise<Response> {
  return fetch(
    getThreadInspectionUrl(options.runtimeUrl, options.threadId, resource),
    {
      headers: { ...options.headers },
      signal: options.signal,
    },
  );
}

export async function fetchRuntimeMessages(
  options: RuntimeRequestOptions,
): Promise<ThreadDebuggerMessage[]> {
  const response = await fetchThreadResource("messages", options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: { messages: ThreadDebuggerMessage[] } = await response.json();
  return data.messages;
}

export async function fetchRuntimeEvents(
  options: RuntimeRequestOptions,
): Promise<RuntimeEventsFetchResult> {
  const response = await fetchThreadResource("events", options);
  if (response.status === 501) return { status: "not-available" };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: { events: ThreadDebuggerEvent[] } = await response.json();
  return { status: "available", events: data.events };
}

export async function fetchRuntimeState(
  options: RuntimeRequestOptions,
): Promise<RuntimeStateFetchResult> {
  const response = await fetchThreadResource("state", options);
  if (response.status === 501) return { status: "not-available" };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: { state: Record<string, unknown> | null } = await response.json();
  return { status: "available", state: data.state ?? null };
}
