import { computed, onScopeDispose, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
  ɵselectThreads,
  ɵselectThreadsError,
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
}

export interface UseThreadsResult {
  threads: Ref<Thread[]>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
  hasMoreThreads: Ref<boolean>;
  isFetchingMoreThreads: Ref<boolean>;
  fetchMoreThreads: () => void;
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
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
  const hasMoreThreads = ref(false);
  const isFetchingMoreThreads = ref(false);

  bindThreadStoreSelector(store, ɵselectThreads, threads as Ref<Thread[]>);
  bindThreadStoreSelector(store, ɵselectThreadsIsLoading, storeIsLoading);
  bindThreadStoreSelector(store, ɵselectThreadsError, storeError);
  bindThreadStoreSelector(store, ɵselectHasNextPage, hasMoreThreads);
  bindThreadStoreSelector(
    store,
    ɵselectIsFetchingNextPage,
    isFetchingMoreThreads,
  );

  store.start();
  onScopeDispose(() => {
    store.stop();
  });

  // Tracks whether we've dispatched the first real context to the store.
  // The store itself starts with `isLoading: false`, so before we dispatch
  // consumers would otherwise see an empty, non-loading state (empty-list
  // flash). While runtimeUrl is set and we haven't dispatched yet, we
  // synthesize `isLoading: true` so the UI keeps its loading indicator until
  // the first fetch is in flight (at which point the store's own
  // isLoading takes over).
  const hasDispatchedContext = ref(false);

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
  watch(
    [
      () => copilotkit.value.runtimeUrl,
      () => copilotkit.value.runtimeConnectionStatus,
      headersKey,
      () => copilotkit.value.intelligence?.wsUrl,
      resolvedAgentId,
      resolvedIncludeArchived,
      resolvedLimit,
    ],
    ([runtimeUrl, runtimeStatus, , wsUrl, agentId, includeArchived, limit]) => {
      if (!runtimeUrl) {
        store.setContext(null);
        return;
      }

      if (runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
        return;
      }

      const context: ɵThreadRuntimeContext = {
        runtimeUrl,
        headers: { ...copilotkit.value.headers },
        wsUrl,
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
    () => !!copilotkit.value.runtimeUrl && !hasDispatchedContext.value,
  );

  const isLoading = computed(() =>
    runtimeError.value
      ? false
      : preConnectLoading.value || storeIsLoading.value,
  );

  const error = computed<Error | null>(
    () => runtimeError.value ?? storeError.value,
  );

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
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads: () => store.fetchNextPage(),
    renameThread: (threadId: string, name: string) =>
      store.renameThread(threadId, name),
    archiveThread: (threadId: string) => store.archiveThread(threadId),
    deleteThread: (threadId: string) => store.deleteThread(threadId),
  };
}
