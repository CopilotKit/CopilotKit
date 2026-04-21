import { computed, onScopeDispose, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import {
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
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

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

  watch(
    [
      () => copilotkit.value.runtimeUrl,
      headersKey,
      () => copilotkit.value.intelligence?.wsUrl,
      resolvedAgentId,
      resolvedIncludeArchived,
      resolvedLimit,
    ],
    ([runtimeUrl, _headersKey, wsUrl, agentId, includeArchived, limit]) => {
      const context: ɵThreadRuntimeContext | null = runtimeUrl
        ? {
            runtimeUrl,
            headers: { ...copilotkit.value.headers },
            wsUrl,
            agentId,
            includeArchived,
            limit,
          }
        : null;

      store.setContext(context);
    },
    { immediate: true },
  );

  watch(
    [() => copilotkit.value.runtimeUrl, storeIsLoading, storeError],
    ([runtimeUrl, loading, latestError]) => {
      if (runtimeUrl) {
        isLoading.value = loading;
        error.value = latestError;
        return;
      }

      isLoading.value = false;
      error.value = new Error("Runtime URL is not configured");
    },
    { immediate: true },
  );

  return {
    threads: computed(() =>
      threads.value.map(
        ({ id, agentId, name, archived, createdAt, updatedAt }) => ({
          id,
          agentId,
          name,
          archived,
          createdAt,
          updatedAt,
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
