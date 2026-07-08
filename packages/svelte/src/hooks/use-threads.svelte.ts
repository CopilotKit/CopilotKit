import { getContext } from "svelte";
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
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";

export interface Thread {
  id: string;
  agentId: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface UseThreadsInput {
  agentId: string;
  includeArchived?: boolean;
  limit?: number;
  enabled?: boolean;
}

export interface UseThreadsResult {
  threads: Thread[];
  isLoading: boolean;
  error: Error | null;
  listError: Error | null;
  fetchMoreError: Error | null;
  hasMoreThreads: boolean;
  isFetchingMoreThreads: boolean;
  isMutating: boolean;
  fetchMoreThreads: () => void;
  refetchThreads: () => void;
  startNewThread: () => void;
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  unarchiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

export function useThreads(input: UseThreadsInput): UseThreadsResult {
  const context = getContext<CopilotKitContextValue>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("useThreads must be used within CopilotKitProvider");
  }

  const store = ɵcreateThreadStore({
    fetch: globalThis.fetch,
  });

  let threads = $state<Thread[]>([]);
  let storeIsLoading = $state(false);
  let storeError = $state<Error | null>(null);
  let fetchMoreError = $state<Error | null>(null);
  let hasMoreThreads = $state(false);
  let isFetchingMoreThreads = $state(false);
  let isMutating = $state(false);
  let hasDispatchedContext = $state(false);

  function bindSelector<T>(selector: (state: any) => T): T {
    const val = selector(store.getState());
    const unsub = store.select(selector).subscribe((next: T) => {
      if (selector === ɵselectThreads) threads = next as unknown as Thread[];
      else if (selector === ɵselectThreadsIsLoading)
        storeIsLoading = next as unknown as boolean;
      else if (selector === ɵselectThreadsError)
        storeError = next as unknown as Error | null;
      else if (selector === ɵselectFetchMoreError)
        fetchMoreError = next as unknown as Error | null;
      else if (selector === ɵselectHasNextPage)
        hasMoreThreads = next as unknown as boolean;
      else if (selector === ɵselectIsFetchingNextPage)
        isFetchingMoreThreads = next as unknown as boolean;
      else if (selector === ɵselectIsMutating)
        isMutating = next as unknown as boolean;
    });
    $effect(() => unsub);
    return val;
  }

  $effect(() => {
    bindSelector(ɵselectThreads);
    bindSelector(ɵselectThreadsIsLoading);
    bindSelector(ɵselectThreadsError);
    bindSelector(ɵselectFetchMoreError);
    bindSelector(ɵselectHasNextPage);
    bindSelector(ɵselectIsFetchingNextPage);
    bindSelector(ɵselectIsMutating);
  });

  store.start();

  const threadListEndpointSupported = $derived(
    context.copilotkit.threadEndpoints?.list !== false,
  );
  const threadMutationsSupported = $derived(
    context.copilotkit.threadEndpoints?.mutations !== false,
  );
  const threadEndpointsUnavailable = $derived(
    !!context.copilotkit.runtimeUrl &&
      context.copilotkit.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Connected &&
      !threadListEndpointSupported,
  );
  const threadMutationsError = $derived(
    threadMutationsSupported
      ? null
      : new Error(
          "Thread mutations are not available on this CopilotKit runtime",
        ),
  );
  const threadEndpointsError = $derived(
    threadEndpointsUnavailable
      ? new Error(
          "Thread endpoints are not available on this CopilotKit runtime",
        )
      : null,
  );

  const resolvedEnabled = $derived(input.enabled ?? true);

  $effect(() => {
    const core = context.copilotkit;
    const runtimeUrl = core.runtimeUrl;
    const runtimeStatus = core.runtimeConnectionStatus;
    const wsUrl = core.intelligence?.wsUrl;
    const agentId = input.agentId;
    const includeArchived = input.includeArchived;
    const limit = input.limit;
    const enabled = resolvedEnabled;
    const listSupported = threadListEndpointSupported;

    if (!runtimeUrl || !enabled || !listSupported) {
      store.setContext(null);
      hasDispatchedContext = false;
      return;
    }

    if (runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
      return;
    }

    const threadContext: ɵThreadRuntimeContext = {
      runtimeUrl,
      headers: { ...core.headers },
      wsUrl,
      agentId,
      includeArchived,
      limit,
    };
    store.setContext(threadContext);
    hasDispatchedContext = true;

    return () => store.setContext(null);
  });

  $effect(() => {
    context.copilotkit.registerThreadStore(input.agentId, store);
    return () => context.copilotkit.unregisterThreadStore(input.agentId);
  });

  const runtimeError = $derived(
    context.copilotkit.runtimeUrl
      ? null
      : new Error("Runtime URL is not configured"),
  );

  const preConnectLoading = $derived(
    !!context.copilotkit.runtimeUrl &&
      resolvedEnabled &&
      !threadEndpointsUnavailable &&
      !hasDispatchedContext,
  );

  const isLoading = $derived(
    runtimeError || threadEndpointsError
      ? false
      : preConnectLoading || storeIsLoading,
  );

  const error = $derived(runtimeError ?? threadEndpointsError ?? storeError);

  const listError = $derived(storeError);

  function guardMutation<TArgs extends unknown[]>(
    mutation: (...args: TArgs) => Promise<void>,
  ): (...args: TArgs) => Promise<void> {
    return (...args: TArgs) => {
      if (threadMutationsError) {
        return Promise.reject(threadMutationsError);
      }
      return mutation(...args);
    };
  }

  return {
    get threads() {
      return threads.map(
        ({ id, agentId, name, archived, createdAt, updatedAt, lastRunAt }) => ({
          id,
          agentId,
          name,
          archived,
          createdAt,
          updatedAt,
          ...(lastRunAt !== undefined ? { lastRunAt } : {}),
        }),
      );
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    get listError() {
      return listError;
    },
    get fetchMoreError() {
      return fetchMoreError;
    },
    get hasMoreThreads() {
      return hasMoreThreads;
    },
    get isFetchingMoreThreads() {
      return isFetchingMoreThreads;
    },
    get isMutating() {
      return isMutating;
    },
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
