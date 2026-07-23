import { computed, onScopeDispose, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
  ɵselectIsMutating,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectFetchMoreError,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type { ɵThreadRuntimeContext, ɵThreadStore } from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";

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

export interface UseThreadsInput {
  agentId: MaybeRefOrGetter<string>;
  includeArchived?: MaybeRefOrGetter<boolean | undefined>;
  limit?: MaybeRefOrGetter<number | undefined>;
  /**
   * When `false`, the hook clears the store context and issues no `/threads`
   * request — used by the drawer to skip fetching while unlicensed. Defaults
   * to `true`.
   */
  enabled?: MaybeRefOrGetter<boolean | undefined>;
}

export interface UseThreadsResult {
  threads: Ref<Thread[]>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
  /** Genuine list-load/mutation errors only — excludes dev/config errors. */
  listError: Ref<Error | null>;
  /**
   * Error from the most recent FAILED next-page (fetch-more) load, or `null`.
   * Tracked separately from {@link listError} so a paginated-load failure
   * shows an inline "couldn't load more" affordance while the loaded list
   * stays visible. Cleared when a fetch-more is retried or succeeds.
   */
  fetchMoreError: Ref<Error | null>;
  hasMoreThreads: Ref<boolean>;
  isFetchingMoreThreads: Ref<boolean>;
  isMutating: Ref<boolean>;
  fetchMoreThreads: () => void;
  refetchThreads: () => void;
  startNewThread: () => void;
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  unarchiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

function bindThreadStoreSelector<T>(
  store: ɵThreadStore,
  selector: (state: ReturnType<ɵThreadStore["getState"]>) => T,
  target: Ref<T>,
): void {
  target.value = selector(store.getState());
  const subscription = store.select(selector).subscribe(() => {
    target.value = selector(store.getState());
  });
  onScopeDispose(() => subscription.unsubscribe());
}

/**
 * Vue composable for listing and managing Intelligence platform threads.
 *
 * The hook fetches threads for the runtime-authenticated user and the given
 * `agentId`, then keeps the result in sync via the core thread store's realtime
 * channel when available. Inputs accept refs/computeds to make thread context
 * changes reactive.
 */
export function useThreads(input: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();
  const store = ɵcreateThreadStore({
    fetch: globalThis.fetch,
  });

  const resolvedAgentId = computed(() => toValue(input.agentId));
  const resolvedIncludeArchived = computed(() =>
    toValue(input.includeArchived),
  );
  const resolvedLimit = computed(() => toValue(input.limit));
  const resolvedEnabled = computed(() => toValue(input.enabled) ?? true);

  // Thread-endpoint capability, derived from the runtime's `/info` payload.
  // `threadEndpoints` is `undefined` on legacy runtimes that don't advertise
  // the capability, so we treat "not explicitly false" as supported (matching
  // React's `!== false` semantics) to preserve legacy thread behavior.
  const threadListEndpointSupported = computed(
    () => copilotkit.value.threadEndpoints?.list !== false,
  );
  const threadMutationsSupported = computed(
    () => copilotkit.value.threadEndpoints?.mutations !== false,
  );
  // Connected, but the runtime explicitly does not serve the list endpoint.
  const threadEndpointsUnavailable = computed(
    () =>
      !!copilotkit.value.runtimeUrl &&
      copilotkit.value.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Connected &&
      !threadListEndpointSupported.value,
  );
  const threadEndpointsError = computed<Error | null>(() =>
    threadEndpointsUnavailable.value
      ? new Error(
          "Thread endpoints are not available on this CopilotKit runtime",
        )
      : null,
  );
  const threadMutationsError = computed<Error | null>(() =>
    threadMutationsSupported.value
      ? null
      : new Error(
          "Thread mutations are not available on this CopilotKit runtime",
        ),
  );

  const headersKey = computed(() =>
    JSON.stringify(
      Object.entries(copilotkit.value.headers ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );

  const threads = ref<Thread[]>([]);
  const storeIsLoading = ref(false);
  const storeError = ref<Error | null>(null);
  const fetchMoreError = ref<Error | null>(null);
  const hasMoreThreads = ref(false);
  const isFetchingMoreThreads = ref(false);
  const isMutating = ref(false);

  bindThreadStoreSelector(store, ɵselectThreads, threads as Ref<Thread[]>);
  bindThreadStoreSelector(store, ɵselectThreadsIsLoading, storeIsLoading);
  bindThreadStoreSelector(store, ɵselectThreadsError, storeError);
  bindThreadStoreSelector(store, ɵselectFetchMoreError, fetchMoreError);
  bindThreadStoreSelector(store, ɵselectHasNextPage, hasMoreThreads);
  bindThreadStoreSelector(
    store,
    ɵselectIsFetchingNextPage,
    isFetchingMoreThreads,
  );
  bindThreadStoreSelector(store, ɵselectIsMutating, isMutating);

  store.start();
  onScopeDispose(() => {
    store.stop();
  });

  // Register this store in core's single-slot thread-store registry so other
  // surfaces (e.g. the chat view) can resolve the same store for the agent.
  //
  // Gated on `resolvedEnabled`: a disabled (e.g. unlicensed) drawer must not
  // claim the agentId slot. The registry is single-slot/last-writer-wins, so
  // registering an inert store would evict — and on unmount tear down — a
  // co-mounted live store for the same agent. Staying unregistered while
  // disabled leaves the live store's registration intact.
  watch(
    [resolvedEnabled, resolvedAgentId],
    ([enabled, agentId], _prev, onCleanup) => {
      if (!enabled) return;
      copilotkit.value.registerThreadStore(agentId, store);
      onCleanup(() => {
        copilotkit.value.unregisterThreadStore(agentId);
      });
    },
    { immediate: true },
  );

  // Tracks whether we've dispatched the first real context to the store.
  // The store itself starts with `isLoading: false`, so before we dispatch
  // consumers would otherwise see an empty, non-loading state (empty-list
  // flash). While runtimeUrl is set and we haven't dispatched yet, we
  // synthesize `isLoading: true` so the UI keeps its loading indicator until
  // the first fetch is in flight (at which point the store's own
  // isLoading takes over).
  const hasDispatchedContext = ref(false);

  // Defer setting the context until the runtime reports Connected. Before then
  // the shared metadata socket isn't seeded, so the context's `getMetadataSocket`
  // provider can't resolve one — dispatching early would fetch the list with
  // realtime silently absent, then re-dispatch once Connected (a new session, so
  // a second list fetch and a `/threads/subscribe`). Waiting lets the hook issue
  // just one `/threads?…` + one `/threads/subscribe`.
  //
  // When `runtimeUrl` is absent we dispatch `null` to clear the store. For
  // transient states (Disconnected/Connecting/Error with a URL still set) we
  // leave the previously-dispatched context in place — any in-flight
  // realtime subscription or cached thread list stays usable while the
  // runtime recovers, and we don't re-trigger a fetch storm on transitions.
  watch(
    [
      () => copilotkit.value.runtimeUrl,
      () => copilotkit.value.runtimeConnectionStatus,
      headersKey,
      () => copilotkit.value.intelligence?.wsUrl,
      resolvedAgentId,
      resolvedIncludeArchived,
      resolvedLimit,
      resolvedEnabled,
      threadListEndpointSupported,
    ],
    ([
      runtimeUrl,
      runtimeStatus,
      ,
      ,
      agentId,
      includeArchived,
      limit,
      enabled,
      listEndpointSupported,
    ]) => {
      if (!runtimeUrl || !enabled) {
        store.setContext(null);
        hasDispatchedContext.value = false;
        return;
      }

      if (runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
        return;
      }

      // Connected, but the runtime explicitly does not serve the list
      // endpoint: stay inert so no `/threads` fetch fires. The
      // `threadEndpointsError` surfaces via `error` instead.
      if (!listEndpointSupported) {
        store.setContext(null);
        hasDispatchedContext.value = false;
        return;
      }

      const context: ɵThreadRuntimeContext = {
        runtimeUrl,
        headers: { ...copilotkit.value.headers },
        getMetadataSocket: (joinToken) =>
          copilotkit.value.ɵgetMetadataSocket(joinToken) ?? null,
        agentId,
        includeArchived,
        limit,
      };

      store.setContext(context);
      hasDispatchedContext.value = true;
    },
    { immediate: true },
  );

  const runtimeError = computed<Error | null>(() =>
    copilotkit.value.runtimeUrl
      ? null
      : new Error("Runtime URL is not configured"),
  );

  const preConnectLoading = computed(
    () =>
      !!copilotkit.value.runtimeUrl &&
      resolvedEnabled.value &&
      !threadEndpointsUnavailable.value &&
      !hasDispatchedContext.value,
  );

  const isLoading = computed(() =>
    runtimeError.value || threadEndpointsError.value
      ? false
      : preConnectLoading.value || storeIsLoading.value,
  );

  // Folds developer/config errors (missing runtime URL, runtime without
  // thread endpoints) together with genuine store errors. `listError` below
  // deliberately excludes the config errors.
  const error = computed<Error | null>(
    () => runtimeError.value ?? threadEndpointsError.value ?? storeError.value,
  );

  // Genuine store errors only. Unlike `error`, this omits the dev/config
  // `runtimeError`/`threadEndpointsError` strings so they are never shown in
  // user-facing error UI.
  const listError = computed<Error | null>(() => storeError.value);

  // Reject mutations locally (before touching the network) when the runtime
  // reports mutations are unsupported, matching React's `guardMutation`.
  function guardMutation<TArgs extends unknown[]>(
    mutation: (...args: TArgs) => Promise<void>,
  ): (...args: TArgs) => Promise<void> {
    return (...args: TArgs) => {
      if (threadMutationsError.value) {
        return Promise.reject(threadMutationsError.value);
      }
      return mutation(...args);
    };
  }

  return {
    threads: computed(() =>
      threads.value.map(
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
    ),
    isLoading,
    error,
    listError,
    fetchMoreError,
    hasMoreThreads,
    isFetchingMoreThreads,
    isMutating,
    fetchMoreThreads: () => store.fetchNextPage(),
    refetchThreads: () => store.refetchThreads(),
    startNewThread: () => store.startNewThread(),
    renameThread: guardMutation((threadId: string, name: string) =>
      store.renameThread(threadId, name),
    ),
    archiveThread: guardMutation((threadId: string) =>
      store.archiveThread(threadId),
    ),
    unarchiveThread: guardMutation((threadId: string) =>
      store.unarchiveThread(threadId),
    ),
    deleteThread: guardMutation((threadId: string) =>
      store.deleteThread(threadId),
    ),
  };
}
