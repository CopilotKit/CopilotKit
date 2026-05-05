import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import type { Signal } from "@angular/core";
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
import { CopilotKit } from "./copilotkit";

/**
 * A conversation thread managed by the Intelligence platform.
 */
export interface Thread {
  id: string;
  agentId: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface InjectThreadStoreInput {
  agentId: string | Signal<string>;
  includeArchived?: boolean | Signal<boolean | undefined>;
  limit?: number | Signal<number | undefined>;
}

export interface ThreadStoreSignal {
  /** Threads sorted by most recently updated first. */
  threads: Signal<Thread[]>;
  /** `true` while the initial thread list is being fetched. */
  isLoading: Signal<boolean>;
  /** Most recent fetch / mutation error, or `null`. */
  error: Signal<Error | null>;
  /** `true` when there are more threads available via `fetchMoreThreads`. */
  hasMoreThreads: Signal<boolean>;
  /** `true` while the next page is being fetched. */
  isFetchingMoreThreads: Signal<boolean>;
  fetchMoreThreads: () => void;
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
}

function toSignalish<T>(value: T | Signal<T>): Signal<T> {
  return typeof value === "function"
    ? (value as Signal<T>)
    : computed(() => value);
}

@Injectable({ providedIn: "root" })
export class CopilotkitThreadFactory {
  readonly #copilotkit = inject(CopilotKit);

  createThreadStoreSignal(
    input: {
      agentId: Signal<string>;
      includeArchived: Signal<boolean | undefined>;
      limit: Signal<number | undefined>;
    },
    destroyRef: DestroyRef,
  ): ThreadStoreSignal {
    const store: ɵThreadStore = ɵcreateThreadStore({
      fetch: globalThis.fetch.bind(globalThis),
    });
    store.start();

    type ThreadState = ReturnType<ɵThreadStore["getState"]>;
    type ThreadRecord = ThreadState["threads"][number];

    const initialState = store.getState() as ThreadState;
    const coreThreads = signal<ThreadRecord[]>(initialState.threads);
    const isLoadingState = signal<boolean>(initialState.isLoading);
    const errorState = signal<Error | null>(initialState.error);
    const hasMoreState = signal<boolean>(initialState.nextCursor != null);
    const isFetchingMoreState = signal<boolean>(
      initialState.isFetchingNextPage,
    );

    const subscriptions = [
      store.select(ɵselectThreads).subscribe((value) => {
        coreThreads.set(value as ThreadRecord[]);
      }),
      store.select(ɵselectThreadsIsLoading).subscribe((value) => {
        isLoadingState.set(value as boolean);
      }),
      store.select(ɵselectThreadsError).subscribe((value) => {
        errorState.set(value as Error | null);
      }),
      store.select(ɵselectHasNextPage).subscribe((value) => {
        hasMoreState.set(value as boolean);
      }),
      store.select(ɵselectIsFetchingNextPage).subscribe((value) => {
        isFetchingMoreState.set(value as boolean);
      }),
    ];

    // The store starts with isLoading=false; before the first context is
    // dispatched consumers would otherwise see an empty, non-loading state.
    // Synthesize loading=true while runtimeUrl is set and we haven't
    // dispatched yet so the UI can keep its spinner during connect.
    const hasDispatchedContext = signal(false);

    const copilotkit = this.#copilotkit;
    const initialAgentId = input.agentId();
    copilotkit.core.registerThreadStore(initialAgentId, store);
    let registeredAgentId = initialAgentId;

    const dispatchEffect = effect(() => {
      const agentId = input.agentId();
      const includeArchived = input.includeArchived();
      const limit = input.limit();
      const runtimeUrl = copilotkit.runtimeUrl();
      const headers = copilotkit.headers();
      const status = copilotkit.runtimeConnectionStatus();

      if (agentId !== registeredAgentId) {
        copilotkit.core.unregisterThreadStore(registeredAgentId);
        copilotkit.core.registerThreadStore(agentId, store);
        registeredAgentId = agentId;
      }

      if (!runtimeUrl) {
        store.setContext(null);
        hasDispatchedContext.set(false);
        return;
      }

      if (status !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
        return;
      }

      const context: ɵThreadRuntimeContext = {
        runtimeUrl,
        headers: { ...headers },
        wsUrl: copilotkit.core.intelligence?.wsUrl,
        agentId,
        includeArchived: includeArchived ?? undefined,
        limit: limit ?? undefined,
      };

      store.setContext(context);
      hasDispatchedContext.set(true);
    });

    const runtimeError = computed<Error | null>(() => {
      if (copilotkit.runtimeUrl()) {
        return null;
      }
      return new Error("Runtime URL is not configured");
    });

    const threads = computed<Thread[]>(() =>
      coreThreads().map(
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
    );

    const isLoading = computed<boolean>(() => {
      if (runtimeError()) {
        return false;
      }
      const preConnect = !!copilotkit.runtimeUrl() && !hasDispatchedContext();
      return preConnect || isLoadingState();
    });

    const error = computed<Error | null>(() => runtimeError() ?? errorState());

    destroyRef.onDestroy(() => {
      dispatchEffect.destroy();
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
      copilotkit.core.unregisterThreadStore(registeredAgentId);
      store.stop();
    });

    return {
      threads,
      isLoading,
      error,
      hasMoreThreads: hasMoreState.asReadonly(),
      isFetchingMoreThreads: isFetchingMoreState.asReadonly(),
      fetchMoreThreads: () => store.fetchNextPage(),
      renameThread: (threadId, name) => store.renameThread(threadId, name),
      archiveThread: (threadId) => store.archiveThread(threadId),
      deleteThread: (threadId) => store.deleteThread(threadId),
    };
  }
}

/**
 * Angular equivalent of React's `useThreads`.
 *
 * Lists and manages Intelligence platform threads for the runtime-authenticated
 * user and the given agent. Returns a {@link ThreadStoreSignal} whose signals
 * stay in sync with the platform via a realtime WebSocket subscription (when
 * available); mutations resolve once the platform confirms the operation.
 *
 * Must be invoked in an Angular DI / injection context.
 */
export function injectThreadStore(
  input: InjectThreadStoreInput,
): ThreadStoreSignal {
  const factory = inject(CopilotkitThreadFactory);
  const destroyRef = inject(DestroyRef);
  return factory.createThreadStoreSignal(
    {
      agentId: toSignalish(input.agentId),
      includeArchived: toSignalish(input.includeArchived),
      limit: toSignalish(input.limit),
    },
    destroyRef,
  );
}
