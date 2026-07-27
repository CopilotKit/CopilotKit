import { phoenixExponentialBackoff } from "@copilotkit/shared";
import type { Observable } from "rxjs";
import {
  asapScheduler,
  defer,
  firstValueFrom,
  merge,
  observeOn,
  of,
} from "rxjs";
import { fromFetch } from "rxjs/fetch";
import {
  catchError,
  concatWith,
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
import { MemoryError, isRetryableStatus } from "./memory-errors";
import {
  ɵphoenixChannel$,
  ɵphoenixSocket$,
  ɵjoinPhoenixChannel$,
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
/**
 * HTTP status codes that indicate memory routes are not configured (non-fatal).
 * 404/501 mean the route is absent/unimplemented; 422 is the runtime's
 * MISSING_INTELLIGENCE signal (intelligence not configured on the deployment —
 * see packages/runtime/.../handlers/intelligence/memories.ts). All three map to
 * the graceful "not available" locked-teaser path, not a hard error.
 */
const ROUTE_UNAVAILABLE_STATUSES = new Set([404, 422, 501]);
/**
 * Thrown when a memory route returns a 404/422/501 — treated as "not
 * configured" (422 is the runtime's MISSING_INTELLIGENCE signal).
 */
class MemoryRouteUnavailableError extends Error {}

/** Public, customer-facing memory kind vocabulary (single taxonomy, no mapping). */
export type MemoryKind = "topical" | "episodic" | "operational";

/** Visibility scope of a memory. */
export type MemoryScope = "user" | "project";

/**
 * Health of the realtime (`user_meta:memories:<code>`) connection that streams
 * live `memory_metadata` deltas. Distinct from `available`/`error`, which
 * describe the REST list route: `realtimeStatus` reports ONLY whether the
 * realtime socket/channel is live so the UI can stop showing a "live" indicator
 * over a frozen snapshot once the socket permanently gives up.
 *
 * - `"connecting"` — fetching join credentials / opening the socket / joining
 *   the channel (the default, and the state every `contextChanged`/`stopped`
 *   resets to).
 * - `"connected"` — the channel join succeeded; live deltas are flowing.
 * - `"unavailable"` — the socket exhausted its retries or the join failed
 *   permanently; the snapshot is frozen and no deltas will arrive. This is a
 *   silent degrade for `available`/`error` (those stay untouched) — only this
 *   signal flips.
 */
export type MemoryRealtimeStatus = "connecting" | "connected" | "unavailable";

/**
 * A memory as projected across the public REST/realtime boundary — the minimal
 * shape the SDK surfaces. Mirrors the server's `PublicMemory` projection.
 */
export interface Memory {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  sourceThreadIds: readonly string[];
  invalidatedAt: string | null;
}

/** Input for creating a memory; `scope` defaults to `"user"` (v1 is user-scoped). */
export interface NewMemory {
  content: string;
  kind: MemoryKind;
  scope?: MemoryScope;
  sourceThreadIds?: readonly string[];
}

/**
 * New values for superseding (updating) a memory — same shape as create.
 *
 * Supersede is a FULL replacement, not a partial patch: this is the complete
 * definition of the new memory that replaces the old one. `content` and `kind`
 * are required and must be re-supplied, and an omitted `sourceThreadIds` resets
 * the new memory's source threads to `[]` — it does NOT preserve the prior
 * memory's value.
 */
export type MemoryChanges = NewMemory;

/** Outcome of a mutation, tracked so the caller's promise resolves/rejects. */
type MemoryMutationOutcome =
  | { requestId: string; sessionId: number; ok: true; memory: Memory | null }
  | { requestId: string; sessionId: number; ok: false; error: Error };

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
  inFlightMutationCount: number;
  error: Error | null;
  context: MemoryRuntimeContext | null;
  sessionId: number;
  available: boolean;
  realtimeStatus: MemoryRealtimeStatus;
}

// Deep-frozen so `getServerState()` (which returns this exact reference) cannot
// be mutated by any caller; a single in-place write would otherwise corrupt
// every SSR snapshot process-wide. The freeze covers the nested `memories`
// array too — a shallow `Object.freeze` would leave `getServerState().memories`
// mutable (`.push(...)` would silently succeed), so the empty array is frozen
// before being sealed into the state. The reducers always build NEW state
// objects/arrays (they spread, never mutate in place), so they are unaffected
// and runtime behavior is unchanged.
const initialMemoryState: MemoryState = Object.freeze({
  memories: Object.freeze([]) as unknown as Memory[],
  isLoading: false,
  inFlightMutationCount: 0,
  error: null,
  context: null,
  sessionId: 0,
  available: true,
  realtimeStatus: "connecting",
});

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
  listUnavailable: props<{ sessionId: number }>(),
  mutationFinished: props<{ outcome: MemoryMutationOutcome }>(),
  credentialsRequested: props<{ sessionId: number }>(),
  credentialsSucceeded: props<{
    sessionId: number;
    joinToken: string;
    joinCode: string;
  }>(),
  // Credentials outcomes are a SILENT degrade: they feed only the realtime
  // socket effect and deliberately do NOT touch the reducer's `available`/
  // `error`, which describe the REST list route. See the reducer note near the
  // list handlers.
  credentialsFailed: props<{ sessionId: number; error: Error }>(),
  credentialsUnavailable: props<{ sessionId: number }>(),
});

const memoryDomainEvents = createActionGroup("Memory Domain", {
  memoryUpserted: props<{ sessionId: number; memory: Memory }>(),
  memoryInvalidated: props<{ sessionId: number; memoryId: string }>(),
  // Realtime-connection health transitions, session-stamped like every other
  // realtime delta so the reducer's session guard drops transitions left over
  // from a superseded context. These flip ONLY `realtimeStatus`; they never
  // touch `available`/`error` (the realtime path is a silent degrade for those).
  realtimeConnecting: props<{ sessionId: number }>(),
  realtimeConnected: props<{ sessionId: number }>(),
  realtimeUnavailable: props<{ sessionId: number }>(),
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
    inFlightMutationCount: 0,
    error: null,
    available: true,
    // A new context re-opens the realtime socket from scratch, so the connection
    // is "connecting" again until the new channel joins.
    realtimeStatus: "connecting" as MemoryRealtimeStatus,
  })),
  on(memoryAdapterEvents.stopped, (state: MemoryState) => ({
    ...state,
    memories: [],
    isLoading: false,
    inFlightMutationCount: 0,
    error: null,
    // Reset to the default (`true`), matching `contextChanged`. Otherwise a
    // `stop()` then `start()` WITHOUT a new `setContext` would retain a stale
    // `available: false` from a prior unconfigured session.
    available: true,
    // Reset to the default ("connecting"), matching `contextChanged`. A later
    // `start()` re-opens the socket; a stale "unavailable"/"connected" from the
    // prior session must not leak into the next.
    realtimeStatus: "connecting" as MemoryRealtimeStatus,
  })),
  on(memoryRestEvents.listRequested, (state: MemoryState, { sessionId }) => {
    if (sessionId !== state.sessionId || !state.context) {
      return state;
    }

    return {
      ...state,
      isLoading: true,
      error: null,
      available: true,
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
  on(memoryRestEvents.listUnavailable, (state: MemoryState, { sessionId }) => {
    if (sessionId !== state.sessionId) {
      return state;
    }

    return {
      ...state,
      memories: [],
      isLoading: false,
      error: null,
      available: false,
    };
  }),
  on(
    memoryAdapterEvents.addRequested,
    memoryAdapterEvents.updateRequested,
    memoryAdapterEvents.removeRequested,
    (state: MemoryState) => ({
      ...state,
      inFlightMutationCount: state.inFlightMutationCount + 1,
    }),
  ),
  on(memoryRestEvents.mutationFinished, (state: MemoryState, { outcome }) => {
    // Drop results from a superseded session. `contextChanged`/`stopped` already
    // reset `inFlightMutationCount`, so a mutation that resolves after the
    // context switched must not write a stale error into the new session.
    // Mirrors every other session-scoped handler (and threads.ts).
    if (outcome.sessionId !== state.sessionId) {
      return state;
    }

    return {
      ...state,
      inFlightMutationCount: Math.max(0, state.inFlightMutationCount - 1),
      // On success clear any previously surfaced mutation error so a later
      // successful mutation does not leave a phantom sticky error banner.
      error: outcome.ok ? null : outcome.error,
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
        // A successful list proves the memory route is available.
        available: true,
      };
    },
  ),
  // NOTE: `credentialsFailed` and `credentialsUnavailable` intentionally have NO
  // reducer cases. `available`/`error` describe the REST list route only and are
  // driven exclusively by the list events above. The credentials/realtime path
  // is a silent degrade by design: a missing/unconfigured `/memories/subscribe`
  // route (404/501/422) or a credentials error must not flip `available` or
  // surface an `error`, because the list route can still be perfectly healthy.
  // Otherwise `available` would be order-dependent on whichever of the two
  // concurrent `contextChanged` bootstraps responds last. Realtime failures are
  // handled where they occur (the socket effect retries and gives up via
  // console.warn); they do not belong in the REST availability state.
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
  // Realtime-connection health. Session-guarded so a transition from a
  // superseded context is ignored. These flip ONLY `realtimeStatus`; `available`
  // and `error` describe the REST list route and are intentionally untouched.
  on(
    memoryDomainEvents.realtimeConnecting,
    (state: MemoryState, { sessionId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        realtimeStatus: "connecting" as MemoryRealtimeStatus,
      };
    },
  ),
  on(
    memoryDomainEvents.realtimeConnected,
    (state: MemoryState, { sessionId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        realtimeStatus: "connected" as MemoryRealtimeStatus,
      };
    },
  ),
  on(
    memoryDomainEvents.realtimeUnavailable,
    (state: MemoryState, { sessionId }) => {
      if (sessionId !== state.sessionId) {
        return state;
      }

      return {
        ...state,
        realtimeStatus: "unavailable" as MemoryRealtimeStatus,
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
 * Reports whether at least one mutation is in flight. Derived from
 * `inFlightMutationCount` so concurrent mutations stay correct: the boolean
 * only clears once every in-flight mutation has settled.
 */
const selectMemoriesIsMutating = createSelector(
  (state: MemoryState) => state.inFlightMutationCount > 0,
);
/**
 * Reports whether the memory routes are available. Becomes `false` after a
 * 404, 422 (the runtime's MISSING_INTELLIGENCE signal), or 501 response during
 * an auto-activation read; defaults to `true`.
 */
const selectMemoriesAvailable = createSelector(
  (state: MemoryState) => state.available,
);
/**
 * Reports the realtime-connection health (see {@link MemoryRealtimeStatus}).
 * Distinct from `available`/`error`: it reflects ONLY the live socket/channel,
 * so the UI can suppress a "live" indicator once realtime permanently dies even
 * while the REST list route stays healthy. Defaults to `"connecting"`.
 */
const selectMemoriesRealtimeStatus = createSelector(
  (state: MemoryState) => state.realtimeStatus,
);

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
  /**
   * Stable, render-safe state for SSR/prerender. React's
   * `useSyncExternalStore` requires a `getServerSnapshot` during SSR/prerender
   * (e.g. Next.js); without one React throws "Missing getServerSnapshot". The
   * returned reference is stable across calls so React does not loop. There is
   * no client-side memory data during prerender, so this is the empty initial
   * state (no memories, not loading, no error).
   */
  getServerState(): MemoryState;
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
  | ReturnType<typeof memoryRestEvents.listUnavailable>
> {
  return defer(() => {
    const qs = context.includeInvalidated ? "?includeInvalidated=true" : "";
    return memoryFromFetch(`${context.runtimeUrl}${MEMORIES_PATH}${qs}`, {
      selector: (response) => {
        if (!response.ok) {
          if (ROUTE_UNAVAILABLE_STATUSES.has(response.status)) {
            throw new MemoryRouteUnavailableError(String(response.status));
          }
          throw new MemoryError("MEMORY_LIST_FAILED", {
            message: `Failed to fetch memories: ${response.status}`,
            retryable: isRetryableStatus(response.status),
          });
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
          throw new MemoryError("MEMORY_REQUEST_TIMEOUT");
        },
      }),
      map((data) =>
        memoryRestEvents.listSucceeded({
          sessionId,
          memories: data.memories.filter((memory) => memory.scope === "user"),
        }),
      ),
      catchError((error) => {
        if (error instanceof MemoryRouteUnavailableError) {
          return of(memoryRestEvents.listUnavailable({ sessionId }));
        }
        return of(
          memoryRestEvents.listFailed({
            sessionId,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        );
      }),
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
  | ReturnType<typeof memoryRestEvents.credentialsUnavailable>
> {
  return defer(() =>
    memoryFromFetch(`${context.runtimeUrl}${MEMORIES_SUBSCRIBE_PATH}`, {
      selector: async (response) => {
        if (!response.ok) {
          if (ROUTE_UNAVAILABLE_STATUSES.has(response.status)) {
            throw new MemoryRouteUnavailableError(String(response.status));
          }
          throw new MemoryError("MEMORY_CREDENTIALS_FAILED", {
            message: `Failed to fetch memory subscribe credentials: ${response.status}`,
            retryable: isRetryableStatus(response.status),
          });
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
          throw new MemoryError("MEMORY_REQUEST_TIMEOUT");
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
      catchError((error) => {
        if (error instanceof MemoryRouteUnavailableError) {
          return of(memoryRestEvents.credentialsUnavailable({ sessionId }));
        }
        return of(
          memoryRestEvents.credentialsFailed({
            sessionId,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        );
      }),
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

const MEMORY_KINDS: ReadonlySet<string> = new Set([
  "topical",
  "episodic",
  "operational",
]);
const MEMORY_SCOPES: ReadonlySet<string> = new Set(["user", "project"]);

/**
 * Validates the required fields of a create/supersede REST response before it is
 * projected to a {@link Memory}. Returns an `Error` describing the first
 * missing/invalid field, or `null` when the body is well-formed. Without this a
 * malformed 200 body yields a Memory with undefined fields that gets upserted.
 */
function validateMutationResponse(
  data: Record<string, unknown> | null,
): Error | null {
  if (!data || typeof data !== "object") {
    return new Error("memory mutation response missing/invalid body");
  }
  if (typeof data.id !== "string" || data.id.length === 0) {
    return new Error("memory mutation response missing/invalid id");
  }
  if (typeof data.kind !== "string" || !MEMORY_KINDS.has(data.kind)) {
    return new Error("memory mutation response missing/invalid kind");
  }
  if (typeof data.scope !== "string" || !MEMORY_SCOPES.has(data.scope)) {
    return new Error("memory mutation response missing/invalid scope");
  }
  if (typeof data.content !== "string") {
    return new Error("memory mutation response missing/invalid content");
  }
  // `sourceThreadIds` is `readonly string[]` on the public Memory; a malformed
  // 200 that omits it (or sends a non-array) would otherwise yield a Memory
  // whose `sourceThreadIds` is `undefined`, violating the type for every
  // consumer that maps over it.
  if (
    !Array.isArray(data.sourceThreadIds) ||
    !data.sourceThreadIds.every((id) => typeof id === "string")
  ) {
    return new Error(
      "memory mutation response missing/invalid sourceThreadIds",
    );
  }
  // `invalidatedAt` is `string | null`; reject any other type so it is not
  // copied through as `undefined`.
  if (data.invalidatedAt !== null && typeof data.invalidatedAt !== "string") {
    return new Error("memory mutation response missing/invalid invalidatedAt");
  }
  return null;
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
    // The platform's DELETE returns a bare 204 with NO body (the runtime
    // handler responds `new Response(null, { status: 204 })` and the client's
    // `removeMemory` is `Promise<void>`), so there is no confirmation field to
    // validate here — removal is status-code-confirmed. We optimistically remove
    // the row locally on any 2xx; the realtime `memory_metadata` `invalidated`
    // event (and the next REST refresh) reconcile idempotently.
    return [
      memoryDomainEvents.memoryInvalidated({ sessionId, memoryId: request.id }),
      memoryRestEvents.mutationFinished({
        outcome: { requestId, sessionId, ok: true, memory: null },
      }),
    ];
  }

  // Validate the required fields before projecting. A malformed 200 body would
  // otherwise yield a Memory with undefined fields that gets upserted into
  // state. Fail the mutation instead, mirroring the `retiredId` validation
  // below and the credentials path's joinToken/joinCode validation.
  const validationError = validateMutationResponse(data);
  if (validationError) {
    return [
      memoryRestEvents.mutationFinished({
        outcome: { requestId, sessionId, ok: false, error: validationError },
      }),
    ];
  }

  const memory = responseToMemory(
    data as Parameters<typeof responseToMemory>[0],
  );

  if (request.kind === "update") {
    // `retiredId` is optional on the server type. Without it the
    // `memoryInvalidated` would be a no-op (no id to remove), leaving the old
    // memory as a duplicate next to the new one. Validate it like the
    // credentials path validates joinToken/joinCode, and fail the mutation
    // rather than apply a half-baked supersede.
    const retiredId = (data as { retiredId?: string }).retiredId;
    if (typeof retiredId !== "string" || retiredId.length === 0) {
      return [
        memoryRestEvents.mutationFinished({
          outcome: {
            requestId,
            sessionId,
            ok: false,
            error: new Error("supersede response missing retiredId"),
          },
        }),
      ];
    }

    return [
      memoryDomainEvents.memoryInvalidated({ sessionId, memoryId: retiredId }),
      memoryDomainEvents.memoryUpserted({ sessionId, memory }),
      memoryRestEvents.mutationFinished({
        outcome: { requestId, sessionId, ok: true, memory },
      }),
    ];
  }

  return [
    memoryDomainEvents.memoryUpserted({ sessionId, memory }),
    memoryRestEvents.mutationFinished({
      outcome: { requestId, sessionId, ok: true, memory },
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
          throw new MemoryError("MEMORY_MUTATION_FAILED", {
            message: `Request failed: ${response.status}`,
            retryable: isRetryableStatus(response.status),
          });
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
          throw new MemoryError("MEMORY_REQUEST_TIMEOUT");
        },
      }),
      mergeMap((data) => of(...buildMutationSuccessActions(request, data))),
      catchError((error) =>
        of(
          memoryRestEvents.mutationFinished({
            outcome: {
              requestId: request.requestId,
              sessionId: request.sessionId,
              ok: false,
              error: error instanceof Error ? error : new Error(String(error)),
            },
          }),
        ),
      ),
    ),
  );
}

/**
 * Creates the framework-agnostic memory store: a REST snapshot on `setContext`,
 * server-authoritative add/update/remove mutations, and realtime
 * `memory_metadata` deltas off the injected `user_meta` event source — all
 * reduced into observable state.
 */
function createMemoryStore(environment: MemoryEnvironment): MemoryStore {
  // Per-store request-id counter. Kept as a closure variable (not a
  // module-level global) so each store instance has its own monotonic sequence:
  // sharing one global across instances is a latent cross-instance/SSR hazard
  // and makes request ids non-reproducible in tests that reset a single store.
  let memoryRequestId = 0;
  const createMemoryRequestId = (): string => {
    memoryRequestId += 1;
    return `memory-request-${memoryRequestId}`;
  };

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
          const sessionId = state.sessionId;
          if (!context?.runtimeUrl) {
            return of(
              memoryRestEvents.mutationFinished({
                outcome: {
                  requestId: action.requestId,
                  sessionId,
                  ok: false,
                  error: new Error("Runtime URL is not configured"),
                },
              }),
            );
          }

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
          const sessionId = action.sessionId;
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
            // The socket give-up signal: completes the realtime stream after the
            // health check throws. ALSO surfaces the give-up as a status delta
            // (`realtimeUnavailable`) so the UI can drop its "live" indicator —
            // this is the permanent-death signal that was previously only a
            // `console.warn`. `available`/`error` stay untouched by design (the
            // realtime path is a silent degrade for the REST list route).
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
            // The give-up mapped to a status delta. Emitted from the merged stream
            // (not the `takeUntil` notifier) so the `realtimeUnavailable` action is
            // dispatched BEFORE teardown: the merged stream is `takeUntil`'d by a
            // microtask-deferred copy of the give-up signal, so this synchronous
            // emission always wins the race and the action reaches the reducer.
            const fatalStatus$ = fatalSocketShutdown$.pipe(
              map(() => memoryDomainEvents.realtimeUnavailable({ sessionId })),
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

            // Drives the actual `channel.join()` AND maps the join outcome to a
            // realtime-status delta. `ɵphoenixChannel$` only creates the channel +
            // a lazy join-outcome stream; the join is sent when that stream is
            // subscribed. Observing channel events (`metadata$`) alone does NOT
            // subscribe it, so without this the socket connects but never joins
            // `user_meta:memories:<code>` and no realtime deltas arrive. The thread
            // store joins for the same reason (its merged `joinOutcome$`).
            //
            // On a successful join -> `realtimeConnected` (the "live" signal). On a
            // failed/timed-out join we KEEP the `console.warn` and emit
            // `realtimeUnavailable`, then swallow the error so a transient
            // rejection doesn't tear down the metadata stream (Phoenix re-attempts
            // the join on socket reconnect); the next successful join re-emits
            // `realtimeConnected`.
            const join$ = ɵjoinPhoenixChannel$(channel$).pipe(
              // `ɵjoinPhoenixChannel$` emits `never` (it completes on success), so
              // this concat surfaces the connected status once the join resolves.
              concatWith(
                of(memoryDomainEvents.realtimeConnected({ sessionId })),
              ),
              catchError((error) => {
                console.warn(
                  `[memory] failed to join user_meta:memories:${joinCode}`,
                  error,
                );
                return of(
                  memoryDomainEvents.realtimeUnavailable({ sessionId }),
                );
              }),
            );

            return merge(
              // Surface "connecting" immediately when the realtime stream starts
              // (credentials succeeded -> socket subscribing/joining). Reset to
              // this on every (re)subscribe so a prior session's terminal status
              // can't bleed through before the new join resolves.
              of(memoryDomainEvents.realtimeConnecting({ sessionId })),
              metadata$,
              join$,
              fatalStatus$,
            ).pipe(
              takeUntil(
                merge(
                  shutdown$,
                  // Defer the give-up teardown by a microtask so `fatalStatus$`'s
                  // synchronous `realtimeUnavailable` emission is dispatched before
                  // the stream is torn down. `observeOn(asapScheduler)` schedules
                  // the teardown after the current microtask drains.
                  fatalSocketShutdown$.pipe(observeOn(asapScheduler)),
                ),
              ),
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
              sessionId: store.getState().sessionId,
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
          ofType(
            memoryRestEvents.listSucceeded,
            memoryRestEvents.listFailed,
            // `listUnavailable` (404/501/422) is the third terminal outcome of
            // the list fetch. Without it `await refresh()` would hang forever
            // against an unconfigured route.
            memoryRestEvents.listUnavailable,
          ),
          filter((action) => action.sessionId === sessionId),
        ),
        store.actions$.pipe(ofType(memoryAdapterEvents.stopped)),
        // The list `fetchEffect` has `takeUntil(contextChanged, stopped)`, so a
        // `contextChanged` fired after this `listRequested` but before the fetch
        // settles tears down the fetch with NO terminal list action for our
        // session — `await refresh()` would hang forever. Settle on it too.
        store.actions$.pipe(ofType(memoryAdapterEvents.contextChanged)),
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
        // A `contextChanged` superseded this refresh: a new context is loading
        // its own snapshot, so this refresh is moot. RESOLVE (do not reject) —
        // resolving is the least-surprising outcome for a superseded refresh.
        if (memoryAdapterEvents.contextChanged.match(action)) {
          return;
        }
        // `listSucceeded` and `listUnavailable` both RESOLVE: an unavailable
        // (not-configured) route is a non-fatal terminal state, consistent with
        // the auto-load path which leaves `available: false` without erroring.
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
        (outcome) => {
          if (outcome.memory == null) {
            throw new Error("add resolved without a memory");
          }
          return outcome.memory;
        },
      );
    },
    updateMemory(id: string, changes: MemoryChanges): Promise<Memory> {
      return trackMutation(
        memoryAdapterEvents.updateRequested({
          requestId: createMemoryRequestId(),
          id,
          changes,
        }),
        (outcome) => {
          if (outcome.memory == null) {
            throw new Error("update resolved without a memory");
          }
          return outcome.memory;
        },
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
    getServerState(): MemoryState {
      return initialMemoryState;
    },
    select: store.select.bind(store),
  };
}

// `Memory`, `MemoryKind`, `MemoryScope`, `NewMemory`, and `MemoryChanges` are
// the consumer-facing memory types surfaced by the framework hooks
// (`useMemories` / `injectMemories`); they are exported unprefixed from their
// declarations above. The remaining memory internals keep the `ɵ` prefix.
// The memory error registry surface is consumer-facing: `MemoryError` is what
// `MemoryState.error` (and the `error: Error | null` from `useMemories` /
// `injectMemories`) carries on a failure, and consumers branch on its
// `code`/`category`/`retryable`. Re-exported unprefixed here so it ships through
// `index.ts` (`export * from "./memory"`) alongside the memory types.
export {
  MemoryError,
  MEMORY_ERROR_REGISTRY,
  isRetryableStatus as ɵisRetryableMemoryStatus,
} from "./memory-errors";
export type {
  MemoryErrorCode,
  MemoryErrorCategory,
  MemoryErrorRegistryEntry,
} from "./memory-errors";

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
export const ɵselectMemoriesIsMutating = selectMemoriesIsMutating;
export const ɵselectMemoriesAvailable = selectMemoriesAvailable;
export const ɵselectMemoriesRealtimeStatus = selectMemoriesRealtimeStatus;
export { createMemoryStore as ɵcreateMemoryStore };
