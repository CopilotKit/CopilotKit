import { DestroyRef, effect, inject, Signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  ɵcreateMemoryStore,
  ɵselectMemories,
  ɵselectMemoriesError,
  ɵselectMemoriesIsLoading,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { ɵMemory, ɵMemoryChanges, ɵNewMemory } from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";

/**
 * Configuration for the {@link injectMemories} function.
 *
 * Memory operations are scoped to the runtime-authenticated user and the
 * provided agent.
 */
export interface InjectMemoriesParams {
  /** The ID of the agent whose memories to list and manage. */
  agentId: string;
}

/**
 * Return value of {@link injectMemories}.
 *
 * The `memories` signal is the server-authoritative list for the current
 * user/agent pair. It is hydrated from a REST snapshot and kept current by
 * realtime `memory_metadata` deltas pushed over the memory store's own
 * channel. Mutations resolve once the platform confirms the operation and
 * reject with an `Error` on failure.
 */
export interface MemoriesController {
  /**
   * Memories for the current user/agent pair. Updated in realtime when the
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
   * when there is no error.
   */
  error: Signal<Error | null>;
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
 * Angular injection function for listing and managing platform memories.
 *
 * On creation the binding fetches the memory snapshot for the
 * runtime-authenticated user and the given `agentId`, then exposes the live
 * list plus stable `addMemory` / `updateMemory` / `removeMemory` / `refresh`
 * callbacks. Mutations are server-authoritative: each resolves once the
 * platform confirms the operation and rejects with an `Error` on failure.
 *
 * Realtime updates: the memory store opens its own channel and works
 * standalone — it does not depend on the thread feature being mounted.
 * Realtime `memory_metadata` deltas flow automatically once the binding's
 * `setContext` connects (i.e. the runtime is `Connected`).
 *
 * Must be called inside an injection context (component constructor, `inject`
 * callback, or `TestBed.runInInjectionContext`).
 *
 * @param params - Agent identifier.
 * @returns Signals for memory state and stable mutation callbacks.
 *
 * @example
 * ```ts
 * import { injectMemories } from "@copilotkit/angular";
 *
 * @Component({ ... })
 * class MemoryList {
 *   readonly #m = injectMemories({ agentId: "agent-1" });
 *   memories = this.#m.memories;
 *   isLoading = this.#m.isLoading;
 *
 *   remove(id: string) { this.#m.removeMemory(id); }
 * }
 * ```
 */
export function injectMemories({
  agentId,
}: InjectMemoriesParams): MemoriesController {
  const copilotkit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);

  const store = ɵcreateMemoryStore({
    fetch: globalThis.fetch.bind(globalThis),
  });

  copilotkit.core.registerMemoryStore(agentId, store);
  store.start();

  // Mirror useThreads: defer setting the context until the runtime reports
  // Connected, since the memory store is session-guarded and does nothing
  // until `setContext` is called. Waiting for `Connected` also means `/info`
  // has landed, so `intelligence.wsUrl` (the realtime gateway the memory store
  // opens its own channel on) is populated. When `runtimeUrl` or `wsUrl` is
  // absent (or the runtime is not Connected) we clear the context so a
  // previous user's snapshot cannot linger.
  effect(() => {
    const runtimeUrl = copilotkit.runtimeUrl();
    const runtimeStatus = copilotkit.runtimeConnectionStatus();
    const wsUrl = copilotkit.core.intelligence?.wsUrl;

    if (
      !runtimeUrl ||
      !wsUrl ||
      runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected
    ) {
      store.setContext(null);
      return;
    }

    store.setContext({
      runtimeUrl,
      wsUrl,
      headers: { ...copilotkit.headers() },
    });
  });

  destroyRef.onDestroy(() => {
    store.stop();
    copilotkit.core.unregisterMemoryStore(agentId);
  });

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

  return {
    memories,
    isLoading,
    error,
    refresh: () => store.refresh(),
    addMemory: (input: ɵNewMemory) => store.addMemory(input),
    updateMemory: (id: string, changes: ɵMemoryChanges) =>
      store.updateMemory(id, changes),
    removeMemory: (id: string) => store.removeMemory(id),
  };
}
