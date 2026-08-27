import type { ThreadDebuggerProvider } from "../../../shared/thread-debugger/types.js";
import type { ThreadsState } from "../state.js";
import { THREADS_EXAMPLE_DETAILS, THREADS_EXAMPLE_THREADS } from "./data.js";

export function isExampleThreadId(
  threadId: string | null | undefined,
): boolean {
  return THREADS_EXAMPLE_THREADS.some((thread) => thread.id === threadId);
}

export function getExampleThreadProvider(
  state: ThreadsState,
  threadId: string,
): ThreadDebuggerProvider {
  const cached = state.exampleThreadProviders.get(threadId);
  if (cached) return cached;

  const thread = THREADS_EXAMPLE_THREADS.find((item) => item.id === threadId);
  const details = THREADS_EXAMPLE_DETAILS[threadId];
  const provider: ThreadDebuggerProvider = {
    getThreadMetadata: async () =>
      thread
        ? {
            id: thread.id,
            name: thread.name,
            agentId: thread.agentId,
            endUserId: "example-user",
            status: "completed",
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
          }
        : null,
    getMessages: async () => details?.messages ?? [],
    getEvents: async () => details?.events ?? [],
    getState: async () => details?.state ?? null,
  };
  state.exampleThreadProviders.set(threadId, provider);
  return provider;
}
