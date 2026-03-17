import {
  computed,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import {
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
  type ɵThread as CoreThread,
  type ɵThreadStore,
  type ɵThreadRuntimeContext,
} from "@copilotkitnext/core";
import { useCopilotKit } from "../providers/useCopilotKit";

export interface Thread extends CoreThread {}

export interface UseThreadsInput {
  userId: MaybeRefOrGetter<string>;
  agentId: MaybeRefOrGetter<string>;
}

export interface UseThreadsResult {
  threads: Ref<Thread[]>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
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
 * The hook fetches threads for the current `userId` / `agentId` pair and keeps
 * the result in sync via the core thread store's realtime channel when
 * available. Inputs accept refs/computeds to make thread context changes
 * reactive.
 */
export function useThreads(input: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();
  const store = ɵcreateThreadStore({
    fetch: globalThis.fetch,
  });

  const resolvedUserId = computed(() => toValue(input.userId));
  const resolvedAgentId = computed(() => toValue(input.agentId));
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
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  bindThreadStoreSelector(store, ɵselectThreads, threads as Ref<Thread[]>);
  bindThreadStoreSelector(store, ɵselectThreadsIsLoading, storeIsLoading);
  bindThreadStoreSelector(store, ɵselectThreadsError, storeError);

  store.start();
  onScopeDispose(() => {
    store.stop();
  });

  watch(
    [
      () => copilotkit.value.runtimeUrl,
      headersKey,
      () => copilotkit.value.intelligence?.wsUrl,
      resolvedUserId,
      resolvedAgentId,
    ],
    ([runtimeUrl, _headersKey, wsUrl, userId, agentId]) => {
      const context: ɵThreadRuntimeContext | null = runtimeUrl
        ? {
            runtimeUrl,
            headers: { ...copilotkit.value.headers },
            wsUrl,
            userId,
            agentId,
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
    threads,
    isLoading,
    error,
    renameThread: (threadId: string, name: string) =>
      store.renameThread(threadId, name),
    archiveThread: (threadId: string) => store.archiveThread(threadId),
    deleteThread: (threadId: string) => store.deleteThread(threadId),
  };
}
