import {
  computed,
  DestroyRef,
  effect,
  inject,
  type Signal,
  signal,
} from "@angular/core";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
  type ɵThread,
  type ɵThreadRuntimeContext,
  type ɵThreadStore,
} from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";

export interface Thread {
  id: string;
  agentId: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface InjectThreadsInput {
  agentId: string | Signal<string | undefined>;
  includeArchived?: boolean | Signal<boolean | undefined>;
  limit?: number | Signal<number | undefined>;
}

export interface InjectThreadsResult {
  threads: Signal<Thread[]>;
  isLoading: Signal<boolean>;
  error: Signal<Error | null>;
  hasMoreThreads: Signal<boolean>;
  isFetchingMoreThreads: Signal<boolean>;
  fetchMoreThreads: () => void;
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

function inputSignal<T>(value: T | Signal<T>): Signal<T> {
  return typeof value === "function"
    ? (value as Signal<T>)
    : computed(() => value);
}

function selectorSignal<T>(
  store: ɵThreadStore,
  version: Signal<number>,
  selector: (state: ReturnType<ɵThreadStore["getState"]>) => T,
): Signal<T> {
  return computed(() => {
    version();
    return selector(store.getState());
  });
}

export function injectThreads(input: InjectThreadsInput): InjectThreadsResult {
  const copilotkit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);
  const store = ɵcreateThreadStore({ fetch: globalThis.fetch });
  const version = signal(0);
  const hasDispatchedContext = signal(false);

  const agentIdSignal = inputSignal(input.agentId);
  const includeArchived = inputSignal(input.includeArchived);
  const limit = inputSignal(input.limit);

  const threadsState = selectorSignal<ɵThread[]>(store, version, (state) =>
    ɵselectThreads(state),
  );
  const threads = computed<Thread[]>(() =>
    threadsState().map(
      ({
        id,
        agentId: threadAgentId,
        name,
        archived,
        createdAt,
        updatedAt,
        lastRunAt,
      }) => ({
        id,
        agentId: threadAgentId,
        name,
        archived,
        createdAt,
        updatedAt,
        ...(lastRunAt !== undefined ? { lastRunAt } : {}),
      }),
    ),
  );
  const storeIsLoading = selectorSignal<boolean>(store, version, (state) =>
    ɵselectThreadsIsLoading(state),
  );
  const storeError = selectorSignal<Error | null>(store, version, (state) =>
    ɵselectThreadsError(state),
  );
  const hasMoreThreads = selectorSignal<boolean>(store, version, (state) =>
    ɵselectHasNextPage(state),
  );
  const isFetchingMoreThreads = selectorSignal<boolean>(
    store,
    version,
    (state) => ɵselectIsFetchingNextPage(state),
  );

  const runtimeError = computed(() => {
    if (copilotkit.runtimeUrl()) {
      return null;
    }

    return new Error("Runtime URL is not configured");
  });
  const runtimeStatus = computed(() => copilotkit.runtimeConnectionStatus());
  const context = computed<ɵThreadRuntimeContext | null>(() => {
    const runtimeUrl = copilotkit.runtimeUrl();
    const resolvedAgentId = agentIdSignal();

    if (
      !runtimeUrl ||
      !resolvedAgentId ||
      runtimeStatus() !== CopilotKitCoreRuntimeConnectionStatus.Connected
    ) {
      return null;
    }

    return {
      runtimeUrl,
      headers: { ...copilotkit.headers() },
      wsUrl: copilotkit.intelligence()?.wsUrl,
      agentId: resolvedAgentId,
      includeArchived: includeArchived(),
      limit: limit(),
      threadEndpoints: copilotkit.threadEndpoints(),
    };
  });

  const isLoading = computed(() =>
    runtimeError()
      ? false
      : (!!copilotkit.runtimeUrl() && !hasDispatchedContext()) ||
        storeIsLoading(),
  );
  const error = computed(() => runtimeError() ?? storeError());

  store.start();
  const subscription = store
    .select((state) => state)
    .subscribe(() => {
      version.update((current) => current + 1);
    });

  effect((onCleanup) => {
    const resolvedAgentId = agentIdSignal();
    if (!resolvedAgentId) {
      return;
    }

    copilotkit.registerThreadStore(resolvedAgentId, store);
    onCleanup(() => {
      copilotkit.unregisterThreadStore(resolvedAgentId);
    });
  });

  effect(() => {
    const nextContext = context();

    if (!copilotkit.runtimeUrl()) {
      store.setContext(null);
      hasDispatchedContext.set(false);
      return;
    }

    if (runtimeStatus() !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
      return;
    }

    store.setContext(nextContext);
    hasDispatchedContext.set(nextContext !== null);
  });

  destroyRef.onDestroy(() => {
    subscription.unsubscribe();
    store.stop();
  });

  return {
    threads,
    isLoading,
    error,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads: () => store.fetchNextPage(),
    renameThread: (threadId, name) => store.renameThread(threadId, name),
    archiveThread: (threadId) => store.archiveThread(threadId),
    deleteThread: (threadId) => store.deleteThread(threadId),
  };
}
