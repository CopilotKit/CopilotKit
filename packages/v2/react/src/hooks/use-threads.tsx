import { useCopilotKit } from "@/providers/CopilotKitProvider";
import {
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
  type ɵThread as CoreThread,
  type ɵThreadRuntimeContext,
  type ɵThreadStore,
} from "@copilotkitnext/core";
import { Socket } from "phoenix";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

export interface Thread extends CoreThread {}

export interface UseThreadsInput {
  userId: string;
  agentId: string;
}

export interface UseThreadsResult {
  threads: Thread[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
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
  );
}

export function useThreads({
  userId,
  agentId,
}: UseThreadsInput): UseThreadsResult {
  const { copilotkit } = useCopilotKit();

  const [store] = useState(() =>
    ɵcreateThreadStore({
      fetch: globalThis.fetch,
      Socket,
    }),
  );

  const threads = useThreadStoreSelector(store, ɵselectThreads);
  const storeIsLoading = useThreadStoreSelector(store, ɵselectThreadsIsLoading);
  const storeError = useThreadStoreSelector(store, ɵselectThreadsError);
  const headersKey = useMemo(() => {
    return JSON.stringify(
      Object.entries(copilotkit.headers ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }, [copilotkit.headers]);
  const runtimeError = useMemo(() => {
    if (copilotkit.runtimeUrl) {
      return null;
    }

    return new Error("Runtime URL is not configured");
  }, [copilotkit.runtimeUrl]);
  const isLoading = runtimeError ? false : storeIsLoading;
  const error = runtimeError ?? storeError;

  useEffect(() => {
    store.start();
    return () => {
      store.stop();
    };
  }, [store]);

  useEffect(() => {
    const context: ɵThreadRuntimeContext | null = copilotkit.runtimeUrl
      ? {
          runtimeUrl: copilotkit.runtimeUrl,
          headers: { ...copilotkit.headers },
          wsUrl: copilotkit.intelligence?.wsUrl,
          userId,
          agentId,
        }
      : null;

    store.setContext(context);
  }, [
    store,
    copilotkit.runtimeUrl,
    headersKey,
    copilotkit.intelligence?.wsUrl,
    userId,
    agentId,
  ]);

  const refetch = useCallback(() => {
    store.refetch();
  }, [store]);

  const renameThread = useCallback(
    (threadId: string, name: string) => store.renameThread(threadId, name),
    [store],
  );

  const archiveThread = useCallback(
    (threadId: string) => store.archiveThread(threadId),
    [store],
  );

  const deleteThread = useCallback(
    (threadId: string) => store.deleteThread(threadId),
    [store],
  );

  return {
    threads,
    isLoading,
    error,
    refetch,
    renameThread,
    archiveThread,
    deleteThread,
  };
}
