import {
  createActionGroup,
  createReducer,
  on,
  props,
} from "./utils/micro-redux";
import type { Reducer } from "./utils/micro-redux";

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
 * In-memory state for the memory store. Session-guarded like the thread store:
 * `sessionId` is bumped whenever the runtime context changes so that responses
 * and realtime deltas from a previous context are ignored.
 */
interface MemoryState {
  memories: Memory[];
  isLoading: boolean;
  error: Error | null;
  sessionId: number;
}

const initialMemoryState: MemoryState = {
  memories: [],
  isLoading: false,
  error: null,
  sessionId: 0,
};

const memoryRestEvents = createActionGroup("Memory REST", {
  listSucceeded: props<{ sessionId: number; memories: Memory[] }>(),
});

const memoryDomainEvents = createActionGroup("Memory Domain", {
  memoryUpserted: props<{ sessionId: number; memory: Memory }>(),
  memoryInvalidated: props<{ sessionId: number; memoryId: string }>(),
});

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

export type ɵMemory = Memory;
export type ɵMemoryKind = MemoryKind;
export type ɵMemoryScope = MemoryScope;
export type ɵMemoryState = MemoryState;
export const ɵmemoryRestEvents = memoryRestEvents;
export const ɵmemoryDomainEvents = memoryDomainEvents;
export const ɵmemoryReducer = memoryReducer;
