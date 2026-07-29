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
import type { Subscription } from "rxjs";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
  ɵselectIsMutating,
  ɵselectFetchMoreError,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type {
  ɵThread,
  ɵThreadRuntimeContext,
  ɵThreadStore,
} from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";

/**
 * A conversation thread managed by the Intelligence platform.
 *
 * Each thread has a unique `id`, an optional human-readable `name`, and
 * timestamp fields tracking creation and update times. This mirrors the
 * `Thread` projection exposed by react-core's `useThreads` so framework
 * wrappers share an identical shape.
 */
export interface Thread {
  /** Stable, server-assigned thread identifier. */
  id: string;
  /** The agent this thread belongs to. */
  agentId: string;
  /** Human-readable name, or `null` when the thread is unnamed. */
  name: string | null;
  /** `true` when the thread has been archived. */
  archived: boolean;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent metadata update. */
  updatedAt: string;
  /**
   * ISO-8601 timestamp of the most recent agent run on this thread. Absent
   * when the thread has never been run. Prefer this over `updatedAt` for
   * user-facing "last activity" displays — it is not bumped by metadata-only
   * actions like rename or archive.
   */
  lastRunAt?: string;
}

/**
 * Configuration for {@link injectThreads}.
 *
 * Thread operations are scoped to the runtime-authenticated user and the
 * provided agent on the Intelligence platform. Each field may be supplied as
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
   * user-facing error display.
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
function projectThread(thread: ɵThread): Thread {
  const { id, agentId, name, archived, createdAt, updatedAt, lastRunAt } =
    thread;
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

/**
 * Owns a single core thread store, bridges its selector observables onto
 * Angular writable signals, keeps the store's runtime context in sync with the
 * ambient {@link CopilotKit} configuration, and registers/unregisters the
 * store with core for the active agent.
 *
 * One instance backs each {@link injectThreads} call. Tear-down (selector
 * unsubscribe, store stop, core unregister) runs on the host's
 * {@link DestroyRef}.
 */
export class ThreadsStore implements InjectThreadsResult {
  readonly #copilotkit = inject(CopilotKit);
  readonly #store: ɵThreadStore = ɵcreateThreadStore({
    // Cast to `typeof fetch`: the wrapper preserves correct `this` binding for
    // globalThis.fetch but does not re-expose static members (e.g. `preconnect`)
    // that newer DOM libs add and that the store never calls.
    fetch: ((...args: Parameters<typeof fetch>) =>
      globalThis.fetch(...args)) as typeof fetch,
  });
  readonly #subscriptions: Subscription[] = [];

  readonly #threads = signal<Thread[]>([]);
  readonly #storeIsLoading = signal<boolean>(false);
  readonly #storeError = signal<Error | null>(null);
  readonly #fetchMoreError = signal<Error | null>(null);
  readonly #hasMoreThreads = signal<boolean>(false);
  readonly #isFetchingMoreThreads = signal<boolean>(false);
  readonly #isMutating = signal<boolean>(false);

  /**
   * Tracks whether a real runtime context has been dispatched to the store
   * yet. The store itself starts `isLoading: false`, so before the first
   * dispatch consumers would otherwise see an empty, non-loading list (the
   * empty-list flash). While a runtime URL is configured and the endpoints
   * are available but no context has been dispatched, we synthesize loading.
   */
  readonly #hasDispatchedContext = signal<boolean>(false);

  readonly threads = this.#threads.asReadonly();
  readonly error: Signal<Error | null>;
  readonly listError: Signal<Error | null>;
  readonly fetchMoreError = this.#fetchMoreError.asReadonly();
  readonly isLoading: Signal<boolean>;
  readonly hasMoreThreads = this.#hasMoreThreads.asReadonly();
  readonly isFetchingMoreThreads = this.#isFetchingMoreThreads.asReadonly();
  readonly isMutating = this.#isMutating.asReadonly();

  constructor(input: InjectThreadsInput, destroyRef: DestroyRef) {
    const agentId = toAccessor(input.agentId);
    const includeArchived = toAccessor(input.includeArchived);
    const limit = toAccessor(input.limit);
    const enabled = toAccessor(input.enabled);
    // `enabled` defaults to `true`; only an explicit `false` keeps the store
    // inert. An unset/`undefined` input is treated as enabled.
    const isEnabled = (): boolean => enabled() !== false;

    this.#bridgeSelectors();
    this.#store.start();

    // Synthesized error/loading reconcile the core store's internal state with
    // configuration-level conditions (no runtime URL, unavailable endpoints),
    // mirroring react-core's useThreads.
    const runtimeUrl = this.#copilotkit.runtimeUrl;
    const runtimeStatus = this.#copilotkit.runtimeConnectionStatus;
    // Read `threadEndpoints`/`intelligence.wsUrl` through the CopilotKit
    // signals (not plain `core.*` getters) so the computeds/effect re-run when
    // `/info` populates them — even if it lands without a connection-status
    // transition. This mirrors react-core, which lists both in its effect deps.
    const threadEndpoints = this.#copilotkit.threadEndpoints;
    const threadListSupported = (): boolean =>
      threadEndpoints()?.list !== false;
    const threadMutationsSupported = (): boolean =>
      threadEndpoints()?.mutations !== false;
    const threadEndpointsUnavailable = (): boolean =>
      !!runtimeUrl() &&
      runtimeStatus() === CopilotKitCoreRuntimeConnectionStatus.Connected &&
      !threadListSupported();

    const runtimeError = (): Error | null =>
      runtimeUrl() ? null : new Error("Runtime URL is not configured");
    const endpointsError = (): Error | null =>
      threadEndpointsUnavailable()
        ? new Error(
            "Thread endpoints are not available on this CopilotKit runtime",
          )
        : null;
    const mutationsError = (): Error | null =>
      threadMutationsSupported()
        ? null
        : new Error(
            "Thread mutations are not available on this CopilotKit runtime",
          );

    const preConnectLoading = (): boolean =>
      isEnabled() &&
      !!runtimeUrl() &&
      !threadEndpointsUnavailable() &&
      !this.#hasDispatchedContext();

    // Synthesized error/loading combine configuration-level conditions with
    // the core store's own state; expressed as pure derived signals.
    this.error = computed(
      () => runtimeError() ?? endpointsError() ?? this.#storeError(),
    );
    // listError exposes only genuine fetch/mutation errors, excluding the
    // dev/config errors (missing runtime URL, runtime without thread
    // endpoints). Use this for user-facing error display so dev strings are
    // never shown to end users.
    this.listError = computed(() => this.#storeError());
    this.isLoading = computed(() =>
      runtimeError() || endpointsError()
        ? false
        : preConnectLoading() || this.#storeIsLoading(),
    );

    // Register/unregister this store with core for the active agent so core can
    // route realtime/agent-driven thread updates to it. Re-runs when the agent
    // id changes; the previous registration is cleared first.
    let registeredAgentId: string | undefined;
    effect(() => {
      const nextAgentId = agentId();
      const enabled = isEnabled();
      untracked(() => {
        // Disabled (e.g. unlicensed): ensure this store is NOT registered. The
        // registry is single-slot/last-writer-wins, so an inert store claiming
        // the agentId slot would evict — and on destroy tear down — a co-mounted
        // live store for the same agent. Mirrors react-core's use-threads gate.
        if (!enabled) {
          if (registeredAgentId !== undefined) {
            this.#copilotkit.core.unregisterThreadStore(registeredAgentId);
            registeredAgentId = undefined;
          }
          return;
        }
        if (registeredAgentId === nextAgentId) {
          return;
        }
        if (registeredAgentId !== undefined) {
          this.#copilotkit.core.unregisterThreadStore(registeredAgentId);
        }
        this.#copilotkit.core.registerThreadStore(nextAgentId, this.#store);
        registeredAgentId = nextAgentId;
      });
    });

    // Sync the runtime context. Defer until the runtime reports Connected so
    // the context's `getMetadataSocket` provider can resolve the shared socket
    // on the first dispatch — otherwise an early dispatch fetches the list with
    // realtime silently absent and then re-dispatches (a new session, so a
    // second list fetch + subscribe) once Connected. Waiting collapses it to a
    // single list + subscribe (mirrors react-core).
    //
    // The store dispatches `setContext` onto an `asapScheduler` queue, and its
    // bootstrap effect issues a list fetch for every queued `contextChanged`
    // whose state is non-null at drain time. So if this effect runs once with
    // no URL (clearing to `null`) and again once Connected (the real context)
    // before that queue drains, BOTH queued actions observe the latest
    // (non-null) state and two identical list fetches fire — the second
    // clobbering the first response. We therefore dispatch only on a
    // meaningful change: skip a clear-to-`null` when nothing was ever
    // dispatched (the store already holds `null`), and skip a re-dispatch of
    // an unchanged context. This collapses the benign URL→Connected transition
    // to a single dispatch and matches react-core's dependency-gated effect.
    let lastDispatchedContext: string | null = null;
    effect(() => {
      // Track every reactive input the dispatched context depends on, so the
      // effect re-runs when any of them changes — including `wsUrl`, which
      // arrives with `/info`. Once it lands the shared metadata socket becomes
      // resolvable, so (via the dedup signature below) a single re-dispatch
      // re-runs `setContext` and the context's `getMetadataSocket` provider now
      // resolves a socket.
      const active = isEnabled();
      const url = runtimeUrl();
      const status = runtimeStatus();
      const headers = this.#copilotkit.headers();
      const id = agentId();
      const archived = includeArchived();
      const pageLimit = limit();
      const listSupported = threadListSupported();
      const wsUrl = this.#copilotkit.intelligence()?.wsUrl;

      untracked(() => {
        const clearContext = (): void => {
          if (this.#hasDispatchedContext()) {
            this.#store.setContext(null);
          }
          lastDispatchedContext = null;
          this.#hasDispatchedContext.set(false);
        };

        // Disabled: stay inert. Clear any previously-dispatched context so an
        // in-flight subscription is torn down and no further fetch is issued.
        if (!active) {
          clearContext();
          return;
        }

        if (!url) {
          clearContext();
          return;
        }

        if (status !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
          // Core disposes the shared metadata socket whenever the runtime
          // leaves Connected. Reset the dedup signature so the next return to
          // Connected ALWAYS re-dispatches `setContext` — otherwise a status
          // blip that leaves the primitives unchanged would not re-dispatch,
          // stranding the store on a disposed socket. On reconnect the store
          // re-fetches creds and re-resolves a fresh socket.
          lastDispatchedContext = null;
          return;
        }

        if (!listSupported) {
          clearContext();
          return;
        }

        const context: ɵThreadRuntimeContext = {
          runtimeUrl: url,
          headers: { ...headers },
          getMetadataSocket: (joinToken) =>
            this.#copilotkit.core.ɵgetMetadataSocket(joinToken) ?? null,
          agentId: id,
          includeArchived: archived,
          limit: pageLimit,
        };

        // Build the dedup signature with header entries sorted, so a
        // same-content header map with a different key order does not trigger
        // a redundant setContext (and the refetch + resubscribe it causes).
        // Mirrors react-core's `headersKey`. The dispatched context keeps its
        // original header order; only the signature is normalized. The
        // `getMetadataSocket` provider is a live closure (not serializable), so
        // the signature keys off the source `wsUrl` — its identity/URL —
        // instead.
        const signature = JSON.stringify({
          runtimeUrl: url,
          headers: Object.entries(headers).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
          wsUrl,
          agentId: id,
          includeArchived: archived,
          limit: pageLimit,
        });
        if (signature === lastDispatchedContext) {
          return;
        }

        lastDispatchedContext = signature;
        this.#store.setContext(context);
        this.#hasDispatchedContext.set(true);
      });
    });

    this.renameThread = this.#guardMutation(mutationsError, (threadId, name) =>
      this.#store.renameThread(threadId, name),
    );
    this.archiveThread = this.#guardMutation(mutationsError, (threadId) =>
      this.#store.archiveThread(threadId),
    );
    this.unarchiveThread = this.#guardMutation(mutationsError, (threadId) =>
      this.#store.unarchiveThread(threadId),
    );
    this.deleteThread = this.#guardMutation(mutationsError, (threadId, _name) =>
      this.#store.deleteThread(threadId),
    );

    destroyRef.onDestroy(() => {
      this.teardown();
      if (registeredAgentId !== undefined) {
        this.#copilotkit.core.unregisterThreadStore(registeredAgentId);
        registeredAgentId = undefined;
      }
    });
  }

  readonly renameThread: (threadId: string, name: string) => Promise<void>;
  readonly archiveThread: (threadId: string) => Promise<void>;
  readonly unarchiveThread: (threadId: string) => Promise<void>;
  readonly deleteThread: (threadId: string) => Promise<void>;

  // Arrow-bound instance fields (not prototype methods) so they keep working
  // when destructured off the result — matching the mutation members above and
  // react-core's standalone callbacks.
  readonly fetchMoreThreads = (): void => {
    this.#store.fetchNextPage();
  };

  readonly refetchThreads = (): void => {
    this.#store.refetchThreads();
  };

  readonly startNewThread = (): void => {
    this.#store.startNewThread();
  };

  /** Unsubscribes all selector bridges and stops the underlying core store. */
  teardown(): void {
    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }
    this.#subscriptions.length = 0;
    this.#store.stop();
  }

  /**
   * Subscribes each core selector to its mirroring writable signal. The
   * `select` operator emits the current value synchronously on subscribe, so
   * the signals are seeded immediately and stay current thereafter.
   */
  #bridgeSelectors(): void {
    this.#subscriptions.push(
      this.#store.select(ɵselectThreads).subscribe((threads) => {
        this.#threads.set(threads.map(projectThread));
      }),
      this.#store.select(ɵselectThreadsIsLoading).subscribe((value) => {
        this.#storeIsLoading.set(value);
      }),
      this.#store.select(ɵselectThreadsError).subscribe((value) => {
        this.#storeError.set(value);
      }),
      this.#store.select(ɵselectFetchMoreError).subscribe((value) => {
        this.#fetchMoreError.set(value);
      }),
      this.#store.select(ɵselectHasNextPage).subscribe((value) => {
        this.#hasMoreThreads.set(value);
      }),
      this.#store.select(ɵselectIsFetchingNextPage).subscribe((value) => {
        this.#isFetchingMoreThreads.set(value);
      }),
      this.#store.select(ɵselectIsMutating).subscribe((value) => {
        this.#isMutating.set(value);
      }),
    );
  }

  /**
   * Wraps a mutation so that, when thread mutations are unavailable on the
   * connected runtime, the call rejects with a descriptive error instead of
   * issuing a request doomed to fail.
   */
  #guardMutation(
    mutationsError: () => Error | null,
    mutation: (threadId: string, name: string) => Promise<void>,
  ): (threadId: string, name?: string) => Promise<void> {
    return (threadId: string, name = "") => {
      const error = mutationsError();
      if (error) {
        return Promise.reject(error);
      }
      return mutation(threadId, name);
    };
  }
}

/**
 * Factory for {@link ThreadsStore} instances. Provided at the root so the
 * ambient {@link CopilotKit} configuration is resolved from the application's
 * injector.
 */
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
 * user and the given `agentId`. When the Intelligence platform exposes a
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
