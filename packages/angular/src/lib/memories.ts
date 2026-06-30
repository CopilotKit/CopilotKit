import { inject, Signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  ɵselectMemories,
  ɵselectMemoriesAvailable,
  ɵselectMemoriesError,
  ɵselectMemoriesIsLoading,
} from "@copilotkit/core";
import type { ɵMemory, ɵMemoryChanges, ɵNewMemory } from "@copilotkit/core";
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
  memories: Signal<ɵMemory[]>;
  /**
   * `true` while the initial memory snapshot is being fetched. Subsequent
   * realtime updates do not re-enter the loading state.
   */
  isLoading: Signal<boolean>;
  /**
   * The most recent error from fetching memories or a mutation, or `null`
   * when there is no error. Reset to `null` on the next successful fetch.
   */
  error: Signal<Error | null>;
  /**
   * `true` when the platform memory routes are available. Set to `false`
   * after a 404 or 501, indicating memory is not supported by the current
   * runtime configuration.
   */
  isAvailable: Signal<boolean>;
  /**
   * Re-fetch the memory snapshot from the platform.
   */
  refresh: () => Promise<void>;
  /**
   * Create a memory. Resolves to the stored memory; rejects on failure.
   */
  addMemory: (input: ɵNewMemory) => Promise<ɵMemory>;
  /**
   * Supersede a memory: the old memory is retired and a new one is created.
   * Resolves to the new memory (its `id` differs from the supplied `id`);
   * rejects on failure.
   */
  updateMemory: (id: string, changes: ɵMemoryChanges) => Promise<ɵMemory>;
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

  return {
    memories,
    isLoading,
    error,
    isAvailable,
    refresh: () => store.refresh(),
    addMemory: (input: ɵNewMemory) => store.addMemory(input),
    updateMemory: (id: string, changes: ɵMemoryChanges) =>
      store.updateMemory(id, changes),
    removeMemory: (id: string) => store.removeMemory(id),
  };
}
