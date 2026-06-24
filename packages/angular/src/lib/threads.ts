import type { Signal } from "@angular/core";
import { DestroyRef, computed, effect, inject, signal } from "@angular/core";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type {
  ThreadEndpointRuntimeInfo,
  ɵThread,
  ɵThreadRuntimeContext,
  ɵThreadStore,
} from "@copilotkit/core";
import type { Subscription } from "rxjs";
import { CopilotKit } from "./copilotkit";

export interface InjectThreadsInput {
  agentId: string | Signal<string | undefined>;
  includeArchived?: boolean | Signal<boolean | undefined>;
  limit?: number | Signal<number | undefined>;
}

export interface Thread {
  id: string;
  agentId: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
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

type StaticSignalValue = string | boolean | number | undefined;

const EMPTY_HEADERS: Record<string, string> = {};

function toInputSignal<T extends StaticSignalValue>(
  value: T | Signal<T>,
): Signal<T> {
  if (typeof value === "function") {
    return value;
  }

  return computed(() => value);
}

function sameThreadEndpoints(
  left: ThreadEndpointRuntimeInfo | undefined,
  right: ThreadEndpointRuntimeInfo | undefined,
): boolean {
  return (
    left?.list === right?.list &&
    left?.inspect === right?.inspect &&
    left?.mutations === right?.mutations &&
    left?.realtimeMetadata === right?.realtimeMetadata
  );
}

function toPublicThread({
  id,
  agentId,
  name,
  archived,
  createdAt,
  updatedAt,
  lastRunAt,
}: ɵThread): Thread {
  return {
    id,
    agentId,
    name,
    archived,
    createdAt,
    updatedAt,
    ...(lastRunAt !== undefined ? { lastRunAt } : {}),
  };
}

function bindSelector<T>(
  store: ɵThreadStore,
  selector: (state: ReturnType<ɵThreadStore["getState"]>) => T,
  destroyRef: DestroyRef,
): Signal<T> {
  const value = signal(selector(store.getState()));
  const subscription: Subscription = store
    .select(selector)
    .subscribe((next) => {
      value.set(next);
    });
  destroyRef.onDestroy(() => {
    subscription.unsubscribe();
  });
  return value.asReadonly();
}

export function injectThreads(input: InjectThreadsInput): InjectThreadsResult {
  const copilotKit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);
  const agentId = toInputSignal(input.agentId);
  const includeArchived = toInputSignal(input.includeArchived);
  const limit = toInputSignal(input.limit);
  const store = ɵcreateThreadStore({ fetch: globalThis.fetch });

  store.start();
  destroyRef.onDestroy(() => {
    store.stop();
  });

  const coreThreads = bindSelector(store, ɵselectThreads, destroyRef);
  const threads = computed(() => coreThreads().map(toPublicThread));
  const isLoading = bindSelector(store, ɵselectThreadsIsLoading, destroyRef);
  const error = bindSelector(store, ɵselectThreadsError, destroyRef);
  const hasMoreThreads = bindSelector(store, ɵselectHasNextPage, destroyRef);
  const isFetchingMoreThreads = bindSelector(
    store,
    ɵselectIsFetchingNextPage,
    destroyRef,
  );

  let lastContext: ɵThreadRuntimeContext | null = null;

  const resolveContext = (
    resolvedAgentId: string,
    runtimeUrl: string | undefined,
    headers: Record<string, string>,
    wsUrl: string | undefined,
    resolvedIncludeArchived: boolean | undefined,
    resolvedLimit: number | undefined,
    threadEndpoints: ThreadEndpointRuntimeInfo | undefined,
  ): ɵThreadRuntimeContext => {
    if (
      lastContext &&
      lastContext.agentId === resolvedAgentId &&
      lastContext.runtimeUrl === runtimeUrl &&
      lastContext.headers === headers &&
      lastContext.wsUrl === wsUrl &&
      lastContext.includeArchived === resolvedIncludeArchived &&
      lastContext.limit === resolvedLimit &&
      sameThreadEndpoints(lastContext.threadEndpoints, threadEndpoints)
    ) {
      return lastContext;
    }

    lastContext = {
      agentId: resolvedAgentId,
      runtimeUrl,
      headers,
      wsUrl,
      includeArchived: resolvedIncludeArchived,
      limit: resolvedLimit,
      threadEndpoints,
    };
    return lastContext;
  };

  effect(() => {
    const resolvedAgentId = agentId();
    if (!resolvedAgentId) {
      store.setContext(null);
      return;
    }

    const runtimeUrl = copilotKit.runtimeUrl();
    const runtimeConnectionStatus = copilotKit.runtimeConnectionStatus();
    if (
      runtimeUrl &&
      runtimeConnectionStatus !==
        CopilotKitCoreRuntimeConnectionStatus.Connected
    ) {
      store.setContext(null);
      return;
    }

    store.setContext(
      resolveContext(
        resolvedAgentId,
        runtimeUrl,
        copilotKit.headers() ?? EMPTY_HEADERS,
        copilotKit.intelligence()?.wsUrl,
        includeArchived(),
        limit(),
        copilotKit.threadEndpoints(),
      ),
    );
  });

  effect((onCleanup) => {
    const resolvedAgentId = agentId();
    if (!resolvedAgentId) {
      return;
    }

    copilotKit.core.registerThreadStore(resolvedAgentId, store);
    onCleanup(() => {
      copilotKit.core.unregisterThreadStore(resolvedAgentId);
    });
  });

  return {
    threads,
    isLoading,
    error,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreThreads: () => {
      store.fetchNextPage();
    },
    renameThread: (threadId: string, name: string) =>
      store.renameThread(threadId, name),
    archiveThread: (threadId: string) => store.archiveThread(threadId),
    deleteThread: (threadId: string) => store.deleteThread(threadId),
  };
}
