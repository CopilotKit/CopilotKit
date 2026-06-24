import type { Observable } from "rxjs";
import { defer, of } from "rxjs";
import { fromFetch } from "rxjs/fetch";
import {
  catchError,
  filter,
  map,
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

const MEMORIES_PATH = "/api/memories";
const REQUEST_TIMEOUT_MS = 15_000;

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

/**
 * Runtime wiring for the memory store: where to reach the REST surface and the
 * headers (auth + `X-Cpki-User-Id`) to send. Scoped to the current user; v1
 * surfaces user-scoped memories only.
 */
interface MemoryRuntimeContext {
  runtimeUrl: string;
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
  error: Error | null;
  context: MemoryRuntimeContext | null;
  sessionId: number;
}

const initialMemoryState: MemoryState = {
  memories: [],
  isLoading: false,
  error: null,
  context: null,
  sessionId: 0,
};

const memoryAdapterEvents = createActionGroup("Memory Adapter", {
  started: empty(),
  stopped: empty(),
  contextChanged: props<{ context: MemoryRuntimeContext | null }>(),
});

const memoryRestEvents = createActionGroup("Memory REST", {
  listRequested: props<{ sessionId: number }>(),
  listSucceeded: props<{ sessionId: number; memories: Memory[] }>(),
  listFailed: props<{ sessionId: number; error: Error }>(),
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
  on(memoryRestEvents.listFailed, (state: MemoryState, { sessionId, error }) => {
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
const selectMemoriesError = createSelector(
  (state: MemoryState) => state.error,
);

/**
 * Dependencies injected into the memory store. `observeUserMetaEvent` is the
 * thread store's `ɵobserveUserMetaEvent` in production: the memory store rides
 * the single `user_meta` socket the thread store already owns rather than
 * opening its own. Injected (not imported) so the store stays decoupled from
 * the thread store and is testable with a plain event source.
 */
interface MemoryEnvironment {
  fetch: typeof fetch;
  observeUserMetaEvent: <T>(eventName: string) => Observable<T>;
}

interface MemoryStore {
  start(): void;
  stop(): void;
  setContext(context: MemoryRuntimeContext | null): void;
  /** Re-fetches the snapshot without clearing the current list. */
  refresh(): void;
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
 * Creates the framework-agnostic memory store. For now it consumes realtime
 * `memory_metadata` deltas off the injected `user_meta` event source and
 * reduces them into observable state; the REST snapshot + mutation surface is
 * layered on in a later increment.
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

  const realtimeEffect = createEffect(
    (actions$, state$: Observable<MemoryState>) =>
      actions$.pipe(
        ofType(memoryAdapterEvents.started),
        switchMap(() =>
          environment
            .observeUserMetaEvent<MemoryMetadataEvent>(MEMORY_METADATA_EVENT)
            .pipe(
              withLatestFrom(state$),
              map(([event, state]) =>
                mapMemoryMetadataEvent(event, state.sessionId),
              ),
              takeUntil(actions$.pipe(ofType(memoryAdapterEvents.stopped))),
            ),
        ),
      ),
  );

  const store = createStore<MemoryState>({
    reducer: memoryReducer,
    effects: [bootstrapEffect, fetchEffect, realtimeEffect],
  });

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
    refresh(): void {
      const { sessionId, context } = store.getState();
      if (!context) return;
      store.dispatch(memoryRestEvents.listRequested({ sessionId }));
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
