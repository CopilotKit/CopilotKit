import {
  createActionGroup,
  createReducer,
  createSelector,
  createStore,
  empty,
  on,
  props,
} from "./utils/micro-redux";
import type { Reducer, Store } from "./utils/micro-redux";

/**
 * Memory taxonomy, public vocabulary. There is a single set of names across
 * storage, the realtime payload, REST, and the SDK — no internal/external
 * mapping layer (see RD-37). Do not reintroduce `semantic`/`procedural`.
 */
export type MemoryKind = "topical" | "episodic" | "operational";

/** Memories are user- or project-scoped only. There is no thread scope. */
export type MemoryScope = "user" | "project";

/**
 * Minimal public projection of a memory, matching the REST contract
 * (`GET/POST /api/memories`, `POST /api/memories/recall`). Internal
 * bookkeeping columns never cross this boundary.
 *
 * - `score` is present only on recall hits.
 * - `invalidatedAt` is present on list responses so the `includeInvalidated`
 *   toggle is meaningful; it is `null` for live memories.
 */
export interface PublicMemory {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  sourceThreadIds: readonly string[];
  score?: number;
  invalidatedAt?: string | null;
}

/** Input accepted by {@link MemoryStore.addMemory} (`POST /api/memories`). */
export interface NewMemory {
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  sourceThreadIds?: readonly string[];
}

/**
 * Mutable fields accepted by {@link MemoryStore.updateMemory}
 * (`PATCH /api/memories/:id`). Scope is immutable across a supersede, so it
 * is not part of the change set.
 */
export interface MemoryChanges {
  kind?: MemoryKind;
  content?: string;
}

/**
 * Realtime `memory_metadata` delta, mirroring the gateway payload. Every
 * server write emits one (or, for a supersede, an `invalidated` for the old
 * id followed by a `created` for the new id).
 */
export type MemoryMetadataEvent =
  | { operation: "created" | "updated"; memory: PublicMemory }
  | { operation: "invalidated"; memoryId: string };

/** Observable state shape exposed by the store. */
export interface MemoryState {
  memories: PublicMemory[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Framework-agnostic memory store surface that the React (`useMemories`) and
 * Angular (`injectMemories`) bindings consume. Selectors are read via
 * `select(...)`; mutations delegate to the store, which owns transport and
 * realtime reconciliation. Mirrors the thread store's contract.
 */
export interface MemoryStore {
  start(): void;
  stop(): void;
  /** Re-pull the REST snapshot (the fallback for project scope, no realtime). */
  refresh(): Promise<void>;
  addMemory(input: NewMemory): Promise<PublicMemory>;
  /** Supersede: retires `id`, creates a replacement, resolves to the new memory. */
  updateMemory(id: string, changes: MemoryChanges): Promise<PublicMemory>;
  removeMemory(id: string): Promise<void>;
  getState(): MemoryState;
  select: Store<MemoryState>["select"];
}

const memoryEvents = createActionGroup("Memory", {
  loadStarted: empty(),
  loadSucceeded: props<{ memories: PublicMemory[] }>(),
  loadFailed: props<{ error: Error }>(),
  upserted: props<{ memory: PublicMemory }>(),
  invalidated: props<{ memoryId: string }>(),
});

const initialMemoryState: MemoryState = {
  memories: [],
  isLoading: false,
  error: null,
};

function upsertMemory(
  memories: PublicMemory[],
  memory: PublicMemory,
): PublicMemory[] {
  const index = memories.findIndex((existing) => existing.id === memory.id);
  if (index === -1) {
    return [...memories, memory];
  }
  const next = memories.slice();
  next[index] = memory;
  return next;
}

const memoryReducer = createReducer(
  initialMemoryState,
  on(memoryEvents.loadStarted, (state: MemoryState) => ({
    ...state,
    isLoading: true,
    error: null,
  })),
  on(memoryEvents.loadSucceeded, (state: MemoryState, { memories }) => ({
    ...state,
    memories,
    isLoading: false,
  })),
  on(memoryEvents.loadFailed, (state: MemoryState, { error }) => ({
    ...state,
    error,
    isLoading: false,
  })),
  on(memoryEvents.upserted, (state: MemoryState, { memory }) => ({
    ...state,
    memories: upsertMemory(state.memories, memory),
  })),
  on(memoryEvents.invalidated, (state: MemoryState, { memoryId }) => ({
    ...state,
    memories: state.memories.filter((memory) => memory.id !== memoryId),
  })),
) as Reducer<MemoryState>;

const selectMemories = createSelector((state: MemoryState) => state.memories);
const selectMemoriesIsLoading = createSelector(
  (state: MemoryState) => state.isLoading,
);
const selectMemoriesError = createSelector((state: MemoryState) => state.error);

/** Options for the in-memory mock store. */
export interface InMemoryMemoryStoreOptions {
  /** Memories the store is seeded with. */
  initial?: PublicMemory[];
  /** Id minted for created/superseded memories. Defaults to a counter. */
  idFactory?: () => string;
}

/**
 * Concrete in-memory mock store used to build and unit-test the framework
 * bindings ahead of the real core `MemoryStore` (RD-34). It collapses
 * REST + realtime into local reducer dispatches — a mutation updates the list
 * immediately, exactly as the server-authoritative `created`/`invalidated`
 * events would. {@link InMemoryMemoryStore.ɵemitMetadataEvent} simulates a
 * realtime delta arriving from another client.
 *
 * This is scaffolding: RD-34 supplies the transport-backed `createMemoryStore`
 * that replaces it; the {@link MemoryStore} contract and selectors stay.
 */
export interface InMemoryMemoryStore extends MemoryStore {
  /** Test seam: apply a realtime `memory_metadata` delta. */
  ɵemitMetadataEvent(event: MemoryMetadataEvent): void;
}

function createDefaultIdFactory(): () => string {
  let counter = 0;
  return () => `mem-${(counter += 1)}`;
}

/**
 * Creates an {@link InMemoryMemoryStore}. See {@link InMemoryMemoryStore} for
 * why this exists and how it relates to RD-34's real store.
 */
export function ɵcreateInMemoryMemoryStore(
  options: InMemoryMemoryStoreOptions = {},
): InMemoryMemoryStore {
  const mintId = options.idFactory ?? createDefaultIdFactory();
  const store = createStore<MemoryState>({ reducer: memoryReducer });

  if (options.initial && options.initial.length > 0) {
    store.dispatch(memoryEvents.loadSucceeded({ memories: options.initial }));
  }

  function applyEvent(event: MemoryMetadataEvent): void {
    if (event.operation === "invalidated") {
      store.dispatch(memoryEvents.invalidated({ memoryId: event.memoryId }));
      return;
    }
    store.dispatch(memoryEvents.upserted({ memory: event.memory }));
  }

  return {
    start(): void {
      store.init();
    },
    stop(): void {
      store.stop();
    },
    refresh(): Promise<void> {
      return Promise.resolve();
    },
    addMemory(input: NewMemory): Promise<PublicMemory> {
      const memory: PublicMemory = {
        id: mintId(),
        kind: input.kind,
        scope: input.scope,
        content: input.content,
        sourceThreadIds: input.sourceThreadIds ?? [],
        invalidatedAt: null,
      };
      applyEvent({ operation: "created", memory });
      return Promise.resolve(memory);
    },
    updateMemory(id: string, changes: MemoryChanges): Promise<PublicMemory> {
      const current = store
        .getState()
        .memories.find((memory) => memory.id === id);
      if (!current) {
        return Promise.reject(new Error("MEMORY_NOT_FOUND"));
      }
      const superseded: PublicMemory = {
        ...current,
        ...changes,
        id: mintId(),
        invalidatedAt: null,
      };
      // Supersede emits both deltas, mirroring the server contract.
      applyEvent({ operation: "invalidated", memoryId: id });
      applyEvent({ operation: "created", memory: superseded });
      return Promise.resolve(superseded);
    },
    removeMemory(id: string): Promise<void> {
      applyEvent({ operation: "invalidated", memoryId: id });
      return Promise.resolve();
    },
    getState(): MemoryState {
      return store.getState();
    },
    select: store.select.bind(store),
    ɵemitMetadataEvent(event: MemoryMetadataEvent): void {
      applyEvent(event);
    },
  };
}

export type ɵMemoryStore = MemoryStore;
export const ɵmemoryEvents = memoryEvents;
export const ɵselectMemories = selectMemories;
export const ɵselectMemoriesIsLoading = selectMemoriesIsLoading;
export const ɵselectMemoriesError = selectMemoriesError;
