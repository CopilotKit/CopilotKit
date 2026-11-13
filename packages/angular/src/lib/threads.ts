import type { Signal } from "@angular/core";
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from "@angular/core";
import { ɵThreadsController, ɵcreateThreadStore } from "@copilotkit/core";
import type { ɵThreadSummary, ɵThreadsCore } from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";

/**
 * A conversation thread managed by CopilotKit Intelligence.
 *
 * Each thread has a unique `id`, the `agentId` it belongs to, an optional
 * human-readable `name` (`null` when unnamed), an `archived` flag, and the
 * ISO-8601 `createdAt` and `updatedAt` timestamps. `lastRunAt` is the time of
 * the most recent agent run, absent when the thread has never run; prefer it
 * over `updatedAt` for "last activity", since rename and archive do not bump
 * it. The shape is core's, shared with React and Vue.
 */
export type Thread = ɵThreadSummary;

/**
 * Configuration for {@link injectThreads}.
 *
 * Thread operations are scoped to the runtime-authenticated user and the
 * provided agent on CopilotKit Intelligence. Each field may be supplied as
 * a plain value or a {@link Signal}; when a signal is used the underlying
 * runtime context is re-synced whenever its value changes.
 */
export interface InjectThreadsInput {
  /** The ID of the agent whose threads to list and manage. */
  agentId: string | Signal<string>;
  /** When `true`, archived threads are included in the list. Defaults to `false`. */
  includeArchived?: boolean | Signal<boolean | undefined>;
  /** Maximum number of threads to fetch per page. When set, enables cursor-based pagination. */
  limit?: number | Signal<number | undefined>;
  /**
   * When `false`, the store stays inert: no runtime context is dispatched, so
   * NO thread-list fetch or realtime subscription is issued, and the
   * synthesized pre-connect loading state is suppressed. Used by gated
   * surfaces (e.g. an unlicensed `<copilotkit-threads-drawer>`) that must not touch
   * the network until the gate opens. Defaults to `true`. Mirrors react-core's
   * `UseThreadsInput.enabled`.
   */
  enabled?: boolean | Signal<boolean | undefined>;
}

/**
 * Signal-based threads-list API returned by {@link injectThreads}.
 *
 * The `threads` signal is kept in sync with the platform via a realtime
 * WebSocket subscription (when available) and is sorted most-recently-active
 * first. Mutation methods reject with an `Error` if the platform request
 * fails; `delete` additionally rolls back its optimistic removal.
 */
export interface InjectThreadsResult {
  /**
   * Threads for the current user/agent pair, sorted most-recently-active
   * first. Updated in realtime when the platform pushes metadata events.
   * Includes archived threads only when `includeArchived` is set.
   */
  threads: Signal<Thread[]>;
  /**
   * `true` while the initial thread list is being fetched from the platform.
   * Subsequent realtime updates do not re-enter the loading state.
   */
  isLoading: Signal<boolean>;
  /**
   * The most recent error from fetching threads or executing a mutation, or
   * `null` when there is no error. Reset to `null` on the next successful
   * fetch.
   */
  error: Signal<Error | null>;
  /**
   * List/mutation errors only — excludes developer/config errors (missing
   * runtime URL, runtime without thread endpoints) so consumer UIs do not
   * surface dev strings to end users. Prefer this over `error` for
   * user-facing error display. Also reports a runtime that refuses to list
   * threads for a caller without identity (no `identifyUser`).
   */
  listError: Signal<Error | null>;
  /**
   * Error from the most recent FAILED next-page (fetch-more) load, or `null`.
   * Tracked separately from {@link InjectThreadsResult.listError} so a
   * paginated-load failure surfaces an inline "couldn't load more" affordance
   * while the loaded list stays visible. Cleared when a fetch-more is retried
   * or succeeds.
   */
  fetchMoreError: Signal<Error | null>;
  /**
   * `true` when there are more threads available to fetch via
   * {@link InjectThreadsResult.fetchMoreThreads}. Only meaningful when `limit`
   * is set.
   */
  hasMoreThreads: Signal<boolean>;
  /** `true` while a subsequent page of threads is being fetched. */
  isFetchingMoreThreads: Signal<boolean>;
  /**
   * `true` while at least one thread mutation (rename, archive, unarchive,
   * delete) is awaiting a server response. Mutations apply optimistically, so
   * this is primarily useful for disabling controls or showing a subtle
   * in-flight indicator.
   */
  isMutating: Signal<boolean>;
  /**
   * Fetch the next page of threads. No-op when
   * {@link InjectThreadsResult.hasMoreThreads} is `false` or a fetch is
   * already in progress.
   */
  fetchMoreThreads: () => void;
  /**
   * Re-fetch the thread list from the platform without clearing the current
   * list. Backs the drawer's error-state Retry and the Active/All filter
   * refetch. No-op until the runtime is connected.
   */
  refetchThreads: () => void;
  /**
   * Reset to a fresh, non-explicit client-side thread so the welcome screen
   * shows. Lazy creation: no row appears in {@link InjectThreadsResult.threads}
   * until the new thread's first run persists server-side.
   */
  startNewThread: () => void;
  /**
   * Rename a thread on the platform. Resolves when the server confirms the
   * update; rejects on failure.
   */
  renameThread: (threadId: string, name: string) => Promise<void>;
  /**
   * Archive a thread on the platform. Archived threads are excluded from
   * subsequent list results. Resolves when the server confirms the update;
   * rejects on failure.
   */
  archiveThread: (threadId: string) => Promise<void>;
  /**
   * Restore a previously archived thread on the platform. The thread
   * re-appears in default (non-archived) list results. Resolves when the
   * server confirms the update; rejects on failure.
   */
  unarchiveThread: (threadId: string) => Promise<void>;
  /**
   * Permanently delete a thread from the platform. This is irreversible.
   * Resolves when the server confirms deletion; rejects on failure (the
   * optimistic removal is rolled back).
   */
  deleteThread: (threadId: string) => Promise<void>;
}

/** Normalizes a value-or-signal field into a no-arg accessor. */
function toAccessor<T>(value: T | Signal<T>): () => T {
  return typeof value === "function" ? (value as () => T) : () => value;
}

/**
 * Projects a core {@link ɵThread} record down to the public {@link Thread}
 * shape, omitting `lastRunAt` entirely when the source value is absent so the
 * field stays optional rather than `undefined`.
 */
export class ThreadsStore implements InjectThreadsResult {
  readonly #copilotkit = inject(CopilotKit);
  // Core's ɵThreadsController owns the view model: thread projection, the
  // configuration errors, the gated and de-duplicated context dispatch, the
  // registry claim and the mutation guard. This class feeds it from signals
  // and projects its snapshot into signals.
  readonly #controller: ɵThreadsController;
  readonly #stop: () => void;
  readonly #unsubscribe: () => void;

  readonly threads: Signal<Thread[]>;
  readonly error: Signal<Error | null>;
  readonly listError: Signal<Error | null>;
  readonly fetchMoreError: Signal<Error | null>;
  readonly isLoading: Signal<boolean>;
  readonly hasMoreThreads: Signal<boolean>;
  readonly isFetchingMoreThreads: Signal<boolean>;
  readonly isMutating: Signal<boolean>;

  constructor(input: InjectThreadsInput, destroyRef: DestroyRef) {
    const agentId = toAccessor(input.agentId);
    const includeArchived = toAccessor(input.includeArchived);
    const limit = toAccessor(input.limit);
    const enabled = toAccessor(input.enabled);
    const service = this.#copilotkit;
    const core = service.core;
    // The runtime state as this service's signals project it from core.
    const runtime: ɵThreadsCore = {
      get runtimeUrl() {
        return service.runtimeUrl();
      },
      get ɵruntimeInfo() {
        return core.ɵruntimeInfo;
      },
      get ɵheadersGeneration() {
        return service.ɵheadersGeneration();
      },
      registerThreadStore: (agentId, store) =>
        core.registerThreadStore(agentId, store),
      unregisterThreadStore: (agentId) => core.unregisterThreadStore(agentId),
    };
    const readInput = () => ({
      core: runtime,
      agentId: agentId(),
      includeArchived: includeArchived(),
      limit: limit(),
      enabled: enabled() !== false,
    });

    const controller = new ɵThreadsController(
      ɵcreateThreadStore({ fetch: core.ɵruntimeFetch }),
      untracked(readInput),
    );
    this.#controller = controller;
    const snapshot = signal(controller.getSnapshot());
    this.#unsubscribe = controller.subscribe(() => {
      snapshot.set(controller.getSnapshot());
    });
    this.#stop = controller.start();

    this.threads = computed(() => snapshot().threads);
    this.error = computed(() => snapshot().error);
    this.listError = computed(() => snapshot().listError);
    this.fetchMoreError = computed(() => snapshot().fetchMoreError);
    this.isLoading = computed(() => snapshot().isLoading);
    this.hasMoreThreads = computed(() => snapshot().hasMoreThreads);
    this.isFetchingMoreThreads = computed(
      () => snapshot().isFetchingMoreThreads,
    );
    this.isMutating = computed(() => snapshot().isMutating);

    this.renameThread = controller.renameThread;
    this.archiveThread = controller.archiveThread;
    this.unarchiveThread = controller.unarchiveThread;
    this.deleteThread = controller.deleteThread;
    this.fetchMoreThreads = controller.fetchMoreThreads;
    this.refetchThreads = controller.refetchThreads;
    this.startNewThread = controller.startNewThread;

    // Re-apply on any input or runtime-state change. Keyed on the header
    // generation, not header values (#1937).
    effect(() => {
      const next = readInput();
      service.runtimeUrl();
      service.runtimeConnectionStatus();
      service.threadEndpoints();
      service.ɵheadersGeneration();
      service.intelligence();
      untracked(() => controller.update(next));
    });

    destroyRef.onDestroy(() => this.teardown());
  }

  readonly renameThread: (threadId: string, name: string) => Promise<void>;
  readonly archiveThread: (threadId: string) => Promise<void>;
  readonly unarchiveThread: (threadId: string) => Promise<void>;
  readonly deleteThread: (threadId: string) => Promise<void>;
  readonly fetchMoreThreads: () => void;
  readonly refetchThreads: () => void;
  readonly startNewThread: () => void;

  /** Stop the store and release its registry claim. Safe to call twice. */
  teardown(): void {
    this.#unsubscribe();
    this.#stop();
    this.#controller.dispose();
  }
}

@Injectable({ providedIn: "root" })
export class CopilotkitThreadsFactory {
  /**
   * Creates a {@link ThreadsStore} bound to the given input and host
   * `DestroyRef`.
   *
   * @param input - Agent identifier and optional list controls.
   * @param destroyRef - Host lifetime; tears the store down on destroy.
   */
  create(input: InjectThreadsInput, destroyRef: DestroyRef): ThreadsStore {
    return new ThreadsStore(input, destroyRef);
  }
}

/**
 * Angular threads-list API over the platform-agnostic core thread store —
 * the signal-based counterpart to react-core's `useThreads`.
 *
 * On creation the store fetches the thread list for the runtime-authenticated
 * user and the given `agentId`. When CopilotKit Intelligence exposes a
 * WebSocket URL it also opens a realtime subscription so the `threads` signal
 * stays current without polling. Mutation methods return promises that resolve
 * once the platform confirms the operation and reject with an `Error` on
 * failure.
 *
 * Must be called within an injection context (component/directive constructor
 * or field initializer). The underlying store is torn down on the host's
 * `DestroyRef`.
 *
 * @param input - Agent identifier and optional list controls. Each field
 *   accepts a plain value or a `Signal`.
 * @returns Thread list state as signals plus stable mutation callbacks.
 *
 * @example
 * ```ts
 * @Component({ ... })
 * class ThreadList {
 *   readonly threads = injectThreads({ agentId: "agent-1" });
 * }
 * ```
 */
export function injectThreads(input: InjectThreadsInput): InjectThreadsResult {
  const factory = inject(CopilotkitThreadsFactory);
  const destroyRef = inject(DestroyRef);
  return factory.create(input, destroyRef);
}
