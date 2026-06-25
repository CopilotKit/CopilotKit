import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { NEVER, Subject } from "rxjs";
import type { Observable } from "rxjs";
import {
  ɵmemoryReducer as memoryReducer,
  ɵmemoryRestEvents as memoryRestEvents,
  ɵmemoryDomainEvents as memoryDomainEvents,
  ɵmemoryAdapterEvents as memoryAdapterEvents,
  ɵmapMemoryMetadataEvent as mapMemoryMetadataEvent,
  ɵcreateMemoryStore as createMemoryStore,
  ɵselectMemories,
  ɵselectMemoriesIsLoading,
  ɵselectMemoriesError,
} from "../memory";
import type {
  ɵMemory as Memory,
  ɵMemoryMetadataEvent as MemoryMetadataEvent,
  ɵMemoryEnvironment as MemoryEnvironment,
} from "../memory";

const noUserMeta: MemoryEnvironment["observeUserMetaEvent"] = <T>() =>
  NEVER as Observable<T>;

function memoryEnvironment(fetchImpl: Mock): MemoryEnvironment {
  return {
    fetch: fetchImpl as unknown as typeof fetch,
    observeUserMetaEvent: noUserMeta,
  };
}

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
      fetch: vi.fn() as unknown as typeof fetch,
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

const sampleContext = {
  runtimeUrl: "https://runtime.example.com",
  wsUrl: "wss://gw.example.com/client",
  headers: { Authorization: "Bearer token", "X-Cpki-User-Id": "u1" },
};

describe("memory store REST snapshot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the snapshot on setContext, keeping only user-scoped memories", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        memories: [
          {
            id: "m1",
            kind: "topical",
            scope: "user",
            content: "mine",
            sourceThreadIds: [],
            invalidatedAt: null,
          },
          {
            id: "p1",
            kind: "topical",
            scope: "project",
            content: "shared",
            sourceThreadIds: [],
            invalidatedAt: null,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/memories",
      expect.objectContaining({ method: "GET" }),
    );
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1"]);
    expect(store.getState().isLoading).toBe(false);

    store.stop();
  });

  it("surfaces a fetch failure as state.error and clears isLoading", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    expect(store.getState().error).toBeInstanceOf(Error);
    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().memories).toEqual([]);

    store.stop();
  });

  it("refresh() re-pulls the snapshot and resolves once it settles", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          memories: [
            {
              id: "m1",
              kind: "topical",
              scope: "user",
              content: "first",
              sourceThreadIds: [],
              invalidatedAt: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          memories: [
            {
              id: "m1",
              kind: "topical",
              scope: "user",
              content: "first",
              sourceThreadIds: [],
              invalidatedAt: null,
            },
            {
              id: "m2",
              kind: "topical",
              scope: "user",
              content: "second",
              sourceThreadIds: [],
              invalidatedAt: null,
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1"]);

    // The promise must resolve only after the re-pull settles.
    await store.refresh();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1", "m2"]);

    store.stop();
  });

  it("refresh() resolves immediately when no context is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();

    await expect(store.refresh()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    store.stop();
  });

  it("refresh() rejects when the re-pull fails (no silent success)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memories: [] }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    await expect(store.refresh()).rejects.toThrow();
    expect(store.getState().error).toBeInstanceOf(Error);

    store.stop();
  });

  it("refresh() rejects when the store is stopped mid-flight (symmetric with mutations)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      // Second pull never settles on its own: the store is stopped first.
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    const pending = store.refresh();
    store.stop();

    await expect(pending).rejects.toThrow("stopped before refresh completed");
  });
});

describe("memory store mutations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const userMemory = (id: string, content = `content-${id}`) => ({
    id,
    kind: "topical" as const,
    scope: "user" as const,
    content,
    sourceThreadIds: [],
    invalidatedAt: null,
  });

  async function connectedStore(fetchMock: Mock) {
    vi.stubGlobal("fetch", fetchMock);
    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();
    return store;
  }

  it("addMemory POSTs and applies the created memory, resolving to it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...userMemory("m1", "hi"), absorbed: false }),
      });
    const store = await connectedStore(fetchMock);

    const created = await store.addMemory({ content: "hi", kind: "topical" });

    expect(created.id).toBe("m1");
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1"]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://runtime.example.com/memories",
      expect.objectContaining({ method: "POST" }),
    );

    store.stop();
  });

  it("addMemory omits scope from the body when the caller does not provide it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...userMemory("m1", "hi"), absorbed: false }),
      });
    const store = await connectedStore(fetchMock);

    await store.addMemory({ content: "hi", kind: "topical" });

    const init = fetchMock.mock.calls[1]?.[1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("scope");
    expect(body).toMatchObject({
      content: "hi",
      kind: "topical",
      sourceThreadIds: [],
    });

    store.stop();
  });

  it("addMemory forwards scope when the caller provides it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...userMemory("m1", "hi"), absorbed: false }),
      });
    const store = await connectedStore(fetchMock);

    await store.addMemory({ content: "hi", kind: "topical", scope: "user" });

    const init = fetchMock.mock.calls[1]?.[1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.scope).toBe("user");

    store.stop();
  });

  it("removeMemory DELETEs and removes the memory from state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memories: [userMemory("m1")] }),
      })
      .mockResolvedValueOnce({ ok: true });
    const store = await connectedStore(fetchMock);
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1"]);

    await store.removeMemory("m1");

    expect(store.getState().memories).toEqual([]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://runtime.example.com/memories/m1",
      expect.objectContaining({ method: "DELETE" }),
    );

    store.stop();
  });

  it("updateMemory supersedes: retires the old id, applies the new memory", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memories: [userMemory("m1", "old")] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...userMemory("m2", "new"), retiredId: "m1" }),
      });
    const store = await connectedStore(fetchMock);

    const updated = await store.updateMemory("m1", {
      content: "new",
      kind: "topical",
    });

    expect(updated.id).toBe("m2");
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m2"]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://runtime.example.com/memories/m1",
      expect.objectContaining({ method: "PATCH" }),
    );

    store.stop();
  });

  it("rejects and records an error when a mutation fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    const store = await connectedStore(fetchMock);

    await expect(
      store.addMemory({ content: "x", kind: "topical" }),
    ).rejects.toThrow();
    expect(store.getState().error).toBeInstanceOf(Error);

    store.stop();
  });
});

it("setContext stores wsUrl alongside runtimeUrl", () => {
  const store = createMemoryStore(memoryEnvironment(vi.fn()));
  store.start();
  store.setContext({
    runtimeUrl: "https://runtime.example.com",
    wsUrl: "wss://gw.example.com/client",
    headers: {},
  });
  expect(store.getState().context?.wsUrl).toBe("wss://gw.example.com/client");
  store.stop();
});

describe("memory selectors", () => {
  it("project the relevant state slices", () => {
    const state = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({ sessionId: 0, memories: [memory("m1")] }),
    );

    expect(ɵselectMemories(state).map((m) => m.id)).toEqual(["m1"]);
    expect(ɵselectMemoriesIsLoading(state)).toBe(false);
    expect(ɵselectMemoriesError(state)).toBeNull();
  });

  it("reflects loading state after contextChanged", () => {
    const state = memoryReducer(
      undefined,
      memoryAdapterEvents.contextChanged({ context: sampleContext }),
    );

    expect(ɵselectMemoriesIsLoading(state)).toBe(true);
  });
});
