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

export interface CreateThreadsInput {
  agentId: string;
  includeArchived?: boolean;
  limit?: number;
  enabled?: boolean;
}

export interface CreateThreadsResult {
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

export function createThreads(input: CreateThreadsInput): CreateThreadsResult {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("createThreads must be used within CopilotKitProvider");
  }

  // The core object is kept for operations (register/unregister) and the
  // instrumented transport. All reactive runtime state below is read through
  // the provider getters (context.runtimeUrl, context.headers, ...), never
  // through the non-reactive fields on the core object — mirroring
  // react-core's useThreads, which reads useCopilotKit() state.
  const core = context.copilotkit;

  const store = ɵcreateThreadStore({
    fetch: core.ɵruntimeFetch,
  });

  let threads = $state<Thread[]>([]);
  let storeIsLoading = $state(false);
  let storeError = $state<Error | null>(null);
  let fetchMoreError = $state<Error | null>(null);
  let hasMoreThreads = $state(false);
  let isFetchingMoreThreads = $state(false);
  let isMutating = $state(false);
  let hasDispatchedContext = $state(false);

  function bindSelector<T>(
    selector: (state: ReturnType<ɵThreadStore["getState"]>) => T,
  ) {
    const val = selector(store.getState());
    const subscription = store.select(selector).subscribe((next: T) => {
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
    return {
      initialValue: val,
      unsubscribe: () => subscription.unsubscribe(),
    };
  }

  $effect(() => {
    const threadsBinding = bindSelector(ɵselectThreads);
    const storeIsLoadingBinding = bindSelector(ɵselectThreadsIsLoading);
    const storeErrorBinding = bindSelector(ɵselectThreadsError);
    const fetchMoreErrorBinding = bindSelector(ɵselectFetchMoreError);
    const hasMoreThreadsBinding = bindSelector(ɵselectHasNextPage);
    const isFetchingMoreThreadsBinding = bindSelector(
      ɵselectIsFetchingNextPage,
    );
    const isMutatingBinding = bindSelector(ɵselectIsMutating);

    threads = threadsBinding.initialValue as Thread[];
    storeIsLoading = storeIsLoadingBinding.initialValue as boolean;
    storeError = storeErrorBinding.initialValue as Error | null;
    fetchMoreError = fetchMoreErrorBinding.initialValue as Error | null;
    hasMoreThreads = hasMoreThreadsBinding.initialValue as boolean;
    isFetchingMoreThreads =
      isFetchingMoreThreadsBinding.initialValue as boolean;
    isMutating = isMutatingBinding.initialValue as boolean;

    return () => {
      threadsBinding.unsubscribe();
      storeIsLoadingBinding.unsubscribe();
      storeErrorBinding.unsubscribe();
      fetchMoreErrorBinding.unsubscribe();
      hasMoreThreadsBinding.unsubscribe();
      isFetchingMoreThreadsBinding.unsubscribe();
      isMutatingBinding.unsubscribe();
    };
  });

  $effect(() => {
    store.start();
    return () => {
      store.setContext(null);
      store.stop();
    };
  });

  // Reactive input getters (agentId/enabled/includeArchived/limit) and
  // provider getters are read inside $derived/$effect so updates rerun them.
  const resolvedEnabled = $derived(input.enabled ?? true);

  const threadListEndpointSupported = $derived(
    context.threadEndpoints?.list !== false,
  );
  const threadMutationsSupported = $derived(
    context.threadEndpoints?.mutations !== false,
  );
  const threadEndpointsUnavailable = $derived(
    !!context.runtimeUrl &&
      context.runtimeConnectionStatus ===
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

  $effect(() => {
    const enabled = input.enabled ?? true;
    const runtimeUrl = context.runtimeUrl;
    const runtimeStatus = context.runtimeConnectionStatus;
    const headers = context.headers;
    const endpoints = context.threadEndpoints;
    const intelligence = context.intelligence;
    const agentId = input.agentId;
    const includeArchived = input.includeArchived;
    const limit = input.limit;
    const listSupported = endpoints?.list !== false;

    const clearContext = () => {
      if (hasDispatchedContext) {
        store.setContext(null);
      }
      hasDispatchedContext = false;
    };

    // Disabled: stay inert and tear down any previously-dispatched context
    // so an in-flight subscription is closed and no further fetch is issued.
    if (!enabled) {
      clearContext();
      return;
    }

    if (!runtimeUrl) {
      clearContext();
      return;
    }

    // Defer setting the context until the runtime reports Connected. Before
    // `/info` resolves we don't know `intelligence.wsUrl`, so dispatching
    // early would issue a list fetch without it, then a second one once it
    // lands. For transient states (Disconnected/Connecting/Error with a URL
    // still set) the previously-dispatched context stays in place.
    if (runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
      return;
    }

    if (!listSupported) {
      clearContext();
      return;
    }

    const threadContext: ɵThreadRuntimeContext = {
      runtimeUrl,
      headers: { ...headers },
      wsUrl: intelligence?.wsUrl,
      agentId,
      includeArchived,
      limit,
    };
    store.setContext(threadContext);
    hasDispatchedContext = true;
  });

  $effect(() => {
    const enabled = input.enabled ?? true;
    const nextAgentId = input.agentId;
    // A disabled (e.g. unlicensed) surface must not claim the agentId slot.
    // The registry is single-slot/last-writer-wins, so registering an inert
    // store would evict — and on unmount tear down — a co-mounted live store
    // for the same agent. Staying unregistered while disabled leaves the live
    // store's registration intact. Mirrors react-core's use-threads gate.
    //
    // The cleanup unregisters exactly the id this run registered: on an
    // agentId change it releases the previous id before the next run
    // registers the new one; on an enabled true→false flip it releases the
    // active id and the re-run registers nothing; on unmount it releases the
    // active id only (an initially-disabled hook never registers, so its
    // unmount unregisters nothing).
    if (!enabled) {
      return;
    }
    core.registerThreadStore(nextAgentId, store);
    return () => {
      core.unregisterThreadStore(nextAgentId);
    };
  });

  const runtimeError = $derived(
    context.runtimeUrl ? null : new Error("Runtime URL is not configured"),
  );

  const preConnectLoading = $derived(
    !!context.runtimeUrl &&
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
