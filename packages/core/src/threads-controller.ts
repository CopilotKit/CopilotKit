import type { CopilotKitCore } from "./core/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "./core/core";
import type { ɵThread, ɵThreadRuntimeContext, ɵThreadStore } from "./threads";

/**
 * The thread-list view model behind React `useThreads`, Vue `useThreads` and
 * Angular `injectThreads`. Internal (`ɵ`): it can change in any release.
 */

/** A thread as the framework hooks expose it. */
export interface ɵThreadSummary {
  id: string;
  agentId: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * ISO-8601 timestamp of the most recent agent run on this thread. Absent
   * when the thread has never been run. Prefer this over `updatedAt` for
   * user-facing "last activity" displays — it is not bumped by metadata-only
   * actions like rename or archive.
   */
  lastRunAt?: string;
}

/** Project a store thread onto the public shape (no internal fields). */
export function ɵprojectThread({
  id,
  agentId,
  name,
  archived,
  createdAt,
  updatedAt,
  lastRunAt,
}: ɵThread): ɵThreadSummary {
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

/** The hook inputs a {@link ɵThreadsController} needs. */
export interface ɵThreadsInput {
  /** The core whose runtime state and thread-store registry are used. */
  core: ɵThreadsCore;
  agentId: string;
  includeArchived?: boolean;
  limit?: number;
  /** `false` keeps the controller inert: no fetch, no registry claim. */
  enabled: boolean;
}

/** What a thread-list hook returns, minus the actions. */
export interface ɵThreadsSnapshot {
  threads: ɵThreadSummary[];
  isLoading: boolean;
  /** Configuration error first, then the list error. */
  error: Error | null;
  /**
   * Why the list did not load: a failed load, or a runtime that refuses to
   * list threads for a caller without identity. Not a configuration error.
   */
  listError: Error | null;
  fetchMoreError: Error | null;
  hasMoreThreads: boolean;
  isFetchingMoreThreads: boolean;
  isMutating: boolean;
}

const RUNTIME_URL_MISSING = "Runtime URL is not configured";
const THREAD_ENDPOINTS_UNAVAILABLE =
  "Thread endpoints are not available on this CopilotKit runtime";
const THREAD_LIST_NEEDS_IDENTITY =
  "Listing threads needs a caller identity. Set identifyUser on CopilotRuntime.";
const THREAD_MUTATIONS_UNAVAILABLE =
  "Thread mutations are not available on this CopilotKit runtime";

function isSameThreadsSnapshot(a: ɵThreadsSnapshot, b: ɵThreadsSnapshot) {
  return (
    a.threads === b.threads &&
    a.isLoading === b.isLoading &&
    a.error === b.error &&
    a.listError === b.listError &&
    a.fetchMoreError === b.fetchMoreError &&
    a.hasMoreThreads === b.hasMoreThreads &&
    a.isFetchingMoreThreads === b.isFetchingMoreThreads &&
    a.isMutating === b.isMutating
  );
}

/** The core state a {@link ɵThreadsController} reads. */
export type ɵThreadsCore = Pick<
  CopilotKitCore,
  | "runtimeUrl"
  | "ɵruntimeInfo"
  | "ɵheadersGeneration"
  | "registerThreadStore"
  | "unregisterThreadStore"
>;

/**
 * Drives a thread store from a hook's inputs and the core's runtime state.
 *
 * - **Context**: the store gets a runtime context only once the hook is
 *   enabled, a runtime URL is set, the runtime is connected, and it supports
 *   the thread list. The same context (including the header generation) is
 *   not sent twice, so an unchanged context does not fetch `/threads` again,
 *   and nothing is cleared when nothing was sent.
 * - **Registry**: the store is registered under the agent with core while
 *   the hook is enabled.
 * - **Errors**: a missing runtime URL or unsupported thread endpoints show as
 *   `error` until `startNewThread()` dismisses them; they come back when the
 *   configuration changes again.
 * - **Mutations**: rejected when the runtime does not support them.
 *
 * Call {@link update} whenever the inputs or the core's runtime state change
 * (runtime URL, connection status, header generation, intelligence,
 * thread endpoints), and {@link start} on mount.
 */
export class ɵThreadsController {
  readonly #store: ɵThreadStore;
  #input: ɵThreadsInput;
  readonly #listeners = new Set<() => void>();
  #hasDispatchedContext = false;
  #lastContextSignature: string | null = null;
  #registeredAgentId: string | null = null;
  #configErrorDismissed = false;
  #runtimeError: Error | null = null;
  #endpointsError: Error | null = null;
  #listAccessError: Error | null = null;
  #mutationsError: Error | null = null;
  #storeThreads: readonly ɵThread[] | null = null;
  #threads: ɵThreadSummary[] = [];
  #snapshot: ɵThreadsSnapshot;
  #serverSnapshot: ɵThreadsSnapshot | null = null;

  #registeredCore: ɵThreadsCore | null = null;

  constructor(store: ɵThreadStore, input: ɵThreadsInput) {
    this.#store = store;
    this.#input = input;
    this.#syncConfigErrors();
    this.#snapshot = this.#compute();
  }

  /** The current view. Same object until a value changes. */
  getSnapshot = () => this.#snapshot;

  /**
   * The view while prerendering (SSR): the store holds no client data there,
   * so this projects its initial state. Same object on every call.
   */
  getServerSnapshot = () => {
    this.#serverSnapshot ??= this.#compute(this.#store.getServerState());
    return this.#serverSnapshot;
  };

  /** Listen for changes. Returns unsubscribe. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Start the store and follow its state. Returns the stop function, which
   * also releases the registry claim.
   */
  start() {
    this.#store.start();
    const subscription = this.#store
      .select((state) => state)
      .subscribe(() => this.#refresh());
    this.#refresh();
    return () => {
      subscription.unsubscribe();
      this.#releaseRegistry();
      this.#store.stop();
      // A restart (React StrictMode remount) sends the context again.
      this.#lastContextSignature = null;
      this.#hasDispatchedContext = false;
    };
  }

  /** Apply the hook inputs and the core's current runtime state. */
  update(input: ɵThreadsInput) {
    this.#input = input;
    this.#syncRegistry();
    this.#syncContext();
    this.#syncConfigErrors();
    this.#refresh();
  }

  /** Show a fresh thread, and dismiss a configuration error. */
  startNewThread = () => {
    this.#configErrorDismissed = true;
    this.#store.startNewThread();
    this.#refresh();
  };

  renameThread = (threadId: string, name: string) =>
    this.#guard(() => this.#store.renameThread(threadId, name));

  archiveThread = (threadId: string) =>
    this.#guard(() => this.#store.archiveThread(threadId));

  unarchiveThread = (threadId: string) =>
    this.#guard(() => this.#store.unarchiveThread(threadId));

  deleteThread = (threadId: string) =>
    this.#guard(() => this.#store.deleteThread(threadId));

  fetchMoreThreads = () => this.#store.fetchNextPage();

  refetchThreads = () => this.#store.refetchThreads();

  dispose() {
    this.#releaseRegistry();
    this.#listeners.clear();
  }

  get #core() {
    return this.#input.core;
  }

  get #runtimeUrl() {
    return this.#core.runtimeUrl;
  }

  get #isConnected() {
    return (
      this.#core.ɵruntimeInfo.status ===
      CopilotKitCoreRuntimeConnectionStatus.Connected
    );
  }

  get #listSupported() {
    return this.#core.ɵruntimeInfo.threadEndpoints?.list !== false;
  }

  get #endpointsUnavailable() {
    return !!this.#runtimeUrl && this.#isConnected && !this.#listSupported;
  }

  /**
   * The runtime refuses to list threads because the caller has no identity:
   * it reads a thread by id but does not list. Only the runtime's anonymous
   * thread access policy (no `identifyUser`, default `owner` access) reports
   * that pair; a runtime without thread endpoints reports neither.
   */
  get #listNeedsIdentity() {
    return (
      this.#endpointsUnavailable &&
      this.#core.ɵruntimeInfo.threadEndpoints?.inspect === true
    );
  }

  #guard(mutation: () => Promise<void>) {
    if (this.#mutationsError) return Promise.reject(this.#mutationsError);
    return mutation();
  }

  #syncRegistry() {
    const { enabled, agentId, core } = this.#input;
    if (!enabled) {
      this.#releaseRegistry();
      return;
    }
    const isClaimed =
      this.#registeredAgentId === agentId && this.#registeredCore === core;
    if (isClaimed) return;
    this.#releaseRegistry();
    core.registerThreadStore(agentId, this.#store);
    this.#registeredAgentId = agentId;
    this.#registeredCore = core;
  }

  #releaseRegistry() {
    if (this.#registeredAgentId === null || this.#registeredCore === null) {
      return;
    }
    this.#registeredCore.unregisterThreadStore(this.#registeredAgentId);
    this.#registeredAgentId = null;
    this.#registeredCore = null;
  }

  #syncContext() {
    const runtimeUrl = this.#runtimeUrl;
    const isInactive = !this.#input.enabled || !runtimeUrl;
    if (isInactive) {
      this.#clearContext();
      return;
    }
    if (!this.#isConnected) return;
    if (!this.#listSupported) {
      this.#clearContext();
      return;
    }
    const { agentId, includeArchived, limit } = this.#input;
    // No headers here: the store's fetch is `ɵruntimeFetch`, which resolves
    // the current core headers at send time (#1937).
    const context: ɵThreadRuntimeContext = {
      runtimeUrl,
      wsUrl: this.#core.ɵruntimeInfo.intelligence?.wsUrl,
      agentId,
      includeArchived,
      limit,
    };
    // A real header source change still forces one re-dispatch (a fresh
    // subscribe and refetch), so the generation is part of the signature.
    const signature = JSON.stringify({
      ...context,
      headersGeneration: this.#core.ɵheadersGeneration,
    });
    if (signature === this.#lastContextSignature) return;
    this.#lastContextSignature = signature;
    this.#store.setContext(context);
    this.#hasDispatchedContext = true;
  }

  #clearContext() {
    // The store already holds `null` when nothing was sent; clearing again
    // would queue a second list fetch.
    if (this.#hasDispatchedContext) this.#store.setContext(null);
    this.#hasDispatchedContext = false;
    this.#lastContextSignature = null;
  }

  #syncConfigErrors() {
    const hasRuntimeError = !this.#runtimeUrl;
    const listNeedsIdentity = this.#listNeedsIdentity;
    const hasEndpointsError = this.#endpointsUnavailable && !listNeedsIdentity;
    const runtimeChanged = hasRuntimeError !== (this.#runtimeError !== null);
    const endpointsChanged =
      hasEndpointsError !== (this.#endpointsError !== null);
    if (runtimeChanged) {
      this.#runtimeError = hasRuntimeError
        ? new Error(RUNTIME_URL_MISSING)
        : null;
    }
    if (endpointsChanged) {
      this.#endpointsError = hasEndpointsError
        ? new Error(THREAD_ENDPOINTS_UNAVAILABLE)
        : null;
    }
    if (listNeedsIdentity !== (this.#listAccessError !== null)) {
      this.#listAccessError = listNeedsIdentity
        ? new Error(THREAD_LIST_NEEDS_IDENTITY)
        : null;
    }
    // A configuration change brings a dismissed error back.
    if (runtimeChanged || endpointsChanged) this.#configErrorDismissed = false;

    const mutationsSupported =
      this.#core.ɵruntimeInfo.threadEndpoints?.mutations !== false;
    if (mutationsSupported) {
      this.#mutationsError = null;
    } else {
      this.#mutationsError ??= new Error(THREAD_MUTATIONS_UNAVAILABLE);
    }
  }

  #compute(state = this.#store.getState()): ɵThreadsSnapshot {
    const selectors = this.#store.selectors;
    const storeThreads = selectors.threads(state);
    if (storeThreads !== this.#storeThreads) {
      this.#storeThreads = storeThreads;
      this.#threads = storeThreads.map(ɵprojectThread);
    }
    const runtimeError = this.#configErrorDismissed ? null : this.#runtimeError;
    const endpointsError = this.#configErrorDismissed
      ? null
      : this.#endpointsError;
    const configError = runtimeError ?? endpointsError;
    const preConnectLoading =
      this.#input.enabled &&
      !!this.#runtimeUrl &&
      !this.#endpointsUnavailable &&
      !this.#hasDispatchedContext;
    const listError = this.#listAccessError ?? selectors.error(state);
    return {
      threads: this.#threads,
      isLoading: configError
        ? false
        : preConnectLoading || selectors.isLoading(state),
      error: configError ?? listError,
      listError,
      fetchMoreError: selectors.fetchMoreError(state),
      hasMoreThreads: selectors.hasNextPage(state),
      isFetchingMoreThreads: selectors.isFetchingNextPage(state),
      isMutating: selectors.isMutating(state),
    };
  }

  #refresh() {
    const next = this.#compute();
    if (isSameThreadsSnapshot(next, this.#snapshot)) return;
    this.#snapshot = next;
    const listeners = [...this.#listeners];
    for (const listener of listeners) listener();
  }
}
