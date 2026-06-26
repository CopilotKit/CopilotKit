import { useCopilotKit } from "../context";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateMemoryStore,
  ɵselectMemories,
  ɵselectMemoriesError,
  ɵselectMemoriesIsLoading,
} from "@copilotkit/core";
import type {
  ɵMemory,
  ɵMemoryChanges,
  ɵMemoryRuntimeContext,
  ɵMemoryStore,
  ɵNewMemory,
} from "@copilotkit/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Configuration for the {@link useMemories} hook.
 *
 * Memory operations are scoped to the runtime-authenticated user (v1 surfaces
 * user-scoped memories only) and the provided agent.
 */
export interface UseMemoriesInput {
  /** The ID of the agent whose memories to list and manage. */
  agentId: string;
}

/**
 * Return value of the {@link useMemories} hook.
 *
 * The `memories` array is the server-authoritative list for the current
 * user/agent pair. It is hydrated from a REST snapshot and kept current by
 * realtime `memory_metadata` deltas from the store's own channel. Mutations
 * resolve once the platform confirms the operation and reject with an `Error`
 * on failure.
 */
export interface UseMemoriesResult {
  /**
   * Memories for the current user/agent pair, newest first. Updated in
   * realtime when the platform pushes `memory_metadata` events.
   */
  memories: ɵMemory[];
  /**
   * `true` while the initial memory snapshot is being fetched. Subsequent
   * realtime updates do not re-enter the loading state.
   */
  isLoading: boolean;
  /**
   * The most recent error from fetching memories or executing a mutation, or
   * `null` when there is no error. Reset to `null` on the next successful
   * fetch.
   */
  error: Error | null;
  /**
   * Re-fetch the memory snapshot from the platform. Resolves once the re-pull
   * settles; rejects if it fails or the store is torn down mid-flight.
   */
  refresh: () => Promise<void>;
  /**
   * Create a memory. Resolves to the stored memory (server-authoritative);
   * rejects on failure.
   */
  addMemory: (input: ɵNewMemory) => Promise<ɵMemory>;
  /**
   * Supersede a memory: the old memory is retired and a new one is created.
   * Resolves to the new memory (its `id` differs from `id`); rejects on
   * failure.
   */
  updateMemory: (id: string, changes: ɵMemoryChanges) => Promise<ɵMemory>;
  /**
   * Retire a memory (non-lossy delete). Resolves when the server confirms;
   * rejects on failure.
   */
  removeMemory: (id: string) => Promise<void>;
}

function useMemoryStoreSelector<T>(
  store: ɵMemoryStore,
  selector: (state: ReturnType<ɵMemoryStore["getState"]>) => T,
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

/**
 * React hook for listing and managing platform memories.
 *
 * On mount the hook fetches the memory snapshot for the runtime-authenticated
 * user and the given `agentId`, then exposes the live list plus stable
 * `addMemory` / `updateMemory` / `removeMemory` / `refresh` callbacks. Mutations
 * are server-authoritative: each resolves once the platform confirms the
 * operation and rejects with an `Error` on failure.
 *
 * Realtime updates are automatic: the memory store opens its own
 * `user_meta:memories:<joinCode>` channel and applies `memory_metadata` deltas
 * to the list as soon as the runtime is connected (i.e. once `setContext` has
 * wired up the runtime URL and headers). No other feature needs to be mounted —
 * memory works standalone. You can still call `refresh()` to re-pull the REST
 * snapshot on demand.
 *
 * @param input - Agent identifier.
 * @returns Memory list state and stable mutation callbacks.
 *
 * @example
 * ```tsx
 * import { useMemories } from "@copilotkit/react-core";
 *
 * function MemoryList() {
 *   const { memories, isLoading, addMemory, removeMemory } = useMemories({
 *     agentId: "agent-1",
 *   });
 *
 *   if (isLoading) return <p>Loading…</p>;
 *
 *   return (
 *     <ul>
 *       {memories.map((m) => (
 *         <li key={m.id}>
 *           {m.content}
 *           <button onClick={() => removeMemory(m.id)}>Delete</button>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useMemories({ agentId }: UseMemoriesInput): UseMemoriesResult {
  const { copilotkit } = useCopilotKit();

  const [store] = useState(() =>
    ɵcreateMemoryStore({ fetch: globalThis.fetch.bind(globalThis) }),
  );

  const memories = useMemoryStoreSelector(store, ɵselectMemories);
  const isLoading = useMemoryStoreSelector(store, ɵselectMemoriesIsLoading);
  const error = useMemoryStoreSelector(store, ɵselectMemoriesError);

  const headersKey = useMemo(() => {
    return JSON.stringify(
      Object.entries(copilotkit.headers ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }, [copilotkit.headers]);
  const runtimeStatus = copilotkit.runtimeConnectionStatus;

  useEffect(() => {
    store.start();
    return () => {
      store.stop();
    };
  }, [store]);

  useEffect(() => {
    copilotkit.registerMemoryStore(agentId, store);
    return () => {
      copilotkit.unregisterMemoryStore(agentId);
    };
  }, [copilotkit, agentId, store]);

  const wsUrl = copilotkit.intelligence?.wsUrl;

  // Mirror useThreads: defer setting the context until the runtime reports
  // Connected, since the memory store is session-guarded and does nothing
  // until `setContext` is called. The store opens its OWN realtime channel
  // (`user_meta:memories:<joinCode>`) from this context, so it needs the
  // gateway `wsUrl` alongside the runtime URL and headers. `wsUrl` only lands
  // once `/info` resolves, so we wait for it to avoid dispatching a context
  // with an undefined socket URL. When `runtimeUrl` is absent (or the runtime
  // isn't Connected) we clear the context so a previous user's snapshot can't
  // linger.
  useEffect(() => {
    if (
      !copilotkit.runtimeUrl ||
      runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected
    ) {
      store.setContext(null);
      return;
    }

    // Wait for `/info` to land so the context carries a real gateway URL and
    // we don't re-dispatch once it resolves.
    if (!wsUrl) {
      return;
    }

    const context: ɵMemoryRuntimeContext = {
      runtimeUrl: copilotkit.runtimeUrl,
      wsUrl,
      headers: { ...copilotkit.headers },
    };
    store.setContext(context);
  }, [store, copilotkit.runtimeUrl, runtimeStatus, headersKey, wsUrl, agentId]);

  const refresh = useCallback(() => store.refresh(), [store]);
  const addMemory = useCallback(
    (input: ɵNewMemory) => store.addMemory(input),
    [store],
  );
  const updateMemory = useCallback(
    (id: string, changes: ɵMemoryChanges) => store.updateMemory(id, changes),
    [store],
  );
  const removeMemory = useCallback(
    (id: string) => store.removeMemory(id),
    [store],
  );

  return {
    memories,
    isLoading,
    error,
    refresh,
    addMemory,
    updateMemory,
    removeMemory,
  };
}
