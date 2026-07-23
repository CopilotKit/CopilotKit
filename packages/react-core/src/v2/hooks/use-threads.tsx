import { useCopilotKit } from "../context";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectFetchMoreError,
  ɵselectThreadsIsLoading,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
  ɵselectIsMutating,
} from "@copilotkit/core";
import type { ɵThreadRuntimeContext, ɵThreadStore } from "@copilotkit/core";
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
  /**
   * Overrides the thread page size. The default is 50 threads per page.
   * Cursor-based pagination remains active when this is omitted.
   */
  limit?: number;
  /**
   * When `false`, the hook stays inert: no runtime context is dispatched, so
   * NO thread-list fetch or realtime subscription is issued. Used by gated
   * surfaces (e.g. an unlicensed `<CopilotThreadsDrawer>`) that must not touch the
   * network until the gate opens. Defaults to `true`.
   *
   * Flipping `enabled` back to `true` resumes normal fetching on the next
   * effect run; mutations are likewise short-circuited while disabled.
   */
  enabled?: boolean;
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
   *
   * This channel folds together developer/config errors (missing runtime URL,
   * runtime without thread endpoints) and genuine list-load/mutation failures.
   * End-user surfaces that must not leak config errors should prefer
   * {@link listError}, which excludes the config/runtime-setup errors.
   */
  error: Error | null;
  /**
   * The most recent genuine list-load or mutation error from the platform, or
   * `null`. Unlike {@link error}, this EXCLUDES developer/config errors (a
   * missing runtime URL, or a runtime that does not advertise thread
   * endpoints), so an end-user surface can render it directly without leaking
   * a developer-facing configuration message into the UI.
   */
  listError: Error | null;
  /**
   * The error from the most recent FAILED next-page (fetch-more) load, or
   * `null`. Tracked separately from {@link listError} so a paginated-load
   * failure surfaces an inline "couldn't load more" affordance while the
   * already-loaded list stays visible. Cleared when a fetch-more is retried or
   * succeeds.
   */
  fetchMoreError: Error | null;
  /**
   * `true` when the latest thread-list response includes `nextCursor`.
   * Use {@link fetchMoreThreads} to load that page, including when `limit` is
   * omitted and the default page size applies.
   */
  hasMoreThreads: boolean;
  /**
   * `true` while a subsequent page of threads is being fetched.
   */
  isFetchingMoreThreads: boolean;
  /**
   * `true` while at least one thread mutation (rename, archive, unarchive,
   * delete) is awaiting a server response. Mutations apply optimistically, so
   * this is primarily useful for disabling controls or showing a subtle
   * in-flight indicator.
   */
  isMutating: boolean;
  /**
   * Fetch the next page of threads. No-op when {@link hasMoreThreads} is
   * `false` or a fetch is already in progress.
   */
  fetchMoreThreads: () => void;
  /**
   * Re-fetch the thread list from the platform without clearing the current
   * list. Backs the drawer's error-state Retry and the Active/All filter
   * refetch. No-op until the runtime is connected.
   */
  refetchThreads: () => void;
  /**
   * Reset to a fresh, non-explicit client-side thread so the welcome screen
   * shows. Lazy creation: no row appears in {@link threads} until the new
   * thread's first run persists server-side.
   */
  startNewThread: () => void;
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
   * Restore a previously archived thread on the platform.
   * The thread re-appears in default (non-archived) list results.
   * Resolves when the server confirms the update; rejects on failure.
   */
  unarchiveThread: (threadId: string) => Promise<void>;
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
    // getServerSnapshot: without this third argument React throws
    // "Missing getServerSnapshot" during SSR/prerender (e.g. Next.js). The
    // store has no client data while prerendering, so we project from its
    // stable server state.
    () => selector(store.getServerState()),
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
 * Mutation methods (`renameThread`, `archiveThread`, `unarchiveThread`,
 * `deleteThread`) return promises that resolve once the platform confirms the
 * operation and reject with an `Error` on failure.
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
  enabled = true,
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
  const fetchMoreError = useThreadStoreSelector(store, ɵselectFetchMoreError);
  const hasMoreThreads = useThreadStoreSelector(store, ɵselectHasNextPage);
  const isFetchingMoreThreads = useThreadStoreSelector(
    store,
    ɵselectIsFetchingNextPage,
  );
  const isMutating = useThreadStoreSelector(store, ɵselectIsMutating);
  const headersKey = useMemo(() => {
    return JSON.stringify(
      Object.entries(copilotkit.headers ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }, [copilotkit.headers]);
  const runtimeStatus = copilotkit.runtimeConnectionStatus;
  const threadListEndpointSupported =
    copilotkit.threadEndpoints?.list !== false;
  const threadMutationsSupported =
    copilotkit.threadEndpoints?.mutations !== false;
  const threadEndpointsUnavailable =
    !!copilotkit.runtimeUrl &&
    runtimeStatus === CopilotKitCoreRuntimeConnectionStatus.Connected &&
    !threadListEndpointSupported;
  const runtimeError = useMemo(() => {
    if (copilotkit.runtimeUrl) {
      return null;
    }

    return new Error("Runtime URL is not configured");
  }, [copilotkit.runtimeUrl]);
  const threadEndpointsError = useMemo(() => {
    if (!threadEndpointsUnavailable) {
      return null;
    }

    return new Error(
      "Thread endpoints are not available on this CopilotKit runtime",
    );
  }, [threadEndpointsUnavailable]);
  const threadMutationsError = useMemo(() => {
    if (threadMutationsSupported) {
      return null;
    }

    return new Error(
      "Thread mutations are not available on this CopilotKit runtime",
    );
  }, [threadMutationsSupported]);

  // Tracks whether we've dispatched the first real context to the store.
  // The store itself starts with `isLoading: false`, so before we dispatch
  // consumers would otherwise see an empty, non-loading state (empty-list
  // flash). While runtimeUrl is set and we haven't dispatched yet, we
  // synthesize `isLoading: true` so the UI keeps its loading indicator until
  // the first fetch is in flight (at which point the store's own
  // isLoading takes over).
  const [hasDispatchedContext, setHasDispatchedContext] = useState(false);
  const preConnectLoading =
    enabled &&
    !!copilotkit.runtimeUrl &&
    !threadEndpointsUnavailable &&
    !hasDispatchedContext;

  // `startNewThread` resets to a clean welcome surface, so it should clear any
  // lingering error banner — including the config/runtime-setup errors that
  // otherwise outrank the store's own (already-cleared) error. We cannot clear
  // a derived `runtimeError`/`threadEndpointsError` directly (they reflect
  // current config), so we suppress them with a dismissal flag that resets
  // whenever the underlying config-error identity changes (a genuine new config
  // problem re-surfaces).
  const [configErrorDismissed, setConfigErrorDismissed] = useState(false);
  useEffect(() => {
    setConfigErrorDismissed(false);
  }, [runtimeError, threadEndpointsError]);

  const activeRuntimeError = configErrorDismissed ? null : runtimeError;
  const activeThreadEndpointsError = configErrorDismissed
    ? null
    : threadEndpointsError;

  const isLoading =
    activeRuntimeError || activeThreadEndpointsError
      ? false
      : preConnectLoading || storeIsLoading;
  const error = activeRuntimeError ?? activeThreadEndpointsError ?? storeError;
  // End-user-facing list/mutation error only: developer/config errors are
  // excluded so a surface like <CopilotThreadsDrawer> does not show "Runtime URL is
  // not configured" to an end user.
  const listError = storeError;

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
  useEffect(() => {
    // A disabled (e.g. unlicensed) drawer must not claim the agentId slot. The
    // registry is single-slot/last-writer-wins, so registering an inert store
    // would evict — and on unmount tear down — a co-mounted live store for the
    // same agent. Staying unregistered while disabled leaves the live store's
    // registration intact.
    if (!enabled) return;
    copilotkit.registerThreadStore(agentId, store);
    return () => {
      copilotkit.unregisterThreadStore(agentId);
    };
  }, [copilotkit, agentId, store, enabled]);

  useEffect(() => {
    // Disabled: stay inert. Clear any previously-dispatched context so an
    // in-flight subscription is torn down and no further fetch is issued.
    if (!enabled) {
      store.setContext(null);
      setHasDispatchedContext(false);
      return;
    }

    if (!copilotkit.runtimeUrl) {
      store.setContext(null);
      setHasDispatchedContext(false);
      return;
    }

    // Wait for /info to land so we can include `wsUrl` in the initial
    // context and avoid a redundant second list fetch.
    if (runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
      return;
    }

    if (!threadListEndpointSupported) {
      store.setContext(null);
      setHasDispatchedContext(false);
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
    enabled,
    copilotkit.runtimeUrl,
    runtimeStatus,
    headersKey,
    copilotkit.intelligence?.wsUrl,
    threadListEndpointSupported,
    agentId,
    includeArchived,
    limit,
  ]);

  const guardMutation = useCallback(
    <TArgs extends unknown[]>(
      mutation: (...args: TArgs) => Promise<void>,
    ): ((...args: TArgs) => Promise<void>) => {
      return (...args: TArgs) => {
        if (threadMutationsError) {
          return Promise.reject(threadMutationsError);
        }
        return mutation(...args);
      };
    },
    [threadMutationsError],
  );

  const renameThread = useMemo(
    () =>
      guardMutation((threadId: string, name: string) =>
        store.renameThread(threadId, name),
      ),
    [store, guardMutation],
  );

  const archiveThread = useMemo(
    () => guardMutation((threadId: string) => store.archiveThread(threadId)),
    [store, guardMutation],
  );

  const unarchiveThread = useMemo(
    () => guardMutation((threadId: string) => store.unarchiveThread(threadId)),
    [store, guardMutation],
  );

  const deleteThread = useMemo(
    () => guardMutation((threadId: string) => store.deleteThread(threadId)),
    [store, guardMutation],
  );

  const fetchMoreThreads = useCallback(() => store.fetchNextPage(), [store]);
  const refetchThreads = useCallback(() => store.refetchThreads(), [store]);
  const startNewThread = useCallback(() => {
    // The store's `newThreadStarted` reducer clears its own error; also dismiss
    // the derived config/runtime-setup errors so the welcome surface renders
    // with no stale error banner.
    setConfigErrorDismissed(true);
    store.startNewThread();
  }, [store]);

  return {
    threads,
    isLoading,
    error,
    listError,
    fetchMoreError,
    hasMoreThreads,
    isFetchingMoreThreads,
    isMutating,
    fetchMoreThreads,
    refetchThreads,
    startNewThread,
    renameThread,
    archiveThread,
    unarchiveThread,
    deleteThread,
  };
}
