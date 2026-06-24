import type { Signal } from "@angular/core";
import { DestroyRef, computed, effect, inject, signal } from "@angular/core";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
} from "@copilotkit/core";
import type { ɵThreadRuntimeContext, ɵThreadStore } from "@copilotkit/core";
import type { Subscription } from "rxjs";
import { CopilotKit } from "./copilotkit";

/**
 * A conversation thread managed by the Intelligence platform.
 *
 * Each thread has a unique `id`, an optional human-readable `name`, and
 * timestamp fields tracking creation and update times. This mirrors the
 * `Thread` shape exposed by `@copilotkit/react-core`'s `useThreads` hook.
 */
export interface Thread {
  /** Stable unique identifier for the thread. */
  id: string;
  /** Identifier of the agent the thread belongs to. */
  agentId: string;
  /** Human-readable thread name, or `null` when never named. */
  name: string | null;
  /** Whether the thread has been archived. */
  archived: boolean;
  /** ISO-8601 timestamp of when the thread was created. */
  createdAt: string;
  /** ISO-8601 timestamp of when the thread metadata last changed. */
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
 * Options controlling which threads {@link ThreadsStore} lists and how they
 * are paginated. Thread operations are scoped to the runtime-authenticated
 * user and the provided agent on the Intelligence platform.
 */
export interface InjectThreadsOptions {
  /** The ID of the agent whose threads to list and manage. */
  agentId: string;
  /** When `true`, archived threads are included in the list. Defaults to `false`. */
  includeArchived?: boolean;
  /** Maximum number of threads to fetch per page. When set, enables cursor-based pagination. */
  limit?: number;
}

/**
 * Reactive, signal-based view over the Intelligence platform thread list for
 * a single user/agent pair, plus stable mutation operations.
 *
 * This is the Angular analogue of `@copilotkit/react-core`'s `useThreads`
 * hook. It owns a CopilotKit core thread store, keeps the store's runtime
 * context in sync with the ambient {@link CopilotKit} configuration via an
 * Angular `effect`, and exposes the store's state as signals so templates can
 * consume it with `ChangeDetectionStrategy.OnPush`.
 *
 * The instance starts the underlying store on construction and tears it down
 * (unsubscribing and unregistering it from core) when the owning injection
 * context is destroyed.
 */
export class ThreadsStore {
  readonly #copilotkit: CopilotKit;
  readonly #agentId: string;
  readonly #includeArchived: boolean | undefined;
  readonly #limit: number | undefined;

  readonly #store: ɵThreadStore;
  readonly #subscriptions: Subscription[] = [];

  readonly #threads = signal<Thread[]>([]);
  readonly #storeIsLoading = signal<boolean>(false);
  readonly #storeError = signal<Error | null>(null);
  readonly #hasMoreThreads = signal<boolean>(false);
  readonly #isFetchingMoreThreads = signal<boolean>(false);

  // Tracks whether the first real context has been dispatched to the store.
  // The store itself starts with `isLoading: false`, so before dispatch a
  // consumer would otherwise see an empty, non-loading state (empty-list
  // flash). While a runtime URL is configured and we have not dispatched yet,
  // we synthesize `isLoading: true` so loading indicators stay up until the
  // first fetch is in flight.
  readonly #hasDispatchedContext = signal<boolean>(false);

  /**
   * Threads for the current user/agent pair, sorted by most recently active
   * first. Updated in realtime when the platform pushes metadata events.
   * Includes archived threads only when `includeArchived` is set.
   */
  readonly threads: Signal<Thread[]> = this.#threads.asReadonly();

  /**
   * Whether the runtime URL is missing. When `true`, {@link error} surfaces a
   * configuration error and mutations reject.
   */
  readonly #runtimeError: Signal<Error | null>;
  /**
   * Whether the connected runtime reports that the thread list endpoint is
   * unavailable. When `true`, {@link error} surfaces an unsupported-endpoint
   * error and no context is dispatched.
   */
  readonly #threadEndpointsError: Signal<Error | null>;
  /**
   * Whether the connected runtime reports that thread mutations are
   * unavailable. When non-null, mutation calls reject with this error.
   */
  readonly #threadMutationsError: Signal<Error | null>;

  /**
   * `true` while the initial thread list is being fetched from the platform.
   * Subsequent realtime updates do not re-enter the loading state. Resolves to
   * `false` when the runtime is misconfigured or the endpoints are
   * unavailable.
   */
  readonly isLoading: Signal<boolean>;

  /**
   * The most recent error affecting the thread list, or `null` when there is
   * none. It composes, in precedence order, the runtime-configuration error
   * (missing runtime URL), the thread-list endpoint-availability error, and the
   * store's thread-list load/fetch error.
   *
   * Per-operation mutation rejections (rename/archive/unarchive/delete failing
   * at runtime, including the mutations-unavailable precondition) are
   * intentionally **not** reflected here — they are surfaced via the rejected
   * promise returned from each mutation method and must be handled by the
   * caller.
   */
  readonly error: Signal<Error | null>;

  /**
   * `true` when there are more threads available to fetch via
   * {@link fetchMoreThreads}. Only meaningful when `limit` is set.
   */
  readonly hasMoreThreads: Signal<boolean> = this.#hasMoreThreads.asReadonly();

  /** `true` while a subsequent page of threads is being fetched. */
  readonly isFetchingMoreThreads: Signal<boolean> =
    this.#isFetchingMoreThreads.asReadonly();

  /**
   * @param copilotkit - Ambient CopilotKit instance providing runtime config.
   * @param options - Agent identifier and optional list controls.
   * @param destroyRef - Injection-context lifetime used to tear the store down.
   */
  constructor(
    copilotkit: CopilotKit,
    options: InjectThreadsOptions,
    destroyRef: DestroyRef,
  ) {
    this.#copilotkit = copilotkit;
    this.#agentId = options.agentId;
    this.#includeArchived = options.includeArchived;
    this.#limit = options.limit;

    this.#store = ɵcreateThreadStore({ fetch: globalThis.fetch });

    this.#runtimeError = computed(() =>
      this.#copilotkit.runtimeUrl()
        ? null
        : new Error("Runtime URL is not configured"),
    );

    this.#threadEndpointsError = computed(() => {
      const runtimeUrl = this.#copilotkit.runtimeUrl();
      const connected =
        this.#copilotkit.runtimeConnectionStatus() ===
        CopilotKitCoreRuntimeConnectionStatus.Connected;
      const listSupported =
        this.#copilotkit.core.threadEndpoints?.list !== false;
      if (runtimeUrl && connected && !listSupported) {
        return new Error(
          "Thread endpoints are not available on this CopilotKit runtime",
        );
      }
      return null;
    });

    this.#threadMutationsError = computed(() => {
      // Read the connection status so this recomputes once `/info` lands and
      // populates `core.threadEndpoints` (a non-reactive snapshot on core).
      this.#copilotkit.runtimeConnectionStatus();
      return this.#copilotkit.core.threadEndpoints?.mutations === false
        ? new Error(
            "Thread mutations are not available on this CopilotKit runtime",
          )
        : null;
    });

    this.isLoading = computed(() => {
      if (this.#runtimeError() || this.#threadEndpointsError()) {
        return false;
      }
      const preConnectLoading =
        !!this.#copilotkit.runtimeUrl() &&
        !this.#threadEndpointsError() &&
        !this.#hasDispatchedContext();
      return preConnectLoading || this.#storeIsLoading();
    });

    this.error = computed(
      () =>
        this.#runtimeError() ??
        this.#threadEndpointsError() ??
        this.#storeError(),
    );

    this.#store.start();
    this.#bridgeStoreState();
    this.#copilotkit.core.registerThreadStore(this.#agentId, this.#store);

    // Keep the store's runtime context in sync with ambient CopilotKit config.
    // Defer dispatching context until the runtime reports Connected so the
    // initial fetch can include `wsUrl` and avoid a redundant second fetch.
    effect(() => {
      const runtimeUrl = this.#copilotkit.runtimeUrl();
      const status = this.#copilotkit.runtimeConnectionStatus();
      // Read headers so the effect re-runs when they change.
      const headers = this.#copilotkit.headers();

      if (!runtimeUrl) {
        this.#store.setContext(null);
        this.#hasDispatchedContext.set(false);
        return;
      }

      if (status !== CopilotKitCoreRuntimeConnectionStatus.Connected) {
        return;
      }

      if (this.#copilotkit.core.threadEndpoints?.list === false) {
        this.#store.setContext(null);
        this.#hasDispatchedContext.set(false);
        return;
      }

      const context: ɵThreadRuntimeContext = {
        runtimeUrl,
        headers: { ...headers },
        wsUrl: this.#copilotkit.core.intelligence?.wsUrl,
        agentId: this.#agentId,
        includeArchived: this.#includeArchived,
        limit: this.#limit,
      };

      this.#store.setContext(context);
      this.#hasDispatchedContext.set(true);
    });

    destroyRef.onDestroy(() => {
      this.teardown();
    });
  }

  /**
   * Bridges the core thread store's selector observables into writable
   * signals, recording the subscriptions for teardown.
   */
  #bridgeStoreState(): void {
    this.#subscriptions.push(
      this.#store.select(ɵselectThreads).subscribe((coreThreads) => {
        this.#threads.set(
          coreThreads.map(
            ({
              id,
              agentId,
              name,
              archived,
              createdAt,
              updatedAt,
              lastRunAt,
            }) => ({
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
      }),
      this.#store.select(ɵselectThreadsIsLoading).subscribe((value) => {
        this.#storeIsLoading.set(value);
      }),
      this.#store.select(ɵselectThreadsError).subscribe((value) => {
        this.#storeError.set(value);
      }),
      this.#store.select(ɵselectHasNextPage).subscribe((value) => {
        this.#hasMoreThreads.set(value);
      }),
      this.#store.select(ɵselectIsFetchingNextPage).subscribe((value) => {
        this.#isFetchingMoreThreads.set(value);
      }),
    );
  }

  /**
   * Runs a store mutation, short-circuiting with the mutations-unavailable
   * error when the connected runtime does not support thread mutations.
   */
  #guardMutation(mutation: () => Promise<void>): Promise<void> {
    const mutationsError = this.#threadMutationsError();
    if (mutationsError) {
      return Promise.reject(mutationsError);
    }
    return mutation();
  }

  /**
   * Fetch the next page of threads. No-op when {@link hasMoreThreads} is
   * `false` or a fetch is already in progress.
   */
  fetchMoreThreads(): void {
    this.#store.fetchNextPage();
  }

  /**
   * Rename a thread on the platform.
   * Resolves when the server confirms the update; rejects on failure.
   */
  renameThread(threadId: string, name: string): Promise<void> {
    return this.#guardMutation(() => this.#store.renameThread(threadId, name));
  }

  /**
   * Archive a thread on the platform.
   * Archived threads are excluded from subsequent list results.
   * Resolves when the server confirms the update; rejects on failure.
   */
  archiveThread(threadId: string): Promise<void> {
    return this.#guardMutation(() => this.#store.archiveThread(threadId));
  }

  /**
   * Restore a previously archived thread on the platform.
   * The thread re-appears in default (non-archived) list results.
   * Resolves when the server confirms the update; rejects on failure.
   */
  unarchiveThread(threadId: string): Promise<void> {
    return this.#guardMutation(() => this.#store.unarchiveThread(threadId));
  }

  /**
   * Permanently delete a thread from the platform.
   * This is irreversible. Resolves when the server confirms deletion;
   * rejects on failure.
   */
  deleteThread(threadId: string): Promise<void> {
    return this.#guardMutation(() => this.#store.deleteThread(threadId));
  }

  /**
   * Unsubscribes from the core store, unregisters it from core, and stops it.
   * Invoked automatically when the owning injection context is destroyed.
   */
  teardown(): void {
    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }
    this.#subscriptions.length = 0;
    this.#copilotkit.core.unregisterThreadStore(this.#agentId);
    this.#store.stop();
  }
}

/**
 * Inject a {@link ThreadsStore} for listing and managing Intelligence platform
 * threads for the given agent.
 *
 * This is the Angular analogue of `@copilotkit/react-core`'s `useThreads`. It
 * must be called from an injection context (component, directive, or service
 * constructor / field initializer). The returned store owns a CopilotKit core
 * thread store, exposes its state as signals, and tears itself down when the
 * injection context is destroyed.
 *
 * @param options - Agent identifier and optional list controls.
 * @returns A reactive {@link ThreadsStore} for the agent.
 *
 * @example
 * ```ts
 * @Component({
 *   standalone: true,
 *   changeDetection: ChangeDetectionStrategy.OnPush,
 *   template: `
 *     @if (threads.isLoading()) {
 *       <p>Loading…</p>
 *     } @else {
 *       <ul>
 *         @for (thread of threads.threads(); track thread.id) {
 *           <li>{{ thread.name ?? "Untitled" }}</li>
 *         }
 *       </ul>
 *     }
 *   `,
 * })
 * class ThreadListComponent {
 *   readonly threads = injectThreads({ agentId: "agent-1" });
 * }
 * ```
 */
export function injectThreads(options: InjectThreadsOptions): ThreadsStore {
  const copilotkit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);
  return new ThreadsStore(copilotkit, options, destroyRef);
}
