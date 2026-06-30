import { useCopilotKit } from "../context";
import {
  ɵselectMemories,
  ɵselectMemoriesError,
  ɵselectMemoriesIsLoading,
  ɵselectMemoriesAvailable,
  ɵselectMemoriesRealtimeStatus,
} from "@copilotkit/core";
import type {
  Memory,
  MemoryChanges,
  MemoryRealtimeStatus,
  ɵMemoryStore,
  NewMemory,
} from "@copilotkit/core";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Return value of the {@link useMemories} hook.
 *
 * The `memories` array is the server-authoritative list for the current user.
 * It is hydrated from a REST snapshot and kept current by realtime
 * `memory_metadata` deltas from the store's own channel. Mutations resolve
 * once the platform confirms the operation and reject with an `Error` on
 * failure.
 */
export interface UseMemoriesResult {
  /**
   * Memories for the current user, newest first. Updated in realtime when
   * the platform pushes `memory_metadata` events.
   */
  memories: Memory[];
  /**
   * `true` while the initial memory snapshot is being fetched. Subsequent
   * realtime updates do not re-enter the loading state.
   */
  isLoading: boolean;
  /**
   * The most recent error from fetching memories or executing a mutation, or
   * `null` when there is no error. Cleared on the next fetch attempt, on a
   * successful fetch, when the runtime context changes, and on a successful
   * mutation (a failed mutation replaces it with that mutation's error).
   */
  error: Error | null;
  /**
   * `true` when the platform memory routes are available. Set to `false`
   * after a 404 or 501, indicating memory is not supported by the current
   * runtime configuration.
   */
  isAvailable: boolean;
  /**
   * Health of the realtime connection that streams live `memory_metadata`
   * deltas. Distinct from `isAvailable`/`error` (which describe the REST list
   * route): `"connecting"` while the socket opens/joins, `"connected"` once
   * live deltas are flowing, and `"unavailable"` once the socket permanently
   * gives up — at which point the list is a frozen snapshot. Lets the UI drop a
   * "live" indicator instead of showing it over stale data.
   */
  realtimeStatus: MemoryRealtimeStatus;
  /**
   * Re-fetch the memory snapshot from the platform. Resolves once the re-pull
   * settles; rejects if it fails or the store is torn down mid-flight.
   */
  refresh: () => Promise<void>;
  /**
   * Create a memory. Resolves to the stored memory (server-authoritative);
   * rejects on failure.
   */
  addMemory: (input: NewMemory) => Promise<Memory>;
  /**
   * Supersede a memory: the old memory is retired and a new one is created.
   * Resolves to the new memory (its `id` differs from `id`); rejects on
   * failure.
   *
   * Supersede is a FULL replacement, not a partial patch: `changes` is the
   * complete definition of the new memory. You must re-supply `content` and
   * `kind`, and an omitted `sourceThreadIds` resets the new memory's source
   * threads to empty — it does not preserve the prior memory's value.
   */
  updateMemory: (id: string, changes: MemoryChanges) => Promise<Memory>;
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
    // getServerSnapshot: without this third argument React throws
    // "Missing getServerSnapshot" during SSR/prerender (e.g. Next.js). The
    // store has no client data while prerendering, so we project from its
    // stable server state.
    () => selector(store.getServerState()),
  );
}

/**
 * React hook for listing and managing platform memories.
 *
 * Reads the memory store owned and wired by `CopilotKitCore`. On mount the
 * hook exposes the live list plus stable `addMemory` / `updateMemory` /
 * `removeMemory` / `refresh` callbacks. Mutations are server-authoritative:
 * each resolves once the platform confirms the operation and rejects with an
 * `Error` on failure.
 *
 * Realtime updates are automatic: the core's memory store opens its own
 * `user_meta:memories:<joinCode>` channel and applies `memory_metadata` deltas
 * to the list. You can still call `refresh()` to re-pull the REST snapshot on
 * demand.
 *
 * @returns Memory list state and stable mutation callbacks.
 *
 * @example
 * ```tsx
 * import { useMemories } from "@copilotkit/react-core";
 *
 * function MemoryList() {
 *   const { memories, isLoading, isAvailable, addMemory, removeMemory } =
 *     useMemories();
 *
 *   if (!isAvailable) return null;
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
export function useMemories(): UseMemoriesResult {
  const { copilotkit } = useCopilotKit();

  const store = copilotkit.getMemoryStore();

  const memories = useMemoryStoreSelector(store, ɵselectMemories);
  const isLoading = useMemoryStoreSelector(store, ɵselectMemoriesIsLoading);
  const error = useMemoryStoreSelector(store, ɵselectMemoriesError);
  const isAvailable = useMemoryStoreSelector(store, ɵselectMemoriesAvailable);
  const realtimeStatus = useMemoryStoreSelector(
    store,
    ɵselectMemoriesRealtimeStatus,
  );

  const refresh = useCallback(() => store.refresh(), [store]);
  const addMemory = useCallback(
    (input: NewMemory) => store.addMemory(input),
    [store],
  );
  const updateMemory = useCallback(
    (id: string, changes: MemoryChanges) => store.updateMemory(id, changes),
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
    isAvailable,
    realtimeStatus,
    refresh,
    addMemory,
    updateMemory,
    removeMemory,
  };
}
