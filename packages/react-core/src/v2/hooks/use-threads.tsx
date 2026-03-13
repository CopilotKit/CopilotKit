import { useCopilotKit } from "@/providers/CopilotKitProvider";
import {
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
  type ɵThread as CoreThread,
  type ɵThreadRuntimeContext,
  type ɵThreadStore,
} from "@copilotkitnext/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * A conversation thread managed by the Intelligence platform.
 *
 * Each thread has a unique `id`, an optional human-readable `name`, and
 * timestamp fields tracking creation and update times.
 */
export interface Thread extends CoreThread {}

/**
 * Configuration for the {@link useThreads} hook.
 *
 * Both fields are required — they scope the thread list and all mutations
 * to a specific user/agent pair on the Intelligence platform.
 */
export interface UseThreadsInput {
  /** The ID of the current user. Thread queries and mutations are scoped to this user. */
  userId: string;
  /** The ID of the agent whose threads to list and manage. */
  agentId: string;
}

/**
 * Return value of the {@link useThreads} hook.
 *
 * The `threads` array is kept in sync with the platform via a realtime
 * WebSocket subscription (when available) and is sorted most-recently-updated
 * first. Mutations reject with an `Error` if the platform request fails.
 */
export interface UseThreadsResult {
  /**
   * All non-archived threads for the current user/agent pair, sorted by
   * most recently updated first. Updated in realtime when the platform
   * pushes metadata events.
   */
  threads: Thread[];
  /**
   * `true` while the initial thread list is being fetched from the platform.
   * Subsequent realtime updates do not re-enter the loading state.
   */
  isLoading: boolean;
  /**
   * The most recent error from fetching threads or executing a mutation,
   * or `null` when there is no error. Reset to `null` on the next
   * successful fetch.
   */
  error: Error | null;
  /**
   * Rename a thread on the platform.
   * Resolves when the server confirms the update; rejects on failure.
   */
  renameThread: (threadId: string, name: string) => Promise<void>;
  /**
   * Archive a thread on the platform.
   * Archived threads are excluded from subsequent list results.
   * Resolves when the server confirms the update; rejects on failure.
   */
  archiveThread: (threadId: string) => Promise<void>;
  /**
   * Permanently delete a thread from the platform.
   * This is irreversible. Resolves when the server confirms deletion;
   * rejects on failure.
   */
  deleteThread: (threadId: string) => Promise<void>;
}

function useThreadStoreSelector<T>(
  store: ɵThreadStore,
  selector: (state: ReturnType<ɵThreadStore["getState"]>) => T,
): T {
  return useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        const subscription = store.select(selector).subscribe(onStoreChange);
        return () => subscription.unsubscribe();
      },
      [store, selector],
    ),
    () => selector(store.getState()),
  );
}

/**
 * React hook for listing and managing Intelligence platform threads.
 *
 * On mount the hook fetches the thread list for the given `userId`/`agentId`
 * pair. When the Intelligence platform exposes a WebSocket URL, it also opens
 * a realtime subscription so the `threads` array stays current without
 * polling — thread creates, renames, archives, and deletes from any client
 * are reflected immediately.
 *
 * Mutation methods (`renameThread`, `archiveThread`, `deleteThread`) return
 * promises that resolve once the platform confirms the operation and reject
 * with an `Error` on failure.
 *
 * @param input - User and agent identifiers that scope the thread list.
 * @returns Thread list state and stable mutation callbacks.
 *
 * @example
 * ```tsx
 * import { useThreads } from "@copilotkitnext/react";
 *
 * function ThreadList() {
 *   const { threads, isLoading, renameThread, deleteThread } = useThreads({
 *     userId: "user-1",
 *     agentId: "agent-1",
 *   });
 *
 *   if (isLoading) return <p>Loading…</p>;
 *
 *   return (
 *     <ul>
 *       {threads.map((t) => (
 *         <li key={t.id}>
 *           {t.name ?? "Untitled"}
 *           <button onClick={() => renameThread(t.id, "New name")}>Rename</button>
 *           <button onClick={() => deleteThread(t.id)}>Delete</button>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useThreads({
  userId,
  agentId,
}: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();

  const [store] = useState(() =>
    ɵcreateThreadStore({
      fetch: globalThis.fetch,
    }),
  );

  const threads = useThreadStoreSelector(store, ɵselectThreads);
  const storeIsLoading = useThreadStoreSelector(store, ɵselectThreadsIsLoading);
  const storeError = useThreadStoreSelector(store, ɵselectThreadsError);
  const headersKey = useMemo(() => {
    return JSON.stringify(
      Object.entries(copilotkit.headers ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }, [copilotkit.headers]);
  const runtimeError = useMemo(() => {
    if (copilotkit.runtimeUrl) {
      return null;
    }

    return new Error("Runtime URL is not configured");
  }, [copilotkit.runtimeUrl]);
  const isLoading = runtimeError ? false : storeIsLoading;
  const error = runtimeError ?? storeError;

  useEffect(() => {
    store.start();
    return () => {
      store.stop();
    };
  }, [store]);

  useEffect(() => {
    const context: ɵThreadRuntimeContext | null = copilotkit.runtimeUrl
      ? {
          runtimeUrl: copilotkit.runtimeUrl,
          headers: { ...copilotkit.headers },
          wsUrl: copilotkit.intelligence?.wsUrl,
          userId,
          agentId,
        }
      : null;

    store.setContext(context);
  }, [
    store,
    copilotkit.runtimeUrl,
    headersKey,
    copilotkit.intelligence?.wsUrl,
    userId,
    agentId,
    copilotkit.headers,
  ]);

  const renameThread = useCallback(
    (threadId: string, name: string) => store.renameThread(threadId, name),
    [store],
  );

  const archiveThread = useCallback(
    (threadId: string) => store.archiveThread(threadId),
    [store],
  );

  const deleteThread = useCallback(
    (threadId: string) => store.deleteThread(threadId),
    [store],
  );

  return {
    threads,
    isLoading,
    error,
    renameThread,
    archiveThread,
    deleteThread,
  };
}
