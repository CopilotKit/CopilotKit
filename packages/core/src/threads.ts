import { phoenixExponentialBackoff } from "@copilotkit/shared";
import type { ThreadEndpointRuntimeInfo } from "@copilotkit/shared";
import { Observable, defer, firstValueFrom, merge, of } from "rxjs";
import {
  catchError,
  filter,
  map,
  mergeMap,
  share,
  shareReplay,
  switchMap,
  take,
  takeUntil,
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
import type {
  ActionCreator,
  ActionFromCreators,
  AnyAction,
  Reducer,
  Store,
  StoreLifecycleAction,
} from "./utils/micro-redux";
import {
  ɵphoenixChannel$,
  ɵphoenixSocket$,
  ɵobservePhoenixEvent$,
  ɵobservePhoenixJoinOutcome$,
  ɵobservePhoenixSocketHealth$,
  ɵobservePhoenixSocketSignals$,
} from "./utils/phoenix-observable";
import type { ɵPhoenixChannelSession } from "./utils/phoenix-observable";
import type {
  ɵPhoenixJoinOutcome,
  ɵPhoenixSocketSignal,
} from "./utils/phoenix-observable";

const THREADS_CHANNEL_EVENT = "thread_metadata";
const THREAD_SUBSCRIBE_PATH = "/threads/subscribe";
const MAX_SOCKET_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const RUNTIME_URL_MISSING_MESSAGE = "Runtime URL is not configured";
const THREAD_LIST_UNAVAILABLE_MESSAGE =
  "Thread endpoints are not available on this CopilotKit runtime";
const THREAD_MUTATIONS_UNAVAILABLE_MESSAGE =
  "Thread mutations are not available on this CopilotKit runtime";

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
  credentials?: RequestCredentials;
  wsUrl?: string;
  agentId: string;
  includeArchived?: boolean;
  limit?: number;
  threadEndpoints?: Partial<ThreadEndpointRuntimeInfo>;
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
  sessionId: number;
  path: string;
  method: "PATCH" | "POST" | "DELETE";
  body: Record<string, unknown>;
  success: Extract<MutationOutcome, { ok: true }>;
}

type MutationOutcome =
  | {
      requestId: string;
      ok: true;
      operation: "rename";
      threadId: string;
      name: string;
    }
  | { requestId: string; ok: true; operation: "archive"; threadId: string }
  | { requestId: string; ok: true; operation: "delete"; threadId: string }
  | { requestId: string; ok: false; error: Error };

interface ThreadEnvironment {
  fetch: typeof fetch;
}

interface ThreadState {
  threads: ThreadRecord[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  error: Error | null;
  context: ThreadRuntimeContext | null;
  sessionId: number;
  metadataCredentialsRequested: boolean;
  metadataJoinCode: string | null;
  nextCursor: string | null;
}

const initialThreadState: ThreadState = {
  threads: [],
  isLoading: false,
  isFetchingNextPage: false,
  error: null,
  context: null,
  sessionId: 0,
  metadataCredentialsRequested: false,
  metadataJoinCode: null,
  nextCursor: null,
};

const threadAdapterEvents = createActionGroup("Thread Adapter", {
  started: empty(),
  stopped: empty(),
  contextChanged: props<{ context: ThreadRuntimeContext | null }>(),
  fetchNextPageRequested: empty(),
  renameRequested: props<{
    requestId: string;
    sessionId: number;
    context: ThreadRuntimeContext | null;
    threadId: string;
    name: string;
  }>(),
  archiveRequested: props<{
    requestId: string;
    sessionId: number;
    context: ThreadRuntimeContext | null;
    threadId: string;
  }>(),
  deleteRequested: props<{
    requestId: string;
    sessionId: number;
    context: ThreadRuntimeContext | null;
    threadId: string;
  }>(),
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
  mutationFinished: props<{ sessionId: number; outcome: MutationOutcome }>(),
});

const threadSocketEvents = createActionGroup("Thread Socket", {
  opened: props<{ sessionId: number }>(),
  errored: props<{ sessionId: number }>(),
  joinFailed: props<{ sessionId: number }>(),
  joinTimedOut: props<{ sessionId: number }>(),
  metadataReceived: props<{
    sessionId: number;
    payload: ThreadMetadataEvent;
  }>(),
});

const threadDomainEvents = createActionGroup("Thread Domain", {
  threadUpserted: props<{ sessionId: number; thread: ThreadRecord }>(),
  threadDeleted: props<{ sessionId: number; threadId: string }>(),
});

type ThreadListRequestedAction = ReturnType<
  typeof threadRestEvents.listRequested
>;
type ThreadListSucceededAction = ReturnType<
  typeof threadRestEvents.listSucceeded
>;
type MetadataCredentialsRequestedAction = ReturnType<
  typeof threadRestEvents.metadataCredentialsRequested
>;
type MetadataCredentialsSucceededAction = ReturnType<
  typeof threadRestEvents.metadataCredentialsSucceeded
>;
type MetadataReceivedAction = ReturnType<
  typeof threadSocketEvents.metadataReceived
>;
type MutationRequestedAction =
  | ReturnType<typeof threadAdapterEvents.renameRequested>
  | ReturnType<typeof threadAdapterEvents.archiveRequested>
  | ReturnType<typeof threadAdapterEvents.deleteRequested>;
type MutationFinishedAction = ReturnType<
  typeof threadRestEvents.mutationFinished
>;

function createFetchObservable<T>(
  environment: ThreadEnvironment,
  input: RequestInfo | URL,
  init: RequestInit,
  selector: (response: Response) => T | Promise<T>,
): Observable<T> {
  return new Observable<T>((observer) => {
    const controller = new AbortController();

    environment
      .fetch(input, {
        ...init,
        signal: controller.signal,
      })
      .then((response) => selector(response))
      .then(
        (value) => {
          if (observer.closed) {
            return;
          }

          observer.next(value);
          observer.complete();
        },
        (error) => {
          if (!observer.closed) {
            observer.error(error);
          }
        },
      );

    return () => {
      controller.abort();
    };
  });
}

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

function applyMutationSuccess(
  state: ThreadState,
  outcome: Extract<MutationOutcome, { ok: true }>,
): ThreadRecord[] {
  if (outcome.operation === "delete") {
    return state.threads.filter((thread) => thread.id !== outcome.threadId);
  }

  if (outcome.operation === "archive" && !state.context?.includeArchived) {
    return state.threads.filter((thread) => thread.id !== outcome.threadId);
  }

  return state.threads.map((thread) => {
    if (thread.id !== outcome.threadId) {
      return thread;
    }

    if (outcome.operation === "rename") {
      return {
        ...thread,
        name: outcome.name,
      };
    }

    return {
      ...thread,
      archived: true,
    };
  });
}

function getThreadListContextError(
  context: ThreadRuntimeContext | null,
): Error | null {
  if (!context) {
    return null;
  }

  if (!context.runtimeUrl) {
    return new Error(RUNTIME_URL_MISSING_MESSAGE);
  }

  if (context.threadEndpoints?.list === false) {
    return new Error(THREAD_LIST_UNAVAILABLE_MESSAGE);
  }

  return null;
}

function getThreadMutationContextError(
  context: ThreadRuntimeContext | null,
): Error | null {
  if (!context?.runtimeUrl) {
    return new Error(RUNTIME_URL_MISSING_MESSAGE);
  }

  if (context.threadEndpoints?.mutations === false) {
    return new Error(THREAD_MUTATIONS_UNAVAILABLE_MESSAGE);
  }

  return null;
}

function onThreadReducer<
  Creators extends readonly ActionCreator<string, any[], any>[],
  Action extends ActionFromCreators<Creators>,
>(
  ...args: [
    ...creators: Creators,
    reducer: (state: ThreadState, action: Action) => ThreadState,
  ]
) {
  return on<ThreadState, Creators, Action>(...args);
}

const threadReducer = createReducer(
  initialThreadState,
  onThreadReducer(threadAdapterEvents.contextChanged, (state, { context }) => {
    const contextError = getThreadListContextError(context);

    return {
      ...state,
      context,
      sessionId: state.sessionId + 1,
      threads: [],
      isLoading: Boolean(context) && !contextError,
      isFetchingNextPage: false,
      error: contextError,
      metadataCredentialsRequested: false,
      metadataJoinCode: null,
      nextCursor: null,
    };
  }),
  onThreadReducer(threadAdapterEvents.stopped, (state) => ({
    ...state,
    context: null,
    sessionId: state.sessionId + 1,
    threads: [],
    isLoading: false,
    isFetchingNextPage: false,
    error: null,
    metadataCredentialsRequested: false,
    metadataJoinCode: null,
    nextCursor: null,
  })),
  onThreadReducer(threadRestEvents.listRequested, (state, { sessionId }) => {
    if (sessionId !== state.sessionId || !state.context) {
      return state;
    }

    const contextError = getThreadListContextError(state.context);
    if (contextError) {
      return {
        ...state,
        isLoading: false,
        error: contextError,
      };
    }

    return {
      ...state,
      isLoading: true,
      error: null,
    };
  }),
  onThreadReducer(
    threadRestEvents.listSucceeded,
    (state, { sessionId, threads, joinCode, nextCursor }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        threads: sortThreadsByRecency(threads),
        isLoading: false,
        error: null,
        metadataJoinCode: joinCode,
        nextCursor,
      };
    },
  ),
  onThreadReducer(
    threadRestEvents.listFailed,
    (state, { sessionId, error }) => {
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
  onThreadReducer(
    threadRestEvents.nextPageSucceeded,
    (state, { sessionId, threads, nextCursor }) => {
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
        nextCursor,
        error: null,
      };
    },
  ),
  onThreadReducer(
    threadRestEvents.nextPageFailed,
    (state, { sessionId, error }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        isFetchingNextPage: false,
        error,
      };
    },
  ),
  onThreadReducer(
    threadRestEvents.metadataCredentialsFailed,
    (state, { sessionId, error }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        metadataCredentialsRequested: false,
        error,
      };
    },
  ),
  onThreadReducer(
    threadRestEvents.metadataCredentialsRequested,
    (state, { sessionId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        metadataCredentialsRequested: true,
      };
    },
  ),
  onThreadReducer(threadAdapterEvents.fetchNextPageRequested, (state) => {
    if (!state.nextCursor || state.isFetchingNextPage) {
      return state;
    }

    return {
      ...state,
      isFetchingNextPage: true,
    };
  }),
  onThreadReducer(
    threadRestEvents.mutationFinished,
    (state, { sessionId, outcome }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        threads: outcome.ok
          ? applyMutationSuccess(state, outcome)
          : state.threads,
        error: outcome.ok ? null : outcome.error,
      };
    },
  ),
  onThreadReducer(
    threadDomainEvents.threadUpserted,
    (state, { sessionId, thread }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        threads: upsertThread(state.threads, thread),
      };
    },
  ),
  onThreadReducer(
    threadDomainEvents.threadDeleted,
    (state, { sessionId, threadId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== threadId),
      };
    },
  ),
) as Reducer<ThreadState, AnyAction | StoreLifecycleAction>;

const selectThreads = createSelector<ThreadState, ThreadRecord[]>(
  (state: ThreadState) => state.threads,
);
const selectThreadsIsLoading = createSelector<ThreadState, boolean>(
  (state: ThreadState) => state.isLoading,
);
const selectThreadsError = createSelector<ThreadState, Error | null>(
  (state: ThreadState) => state.error,
);
const selectHasNextPage = createSelector<ThreadState, boolean>(
  (state: ThreadState) => state.nextCursor != null,
);
const selectIsFetchingNextPage = createSelector<ThreadState, boolean>(
  (state: ThreadState) => state.isFetchingNextPage,
);

interface ThreadStore {
  start(): void;
  stop(): void;
  setContext(context: ThreadRuntimeContext | null): void;
  /** Re-fetches the thread list without resetting the current list to empty. */
  refresh(): void;
  fetchNextPage(): void;
  renameThread(threadId: string, name: string): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  getState(): ThreadState;
  select: Store<ThreadState>["select"];
}

let threadRequestId = 0;

function createThreadRequestId(): string {
  threadRequestId += 1;
  return `thread-request-${threadRequestId}`;
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
    const contextError = getThreadListContextError(context);
    if (contextError) {
      return of(
        threadRestEvents.listFailed({
          sessionId,
          error: contextError,
        }),
      );
    }

    const params: Record<string, string> = {
      agentId: context.agentId,
    };
    if (context.includeArchived) params.includeArchived = "true";
    if (context.limit != null) params.limit = String(context.limit);

    const qs = new URLSearchParams(params);
    return createFetchObservable<ThreadListResponse>(
      environment,
      `${context.runtimeUrl}/threads?${qs.toString()}`,
      {
        method: "GET",
        headers: { ...context.headers },
        credentials: context.credentials,
      },
      (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch threads: ${response.status}`);
        }

        return response.json() as Promise<ThreadListResponse>;
      },
    ).pipe(
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
    return createFetchObservable<ThreadMetadataCredentialsResponse>(
      environment,
      `${context.runtimeUrl}${THREAD_SUBSCRIBE_PATH}`,
      {
        method: "POST",
        headers: {
          ...context.headers,
          "Content-Type": "application/json",
        },
        credentials: context.credentials,
        body: JSON.stringify({}),
      },
      async (response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to fetch thread metadata credentials: ${response.status}`,
          );
        }

        return response.json() as Promise<ThreadMetadataCredentialsResponse>;
      },
    ).pipe(
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
    return createFetchObservable<null>(
      environment,
      `${context.runtimeUrl}${request.path}`,
      {
        method: request.method,
        headers: {
          ...context.headers,
          "Content-Type": "application/json",
        },
        credentials: context.credentials,
        body: JSON.stringify(request.body),
      },
      async (response) => {
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        return null;
      },
    ).pipe(
      timeout({
        first: REQUEST_TIMEOUT_MS,
        with: () => {
          throw new Error("Request timed out");
        },
      }),
      map(() =>
        threadRestEvents.mutationFinished({
          sessionId: request.sessionId,
          outcome: request.success,
        }),
      ),
      catchError((error) => {
        return of(
          threadRestEvents.mutationFinished({
            sessionId: request.sessionId,
            outcome: {
              requestId: request.requestId,
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
  const bootstrapEffect = createEffect<
    ThreadState,
    AnyAction,
    ReturnType<typeof threadRestEvents.listRequested>
  >(
    (
      actions$: Observable<AnyAction>,
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

  const fetchEffect = createEffect<ThreadState, AnyAction, AnyAction>(
    (actions$: Observable<AnyAction>, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadRestEvents.listRequested),
        map((action) => action as ThreadListRequestedAction),
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

  const metadataCredentialsEffect = createEffect<
    ThreadState,
    AnyAction,
    AnyAction
  >((actions$: Observable<AnyAction>, state$: Observable<ThreadState>) =>
    actions$.pipe(
      ofType(threadRestEvents.listSucceeded),
      map((action) => action as ThreadListSucceededAction),
      withLatestFrom(state$),
      filter(([action, state]) => {
        return (
          action.sessionId === state.sessionId &&
          !state.metadataCredentialsRequested &&
          Boolean(state.context?.wsUrl) &&
          Boolean(state.metadataJoinCode) &&
          state.context?.threadEndpoints?.realtimeMetadata !== false
        );
      }),
      map(([action]) =>
        threadRestEvents.metadataCredentialsRequested({
          sessionId: action.sessionId,
        }),
      ),
    ),
  );

  const metadataCredentialsFetchEffect = createEffect<
    ThreadState,
    AnyAction,
    AnyAction
  >((actions$: Observable<AnyAction>, state$: Observable<ThreadState>) =>
    actions$.pipe(
      ofType(threadRestEvents.metadataCredentialsRequested),
      map((action) => action as MetadataCredentialsRequestedAction),
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

  const socketEffect = createEffect<ThreadState, AnyAction, AnyAction>(
    (actions$: Observable<AnyAction>, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadRestEvents.metadataCredentialsSucceeded),
        map((action) => action as MetadataCredentialsSucceededAction),
        withLatestFrom(state$),
        filter(([action, state]) => {
          return (
            action.sessionId === state.sessionId &&
            Boolean(state.context?.wsUrl)
          );
        }),
        switchMap(([action, state]) => {
          const context = state.context as ThreadRuntimeContext;
          const joinToken = action.joinToken as string;
          const joinCode = state.metadataJoinCode as string;
          const shutdown$ = actions$.pipe(
            ofType(
              threadAdapterEvents.contextChanged,
              threadAdapterEvents.stopped,
            ),
          );

          return defer(() => {
            const socket$ = ɵphoenixSocket$({
              url: context.wsUrl!,
              options: {
                params: { join_token: joinToken },
                reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
                rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
              },
            }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
            const channel$ = ɵphoenixChannel$({
              socket$,
              topic: `user_meta:${joinCode}`,
            }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
            const socketSignals$ =
              ɵobservePhoenixSocketSignals$(socket$).pipe(share());
            const fatalSocketShutdown$ = ɵobservePhoenixSocketHealth$(
              socketSignals$,
              MAX_SOCKET_RETRIES,
            ).pipe(
              catchError(() => {
                console.warn(
                  `[threads] WebSocket failed after ${MAX_SOCKET_RETRIES} attempts, giving up`,
                );
                return of(undefined);
              }),
              share(),
            );
            const socketLifecycle$ = socketSignals$.pipe(
              map((signal: ɵPhoenixSocketSignal) =>
                signal.type === "open"
                  ? threadSocketEvents.opened({ sessionId: action.sessionId })
                  : threadSocketEvents.errored({ sessionId: action.sessionId }),
              ),
            );
            const metadata$ = channel$.pipe(
              switchMap(({ channel }: ɵPhoenixChannelSession) =>
                ɵobservePhoenixEvent$<ThreadMetadataEvent>(
                  channel,
                  THREADS_CHANNEL_EVENT,
                ),
              ),
              map((payload) =>
                threadSocketEvents.metadataReceived({
                  sessionId: action.sessionId,
                  payload,
                }),
              ),
            );
            const joinOutcome$ = ɵobservePhoenixJoinOutcome$(channel$).pipe(
              filter(
                (outcome: ɵPhoenixJoinOutcome) => outcome.type !== "joined",
              ),
              map((outcome: Exclude<ɵPhoenixJoinOutcome, { type: "joined" }>) =>
                outcome.type === "timeout"
                  ? threadSocketEvents.joinTimedOut({
                      sessionId: action.sessionId,
                    })
                  : threadSocketEvents.joinFailed({
                      sessionId: action.sessionId,
                    }),
              ),
            );

            return merge(socketLifecycle$, metadata$, joinOutcome$).pipe(
              takeUntil(merge(shutdown$, fatalSocketShutdown$)),
            );
          });
        }),
      ),
  );

  const realtimeMappingEffect = createEffect<ThreadState, AnyAction, AnyAction>(
    (actions$: Observable<AnyAction>, state$: Observable<ThreadState>) =>
      actions$.pipe(
        ofType(threadSocketEvents.metadataReceived),
        map((action) => action as MetadataReceivedAction),
        withLatestFrom(state$),
        filter(([action, state]) => {
          return (
            action.sessionId === state.sessionId &&
            (action.payload.operation === "deleted" ||
              action.payload.thread.agentId === state.context?.agentId)
          );
        }),
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

  const fetchNextPageEffect = createEffect<ThreadState, AnyAction, AnyAction>(
    (actions$: Observable<AnyAction>, state$: Observable<ThreadState>) =>
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

          return createFetchObservable<ThreadListResponse>(
            environment,
            `${context.runtimeUrl}/threads?${new URLSearchParams(
              params,
            ).toString()}`,
            {
              method: "GET",
              headers: { ...context.headers },
              credentials: context.credentials,
            },
            (response) => {
              if (!response.ok) {
                throw new Error(
                  `Failed to fetch next page: ${response.status}`,
                );
              }

              return response.json() as Promise<ThreadListResponse>;
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

  const mutationEffect = createEffect<ThreadState, AnyAction, AnyAction>(
    (actions$: Observable<AnyAction>) =>
      actions$.pipe(
        ofType(
          threadAdapterEvents.renameRequested,
          threadAdapterEvents.archiveRequested,
          threadAdapterEvents.deleteRequested,
        ),
        map((action) => action as MutationRequestedAction),
        mergeMap((action) => {
          const context = action.context;
          const contextError = getThreadMutationContextError(context);
          if (contextError) {
            const requestId = action.requestId;
            return of(
              threadRestEvents.mutationFinished({
                sessionId: action.sessionId,
                outcome: {
                  requestId,
                  ok: false,
                  error: contextError,
                },
              }),
            );
          }

          const mutationContext = context as ThreadRuntimeContext;
          const commonBody = {
            agentId: mutationContext.agentId,
          };

          if (threadAdapterEvents.renameRequested.match(action)) {
            return createThreadMutationObservable(
              environment,
              mutationContext,
              {
                requestId: action.requestId,
                sessionId: action.sessionId,
                method: "PATCH",
                path: `/threads/${encodeURIComponent(action.threadId)}`,
                body: {
                  ...commonBody,
                  name: action.name,
                },
                success: {
                  requestId: action.requestId,
                  ok: true,
                  operation: "rename",
                  threadId: action.threadId,
                  name: action.name,
                },
              },
            );
          }

          if (threadAdapterEvents.archiveRequested.match(action)) {
            return createThreadMutationObservable(
              environment,
              mutationContext,
              {
                requestId: action.requestId,
                sessionId: action.sessionId,
                method: "POST",
                path: `/threads/${encodeURIComponent(action.threadId)}/archive`,
                body: commonBody,
                success: {
                  requestId: action.requestId,
                  ok: true,
                  operation: "archive",
                  threadId: action.threadId,
                },
              },
            );
          }

          return createThreadMutationObservable(environment, mutationContext, {
            requestId: action.requestId,
            sessionId: action.sessionId,
            method: "DELETE",
            path: `/threads/${encodeURIComponent(action.threadId)}`,
            body: commonBody,
            success: {
              requestId: action.requestId,
              ok: true,
              operation: "delete",
              threadId: action.threadId,
            },
          });
        }),
      ),
  );

  const store = createStore({
    reducer: threadReducer,
    effects: [
      bootstrapEffect,
      fetchEffect,
      metadataCredentialsEffect,
      metadataCredentialsFetchEffect,
      socketEffect,
      realtimeMappingEffect,
      fetchNextPageEffect,
      mutationEffect,
    ],
  });

  function trackMutation(
    dispatchAction:
      | ReturnType<typeof threadAdapterEvents.renameRequested>
      | ReturnType<typeof threadAdapterEvents.archiveRequested>
      | ReturnType<typeof threadAdapterEvents.deleteRequested>,
  ): Promise<void> {
    const mutationFinished$ = store.actions$.pipe(
      filter(
        (action: unknown) =>
          threadRestEvents.mutationFinished.match(action as AnyAction) &&
          (action as MutationFinishedAction).outcome.requestId ===
            dispatchAction.requestId,
      ),
      map((action: unknown): MutationOutcome => {
        return (action as MutationFinishedAction).outcome;
      }),
    ) as Observable<MutationOutcome>;
    const storeStopped$ = store.actions$.pipe(
      ofType(threadAdapterEvents.stopped),
      map(
        (): MutationOutcome => ({
          requestId: dispatchAction.requestId,
          ok: false,
          error: new Error("Thread store stopped before mutation completed"),
        }),
      ),
    ) as Observable<MutationOutcome>;
    const completion$ = merge(mutationFinished$, storeStopped$).pipe(take(1));

    const resultPromise = firstValueFrom(completion$).then((outcome) => {
      if (outcome.ok) {
        return;
      }

      throw outcome.error;
    });

    store.dispatch(dispatchAction);
    return resultPromise;
  }

  return {
    start(): void {
      store.init();
      store.dispatch(threadAdapterEvents.started());
    },
    stop(): void {
      store.dispatch(threadAdapterEvents.stopped());
      store.stop();
    },
    setContext(context: ThreadRuntimeContext | null): void {
      if (store.getState().context === context) {
        return;
      }

      store.dispatch(threadAdapterEvents.contextChanged({ context }));
    },
    refresh(): void {
      const { sessionId, context } = store.getState();
      if (!context) return;
      store.dispatch(threadRestEvents.listRequested({ sessionId }));
    },
    fetchNextPage(): void {
      const { nextCursor, isFetchingNextPage } = store.getState();
      if (!nextCursor || isFetchingNextPage) {
        return;
      }

      store.dispatch(threadAdapterEvents.fetchNextPageRequested());
    },
    renameThread(threadId: string, name: string): Promise<void> {
      const { sessionId, context } = store.getState();
      return trackMutation(
        threadAdapterEvents.renameRequested({
          requestId: createThreadRequestId(),
          sessionId,
          context,
          threadId,
          name,
        }),
      );
    },
    archiveThread(threadId: string): Promise<void> {
      const { sessionId, context } = store.getState();
      return trackMutation(
        threadAdapterEvents.archiveRequested({
          requestId: createThreadRequestId(),
          sessionId,
          context,
          threadId,
        }),
      );
    },
    deleteThread(threadId: string): Promise<void> {
      const { sessionId, context } = store.getState();
      return trackMutation(
        threadAdapterEvents.deleteRequested({
          requestId: createThreadRequestId(),
          sessionId,
          context,
          threadId,
        }),
      );
    },
    getState(): ThreadState {
      return store.getState();
    },
    select: store.select.bind(store),
  };
}

export type ɵThread = ThreadRecord;
export type ɵThreadRuntimeContext = ThreadRuntimeContext;
export type ɵThreadMetadataEvent = ThreadMetadataEvent;
export type ɵThreadEnvironment = ThreadEnvironment;
export type ɵThreadStore = ThreadStore;
export const ɵthreadAdapterEvents = threadAdapterEvents;
export const ɵselectThreads = selectThreads;
export const ɵselectThreadsIsLoading = selectThreadsIsLoading;
export const ɵselectThreadsError = selectThreadsError;
export const ɵselectHasNextPage = selectHasNextPage;
export const ɵselectIsFetchingNextPage = selectIsFetchingNextPage;
export { createThreadStore as ɵcreateThreadStore };
/**
 * Number of consecutive WebSocket connection failures after which the
 * threads channel tears itself down rather than retrying indefinitely.
 * Exposed for tests so they can assert teardown semantics without
 * hardcoding the threshold separately from production.
 */
export const ɵMAX_SOCKET_RETRIES = MAX_SOCKET_RETRIES;
