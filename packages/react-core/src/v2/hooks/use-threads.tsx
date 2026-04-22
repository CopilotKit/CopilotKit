import { useCopilotKit } from "../providers/CopilotKitProvider";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
  type ɵThreadRuntimeContext,
  type ɵThreadStore,
} from "@copilotkit/core";
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
export interface Thread {
  id: string;
  agentId: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * ISO-8601 timestamp of the most recent agent run on this thread. Absent
   * when the thread has never been run. Prefer this over `updatedAt` for
   * user-facing "last activity" displays — it is not bumped by metadata-only
   * actions like rename or archive.
   */
  lastRunAt?: string;
}

/**
 * Configuration for the {@link useThreads} hook.
 *
 * Thread operations are scoped to the runtime-authenticated user and the
 * provided agent on the Intelligence platform.
 */
export interface UseThreadsInput {
  /** The ID of the agent whose threads to list and manage. */
  agentId: string;
  /** When `true`, archived threads are included in the list. Defaults to `false`. */
  includeArchived?: boolean;
  /** Maximum number of threads to fetch per page. When set, enables cursor-based pagination. */
  limit?: number;
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
   * Threads for the current user/agent pair, sorted by most recently
   * updated first. Updated in realtime when the platform pushes metadata
   * events. Includes archived threads only when `includeArchived` is set.
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
   * `true` when there are more threads available to fetch via
   * {@link fetchMoreThreads}. Only meaningful when `limit` is set.
   */
  hasMoreThreads: boolean;
  /**
   * `true` while a subsequent page of threads is being fetched.
   */
  isFetchingMoreThreads: boolean;
  /**
   * Fetch the next page of threads. No-op when {@link hasMoreThreads} is
   * `false` or a fetch is already in progress.
   */
  fetchMoreThreads: () => void;
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
 * On mount the hook fetches the thread list for the runtime-authenticated user
 * and the given `agentId`. When the Intelligence platform exposes a WebSocket
 * URL, it also opens a realtime subscription so the `threads` array stays
 * current without polling — thread creates, renames, archives, and deletes
 * from any client are reflected immediately.
 *
 * Mutation methods (`renameThread`, `archiveThread`, `deleteThread`) return
 * promises that resolve once the platform confirms the operation and reject
 * with an `Error` on failure.
 *
 * @param input - Agent identifier and optional list controls.
 * @returns Thread list state and stable mutation callbacks.
 *
 * @example
 * ```tsx
 * import { useThreads } from "@copilotkit/react-core";
 *
 * function ThreadList() {
 *   const { threads, isLoading, renameThread, deleteThread } = useThreads({
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
  agentId,
  includeArchived,
  limit,
}: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();

  const [store] = useState(() =>
    ɵcreateThreadStore({
      fetch: globalThis.fetch,
    }),
  );

  const coreThreads = useThreadStoreSelector(store, ɵselectThreads);
  const threads: Thread[] = useMemo(
    () =>
      coreThreads.map(
        ({ id, agentId, name, archived, createdAt, updatedAt, lastRunAt }) => ({
          id,
          agentId,
          name,
          archived,
          createdAt,
          updatedAt,
          ...(lastRunAt !== undefined ? { lastRunAt } : {}),
        }),
      ),
    [coreThreads],
  );
  const storeIsLoading = useThreadStoreSelector(store, ɵselectThreadsIsLoading);
  const storeError = useThreadStoreSelector(store, ɵselectThreadsError);
  const hasMoreThreads = useThreadStoreSelector(store, ɵselectHasNextPage);
  const isFetchingMoreThreads = useThreadStoreSelector(
    store,
    ɵselectIsFetchingNextPage,
  );
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

  // Tracks whether we've dispatched the first real context to the store.
  // The store itself starts with `isLoading: false`, so before we dispatch
  // consumers would otherwise see an empty, non-loading state (empty-list
  // flash). While runtimeUrl is set and we haven't dispatched yet, we
  // synthesize `isLoading: true` so the UI keeps its loading indicator until
  // the first fetch is in flight (at which point the store's own
  // isLoading takes over).
  const [hasDispatchedContext, setHasDispatchedContext] = useState(false);
  const preConnectLoading = !!copilotkit.runtimeUrl && !hasDispatchedContext;

  const isLoading = runtimeError
    ? false
    : preConnectLoading || storeIsLoading;
  const error = runtimeError ?? storeError;

  useEffect(() => {
    store.start();
    return () => {
      store.stop();
    };
  }, [store]);

  // Defer setting the context until the runtime reports Connected. Before
  // `/info` resolves we don't know `intelligence.wsUrl`, so dispatching the
  // context early would issue a list fetch with `wsUrl: undefined`, then a
  // second list fetch (and a `/threads/subscribe`) once the flag lands.
  // Waiting lets the hook issue just one `/threads?…` + one `/threads/subscribe`.
  //
  // When `runtimeUrl` is absent we dispatch `null` to clear the store. For
  // transient states (Disconnected/Connecting/Error with a URL still set) we
  // leave the previously-dispatched context in place — any in-flight
  // realtime subscription or cached thread list stays usable while the
  // runtime recovers, and we don't re-trigger a fetch storm on transitions.
  const runtimeStatus = copilotkit.runtimeConnectionStatus;
  useEffect(() => {
    if (!copilotkit.runtimeUrl) {
      store.setContext(null);
      return;
    }

    // Wait for /info to land so we can include `wsUrl` in the initial
    // context and avoid a redundant second list fetch.
    if (runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
      return;
    }

    const context: ɵThreadRuntimeContext = {
      runtimeUrl: copilotkit.runtimeUrl,
      headers: { ...copilotkit.headers },
      wsUrl: copilotkit.intelligence?.wsUrl,
      agentId,
      includeArchived,
      limit,
    };

    store.setContext(context);
    setHasDispatchedContext(true);
  }, [
    store,
    copilotkit.runtimeUrl,
    runtimeStatus,
    headersKey,
    copilotkit.intelligence?.wsUrl,
    agentId,
    copilotkit.headers,
    includeArchived,
    limit,
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

  const fetchMoreThreads = useCallback(() => store.fetchNextPage(), [store]);

  return {
    threads,
    isLoading,
    error,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads,
    renameThread,
    archiveThread,
    deleteThread,
  };
}
