import { phoenixExponentialBackoff } from "@copilotkitnext/shared";
import type { Observable } from "rxjs";
import { defer, firstValueFrom, merge, of } from "rxjs";
import { fromFetch } from "rxjs/fetch";
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
  type Store,
} from "./utils/micro-redux";
import {
  ɵphoenixChannel$,
  ɵphoenixSocket$,
  type ɵPhoenixChannelSession,
  ɵobservePhoenixEvent$,
  ɵobservePhoenixJoinOutcome$,
  ɵobservePhoenixSocketHealth$,
  ɵobservePhoenixSocketSignals$,
} from "./utils/phoenix-observable";

const THREADS_CHANNEL_EVENT = "thread_metadata";
const THREAD_SUBSCRIBE_PATH = "/threads/subscribe";
const MAX_SOCKET_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 15_000;

interface ThreadRecord {
  id: string;
  tenantId: string;
  agentId: string;
  createdById: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ThreadRuntimeContext {
  runtimeUrl: string;
  headers: Record<string, string>;
  wsUrl?: string;
  userId: string;
  agentId: string;
}

type ThreadMetadataEvent =
  | {
      operation: "created" | "renamed" | "archived" | "unarchived" | "updated";
      threadId: string;
      userId: string;
      tenantId: string;
      occurredAt: string;
      thread: ThreadRecord;
    }
  | {
      operation: "deleted";
      threadId: string;
      userId: string;
      tenantId: string;
      occurredAt: string;
      deleted: {
        id: string;
      };
    };

interface ThreadListResponse {
  threads: ThreadRecord[];
}

interface ThreadMetadataCredentialsResponse {
  joinToken: string;
}

interface MutationRequest {
  requestId: string;
  path: string;
  method: "PATCH" | "POST" | "DELETE";
  body: Record<string, unknown>;
}

type MutationOutcome =
  | { requestId: string; ok: true }
  | { requestId: string; ok: false; error: Error };

interface ThreadEnvironment {
  fetch: typeof fetch;
}

interface ThreadState {
  threads: ThreadRecord[];
  isLoading: boolean;
  error: Error | null;
  context: ThreadRuntimeContext | null;
  sessionId: number;
  metadataCredentialsRequested: boolean;
}

const initialThreadState: ThreadState = {
  threads: [],
  isLoading: false,
  error: null,
  context: null,
  sessionId: 0,
  metadataCredentialsRequested: false,
};

const threadAdapterEvents = createActionGroup("Thread Adapter", {
  started: empty(),
  stopped: empty(),
  contextChanged: props<{ context: ThreadRuntimeContext | null }>(),
  renameRequested: props<{
    requestId: string;
    threadId: string;
    name: string;
  }>(),
  archiveRequested: props<{ requestId: string; threadId: string }>(),
  deleteRequested: props<{ requestId: string; threadId: string }>(),
});

const threadRestEvents = createActionGroup("Thread REST", {
  listRequested: props<{ sessionId: number }>(),
  listSucceeded: props<{
    sessionId: number;
    threads: ThreadRecord[];
  }>(),
  listFailed: props<{ sessionId: number; error: Error }>(),
  metadataCredentialsRequested: props<{ sessionId: number }>(),
  metadataCredentialsSucceeded: props<{
    sessionId: number;
    joinToken: string;
  }>(),
  metadataCredentialsFailed: props<{ sessionId: number; error: Error }>(),
  mutationFinished: props<{ outcome: MutationOutcome }>(),
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

function sortThreadsByUpdatedAt(threads: ThreadRecord[]): ThreadRecord[] {
  return [...threads].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function upsertThread(
  threads: ThreadRecord[],
  thread: ThreadRecord,
): ThreadRecord[] {
  const existingIndex = threads.findIndex((item) => item.id === thread.id);
  if (existingIndex === -1) {
    return sortThreadsByUpdatedAt([...threads, thread]);
  }

  const next = [...threads];
  next[existingIndex] = thread;
  return sortThreadsByUpdatedAt(next);
}

const threadReducer = createReducer<ThreadState>(
  initialThreadState,
  on(threadAdapterEvents.contextChanged, (state, { context }) => ({
    ...state,
    context,
    sessionId: state.sessionId + 1,
    threads: [],
    isLoading: Boolean(context),
    error: null,
    metadataCredentialsRequested: false,
  })),
  on(threadAdapterEvents.stopped, (state) => ({
    ...state,
    threads: [],
    isLoading: false,
    error: null,
    metadataCredentialsRequested: false,
  })),
  on(threadRestEvents.listRequested, (state, { sessionId }) => {
    if (sessionId !== state.sessionId || !state.context) {
      return state;
    }

    return {
      ...state,
      isLoading: true,
      error: null,
    };
  }),
  on(threadRestEvents.listSucceeded, (state, { sessionId, threads }) => {
    if (sessionId !== state.sessionId) {
      return state;
    }

    return {
      ...state,
      threads: sortThreadsByUpdatedAt(threads),
      isLoading: false,
      error: null,
    };
  }),
  on(threadRestEvents.listFailed, (state, { sessionId, error }) => {
    if (sessionId !== state.sessionId) {
      return state;
    }

    return {
      ...state,
      isLoading: false,
      error,
    };
  }),
  on(
    threadRestEvents.metadataCredentialsFailed,
    (state, { sessionId, error }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        error,
      };
    },
  ),
  on(threadRestEvents.metadataCredentialsRequested, (state, { sessionId }) => {
    if (sessionId !== state.sessionId) {
      return state;
    }

    return {
      ...state,
      metadataCredentialsRequested: true,
    };
  }),
  on(threadRestEvents.mutationFinished, (state, { outcome }) => ({
    ...state,
    error: outcome.ok ? state.error : outcome.error,
  })),
  on(threadDomainEvents.threadUpserted, (state, { sessionId, thread }) => {
    if (sessionId !== state.sessionId) {
      return state;
    }

    return {
      ...state,
      threads: upsertThread(state.threads, thread),
    };
  }),
  on(threadDomainEvents.threadDeleted, (state, { sessionId, threadId }) => {
    if (sessionId !== state.sessionId) {
      return state;
    }

    return {
      ...state,
      threads: state.threads.filter((thread) => thread.id !== threadId),
    };
  }),
);

const selectThreads = createSelector((state: ThreadState) => state.threads);
const selectThreadsIsLoading = createSelector(
  (state: ThreadState) => state.isLoading,
);
const selectThreadsError = createSelector((state: ThreadState) => state.error);

interface ThreadStore {
  start(): void;
  stop(): void;
  setContext(context: ThreadRuntimeContext | null): void;
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
    const params = new URLSearchParams({
      userId: context.userId,
      agentId: context.agentId,
    });
    return fromFetch(`${context.runtimeUrl}/threads?${params.toString()}`, {
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
    return fromFetch(`${context.runtimeUrl}${THREAD_SUBSCRIBE_PATH}`, {
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
      body: JSON.stringify({
        userId: context.userId,
      }),
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
    return fromFetch(`${context.runtimeUrl}${request.path}`, {
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
            ok: true,
          },
        }),
      ),
      catchError((error) => {
        return of(
          threadRestEvents.mutationFinished({
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
  const bootstrapEffect = createEffect(
    (
      actions$,
      state$,
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

  const fetchEffect = createEffect((actions$, state$) =>
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

  const metadataCredentialsEffect = createEffect((actions$, state$) =>
    actions$.pipe(
      ofType(threadRestEvents.listSucceeded),
      withLatestFrom(state$),
      filter(([action, state]) => {
        return (
          action.sessionId === state.sessionId &&
          !state.metadataCredentialsRequested &&
          Boolean(state.context?.wsUrl)
        );
      }),
      map(([action]) =>
        threadRestEvents.metadataCredentialsRequested({
          sessionId: action.sessionId,
        }),
      ),
    ),
  );

  const metadataCredentialsFetchEffect = createEffect((actions$, state$) =>
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

  const socketEffect = createEffect((actions$, state$) =>
    actions$.pipe(
      ofType(threadRestEvents.metadataCredentialsSucceeded),
      withLatestFrom(state$),
      filter(([action, state]) => {
        return (
          action.sessionId === state.sessionId && Boolean(state.context?.wsUrl)
        );
      }),
      switchMap(([action, state]) => {
        const context = state.context as ThreadRuntimeContext;
        const joinToken = action.joinToken as string;
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
            topic: `user_meta:${context.userId}`,
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
            map((signal) =>
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
            filter((outcome) => outcome.type !== "joined"),
            map((outcome) =>
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

  const realtimeMappingEffect = createEffect((actions$, state$) =>
    actions$.pipe(
      ofType(threadSocketEvents.metadataReceived),
      withLatestFrom(state$),
      filter(([action, state]) => {
        return (
          action.sessionId === state.sessionId &&
          action.payload.userId === state.context?.userId
        );
      }),
      map(([action]) => {
        if (action.payload.operation === "deleted") {
          return threadDomainEvents.threadDeleted({
            sessionId: action.sessionId,
            threadId: action.payload.deleted.id,
          });
        }

        return threadDomainEvents.threadUpserted({
          sessionId: action.sessionId,
          thread: action.payload.thread,
        });
      }),
    ),
  );

  const mutationEffect = createEffect((actions$, state$) =>
    actions$.pipe(
      ofType(
        threadAdapterEvents.renameRequested,
        threadAdapterEvents.archiveRequested,
        threadAdapterEvents.deleteRequested,
      ),
      withLatestFrom(state$),
      mergeMap(([action, state]) => {
        const context = state.context;
        if (!context?.runtimeUrl) {
          const requestId = action.requestId;
          return of(
            threadRestEvents.mutationFinished({
              outcome: {
                requestId,
                ok: false,
                error: new Error("Runtime URL is not configured"),
              },
            }),
          );
        }

        const commonBody = {
          userId: context.userId,
          agentId: context.agentId,
        };

        if (threadAdapterEvents.renameRequested.match(action)) {
          return createThreadMutationObservable(environment, context, {
            requestId: action.requestId,
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
            method: "POST",
            path: `/threads/${encodeURIComponent(action.threadId)}/archive`,
            body: commonBody,
          });
        }

        return createThreadMutationObservable(environment, context, {
          requestId: action.requestId,
          method: "DELETE",
          path: `/threads/${encodeURIComponent(action.threadId)}`,
          body: commonBody,
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
      mutationEffect,
    ],
  });

  function trackMutation(
    dispatchAction:
      | ReturnType<typeof threadAdapterEvents.renameRequested>
      | ReturnType<typeof threadAdapterEvents.archiveRequested>
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
      store.dispatch(threadAdapterEvents.contextChanged({ context }));
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
    deleteThread(threadId: string): Promise<void> {
      return trackMutation(
        threadAdapterEvents.deleteRequested({
          requestId: createThreadRequestId(),
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
export { createThreadStore as ɵcreateThreadStore };
