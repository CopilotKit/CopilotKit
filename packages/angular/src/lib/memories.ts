import { inject, Signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  ɵselectMemories,
  ɵselectMemoriesAvailable,
  ɵselectMemoriesError,
  ɵselectMemoriesIsLoading,
  ɵselectMemoriesRealtimeStatus,
} from "@copilotkit/core";
import type {
  Memory,
  MemoryChanges,
  MemoryRealtimeStatus,
  NewMemory,
} from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";

/**
 * Return value of {@link injectMemories}.
 *
 * The `memories` signal is the server-authoritative list for the current
 * runtime-authenticated user. It is hydrated from a REST snapshot and kept
 * current by realtime `memory_metadata` deltas pushed over the memory store's
 * own channel. Mutations resolve once the platform confirms the operation and
 * reject with an `Error` on failure.
 */
export interface MemoriesController {
  /**
   * Memories for the current user, newest first. Updated in realtime when the
   * platform pushes `memory_metadata` events over the memory store's channel.
   */
  memories: Signal<Memory[]>;
  /**
   * `true` while the initial memory snapshot is being fetched. Subsequent
   * realtime updates do not re-enter the loading state.
   */
  isLoading: Signal<boolean>;
  /**
   * The most recent error from fetching memories or a mutation, or `null`
   * when there is no error. Cleared on the next fetch attempt, on a
   * successful fetch, when the runtime context changes, and on a successful
   * mutation (a failed mutation replaces it with that mutation's error).
   */
  error: Signal<Error | null>;
  /**
   * `true` when the platform memory routes are available. Set to `false`
   * after a 404 or 501, indicating memory is not supported by the current
   * runtime configuration.
   */
  isAvailable: Signal<boolean>;
  /**
   * Health of the realtime connection that streams live `memory_metadata`
   * deltas. Distinct from `isAvailable`/`error` (which describe the REST list
   * route): `"connecting"` while the socket opens/joins, `"connected"` once
   * live deltas are flowing, and `"unavailable"` once the socket permanently
   * gives up — at which point the list is a frozen snapshot. Lets a template
   * drop a "live" indicator instead of showing it over stale data.
   */
  realtimeStatus: Signal<MemoryRealtimeStatus>;
  /**
   * Re-fetch the memory snapshot from the platform. Resolves when the re-pull
   * succeeds; rejects if it fails or the store is torn down mid-flight.
   */
  refresh: () => Promise<void>;
  /**
   * Create a memory. Resolves to the stored memory (server-authoritative);
   * rejects on failure.
   */
  addMemory: (input: NewMemory) => Promise<Memory>;
  /**
   * Supersede a memory: the old memory is retired and a new one is created.
   * Resolves to the new memory (its `id` differs from the supplied `id`);
   * rejects on failure.
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

/**
 * Angular injection function for listing and managing platform memories — the
 * signal-based counterpart to react-core's `useMemories`.
 *
 * Reads the user-scoped memory store owned and wired by `CopilotKitCore`. The
 * binding does not create, register, start, or stop the store: core owns its
 * lifecycle and opens its own `user_meta:memories:<joinCode>` channel, applying
 * `memory_metadata` deltas to the list. The binding only bridges the store's
 * selectors onto Angular signals and forwards the stable mutation callbacks.
 *
 * Mutations are server-authoritative: each resolves once the platform confirms
 * the operation and rejects with an `Error` on failure. You can still call
 * `refresh()` to re-pull the REST snapshot on demand.
 *
 * Must be called inside an injection context (component constructor, field
 * initializer, `inject` callback, or `TestBed.runInInjectionContext`) so the
 * selector→signal bridges (`toSignal`) tear down with the host.
 *
 * @returns Signals for memory state and stable mutation callbacks.
 *
 * @example
 * ```ts
 * import { injectMemories } from "@copilotkit/angular";
 *
 * @Component({ ... })
 * class MemoryList {
 *   readonly #m = injectMemories();
 *   memories = this.#m.memories;
 *   isLoading = this.#m.isLoading;
 *   isAvailable = this.#m.isAvailable;
 *
 *   remove(id: string) { this.#m.removeMemory(id); }
 * }
 * ```
 */
export function injectMemories(): MemoriesController {
  const store = inject(CopilotKit).core.getMemoryStore();

  const initialState = store.getState();

  const memories = toSignal(store.select(ɵselectMemories), {
    initialValue: ɵselectMemories(initialState),
  });
  const isLoading = toSignal(store.select(ɵselectMemoriesIsLoading), {
    initialValue: ɵselectMemoriesIsLoading(initialState),
  });
  const error = toSignal(store.select(ɵselectMemoriesError), {
    initialValue: ɵselectMemoriesError(initialState),
  });
  const isAvailable = toSignal(store.select(ɵselectMemoriesAvailable), {
    initialValue: ɵselectMemoriesAvailable(initialState),
  });
  const realtimeStatus = toSignal(store.select(ɵselectMemoriesRealtimeStatus), {
    initialValue: ɵselectMemoriesRealtimeStatus(initialState),
  });

  return {
    memories,
    isLoading,
    error,
    isAvailable,
    realtimeStatus,
    refresh: () => store.refresh(),
    addMemory: (input: NewMemory) => store.addMemory(input),
    updateMemory: (id: string, changes: MemoryChanges) =>
      store.updateMemory(id, changes),
    removeMemory: (id: string) => store.removeMemory(id),
  };
}
