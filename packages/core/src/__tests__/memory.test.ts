import { describe, expect, it } from "vitest";
import { Subject } from "rxjs";
import type { Observable } from "rxjs";
import {
  ɵmemoryReducer as memoryReducer,
  ɵmemoryRestEvents as memoryRestEvents,
  ɵmemoryDomainEvents as memoryDomainEvents,
  ɵmapMemoryMetadataEvent as mapMemoryMetadataEvent,
  ɵcreateMemoryStore as createMemoryStore,
} from "../memory";
import type {
  ɵMemory as Memory,
  ɵMemoryMetadataEvent as MemoryMetadataEvent,
} from "../memory";

const flushEffects = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function createdEvent(id: string, content = `content-${id}`): MemoryMetadataEvent {
  return {
    operation: "created",
    memoryId: id,
    organizationId: "org-1",
    projectId: "proj-1",
    occurredAt: "2026-01-01T00:00:00Z",
    memory: {
      id,
      organizationId: "org-1",
      projectId: "proj-1",
      scope: "user",
      kind: "topical",
      content,
      sourceThreadIds: [],
      invalidatedAt: null,
    },
  };
}

function memory(id: string, content = `content-${id}`): Memory {
  return {
    id,
    kind: "topical",
    scope: "user",
    content,
    sourceThreadIds: [],
    invalidatedAt: null,
  };
}

describe("memory reducer", () => {
  it("populates memories from a snapshot for the matching session", () => {
    const next = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1"), memory("m2")],
      }),
    );

    expect(next.memories.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(next.isLoading).toBe(false);
    expect(next.error).toBeNull();
  });

  it("ignores a snapshot for a stale session", () => {
    const next = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 99,
        memories: [memory("m1")],
      }),
    );

    expect(next.memories).toEqual([]);
  });

  it("prepends a newly created memory (newest first)", () => {
    const base = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({ sessionId: 0, memories: [memory("m1")] }),
    );

    const next = memoryReducer(
      base,
      memoryDomainEvents.memoryUpserted({ sessionId: 0, memory: memory("m2") }),
    );

    expect(next.memories.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("replaces an existing memory in place on update", () => {
    const base = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1", "old"), memory("m2")],
      }),
    );

    const next = memoryReducer(
      base,
      memoryDomainEvents.memoryUpserted({
        sessionId: 0,
        memory: memory("m1", "new"),
      }),
    );

    expect(next.memories.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(next.memories[0]?.content).toBe("new");
  });

  it("removes a memory on invalidation", () => {
    const base = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1"), memory("m2")],
      }),
    );

    const next = memoryReducer(
      base,
      memoryDomainEvents.memoryInvalidated({ sessionId: 0, memoryId: "m1" }),
    );

    expect(next.memories.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("memory_metadata realtime mapping", () => {
  it("maps a created event to a memoryUpserted action (projecting to the public shape)", () => {
    const event: MemoryMetadataEvent = {
      operation: "created",
      memoryId: "m1",
      organizationId: "org-1",
      projectId: "proj-1",
      occurredAt: "2026-01-01T00:00:00Z",
      memory: {
        id: "m1",
        organizationId: "org-1",
        projectId: "proj-1",
        scope: "user",
        kind: "topical",
        content: "hello",
        sourceThreadIds: ["t1"],
        invalidatedAt: null,
      },
    };

    expect(mapMemoryMetadataEvent(event, 0)).toEqual(
      memoryDomainEvents.memoryUpserted({
        sessionId: 0,
        memory: {
          id: "m1",
          kind: "topical",
          scope: "user",
          content: "hello",
          sourceThreadIds: ["t1"],
          invalidatedAt: null,
        },
      }),
    );
  });

  it("maps an updated event to a memoryUpserted action", () => {
    const event: MemoryMetadataEvent = {
      operation: "updated",
      memoryId: "m1",
      organizationId: "org-1",
      projectId: "proj-1",
      occurredAt: "2026-01-01T00:00:00Z",
      memory: {
        id: "m1",
        organizationId: "org-1",
        projectId: "proj-1",
        scope: "user",
        kind: "operational",
        content: "updated",
        sourceThreadIds: [],
        invalidatedAt: null,
      },
    };

    const action = mapMemoryMetadataEvent(event, 3);
    expect(action).toEqual(
      memoryDomainEvents.memoryUpserted({
        sessionId: 3,
        memory: {
          id: "m1",
          kind: "operational",
          scope: "user",
          content: "updated",
          sourceThreadIds: [],
          invalidatedAt: null,
        },
      }),
    );
  });

  it("maps an invalidated event to a memoryInvalidated action", () => {
    const event: MemoryMetadataEvent = {
      operation: "invalidated",
      memoryId: "m1",
      organizationId: "org-1",
      projectId: "proj-1",
      occurredAt: "2026-01-01T00:00:00Z",
      invalidated: { id: "m1" },
    };

    expect(mapMemoryMetadataEvent(event, 0)).toEqual(
      memoryDomainEvents.memoryInvalidated({ sessionId: 0, memoryId: "m1" }),
    );
  });
});

describe("memory store realtime", () => {
  it("applies created and invalidated memory_metadata events to observable state", async () => {
    const events$ = new Subject<MemoryMetadataEvent>();
    const store = createMemoryStore({
      observeUserMetaEvent: (<T>() =>
        events$ as unknown as Observable<T>) as <T>(
        eventName: string,
      ) => Observable<T>,
    });
    store.start();
    await flushEffects();

    const seen: string[][] = [];
    const sub = store
      .select((state) => state.memories)
      .subscribe((memories) => seen.push(memories.map((m) => m.id)));

    events$.next(createdEvent("m1"));
    events$.next(createdEvent("m2"));
    await flushEffects();

    expect(store.getState().memories.map((m) => m.id)).toEqual(["m2", "m1"]);

    events$.next({
      operation: "invalidated",
      memoryId: "m1",
      organizationId: "org-1",
      projectId: "proj-1",
      occurredAt: "2026-01-01T00:00:00Z",
      invalidated: { id: "m1" },
    });
    await flushEffects();

    expect(store.getState().memories.map((m) => m.id)).toEqual(["m2"]);
    // the observable surface re-emitted on every change (drives hooks/signals)
    expect(seen.at(-1)).toEqual(["m2"]);

    sub.unsubscribe();
    store.stop();
  });
});
