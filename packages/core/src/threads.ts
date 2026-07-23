import type { Subscription } from "rxjs";
import { defer, EMPTY, firstValueFrom, merge, Observable, of } from "rxjs";
import {
  catchError,
  filter,
  map,
  mergeMap,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  tap,
  timeout,
  withLatestFrom,
} from "rxjs/operators";
import {
  createActionGroup,
  createEffect,
  createReducer,
  createSelector,
  createStore,
  empty,
  ofType,
  on,
  props,
} from "./utils/micro-redux";
import type { Reducer, Store } from "./utils/micro-redux";
import {
  ɵphoenixChannel$,
  ɵobservePhoenixEvent$,
  ɵobservePhoenixJoinOutcome$,
} from "./utils/phoenix-observable";
import type { ɵPhoenixChannelSession } from "./utils/phoenix-observable";
import type { ɵMetadataSocket } from "./core/metadata-realtime";

const THREADS_CHANNEL_EVENT = "thread_metadata";
const THREAD_RUN_ACTIVITY_CHANNEL_EVENT = "thread_run_activity";
const THREAD_SUBSCRIBE_PATH = "/threads/subscribe";
const REQUEST_TIMEOUT_MS = 15_000;

interface ThreadRecord {
  id: string;
  organizationId: string;
  agentId: string;
  createdById: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

interface ThreadRuntimeContext {
  runtimeUrl: string;
  headers: Record<string, string>;
  agentId: string;
  includeArchived?: boolean;
  limit?: number;
  /**
   * Resolves the SHARED, credential-agnostic metadata socket for a given
   * `joinToken` (the store fetches its own `/threads/subscribe` credentials and
   * hands the resulting `joinToken` here). Owned by `CopilotKitCore` and shared
   * with the memory store: threads join their own `user_meta:<joinCode>` channel
   * off the returned socket instead of opening one of their own. Returns `null`
   * when no shared socket is available yet (e.g. the runtime is not connected) —
   * the store then simply never joins its channel and realtime silently stays
   * absent.
   *
   * Resolves the shared metadata socket for the given joinToken (seed-once; see
   * core.ɵgetMetadataSocket). Core DISPOSES the shared socket on disconnect,
   * header change, and health give-up — so a binding MUST re-dispatch setContext
   * on return-to-Connected (and header change) to re-resolve a fresh socket,
   * else the store is stranded on a disposed socket.
   */
  getMetadataSocket: (joinToken: string) => ɵMetadataSocket | null;
}

type ThreadMetadataEvent =
  | {
      operation: "created" | "renamed" | "archived" | "unarchived" | "updated";
      threadId: string;
      userId: string;
      organizationId: string;
      occurredAt: string;
      thread: ThreadRecord;
    }
  | {
      operation: "deleted";
      threadId: string;
      userId: string;
      organizationId: string;
      occurredAt: string;
      deleted: {
        id: string;
      };
    };

/**
 * Internal notification emitted when Intelligence observes new run activity
 * for a thread without changing that thread's metadata row.
 */
export type ThreadRunActivityNotification = {
  type: "thread_run_activity";
  threadId: string;
  agentId?: string;
  runId?: string;
  eventType: string;
  latestEventId?: string;
};

type ThreadRunActivityGatewayPayload = {
  threadId?: unknown;
  thread_id?: unknown;
  agentId?: unknown;
  agent_id?: unknown;
  runId?: unknown;
  run_id?: unknown;
  eventType?: unknown;
  event_type?: unknown;
  latestEventId?: unknown;
  latest_event_id?: unknown;
};

interface ThreadListResponse {
  threads: ThreadRecord[];
  joinCode?: string | null;
  nextCursor?: string | null;
}

interface ThreadMetadataCredentialsResponse {
  joinToken: string;
}

interface MutationRequest {
  requestId: string;
  /** Session the mutation was dispatched in; stale results are dropped. */
  sessionId: number;
  path: string;
  method: "PATCH" | "POST" | "DELETE";
  body: Record<string, unknown>;
}

type MutationOutcome =
  | { requestId: string; sessionId: number; ok: true }
  | { requestId: string; sessionId: number; ok: false; error: Error };

interface ThreadEnvironment {
  fetch: typeof fetch;
  /**
   * Optional callback invoked whenever a thread mutation (rename, archive,
   * unarchive, delete) is rejected by the server. Lets framework wrappers
   * surface a transient error toast without subscribing to the error
   * selector. The error is also recorded in `state.error` regardless.
   *
   * Fired after any rollback (delete) has been applied to local state.
   */
  onError?: (error: Error) => void;
}

interface ThreadState {
  threads: ThreadRecord[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  error: Error | null;
  /**
   * Error from the most recent failed next-page (`fetchMore`) load, or `null`.
   * Tracked SEPARATELY from `error` so a paginated-load failure surfaces an
   * inline "couldn't load more" affordance without replacing the already-loaded
   * list with a full-panel error. Cleared when a fetch-more is retried or when
   * one succeeds; reset on context change / stop.
   */
  fetchMoreError: Error | null;
  context: ThreadRuntimeContext | null;
  sessionId: number;
  metadataCredentialsRequested: boolean;
  metadataJoinCode: string | null;
  nextCursor: string | null;
  /** Number of thread mutations currently awaiting a server response. */
  inFlightMutationCount: number;
  /**
   * Rows optimistically removed by an in-flight `delete`, keyed by the
   * originating request id. DELETE is the one mutation that rolls back on
   * rejection, so the removed row is parked here and restored if the server
   * rejects. Rename/archive/unarchive are optimistic no-rollback and do not
   * populate this map.
   */
  pendingDeletes: Record<string, ThreadRecord>;
}

const initialThreadState: ThreadState = {
  threads: [],
  isLoading: false,
  isFetchingNextPage: false,
  error: null,
  fetchMoreError: null,
  context: null,
  sessionId: 0,
  metadataCredentialsRequested: false,
  metadataJoinCode: null,
  nextCursor: null,
  inFlightMutationCount: 0,
  pendingDeletes: {},
};

const threadAdapterEvents = createActionGroup("Thread Adapter", {
  started: empty(),
  stopped: empty(),
  contextChanged: props<{ context: ThreadRuntimeContext | null }>(),
  fetchNextPageRequested: empty(),
  renameRequested: props<{
    requestId: string;
    threadId: string;
    name: string;
  }>(),
  archiveRequested: props<{ requestId: string; threadId: string }>(),
  unarchiveRequested: props<{ requestId: string; threadId: string }>(),
  deleteRequested: props<{ requestId: string; threadId: string }>(),
  newThreadStarted: empty(),
});

const threadRestEvents = createActionGroup("Thread REST", {
  listRequested: props<{ sessionId: number }>(),
  listSucceeded: props<{
    sessionId: number;
    threads: ThreadRecord[];
    joinCode: string | null;
    nextCursor: string | null;
  }>(),
  listFailed: props<{ sessionId: number; error: Error }>(),
  nextPageSucceeded: props<{
    sessionId: number;
    threads: ThreadRecord[];
    nextCursor: string | null;
  }>(),
  nextPageFailed: props<{ sessionId: number; error: Error }>(),
  metadataCredentialsRequested: props<{ sessionId: number }>(),
  metadataCredentialsSucceeded: props<{
    sessionId: number;
    joinToken: string;
  }>(),
  metadataCredentialsFailed: props<{ sessionId: number; error: Error }>(),
  mutationFinished: props<{ outcome: MutationOutcome }>(),
});

const threadSocketEvents = createActionGroup("Thread Socket", {
  joinFailed: props<{ sessionId: number }>(),
  joinTimedOut: props<{ sessionId: number }>(),
  metadataReceived: props<{
    sessionId: number;
    payload: ThreadMetadataEvent;
  }>(),
  runActivityReceived: props<{
    sessionId: number;
    notification: ThreadRunActivityNotification;
  }>(),
});

const threadDomainEvents = createActionGroup("Thread Domain", {
  threadUpserted: props<{ sessionId: number; thread: ThreadRecord }>(),
  threadDeleted: props<{ sessionId: number; threadId: string }>(),
});

function sortThreadsByRecency(threads: ThreadRecord[]): ThreadRecord[] {
  // Prefer lastRunAt so the order reflects actual agent activity and stays
  // stable when a user performs metadata-only actions like archive or rename.
  // Fall back to updatedAt (and then createdAt) for threads that have never run.
  return [...threads].sort((left, right) => {
    const leftKey = left.lastRunAt ?? left.updatedAt ?? left.createdAt;
    const rightKey = right.lastRunAt ?? right.updatedAt ?? right.createdAt;
    return rightKey.localeCompare(leftKey);
  });
}

function upsertThread(
  threads: ThreadRecord[],
  thread: ThreadRecord,
): ThreadRecord[] {
  const existingIndex = threads.findIndex((item) => item.id === thread.id);
  if (existingIndex === -1) {
    return sortThreadsByRecency([...threads, thread]);
  }

  const next = [...threads];
  next[existingIndex] = thread;
  return sortThreadsByRecency(next);
}

/**
 * Returns a non-empty string payload field or undefined for absent fields.
 */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Converts gateway run-activity payloads into the internal TypeScript shape.
 */
function normalizeThreadRunActivityNotification(
  payload: ThreadRunActivityGatewayPayload,
): ThreadRunActivityNotification | null {
  const threadId = optionalString(payload.threadId ?? payload.thread_id);
  const eventType = optionalString(payload.eventType ?? payload.event_type);

  if (!threadId || !eventType) {
    return null;
  }

  return {
    type: "thread_run_activity",
    threadId,
    agentId: optionalString(payload.agentId ?? payload.agent_id),
    runId: optionalString(payload.runId ?? payload.run_id),
    eventType,
    latestEventId: optionalString(
      payload.latestEventId ?? payload.latest_event_id,
    ),
  };
}

const threadReducer = createReducer(
  initialThreadState,
  on(threadAdapterEvents.contextChanged, (state: ThreadState, { context }) => ({
    ...state,
    context,
    sessionId: state.sessionId + 1,
    threads: [],
    isLoading: Boolean(context),
    isFetchingNextPage: false,
    error: null,
    fetchMoreError: null,
    metadataCredentialsRequested: false,
    metadataJoinCode: null,
    nextCursor: null,
    inFlightMutationCount: 0,
    pendingDeletes: {},
  })),
  on(threadAdapterEvents.stopped, (state: ThreadState) => ({
    ...state,
    threads: [],
    isLoading: false,
    isFetchingNextPage: false,
    error: null,
    fetchMoreError: null,
    metadataCredentialsRequested: false,
    metadataJoinCode: null,
    nextCursor: null,
    inFlightMutationCount: 0,
    pendingDeletes: {},
  })),
  on(threadRestEvents.listRequested, (state: ThreadState, { sessionId }) => {
    if (sessionId !== state.sessionId || !state.context) {
      return state;
    }

    return {
      ...state,
      isLoading: true,
      error: null,
      // A full-list refetch supersedes any prior fetch-more failure: the whole
      // list is being reloaded, so the stale inline "couldn't load more" banner
      // must not survive onto the fresh list.
      fetchMoreError: null,
    };
  }),
  on(
    threadRestEvents.listSucceeded,
    (state: ThreadState, { sessionId, threads, joinCode, nextCursor }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }
      const joinCodeChanged = joinCode !== state.metadataJoinCode;

      return {
        ...state,
        threads: sortThreadsByRecency(threads),
        isLoading: false,
        error: null,
        // The fresh full list also clears any lingering fetch-more error, in
        // case the list arrived without passing through `listRequested`.
        fetchMoreError: null,
        metadataJoinCode: joinCode,
        metadataCredentialsRequested: joinCodeChanged
          ? false
          : state.metadataCredentialsRequested,
        nextCursor,
      };
    },
  ),
  on(
    threadRestEvents.listFailed,
    (state: ThreadState, { sessionId, error }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        isLoading: false,
        error,
      };
    },
  ),
  on(
    threadRestEvents.nextPageSucceeded,
    (state: ThreadState, { sessionId, threads, nextCursor }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      let merged = state.threads;
      for (const thread of threads) {
        merged = upsertThread(merged, thread);
      }

      return {
        ...state,
        threads: merged,
        isFetchingNextPage: false,
        // A successful next page clears any prior fetch-more error.
        fetchMoreError: null,
        nextCursor,
      };
    },
  ),
  on(
    threadRestEvents.nextPageFailed,
    (state: ThreadState, { sessionId, error }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      // A failed next-page load records the error on the DEDICATED fetch-more
      // channel — NOT `state.error` — so the already-loaded list is preserved
      // and the drawer renders an inline "couldn't load more — retry" panel
      // rather than replacing the whole list with a full-panel error.
      return {
        ...state,
        isFetchingNextPage: false,
        fetchMoreError: error,
      };
    },
  ),
  on(
    threadRestEvents.metadataCredentialsFailed,
    (state: ThreadState, { sessionId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      // Non-fatal: the metadata-credentials (realtime join-token) fetch runs
      // AFTER the thread list has already loaded and only powers the realtime
      // channel. A failure means realtime won't connect, but the fetched list
      // is still valid — so we do NOT write `state.error` (which would replace
      // the whole list with a "couldn't load" panel). The failure is surfaced
      // as a diagnostic warning instead (the B5 warn in
      // `createThreadMetadataCredentialsObservable`), mirroring the stay-stale
      // handling of a realtime channel join failure. Clear the request latch so
      // a later list refresh can retry realtime setup.
      return {
        ...state,
        metadataCredentialsRequested: false,
      };
    },
  ),
  on(
    threadRestEvents.metadataCredentialsRequested,
    (state: ThreadState, { sessionId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        metadataCredentialsRequested: true,
      };
    },
  ),
  on(threadAdapterEvents.fetchNextPageRequested, (state: ThreadState) => {
    if (!state.nextCursor || state.isFetchingNextPage) {
      return state;
    }

    return {
      ...state,
      isFetchingNextPage: true,
      // Clear any prior fetch-more error so a retry dismisses the inline panel
      // immediately while the next-page request is in flight.
      fetchMoreError: null,
    };
  }),
  on(
    threadAdapterEvents.renameRequested,
    (state: ThreadState, { threadId, name }) => {
      // Optimistic, no-rollback: reflect the new name immediately. A failure
      // surfaces via `error`/`onError` but the local row is left as-is; a
      // realtime metadata event or refetch reconciles the true server state.
      const existing = state.threads.find((thread) => thread.id === threadId);
      const inFlightMutationCount = state.inFlightMutationCount + 1;
      if (!existing) {
        return { ...state, inFlightMutationCount };
      }

      return {
        ...state,
        threads: upsertThread(state.threads, { ...existing, name }),
        inFlightMutationCount,
      };
    },
  ),
  on(
    threadAdapterEvents.archiveRequested,
    (state: ThreadState, { threadId }) => {
      // Optimistic, no-rollback. When archived threads are hidden, drop the
      // row; otherwise flip the flag in place. Note: archiving the active
      // thread is non-destructive — the wrapper keeps viewing it.
      const existing = state.threads.find((thread) => thread.id === threadId);
      const inFlightMutationCount = state.inFlightMutationCount + 1;
      if (!existing) {
        return { ...state, inFlightMutationCount };
      }

      if (!state.context?.includeArchived) {
        return {
          ...state,
          threads: state.threads.filter((thread) => thread.id !== threadId),
          inFlightMutationCount,
        };
      }

      return {
        ...state,
        threads: upsertThread(state.threads, { ...existing, archived: true }),
        inFlightMutationCount,
      };
    },
  ),
  on(
    threadAdapterEvents.unarchiveRequested,
    (state: ThreadState, { threadId }) => {
      // Optimistic, no-rollback.
      const existing = state.threads.find((thread) => thread.id === threadId);
      const inFlightMutationCount = state.inFlightMutationCount + 1;
      if (!existing) {
        return { ...state, inFlightMutationCount };
      }

      return {
        ...state,
        threads: upsertThread(state.threads, { ...existing, archived: false }),
        inFlightMutationCount,
      };
    },
  ),
  on(
    threadAdapterEvents.deleteRequested,
    (state: ThreadState, { requestId, threadId }) => {
      // Optimistic WITH rollback: remove the row now, but park it under the
      // request id so it can be restored if the server rejects the delete.
      const existing = state.threads.find((thread) => thread.id === threadId);
      const inFlightMutationCount = state.inFlightMutationCount + 1;
      if (!existing) {
        return { ...state, inFlightMutationCount };
      }

      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== threadId),
        pendingDeletes: { ...state.pendingDeletes, [requestId]: existing },
        inFlightMutationCount,
      };
    },
  ),
  on(threadAdapterEvents.newThreadStarted, (state: ThreadState) => ({
    // Lazy creation: a fresh client-side thread does NOT add a phantom row —
    // it only materializes once its first run persists server-side. The
    // store-side concern is purely to clear any stale error so the welcome
    // screen renders cleanly; the wrapper owns the active/explicit threadId.
    ...state,
    error: null,
  })),
  on(threadRestEvents.mutationFinished, (state: ThreadState, { outcome }) => {
    // Drop results from a superseded session. `contextChanged`/`stopped` already
    // reset `threads`, `pendingDeletes`, and `inFlightMutationCount`, so a
    // mutation that resolves after the context switched must not write an error,
    // fire onError (guarded in subscribeErrors), or roll a stale row back into
    // the new list. Mirrors every other session-scoped handler.
    if (outcome.sessionId !== state.sessionId) {
      return state;
    }

    const inFlightMutationCount = Math.max(0, state.inFlightMutationCount - 1);

    if (outcome.ok) {
      // Success: drop any parked delete-rollback snapshot for this request.
      if (state.pendingDeletes[outcome.requestId] === undefined) {
        return { ...state, inFlightMutationCount };
      }

      const { [outcome.requestId]: _settled, ...rest } = state.pendingDeletes;
      return { ...state, inFlightMutationCount, pendingDeletes: rest };
    }

    // Failure: surface the error. For a rejected delete, restore the row that
    // was optimistically removed (rollback). Other mutations are no-rollback.
    const rolledBack = state.pendingDeletes[outcome.requestId];
    if (rolledBack === undefined) {
      return { ...state, inFlightMutationCount, error: outcome.error };
    }

    const { [outcome.requestId]: _restored, ...rest } = state.pendingDeletes;
    return {
      ...state,
      threads: upsertThread(state.threads, rolledBack),
      pendingDeletes: rest,
      inFlightMutationCount,
      error: outcome.error,
    };
  }),
  on(
    threadDomainEvents.threadUpserted,
    (state: ThreadState, { sessionId, thread }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        threads: upsertThread(state.threads, thread),
      };
    },
  ),
  on(
    threadDomainEvents.threadDeleted,
    (state: ThreadState, { sessionId, threadId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== threadId),
      };
    },
  ),
) as Reducer<ThreadState>;

/**
 * The set of memoized thread selectors bound to a single store instance.
 *
 * @see createThreadSelectors
 */
interface ThreadSelectors {
  threads: (state: ThreadState) => ThreadRecord[];
  isLoading: (state: ThreadState) => boolean;
  error: (state: ThreadState) => Error | null;
  fetchMoreError: (state: ThreadState) => Error | null;
  hasNextPage: (state: ThreadState) => boolean;
  isFetchingNextPage: (state: ThreadState) => boolean;
  isMutating: (state: ThreadState) => boolean;
}

/**
 * Builds a fresh set of memoized thread selectors.
 *
 * Each `createSelector` closure owns a private one-entry cache. Sharing a
 * single module-level selector instance across multiple concurrent stores
 * (e.g. a `<CopilotThreadsDrawer>` plus an independent `useThreads`) makes every
 * cross-store emission a cache miss, defeating memoization and risking
 * emission instability for any future selector that allocates a new
 * object/array. Creating a per-store instance keeps each store's cache
 * isolated so concurrent stores never thrash one another.
 */
function createThreadSelectors(): ThreadSelectors {
  return {
    threads: createSelector((state: ThreadState) => state.threads),
    isLoading: createSelector((state: ThreadState) => state.isLoading),
    error: createSelector((state: ThreadState) => state.error),
    fetchMoreError: createSelector(
      (state: ThreadState) => state.fetchMoreError,
    ),
    hasNextPage: createSelector(
      (state: ThreadState) => state.nextCursor != null,
    ),
    isFetchingNextPage: createSelector(
      (state: ThreadState) => state.isFetchingNextPage,
    ),
    isMutating: createSelector(
      (state: ThreadState) => state.inFlightMutationCount > 0,
    ),
  };
}

// Standalone selector instances retained for callers that read a one-off
// snapshot (e.g. `selectThreads(store.getState())`) where cross-store memo
// isolation is irrelevant. Subscriptions through `store.select(...)` should
// prefer the per-store `ThreadStore.selectors` bundle below.
const standaloneSelectors = createThreadSelectors();
const selectThreads = standaloneSelectors.threads;
const selectThreadsIsLoading = standaloneSelectors.isLoading;
const selectThreadsError = standaloneSelectors.error;
const selectFetchMoreError = standaloneSelectors.fetchMoreError;
const selectHasNextPage = standaloneSelectors.hasNextPage;
const selectIsFetchingNextPage = standaloneSelectors.isFetchingNextPage;
const selectIsMutating = standaloneSelectors.isMutating;

interface ThreadStore {
  start(): void;
  stop(): void;
  setContext(context: ThreadRuntimeContext | null): void;
  /** Re-fetches the thread list without resetting the current list to empty. */
  refresh(): void;
  /**
   * Re-fetches the thread list without resetting the current list to empty.
   *
   * Public, design-named alias of {@link refresh} used by the drawer's
   * error-state Retry affordance and the Active/All filter-change refetch.
   */
  refetchThreads(): void;
  /**
   * Resets to a fresh, client-side thread so the welcome screen can show.
   *
   * Lazy creation: no phantom row is added to the list — the new thread only
   * materializes once its first run persists server-side. This is distinct
   * from selecting an existing thread (which the wrapper marks *explicit*,
   * suppressing the welcome screen): the thread produced here is NOT explicit.
   */
  startNewThread(): void;
  fetchNextPage(): void;
  renameThread(threadId: string, name: string): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  unarchiveThread(threadId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  /**
   * Subscribes to synthetic run-activity notifications without changing the
   * thread metadata list.
   */
  subscribeToRunActivity?(
    callback: (notification: ThreadRunActivityNotification) => void,
  ): Subscription;
  getState(): ThreadState;
  /**
   * Returns a stable initial snapshot for server-side rendering.
   *
   * `useSyncExternalStore` requires a `getServerSnapshot` during SSR/prerender
   * (e.g. Next.js); without one React throws "Missing getServerSnapshot". The
   * returned reference is stable across calls so React does not loop. There is
   * no client-side thread data during prerender, so this is the empty initial
   * state.
   */
  getServerState(): ThreadState;
  select: Store<ThreadState>["select"];
  /**
   * Memoized selectors bound to THIS store instance.
   *
   * Subscriptions should pass these to {@link select} (e.g.
   * `store.select(store.selectors.threads)`) so each store keeps its own
   * one-entry memo cache. Sharing the module-level singletons across
   * concurrent stores defeats memoization and risks emission instability.
   */
  selectors: ThreadSelectors;
}

let threadRequestId = 0;

function createThreadRequestId(): string {
  threadRequestId += 1;
  return `thread-request-${threadRequestId}`;
}

function threadFromFetch<T>(
  input: string,
  init: RequestInit & {
    selector: (response: Response) => Promise<T>;
    fetch: typeof fetch;
  },
): Observable<T> {
  return new Observable<T>((subscriber) => {
    const { fetch: fetchImpl, selector, signal, ...requestInit } = init;
    const controller = new AbortController();
    const abortRequest = () => controller.abort();

    if (signal?.aborted) {
      abortRequest();
    } else {
      signal?.addEventListener("abort", abortRequest, { once: true });
    }

    fetchImpl(input, { ...requestInit, signal: controller.signal })
      .then((response) => selector(response))
      .then((value) => {
        if (subscriber.closed) return;
        subscriber.next(value);
        subscriber.complete();
      })
      .catch((error) => {
        if (!subscriber.closed) {
          subscriber.error(error);
        }
      });

    return () => {
      signal?.removeEventListener("abort", abortRequest);
      abortRequest();
    };
  });
}

function createThreadFetchObservable(
  environment: ThreadEnvironment,
  context: ThreadRuntimeContext,
  sessionId: number,
): Observable<
  | ReturnType<typeof threadRestEvents.listSucceeded>
  | ReturnType<typeof threadRestEvents.listFailed>
> {
  return defer(() => {
    const params: Record<string, string> = {
      agentId: context.agentId,
    };
    if (context.includeArchived) params.includeArchived = "true";
    if (context.limit != null) params.limit = String(context.limit);

    const qs = new URLSearchParams(params);
    return threadFromFetch(`${context.runtimeUrl}/threads?${qs.toString()}`, {
      selector: (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch threads: ${response.status}`);
        }

        return response.json() as Promise<ThreadListResponse>;
      },
      fetch: environment.fetch,
      method: "GET",
      headers: { ...context.headers },
    }).pipe(
      timeout({
        first: REQUEST_TIMEOUT_MS,
        with: () => {
          throw new Error("Request timed out");
        },
      }),
      map((data) =>
        threadRestEvents.listSucceeded({
          sessionId,
          threads: data.threads,
          joinCode:
            typeof data.joinCode === "string" && data.joinCode.length > 0
              ? data.joinCode
              : null,
          nextCursor: data.nextCursor ?? null,
        }),
      ),
      catchError((error) => {
        return of(
          threadRestEvents.listFailed({
            sessionId,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        );
      }),
    );
  });
}

function createThreadMetadataCredentialsObservable(
  environment: ThreadEnvironment,
  context: ThreadRuntimeContext,
  sessionId: number,
): Observable<
  | ReturnType<typeof threadRestEvents.metadataCredentialsSucceeded>
  | ReturnType<typeof threadRestEvents.metadataCredentialsFailed>
> {
  return defer(() => {
    return threadFromFetch(`${context.runtimeUrl}${THREAD_SUBSCRIBE_PATH}`, {
      selector: async (response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to fetch thread metadata credentials: ${response.status}`,
          );
        }

        return response.json() as Promise<ThreadMetadataCredentialsResponse>;
      },
      fetch: environment.fetch,
      method: "POST",
      headers: {
        ...context.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }).pipe(
      timeout({
        first: REQUEST_TIMEOUT_MS,
        with: () => {
          throw new Error("Request timed out");
        },
      }),
      map((data) => {
        if (typeof data.joinToken !== "string" || data.joinToken.length === 0) {
          throw new Error("missing joinToken");
        }

        return threadRestEvents.metadataCredentialsSucceeded({
          sessionId,
          joinToken: data.joinToken,
        });
      }),
      catchError((error) => {
        // B5: a genuine credentials-fetch failure degrades realtime silently
        // for the list — `metadataCredentialsFailed` deliberately does NOT write
        // `state.error` or touch the fetched list (see its reducer case). But
        // the degrade should be VISIBLE so operators can see that live updates
        // won't arrive; mirror the join-failure warn (and memory.ts's B5 warn).
        console.warn(
          "[threads] realtime subscribe failed; the thread list will not receive live updates",
          error,
        );
        return of(
          threadRestEvents.metadataCredentialsFailed({
            sessionId,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        );
      }),
    );
  });
}

function createThreadMutationObservable(
  environment: ThreadEnvironment,
  context: ThreadRuntimeContext,
  request: MutationRequest,
): Observable<ReturnType<typeof threadRestEvents.mutationFinished>> {
  return defer(() => {
    return threadFromFetch(`${context.runtimeUrl}${request.path}`, {
      selector: async (response) => {
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        return null;
      },
      fetch: environment.fetch,
      method: request.method,
      headers: {
        ...context.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.body),
    }).pipe(
      map(() =>
        threadRestEvents.mutationFinished({
          outcome: {
            requestId: request.requestId,
            sessionId: request.sessionId,
            ok: true,
          },
        }),
      ),
      catchError((error) => {
        return of(
          threadRestEvents.mutationFinished({
            outcome: {
              requestId: request.requestId,
              sessionId: request.sessionId,
              ok: false,
              error: error instanceof Error ? error : new Error(String(error)),
            },
          }),
        );
      }),
    );
  });
}

function createThreadStore(environment: ThreadEnvironment): ThreadStore {
  // Per-store selector instances keep this store's memo cache isolated from
  // any other concurrent store (see createThreadSelectors).
  const selectors = createThreadSelectors();

  const bootstrapEffect = createEffect(
    (
      actions$,
      state$: Observable<ThreadState>,
    ): Observable<ReturnType<typeof threadRestEvents.listRequested>> =>
      actions$.pipe(
        ofType(threadAdapterEvents.contextChanged),
        withLatestFrom(state$),
        filter(([, state]) => Boolean(state.context)),
        map(([, state]) =>
          threadRestEvents.listRequested({ sessionId: state.sessionId }),
        ),
      ),
  );

  const fetchEffect = createEffect(
    (actions$, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadRestEvents.listRequested),
        switchMap((action) =>
          state$.pipe(
            map((state) => state.context),
            filter((context): context is ThreadRuntimeContext =>
              Boolean(context),
            ),
            take(1),
            map((context) => ({ action, context })),
            takeUntil(
              actions$.pipe(
                ofType(
                  threadAdapterEvents.contextChanged,
                  threadAdapterEvents.stopped,
                ),
              ),
            ),
            switchMap(({ action: currentAction, context }) =>
              createThreadFetchObservable(
                environment,
                context,
                currentAction.sessionId,
              ),
            ),
          ),
        ),
      ),
  );

  const metadataCredentialsEffect = createEffect(
    (actions$, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadRestEvents.listSucceeded),
        withLatestFrom(state$),
        filter(([action, state]) => {
          return (
            action.sessionId === state.sessionId &&
            !state.metadataCredentialsRequested &&
            Boolean(state.metadataJoinCode)
          );
        }),
        map(([action]) =>
          threadRestEvents.metadataCredentialsRequested({
            sessionId: action.sessionId,
          }),
        ),
      ),
  );

  const metadataCredentialsFetchEffect = createEffect(
    (actions$, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadRestEvents.metadataCredentialsRequested),
        switchMap((action) =>
          state$.pipe(
            map((state) => state.context),
            filter((context): context is ThreadRuntimeContext =>
              Boolean(context),
            ),
            take(1),
            map((context) => ({ action, context })),
            takeUntil(
              actions$.pipe(
                ofType(
                  threadAdapterEvents.contextChanged,
                  threadAdapterEvents.stopped,
                ),
              ),
            ),
            switchMap(({ action: currentAction, context }) =>
              createThreadMetadataCredentialsObservable(
                environment,
                context,
                currentAction.sessionId,
              ),
            ),
          ),
        ),
      ),
  );

  // Joins `user_meta:<joinCode>` off the SHARED metadata socket (resolved via
  // `context.getMetadataSocket(joinToken)`, owned by `CopilotKitCore` and shared
  // with the memory store) instead of opening its own socket. The store still
  // fetches its OWN `/threads/subscribe` credentials (see
  // `metadataCredentialsFetchEffect`) and reads the `joinCode` from the LIST
  // response — only the socket SOURCE changed. Socket lifecycle/health is the
  // shared socket's concern (it warns internally on fatal give-up); this store
  // only cares about the channel join outcome (surfaced via
  // `joinFailed`/`joinTimedOut`, warned by `socketDiagnosticsEffect` below) and
  // the two channel events it maps.
  const socketEffect = createEffect(
    (actions$, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadRestEvents.metadataCredentialsSucceeded),
        withLatestFrom(state$),
        filter(([action, state]) => {
          return action.sessionId === state.sessionId && Boolean(state.context);
        }),
        switchMap(([action, state]) => {
          const context = state.context as ThreadRuntimeContext;
          const { joinToken } = action;
          const joinCode = state.metadataJoinCode as string;
          const sessionId = action.sessionId;
          const shutdown$ = actions$.pipe(
            ofType(
              threadAdapterEvents.contextChanged,
              threadAdapterEvents.stopped,
            ),
          );

          // Resolve the SHARED socket for this joinToken. `null` here is reached
          // AFTER a successful `/threads/subscribe`, so the runtime is connected
          // but has no shared metadata socket (e.g. connected without a ws URL;
          // the threads context is not gated on wsUrl). Rather than silently
          // dropping live updates with no signal, warn so operators can see that
          // the list will not receive live updates. The (already fetched) REST
          // list is unaffected. This branch only runs after a successful
          // subscribe, so it can't false-positive on the normal not-connected
          // path.
          const socket = context.getMetadataSocket(joinToken);
          if (!socket) {
            console.warn(
              "[threads] realtime unavailable: no shared metadata socket (runtime connected without a ws URL?); the thread list will not receive live updates",
            );
            return EMPTY;
          }

          const channel$ = ɵphoenixChannel$({
            socket$: socket.socket$,
            topic: `user_meta:${joinCode}`,
          }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

          const metadata$ = channel$.pipe(
            switchMap(({ channel }: ɵPhoenixChannelSession) =>
              ɵobservePhoenixEvent$<ThreadMetadataEvent>(
                channel,
                THREADS_CHANNEL_EVENT,
              ),
            ),
            map((payload) =>
              threadSocketEvents.metadataReceived({ sessionId, payload }),
            ),
          );

          const runActivity$ = channel$.pipe(
            switchMap(({ channel }: ɵPhoenixChannelSession) =>
              ɵobservePhoenixEvent$<ThreadRunActivityGatewayPayload>(
                channel,
                THREAD_RUN_ACTIVITY_CHANNEL_EVENT,
              ),
            ),
            map((payload) => normalizeThreadRunActivityNotification(payload)),
            filter(
              (notification): notification is ThreadRunActivityNotification =>
                notification !== null,
            ),
            map((notification) =>
              threadSocketEvents.runActivityReceived({
                sessionId,
                notification,
              }),
            ),
          );

          const joinOutcome$ = ɵobservePhoenixJoinOutcome$(channel$).pipe(
            filter((outcome) => outcome.type !== "joined"),
            map((outcome) =>
              outcome.type === "timeout"
                ? threadSocketEvents.joinTimedOut({ sessionId })
                : threadSocketEvents.joinFailed({ sessionId }),
            ),
          );

          return merge(metadata$, runActivity$, joinOutcome$).pipe(
            takeUntil(shutdown$),
          );
        }),
      ),
  );

  const realtimeMappingEffect = createEffect(
    (actions$, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadSocketEvents.metadataReceived),
        withLatestFrom(state$),
        filter(([action, state]) => action.sessionId === state.sessionId),
        map(([action, state]) => {
          if (action.payload.operation === "deleted") {
            return threadDomainEvents.threadDeleted({
              sessionId: action.sessionId,
              threadId: action.payload.deleted.id,
            });
          }

          // When includeArchived is false, an "archived" event should remove
          // the thread from the local list rather than upserting it.
          if (
            action.payload.operation === "archived" &&
            !state.context?.includeArchived
          ) {
            return threadDomainEvents.threadDeleted({
              sessionId: action.sessionId,
              threadId: action.payload.threadId,
            });
          }

          return threadDomainEvents.threadUpserted({
            sessionId: action.sessionId,
            thread: action.payload.thread,
          });
        }),
      ),
  );

  // Observability-only effect for realtime channel-join health. The socket
  // effect dispatches `joinFailed`/`joinTimedOut` but the reducer has no
  // handler for them by design: a transient channel-join failure while the
  // (already fetched) list is present must NOT become a hard list error —
  // the user keeps the stale list. Without this the actions would be
  // silently swallowed, leaving a realtime-join failure with zero signal.
  // Socket-level lifecycle/health is now the shared metadata socket's concern
  // (it warns internally on fatal give-up), and the credentials-fetch failure
  // warns itself (the B5 warn); this effect only covers the channel-level join
  // outcome. Session-guarded so a superseded session stays quiet.
  const socketDiagnosticsEffect = createEffect(
    (actions$, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadSocketEvents.joinFailed, threadSocketEvents.joinTimedOut),
        withLatestFrom(state$),
        filter(([action, state]) => action.sessionId === state.sessionId),
        tap(([action]) => {
          const reason = threadSocketEvents.joinTimedOut.match(action)
            ? "channel join timed out"
            : "channel join was rejected";
          console.warn(
            `[threads] realtime ${reason}; the thread list may be stale until reconnect`,
          );
        }),
      ),
    { dispatch: false },
  );

  const fetchNextPageEffect = createEffect(
    (actions$, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadAdapterEvents.fetchNextPageRequested),
        withLatestFrom(state$),
        filter(
          ([, state]) => Boolean(state.context) && Boolean(state.nextCursor),
        ),
        switchMap(([, state]) => {
          const context = state.context as ThreadRuntimeContext;
          const params: Record<string, string> = {
            agentId: context.agentId,
            cursor: state.nextCursor!,
          };
          if (context.includeArchived) params.includeArchived = "true";
          if (context.limit != null) params.limit = String(context.limit);

          return threadFromFetch(
            `${context.runtimeUrl}/threads?${new URLSearchParams(params).toString()}`,
            {
              selector: (response) => {
                if (!response.ok) {
                  throw new Error(
                    `Failed to fetch next page: ${response.status}`,
                  );
                }

                return response.json() as Promise<ThreadListResponse>;
              },
              fetch: environment.fetch,
              method: "GET",
              headers: { ...context.headers },
            },
          ).pipe(
            timeout({
              first: REQUEST_TIMEOUT_MS,
              with: () => {
                throw new Error("Request timed out");
              },
            }),
            map((data) =>
              threadRestEvents.nextPageSucceeded({
                sessionId: state.sessionId,
                threads: data.threads,
                nextCursor: data.nextCursor ?? null,
              }),
            ),
            catchError((error) =>
              of(
                threadRestEvents.nextPageFailed({
                  sessionId: state.sessionId,
                  error:
                    error instanceof Error ? error : new Error(String(error)),
                }),
              ),
            ),
            takeUntil(
              actions$.pipe(
                ofType(
                  threadAdapterEvents.contextChanged,
                  threadAdapterEvents.stopped,
                ),
              ),
            ),
          );
        }),
      ),
  );

  const mutationEffect = createEffect(
    (actions$, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(
          threadAdapterEvents.renameRequested,
          threadAdapterEvents.archiveRequested,
          threadAdapterEvents.unarchiveRequested,
          threadAdapterEvents.deleteRequested,
        ),
        withLatestFrom(state$),
        mergeMap(([action, state]) => {
          // Capture the dispatching session so a result that resolves after a
          // `contextChanged` is dropped by the reducer instead of leaking an
          // error/onError/rollback into the new session. The mergeMap is not
          // cancelled on context change, so the session tag is the guard.
          const sessionId = state.sessionId;
          const context = state.context;
          if (!context?.runtimeUrl) {
            const requestId = action.requestId;
            return of(
              threadRestEvents.mutationFinished({
                outcome: {
                  requestId,
                  sessionId,
                  ok: false,
                  error: new Error("Runtime URL is not configured"),
                },
              }),
            );
          }

          const commonBody = {
            agentId: context.agentId,
          };

          if (threadAdapterEvents.renameRequested.match(action)) {
            return createThreadMutationObservable(environment, context, {
              requestId: action.requestId,
              sessionId,
              method: "PATCH",
              path: `/threads/${encodeURIComponent(action.threadId)}`,
              body: {
                ...commonBody,
                name: action.name,
              },
            });
          }

          if (threadAdapterEvents.archiveRequested.match(action)) {
            return createThreadMutationObservable(environment, context, {
              requestId: action.requestId,
              sessionId,
              method: "POST",
              path: `/threads/${encodeURIComponent(action.threadId)}/archive`,
              body: commonBody,
            });
          }

          if (threadAdapterEvents.unarchiveRequested.match(action)) {
            return createThreadMutationObservable(environment, context, {
              requestId: action.requestId,
              sessionId,
              method: "PATCH",
              path: `/threads/${encodeURIComponent(action.threadId)}`,
              body: {
                ...commonBody,
                archived: false,
              },
            });
          }

          return createThreadMutationObservable(environment, context, {
            requestId: action.requestId,
            sessionId,
            method: "DELETE",
            path: `/threads/${encodeURIComponent(action.threadId)}`,
            body: commonBody,
          });
        }),
      ),
  );

  const store = createStore<ThreadState>({
    reducer: threadReducer,
    effects: [
      bootstrapEffect,
      fetchEffect,
      metadataCredentialsEffect,
      metadataCredentialsFetchEffect,
      socketEffect,
      realtimeMappingEffect,
      socketDiagnosticsEffect,
      fetchNextPageEffect,
      mutationEffect,
    ],
  });

  function trackMutation(
    dispatchAction:
      | ReturnType<typeof threadAdapterEvents.renameRequested>
      | ReturnType<typeof threadAdapterEvents.archiveRequested>
      | ReturnType<typeof threadAdapterEvents.unarchiveRequested>
      | ReturnType<typeof threadAdapterEvents.deleteRequested>,
  ): Promise<void> {
    const completion$ = merge(
      store.actions$.pipe(
        ofType(threadRestEvents.mutationFinished),
        filter(
          (action) => action.outcome.requestId === dispatchAction.requestId,
        ),
        map((action) => action.outcome),
      ),
      store.actions$.pipe(
        ofType(threadAdapterEvents.stopped),
        map(
          () =>
            ({
              requestId: dispatchAction.requestId,
              sessionId: store.getState().sessionId,
              ok: false,
              error: new Error(
                "Thread store stopped before mutation completed",
              ),
            }) satisfies MutationOutcome,
        ),
      ),
    ).pipe(take(1));

    const resultPromise = firstValueFrom(completion$).then((outcome) => {
      if (outcome.ok) {
        return;
      }

      throw outcome.error;
    });

    store.dispatch(dispatchAction);
    return resultPromise;
  }

  // Surface mutation rejections to the optional environment callback. The
  // reducer has already applied any delete rollback by the time this fires
  // (the store reduces state before re-emitting the action), so consumers see
  // a consistent list when they react to the error.
  let errorSubscription: Subscription | null = null;
  const subscribeErrors = (): void => {
    if (!environment.onError || errorSubscription) {
      return;
    }

    errorSubscription = store.actions$
      .pipe(
        ofType(threadRestEvents.mutationFinished),
        // Drop stale-session failures: a mutation that rejects after a
        // `contextChanged` belongs to a context the user already left, so
        // surfacing it would fire onError for the wrong session. The reducer
        // applies the same guard before writing `state.error`.
        filter(
          (action) =>
            !action.outcome.ok &&
            action.outcome.sessionId === store.getState().sessionId,
        ),
      )
      .subscribe((action) => {
        if (!action.outcome.ok) {
          environment.onError?.(action.outcome.error);
        }
      });
  };

  return {
    start(): void {
      store.init();
      subscribeErrors();
      store.dispatch(threadAdapterEvents.started());
    },
    stop(): void {
      store.dispatch(threadAdapterEvents.stopped());
      errorSubscription?.unsubscribe();
      errorSubscription = null;
      store.stop();
    },
    setContext(context: ThreadRuntimeContext | null): void {
      store.dispatch(threadAdapterEvents.contextChanged({ context }));
    },
    refresh(): void {
      const { sessionId, context } = store.getState();
      if (!context) return;
      store.dispatch(threadRestEvents.listRequested({ sessionId }));
    },
    refetchThreads(): void {
      const { sessionId, context } = store.getState();
      if (!context) return;
      store.dispatch(threadRestEvents.listRequested({ sessionId }));
    },
    startNewThread(): void {
      store.dispatch(threadAdapterEvents.newThreadStarted());
    },
    fetchNextPage(): void {
      store.dispatch(threadAdapterEvents.fetchNextPageRequested());
    },
    renameThread(threadId: string, name: string): Promise<void> {
      return trackMutation(
        threadAdapterEvents.renameRequested({
          requestId: createThreadRequestId(),
          threadId,
          name,
        }),
      );
    },
    archiveThread(threadId: string): Promise<void> {
      return trackMutation(
        threadAdapterEvents.archiveRequested({
          requestId: createThreadRequestId(),
          threadId,
        }),
      );
    },
    unarchiveThread(threadId: string): Promise<void> {
      return trackMutation(
        threadAdapterEvents.unarchiveRequested({
          requestId: createThreadRequestId(),
          threadId,
        }),
      );
    },
    deleteThread(threadId: string): Promise<void> {
      return trackMutation(
        threadAdapterEvents.deleteRequested({
          requestId: createThreadRequestId(),
          threadId,
        }),
      );
    },
    subscribeToRunActivity(
      callback: (notification: ThreadRunActivityNotification) => void,
    ): Subscription {
      return store.actions$
        .pipe(
          ofType(threadSocketEvents.runActivityReceived),
          filter((action) => action.sessionId === store.getState().sessionId),
          map((action) => action.notification),
        )
        .subscribe(callback);
    },
    getState(): ThreadState {
      return store.getState();
    },
    getServerState(): ThreadState {
      return initialThreadState;
    },
    select: store.select.bind(store),
    selectors,
  };
}

export type ɵThread = ThreadRecord;
export type ɵThreadRuntimeContext = ThreadRuntimeContext;
export type ɵThreadMetadataEvent = ThreadMetadataEvent;
export type ɵThreadEnvironment = ThreadEnvironment;
export type ɵThreadStore = ThreadStore;
export type ɵThreadSelectors = ThreadSelectors;
export const ɵthreadAdapterEvents = threadAdapterEvents;
export const ɵcreateThreadSelectors = createThreadSelectors;
export const ɵselectThreads = selectThreads;
export const ɵselectThreadsIsLoading = selectThreadsIsLoading;
export const ɵselectThreadsError = selectThreadsError;
export const ɵselectFetchMoreError = selectFetchMoreError;
export const ɵselectHasNextPage = selectHasNextPage;
export const ɵselectIsFetchingNextPage = selectIsFetchingNextPage;
export const ɵselectIsMutating = selectIsMutating;
export { createThreadStore as ɵcreateThreadStore };
