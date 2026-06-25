import { phoenixExponentialBackoff } from "@copilotkit/shared";
import type { Observable } from "rxjs";
import { defer, firstValueFrom, merge, of } from "rxjs";
import { fromFetch } from "rxjs/fetch";
import {
  catchError,
  filter,
  finalize,
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
import type { Reducer, Store } from "./utils/micro-redux";
import {
  ɵphoenixChannel$,
  ɵphoenixSocket$,
  ɵobservePhoenixEvent$,
  ɵobservePhoenixSocketHealth$,
  ɵobservePhoenixSocketSignals$,
} from "./utils/phoenix-observable";
import type { ɵPhoenixChannelSession } from "./utils/phoenix-observable";

// Runtime-relative path, mirroring the thread store's `/threads` (NOT
// `/api/threads`): `runtimeUrl` is the CopilotKit runtime mount (e.g.
// `/api/copilotkit`), and the runtime maps `/memories` to the app-api's
// `/api/memories` the same way it maps `/threads` -> `/api/threads`.
const MEMORIES_PATH = "/memories";
const MEMORIES_SUBSCRIBE_PATH = "/memories/subscribe";
const REQUEST_TIMEOUT_MS = 15_000;
/** Consecutive socket errors tolerated before the realtime stream gives up. */
const MAX_SOCKET_RETRIES = 5;

/** Public, customer-facing memory kind vocabulary (single taxonomy, no mapping). */
type MemoryKind = "topical" | "episodic" | "operational";

/** Visibility scope of a memory. */
type MemoryScope = "user" | "project";

/**
 * A memory as projected across the public REST/realtime boundary — the minimal
 * shape the SDK surfaces. Mirrors the server's `PublicMemory` projection.
 */
interface Memory {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  sourceThreadIds: readonly string[];
  invalidatedAt: string | null;
}

/** Input for creating a memory; `scope` defaults to `"user"` (v1 is user-scoped). */
interface NewMemory {
  content: string;
  kind: MemoryKind;
  scope?: MemoryScope;
  sourceThreadIds?: readonly string[];
}

/** New values for superseding (updating) a memory — same shape as create. */
type MemoryChanges = NewMemory;

/** Outcome of a mutation, tracked so the caller's promise resolves/rejects. */
type MemoryMutationOutcome =
  | { requestId: string; ok: true; memory: Memory | null }
  | { requestId: string; ok: false; error: Error };

/**
 * Runtime wiring for the memory store: where to reach the REST surface and the
 * headers (auth + `X-Cpki-User-Id`) to send. Scoped to the current user; v1
 * surfaces user-scoped memories only.
 */
interface MemoryRuntimeContext {
  runtimeUrl: string;
  /** WebSocket URL for the realtime gateway (e.g. `wss://gw.example.com/client`). */
  wsUrl: string;
  headers: Record<string, string>;
  includeInvalidated?: boolean;
}

/**
 * In-memory state for the memory store. Session-guarded like the thread store:
 * `sessionId` is bumped whenever the runtime context changes so that responses
 * and realtime deltas from a previous context are ignored.
 */
interface MemoryState {
  memories: Memory[];
  isLoading: boolean;
  isMutating: boolean;
  error: Error | null;
  context: MemoryRuntimeContext | null;
  sessionId: number;
}

const initialMemoryState: MemoryState = {
  memories: [],
  isLoading: false,
  isMutating: false,
  error: null,
  context: null,
  sessionId: 0,
};

const memoryAdapterEvents = createActionGroup("Memory Adapter", {
  started: empty(),
  stopped: empty(),
  contextChanged: props<{ context: MemoryRuntimeContext | null }>(),
  addRequested: props<{ requestId: string; input: NewMemory }>(),
  updateRequested: props<{
    requestId: string;
    id: string;
    changes: MemoryChanges;
  }>(),
  removeRequested: props<{ requestId: string; id: string }>(),
});

const memoryRestEvents = createActionGroup("Memory REST", {
  listRequested: props<{ sessionId: number }>(),
  listSucceeded: props<{ sessionId: number; memories: Memory[] }>(),
  listFailed: props<{ sessionId: number; error: Error }>(),
  mutationFinished: props<{ outcome: MemoryMutationOutcome }>(),
  credentialsRequested: props<{ sessionId: number }>(),
  credentialsSucceeded: props<{
    sessionId: number;
    joinToken: string;
    joinCode: string;
  }>(),
  credentialsFailed: props<{ sessionId: number; error: Error }>(),
});

const memoryDomainEvents = createActionGroup("Memory Domain", {
  memoryUpserted: props<{ sessionId: number; memory: Memory }>(),
  memoryInvalidated: props<{ sessionId: number; memoryId: string }>(),
});

/** Wire shape of a memory inside a `memory_metadata` payload (carries tenant ids). */
interface MemoryMetadataPayloadMemory extends Memory {
  organizationId: string;
  projectId: string;
}

/**
 * The realtime `memory_metadata` event broadcast on the `user_meta` channel:
 * `created`/`updated` carry the full memory, `invalidated` carries only its id.
 * The gateway strips `userId` before broadcasting and only delivers
 * user-scoped memories, so this is always the current user's stream.
 */
type MemoryMetadataEvent =
  | {
      operation: "created" | "updated";
      memoryId: string;
      organizationId: string;
      projectId: string;
      occurredAt: string;
      memory: MemoryMetadataPayloadMemory;
    }
  | {
      operation: "invalidated";
      memoryId: string;
      organizationId: string;
      projectId: string;
      occurredAt: string;
      invalidated: { id: string };
    };

/** Projects a wire memory to the public {@link Memory} shape (drops tenant ids). */
function toMemory(memory: MemoryMetadataPayloadMemory): Memory {
  return {
    id: memory.id,
    kind: memory.kind,
    scope: memory.scope,
    content: memory.content,
    sourceThreadIds: memory.sourceThreadIds,
    invalidatedAt: memory.invalidatedAt,
  };
}

/**
 * Maps a realtime `memory_metadata` event to the domain action that applies it:
 * `created`/`updated` upsert the projected memory, `invalidated` removes it by
 * id. Carries the current `sessionId` so the reducer's session guard can drop
 * deltas left over from a previous context.
 */
function mapMemoryMetadataEvent(
  event: MemoryMetadataEvent,
  sessionId: number,
):
  | ReturnType<typeof memoryDomainEvents.memoryUpserted>
  | ReturnType<typeof memoryDomainEvents.memoryInvalidated> {
  if (event.operation === "invalidated") {
    return memoryDomainEvents.memoryInvalidated({
      sessionId,
      memoryId: event.invalidated.id,
    });
  }

  return memoryDomainEvents.memoryUpserted({
    sessionId,
    memory: toMemory(event.memory),
  });
}

/**
 * Inserts or replaces a memory by id. A new memory is prepended (newest first,
 * matching the REST list's `created_at DESC` ordering without needing a date
 * field on the public projection); an existing memory is replaced in place.
 */
function upsertMemory(memories: Memory[], memory: Memory): Memory[] {
  const existingIndex = memories.findIndex((item) => item.id === memory.id);
  if (existingIndex === -1) {
    return [memory, ...memories];
  }

  const next = [...memories];
  next[existingIndex] = memory;
  return next;
}

const memoryReducer = createReducer(
  initialMemoryState,
  on(memoryAdapterEvents.contextChanged, (state: MemoryState, { context }) => ({
    ...state,
    context,
    sessionId: state.sessionId + 1,
    memories: [],
    isLoading: Boolean(context),
    error: null,
  })),
  on(memoryAdapterEvents.stopped, (state: MemoryState) => ({
    ...state,
    memories: [],
    isLoading: false,
    error: null,
  })),
  on(memoryRestEvents.listRequested, (state: MemoryState, { sessionId }) => {
    if (sessionId !== state.sessionId || !state.context) {
      return state;
    }

    return {
      ...state,
      isLoading: true,
      error: null,
    };
  }),
  on(
    memoryRestEvents.listFailed,
    (state: MemoryState, { sessionId, error }) => {
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
    memoryAdapterEvents.addRequested,
    memoryAdapterEvents.updateRequested,
    memoryAdapterEvents.removeRequested,
    (state: MemoryState) => ({ ...state, isMutating: true }),
  ),
  on(memoryRestEvents.mutationFinished, (state: MemoryState, { outcome }) => ({
    ...state,
    isMutating: false,
    error: outcome.ok ? state.error : outcome.error,
  })),
  on(
    memoryRestEvents.listSucceeded,
    (state: MemoryState, { sessionId, memories }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        memories,
        isLoading: false,
        error: null,
      };
    },
  ),
  on(
    memoryDomainEvents.memoryUpserted,
    (state: MemoryState, { sessionId, memory }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        memories: upsertMemory(state.memories, memory),
      };
    },
  ),
  on(
    memoryDomainEvents.memoryInvalidated,
    (state: MemoryState, { sessionId, memoryId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        memories: state.memories.filter((memory) => memory.id !== memoryId),
      };
    },
  ),
) as Reducer<MemoryState>;

const selectMemories = createSelector((state: MemoryState) => state.memories);
const selectMemoriesIsLoading = createSelector(
  (state: MemoryState) => state.isLoading,
);
const selectMemoriesError = createSelector((state: MemoryState) => state.error);

/**
 * Dependencies injected into the memory store. The store opens its own
 * `user_meta:memories:<joinCode>` socket/channel and does not share the
 * thread store's socket, so only a `fetch` implementation is required.
 */
interface MemoryEnvironment {
  fetch: typeof fetch;
}

interface MemoryStore {
  start(): void;
  stop(): void;
  setContext(context: MemoryRuntimeContext | null): void;
  /**
   * Re-fetches the REST snapshot without clearing the current list. Resolves
   * once the re-pull settles (success or failure) for the current context, so
   * callers (e.g. a `useMemories` `refresh()`) can await it. Resolves
   * immediately when no context is set.
   */
  refresh(): Promise<void>;
  /** Creates a memory; resolves to the stored memory (server-authoritative). */
  addMemory(input: NewMemory): Promise<Memory>;
  /** Supersedes a memory; resolves to the new memory (its id changes). */
  updateMemory(id: string, changes: MemoryChanges): Promise<Memory>;
  /** Retires a memory (non-lossy delete). */
  removeMemory(id: string): Promise<void>;
  getState(): MemoryState;
  select: Store<MemoryState>["select"];
}

const MEMORY_METADATA_EVENT = "memory_metadata";

function memoryFromFetch<T>(
  input: string,
  init: RequestInit & {
    selector: (response: Response) => Promise<T>;
    fetch: typeof fetch;
  },
): Observable<T> {
  return fromFetch(input, init);
}

/**
 * Fetches the memory snapshot and maps it to a success/failure action. Keeps
 * only user-scoped memories (v1 surfaces user scope only; the realtime stream
 * is user-scoped too), so project-scoped rows visible to the caller are
 * dropped from the store.
 */
function createMemoryFetchObservable(
  environment: MemoryEnvironment,
  context: MemoryRuntimeContext,
  sessionId: number,
): Observable<
  | ReturnType<typeof memoryRestEvents.listSucceeded>
  | ReturnType<typeof memoryRestEvents.listFailed>
> {
  return defer(() => {
    const qs = context.includeInvalidated ? "?includeInvalidated=true" : "";
    return memoryFromFetch(`${context.runtimeUrl}${MEMORIES_PATH}${qs}`, {
      selector: (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch memories: ${response.status}`);
        }

        return response.json() as Promise<{ memories: Memory[] }>;
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
        memoryRestEvents.listSucceeded({
          sessionId,
          memories: data.memories.filter((memory) => memory.scope === "user"),
        }),
      ),
      catchError((error) =>
        of(
          memoryRestEvents.listFailed({
            sessionId,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        ),
      ),
    );
  });
}

/**
 * Fetches join credentials from the `/memories/subscribe` endpoint and maps
 * the response to a success/failure action. Requires both `joinToken` and
 * `joinCode` to be non-empty strings; throws otherwise so the `catchError`
 * path emits `credentialsFailed`.
 */
function createMemoryCredentialsFetchObservable(
  environment: MemoryEnvironment,
  context: MemoryRuntimeContext,
  sessionId: number,
): Observable<
  | ReturnType<typeof memoryRestEvents.credentialsSucceeded>
  | ReturnType<typeof memoryRestEvents.credentialsFailed>
> {
  return defer(() =>
    memoryFromFetch(`${context.runtimeUrl}${MEMORIES_SUBSCRIBE_PATH}`, {
      selector: async (response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to fetch memory subscribe credentials: ${response.status}`,
          );
        }

        return response.json() as Promise<{
          joinToken: string;
          joinCode: string;
        }>;
      },
      fetch: environment.fetch,
      method: "POST",
      headers: { ...context.headers, "Content-Type": "application/json" },
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
        if (typeof data.joinCode !== "string" || data.joinCode.length === 0) {
          throw new Error("missing joinCode");
        }

        return memoryRestEvents.credentialsSucceeded({
          sessionId,
          joinToken: data.joinToken,
          joinCode: data.joinCode,
        });
      }),
      catchError((error) =>
        of(
          memoryRestEvents.credentialsFailed({
            sessionId,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        ),
      ),
    ),
  );
}

type MemoryMutationAction =
  | ReturnType<typeof memoryDomainEvents.memoryUpserted>
  | ReturnType<typeof memoryDomainEvents.memoryInvalidated>
  | ReturnType<typeof memoryRestEvents.mutationFinished>;

type MemoryMutationRequest =
  | {
      requestId: string;
      sessionId: number;
      kind: "add";
      body: Record<string, unknown>;
    }
  | {
      requestId: string;
      sessionId: number;
      kind: "update";
      id: string;
      body: Record<string, unknown>;
    }
  | { requestId: string; sessionId: number; kind: "remove"; id: string };

/** Projects a REST mutation response to the public {@link Memory} shape. */
function responseToMemory(data: {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  sourceThreadIds: readonly string[];
  invalidatedAt: string | null;
}): Memory {
  return {
    id: data.id,
    kind: data.kind,
    scope: data.scope,
    content: data.content,
    sourceThreadIds: data.sourceThreadIds,
    invalidatedAt: data.invalidatedAt,
  };
}

/**
 * Request body for create/supersede. `scope` is forwarded only when the caller
 * supplies it: the platform owns the default (`scope` defaults to `"user"` in
 * the `/api/memories` schema), so the store does not second-guess it here —
 * one default, at the contract owner. `sourceThreadIds` defaults to `[]`.
 */
function toMutationBody(input: NewMemory): Record<string, unknown> {
  return {
    content: input.content,
    kind: input.kind,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    sourceThreadIds: input.sourceThreadIds ?? [],
  };
}

/**
 * Builds the actions a successful mutation dispatches (server-authoritative):
 * the REST response is applied to local state immediately, and the realtime
 * event reconciles idempotently (upsert-by-id). `mutationFinished` resolves the
 * caller's promise.
 */
function buildMutationSuccessActions(
  request: MemoryMutationRequest,
  data: Record<string, unknown> | null,
): MemoryMutationAction[] {
  const { requestId, sessionId } = request;

  if (request.kind === "remove") {
    return [
      memoryDomainEvents.memoryInvalidated({ sessionId, memoryId: request.id }),
      memoryRestEvents.mutationFinished({
        outcome: { requestId, ok: true, memory: null },
      }),
    ];
  }

  const memory = responseToMemory(
    data as Parameters<typeof responseToMemory>[0],
  );

  if (request.kind === "update") {
    const retiredId = (data as { retiredId: string }).retiredId;
    return [
      memoryDomainEvents.memoryInvalidated({ sessionId, memoryId: retiredId }),
      memoryDomainEvents.memoryUpserted({ sessionId, memory }),
      memoryRestEvents.mutationFinished({
        outcome: { requestId, ok: true, memory },
      }),
    ];
  }

  return [
    memoryDomainEvents.memoryUpserted({ sessionId, memory }),
    memoryRestEvents.mutationFinished({
      outcome: { requestId, ok: true, memory },
    }),
  ];
}

/** Performs a create/supersede/retire HTTP call and emits its resulting actions. */
function createMemoryMutationObservable(
  environment: MemoryEnvironment,
  context: MemoryRuntimeContext,
  request: MemoryMutationRequest,
): Observable<MemoryMutationAction> {
  const method =
    request.kind === "add"
      ? "POST"
      : request.kind === "update"
        ? "PATCH"
        : "DELETE";
  const path =
    request.kind === "add"
      ? MEMORIES_PATH
      : `${MEMORIES_PATH}/${encodeURIComponent(request.id)}`;

  return defer(() =>
    memoryFromFetch(`${context.runtimeUrl}${path}`, {
      selector: async (response) => {
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        return request.kind === "remove"
          ? null
          : ((await response.json()) as Record<string, unknown>);
      },
      fetch: environment.fetch,
      method,
      headers: { ...context.headers, "Content-Type": "application/json" },
      body:
        request.kind === "remove" ? undefined : JSON.stringify(request.body),
    }).pipe(
      timeout({
        first: REQUEST_TIMEOUT_MS,
        with: () => {
          throw new Error("Request timed out");
        },
      }),
      mergeMap((data) => of(...buildMutationSuccessActions(request, data))),
      catchError((error) =>
        of(
          memoryRestEvents.mutationFinished({
            outcome: {
              requestId: request.requestId,
              ok: false,
              error: error instanceof Error ? error : new Error(String(error)),
            },
          }),
        ),
      ),
    ),
  );
}

let memoryRequestId = 0;

function createMemoryRequestId(): string {
  memoryRequestId += 1;
  return `memory-request-${memoryRequestId}`;
}

/**
 * Creates the framework-agnostic memory store: a REST snapshot on `setContext`,
 * server-authoritative add/update/remove mutations, and realtime
 * `memory_metadata` deltas off the injected `user_meta` event source — all
 * reduced into observable state.
 */
function createMemoryStore(environment: MemoryEnvironment): MemoryStore {
  const bootstrapEffect = createEffect(
    (actions$, state$: Observable<MemoryState>) =>
      actions$.pipe(
        ofType(memoryAdapterEvents.contextChanged),
        withLatestFrom(state$),
        filter(([, state]) => Boolean(state.context)),
        map(([, state]) =>
          memoryRestEvents.listRequested({ sessionId: state.sessionId }),
        ),
      ),
  );

  const credentialsBootstrapEffect = createEffect(
    (actions$, state$: Observable<MemoryState>) =>
      actions$.pipe(
        ofType(memoryAdapterEvents.contextChanged),
        withLatestFrom(state$),
        filter(([, state]) => Boolean(state.context)),
        map(([, state]) =>
          memoryRestEvents.credentialsRequested({ sessionId: state.sessionId }),
        ),
      ),
  );

  const credentialsFetchEffect = createEffect(
    (actions$, state$: Observable<MemoryState>) =>
      actions$.pipe(
        ofType(memoryRestEvents.credentialsRequested),
        switchMap((action) =>
          state$.pipe(
            map((state) => state.context),
            filter((context): context is MemoryRuntimeContext =>
              Boolean(context),
            ),
            take(1),
            map((context) => ({ action, context })),
            takeUntil(
              actions$.pipe(
                ofType(
                  memoryAdapterEvents.contextChanged,
                  memoryAdapterEvents.stopped,
                ),
              ),
            ),
            switchMap(({ action: currentAction, context }) =>
              createMemoryCredentialsFetchObservable(
                environment,
                context,
                currentAction.sessionId,
              ),
            ),
          ),
        ),
      ),
  );

  const fetchEffect = createEffect(
    (actions$, state$: Observable<MemoryState>) =>
      actions$.pipe(
        ofType(memoryRestEvents.listRequested),
        switchMap((action) =>
          state$.pipe(
            map((state) => state.context),
            filter((context): context is MemoryRuntimeContext =>
              Boolean(context),
            ),
            take(1),
            map((context) => ({ action, context })),
            takeUntil(
              actions$.pipe(
                ofType(
                  memoryAdapterEvents.contextChanged,
                  memoryAdapterEvents.stopped,
                ),
              ),
            ),
            switchMap(({ action: currentAction, context }) =>
              createMemoryFetchObservable(
                environment,
                context,
                currentAction.sessionId,
              ),
            ),
          ),
        ),
      ),
  );

  const mutationEffect = createEffect(
    (actions$, state$: Observable<MemoryState>) =>
      actions$.pipe(
        ofType(
          memoryAdapterEvents.addRequested,
          memoryAdapterEvents.updateRequested,
          memoryAdapterEvents.removeRequested,
        ),
        withLatestFrom(state$),
        mergeMap(([action, state]) => {
          const context = state.context;
          if (!context?.runtimeUrl) {
            return of(
              memoryRestEvents.mutationFinished({
                outcome: {
                  requestId: action.requestId,
                  ok: false,
                  error: new Error("Runtime URL is not configured"),
                },
              }),
            );
          }

          const sessionId = state.sessionId;
          if (memoryAdapterEvents.addRequested.match(action)) {
            return createMemoryMutationObservable(environment, context, {
              requestId: action.requestId,
              sessionId,
              kind: "add",
              body: toMutationBody(action.input),
            });
          }
          if (memoryAdapterEvents.updateRequested.match(action)) {
            return createMemoryMutationObservable(environment, context, {
              requestId: action.requestId,
              sessionId,
              kind: "update",
              id: action.id,
              body: toMutationBody(action.changes),
            });
          }
          return createMemoryMutationObservable(environment, context, {
            requestId: action.requestId,
            sessionId,
            kind: "remove",
            id: action.id,
          });
        }),
      ),
  );

  const socketEffect = createEffect(
    (actions$, state$: Observable<MemoryState>) =>
      actions$.pipe(
        ofType(memoryRestEvents.credentialsSucceeded),
        withLatestFrom(state$),
        filter(([action, state]) => {
          return (
            action.sessionId === state.sessionId &&
            Boolean(state.context?.wsUrl)
          );
        }),
        switchMap(([action, state]) => {
          const context = state.context as MemoryRuntimeContext;
          const { joinToken, joinCode } = action;
          const shutdown$ = actions$.pipe(
            ofType(
              memoryAdapterEvents.contextChanged,
              memoryAdapterEvents.stopped,
            ),
          );

          return defer(() => {
            const socket$ = ɵphoenixSocket$({
              url: context.wsUrl,
              options: {
                params: { join_token: joinToken },
                reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
                rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
              },
            }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
            const channel$ = ɵphoenixChannel$({
              socket$,
              topic: `user_meta:memories:${joinCode}`,
            }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
            const socketSignals$ =
              ɵobservePhoenixSocketSignals$(socket$).pipe(share());
            const fatalSocketShutdown$ = ɵobservePhoenixSocketHealth$(
              socketSignals$,
              MAX_SOCKET_RETRIES,
            ).pipe(
              catchError(() => {
                console.warn(
                  `[memory] WebSocket failed after ${MAX_SOCKET_RETRIES} attempts, giving up`,
                );
                return of(undefined);
              }),
              share(),
            );
            const metadata$ = channel$.pipe(
              switchMap(({ channel }: ɵPhoenixChannelSession) =>
                ɵobservePhoenixEvent$<MemoryMetadataEvent>(
                  channel,
                  MEMORY_METADATA_EVENT,
                ),
              ),
              map((event) => mapMemoryMetadataEvent(event, action.sessionId)),
            );

            return metadata$.pipe(
              takeUntil(merge(shutdown$, fatalSocketShutdown$)),
              finalize(() => {
                // Socket/channel teardown is handled by the `finalize` operators
                // inside `ɵphoenixSocket$`/`ɵphoenixChannel$`; this hook exists to
                // mirror the thread store's socket-effect lifecycle shape.
              }),
            );
          });
        }),
      ),
  );

  const store = createStore<MemoryState>({
    reducer: memoryReducer,
    effects: [
      bootstrapEffect,
      credentialsBootstrapEffect,
      fetchEffect,
      credentialsFetchEffect,
      mutationEffect,
      socketEffect,
    ],
  });

  function trackMutation<T>(
    dispatchAction:
      | ReturnType<typeof memoryAdapterEvents.addRequested>
      | ReturnType<typeof memoryAdapterEvents.updateRequested>
      | ReturnType<typeof memoryAdapterEvents.removeRequested>,
    extract: (outcome: Extract<MemoryMutationOutcome, { ok: true }>) => T,
  ): Promise<T> {
    const { requestId } = dispatchAction;
    const completion$ = merge(
      store.actions$.pipe(
        ofType(memoryRestEvents.mutationFinished),
        filter((action) => action.outcome.requestId === requestId),
        map((action) => action.outcome),
      ),
      store.actions$.pipe(
        ofType(memoryAdapterEvents.stopped),
        map(
          () =>
            ({
              requestId,
              ok: false,
              error: new Error(
                "Memory store stopped before mutation completed",
              ),
            }) satisfies MemoryMutationOutcome,
        ),
      ),
    ).pipe(take(1));

    const resultPromise = firstValueFrom(completion$).then((outcome) => {
      if (!outcome.ok) {
        throw outcome.error;
      }
      return extract(outcome);
    });

    store.dispatch(dispatchAction);
    return resultPromise;
  }

  return {
    start(): void {
      store.init();
      store.dispatch(memoryAdapterEvents.started());
    },
    stop(): void {
      store.dispatch(memoryAdapterEvents.stopped());
      store.stop();
    },
    setContext(context: MemoryRuntimeContext | null): void {
      store.dispatch(memoryAdapterEvents.contextChanged({ context }));
    },
    refresh(): Promise<void> {
      const { sessionId, context } = store.getState();
      if (!context) return Promise.resolve();

      // Settle when the re-pulled snapshot completes for this session (success
      // or failure), or if the store is stopped first. Subscribe before
      // dispatching so the resulting list action can't slip past, mirroring
      // trackMutation.
      const completion$ = merge(
        store.actions$.pipe(
          ofType(memoryRestEvents.listSucceeded, memoryRestEvents.listFailed),
          filter((action) => action.sessionId === sessionId),
        ),
        store.actions$.pipe(ofType(memoryAdapterEvents.stopped)),
      ).pipe(take(1));

      // `await refresh()` resolving must mean the snapshot actually refreshed,
      // so reject on anything that isn't a successful re-pull — a failed list
      // (its error also lands in the `error` selector) or the store being
      // stopped mid-flight. This keeps `refresh` fully symmetric with the
      // mutation methods, which reject on both failure and stop via
      // `trackMutation`.
      const done = firstValueFrom(completion$).then((action) => {
        if (memoryRestEvents.listFailed.match(action)) {
          throw action.error;
        }
        if (memoryAdapterEvents.stopped.match(action)) {
          throw new Error("Memory store stopped before refresh completed");
        }
      });
      store.dispatch(memoryRestEvents.listRequested({ sessionId }));
      return done;
    },
    addMemory(input: NewMemory): Promise<Memory> {
      return trackMutation(
        memoryAdapterEvents.addRequested({
          requestId: createMemoryRequestId(),
          input,
        }),
        (outcome) => outcome.memory as Memory,
      );
    },
    updateMemory(id: string, changes: MemoryChanges): Promise<Memory> {
      return trackMutation(
        memoryAdapterEvents.updateRequested({
          requestId: createMemoryRequestId(),
          id,
          changes,
        }),
        (outcome) => outcome.memory as Memory,
      );
    },
    removeMemory(id: string): Promise<void> {
      return trackMutation(
        memoryAdapterEvents.removeRequested({
          requestId: createMemoryRequestId(),
          id,
        }),
        () => undefined,
      );
    },
    getState(): MemoryState {
      return store.getState();
    },
    select: store.select.bind(store),
  };
}

export type ɵMemory = Memory;
export type ɵMemoryKind = MemoryKind;
export type ɵMemoryScope = MemoryScope;
// Mutation input types: exported so framework bindings can name the arguments
// of `ɵMemoryStore.addMemory(input)` / `updateMemory(id, changes)` when wrapping
// them (e.g. `useMemories` / `injectMemories`).
export type ɵNewMemory = NewMemory;
export type ɵMemoryChanges = MemoryChanges;
export type ɵMemoryState = MemoryState;
export type ɵMemoryRuntimeContext = MemoryRuntimeContext;
export type ɵMemoryMetadataEvent = MemoryMetadataEvent;
export type ɵMemoryEnvironment = MemoryEnvironment;
export type ɵMemoryStore = MemoryStore;
export const ɵmemoryAdapterEvents = memoryAdapterEvents;
export const ɵmemoryRestEvents = memoryRestEvents;
export const ɵmemoryDomainEvents = memoryDomainEvents;
export const ɵmemoryReducer = memoryReducer;
export const ɵmapMemoryMetadataEvent = mapMemoryMetadataEvent;
export const ɵselectMemories = selectMemories;
export const ɵselectMemoriesIsLoading = selectMemoriesIsLoading;
export const ɵselectMemoriesError = selectMemoriesError;
export { createMemoryStore as ɵcreateMemoryStore };
