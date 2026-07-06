import { afterEach, describe, expect, it, test, vi } from "vitest";
import type { Mock } from "vitest";
import type { MockChannel } from "./test-utils";
import { MockSocket } from "./test-utils";

// Phoenix mock harness: the memory store opens its OWN socket/channel, so the
// `phoenix` module is mocked here (mirrors `thread-store-user-meta.test.ts`).
// `phoenix.sockets` captures every socket the store constructs so tests can
// reach the joined channel and `serverPush` events onto it.
const phoenix = vi.hoisted(() => ({
  sockets: [] as MockSocket[],
}));

vi.mock("phoenix", () => ({
  Socket: class extends MockSocket {
    constructor(url = "", opts: Record<string, any> = {}) {
      super(url, opts);
      phoenix.sockets.push(this);
    }
  },
}));

const {
  ɵmemoryReducer: memoryReducer,
  ɵmemoryRestEvents: memoryRestEvents,
  ɵmemoryDomainEvents: memoryDomainEvents,
  ɵmemoryAdapterEvents: memoryAdapterEvents,
  ɵmapMemoryMetadataEvent: mapMemoryMetadataEvent,
  ɵcreateMemoryStore: createMemoryStore,
  ɵselectMemories,
  ɵselectMemoriesIsLoading,
  ɵselectMemoriesError,
  ɵselectMemoriesIsMutating,
  ɵselectMemoriesAvailable,
} = await import("../memory");
import type {
  Memory,
  ɵMemoryMetadataEvent as MemoryMetadataEvent,
  ɵMemoryEnvironment as MemoryEnvironment,
} from "../memory";
import { MemoryError } from "../memory-errors";
import { ɵcreateMetadataRealtimeConnection } from "../core/metadata-realtime";

function memoryEnvironment(fetchImpl: Mock): MemoryEnvironment {
  return {
    fetch: fetchImpl as unknown as typeof fetch,
  };
}

/** Returns the channel the store joined (its own `user_meta:memories:*` topic). */
function memoryChannel(): MockChannel {
  const channel = phoenix.sockets[0]?.channels[0];
  if (!channel) {
    throw new Error("expected a phoenix channel to exist");
  }
  return channel;
}

const flushEffects = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function createdEvent(
  id: string,
  content = `content-${id}`,
): MemoryMetadataEvent {
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
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1")],
      }),
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

  // Realtime session guard: a `memory_metadata` delta whose sessionId is stale
  // (a `contextChanged` bumped the live session after this event was mapped)
  // must be IGNORED — it must not be applied to the new session's state. This is
  // the reducer half of the realtime effect's `mapMemoryMetadataEvent(event,
  // sessionId)` projection.
  it("ignores a realtime memoryUpserted carrying a stale session", () => {
    const listed = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1")],
      }),
    );

    // A contextChanged bumps the live session to 1.
    const bumped = memoryReducer(
      listed,
      memoryAdapterEvents.contextChanged({ context: sampleContext }),
    );
    expect(bumped.sessionId).toBe(1);

    // A stale realtime delta (mapped against the OLD session 0) arrives late.
    const next = memoryReducer(
      bumped,
      memoryDomainEvents.memoryUpserted({ sessionId: 0, memory: memory("m2") }),
    );

    // The stale delta is dropped: no "m2" leaks into the new session.
    expect(next.memories.map((m) => m.id)).not.toContain("m2");
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
  const realtimeContext = {
    runtimeUrl: "https://runtime.example.com",
    headers: { Authorization: "Bearer token", "X-Cpki-User-Id": "u1" },
  };

  /** Fresh shared metadata connection per call: the phoenix module is mocked
   * (see the hoisted `vi.mock("phoenix", ...)` above), so this connects
   * through `phoenix.sockets` exactly like the real `CopilotKitCore`-owned
   * connection would. */
  function fakeMetadataConnection(joinCode = "jc-1") {
    return ɵcreateMetadataRealtimeConnection({
      wsUrl: "wss://gw.example.com/client",
      fetchSubscription: async () => ({ joinToken: "jt-1", joinCode }),
    });
  }

  /**
   * Boots a store, sets context with a real (mock-phoenix-backed) shared
   * metadata connection, and lets it join its own
   * `user_meta:memories:<joinCode>` channel. Returns the connected store.
   */
  async function connectedRealtimeStore() {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ memories: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext({
      ...realtimeContext,
      metadata: fakeMetadataConnection(),
    });
    await flushEffects();
    return store;
  }

  afterEach(() => {
    phoenix.sockets.splice(0);
    vi.unstubAllGlobals();
  });

  it("delivers memory_metadata over its own user_meta:memories channel (no thread store)", async () => {
    const store = await connectedRealtimeStore();

    // The store must actually JOIN the channel — `ɵphoenixChannel$` only creates
    // it lazily; the join is sent when the join-outcome stream is subscribed.
    // Observing channel events alone does not join, so without the socket
    // effect's join driver the server would never push deltas. (Regression: the
    // socket connected but never joined `user_meta:memories:<code>`.)
    expect(memoryChannel().joinCount).toBeGreaterThan(0);

    memoryChannel().serverPush("memory_metadata", createdEvent("m1"));
    await flushEffects();

    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1"]);
    expect(memoryChannel().topic).toBe("user_meta:memories:jc-1");

    store.stop();
  });

  it("applies created and invalidated memory_metadata events to observable state", async () => {
    const store = await connectedRealtimeStore();

    const seen: string[][] = [];
    const sub = store
      .select((state) => state.memories)
      .subscribe((memories) => seen.push(memories.map((m) => m.id)));

    memoryChannel().serverPush("memory_metadata", createdEvent("m1"));
    memoryChannel().serverPush("memory_metadata", createdEvent("m2"));
    await flushEffects();

    expect(store.getState().memories.map((m) => m.id)).toEqual(["m2", "m1"]);

    memoryChannel().serverPush("memory_metadata", {
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

  // Upsert-by-id idempotency across transports: a memory created over REST
  // (addMemory's POST response is applied locally) followed by the realtime
  // `created` echo for the SAME id must NOT produce a duplicate row. The store's
  // reducer upserts by id, so the realtime delta replaces in place.
  it("does not duplicate a REST-created memory when its realtime echo arrives", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "m1",
          kind: "topical",
          scope: "user",
          content: "content-m1",
          sourceThreadIds: [],
          invalidatedAt: null,
          absorbed: false,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext({
      ...realtimeContext,
      metadata: fakeMetadataConnection(),
    });
    await flushEffects();

    // REST create: applied locally from the POST response.
    await store.addMemory({ content: "content-m1", kind: "topical" });
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1"]);

    // The realtime `created` echo for the SAME id arrives over the channel.
    memoryChannel().serverPush("memory_metadata", createdEvent("m1"));
    await flushEffects();

    // Upsert-by-id: still exactly one row, no duplicate.
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1"]);

    store.stop();
  });

  it("starts realtimeStatus at 'connecting' before any join resolves", async () => {
    const store = await connectedRealtimeStore();

    // Credentials succeeded and the socket is subscribing/joining, but the join
    // has not been acknowledged yet -> still "connecting".
    expect(store.getState().realtimeStatus).toBe("connecting");

    store.stop();
  });

  it("flips realtimeStatus to 'connected' on a successful channel join", async () => {
    const store = await connectedRealtimeStore();

    memoryChannel().triggerJoin("ok");
    await flushEffects();

    expect(store.getState().realtimeStatus).toBe("connected");

    store.stop();
  });

  it("flips realtimeStatus to 'unavailable' when the socket exhausts its retries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = await connectedRealtimeStore();
    const socket = phoenix.sockets[0];
    if (!socket) {
      throw new Error("expected a phoenix socket to exist");
    }

    // Drive MAX_SOCKET_RETRIES (5) consecutive transport errors with no
    // intervening `open`, exhausting `ɵobservePhoenixSocketHealth$` so the
    // realtime stream gives up.
    for (let i = 0; i < 5; i += 1) {
      socket.triggerError();
    }
    await flushEffects();

    expect(store.getState().realtimeStatus).toBe("unavailable");
    // The give-up is still logged (silent-degrade for `available`/`error`).
    expect(warn).toHaveBeenCalled();
    // The realtime give-up must NOT touch the REST availability/error state.
    expect(store.getState().available).toBe(true);
    expect(store.getState().error).toBeNull();

    warn.mockRestore();
    store.stop();
  });

  it("flips realtimeStatus to 'unavailable' on a permanent join failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = await connectedRealtimeStore();

    memoryChannel().triggerJoin("error", { reason: "unauthorized" });
    await flushEffects();

    expect(store.getState().realtimeStatus).toBe("unavailable");
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    store.stop();
  });

  it("resets realtimeStatus to 'connecting' on contextChanged", async () => {
    const store = await connectedRealtimeStore();

    memoryChannel().triggerJoin("ok");
    await flushEffects();
    expect(store.getState().realtimeStatus).toBe("connected");

    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: { Authorization: "Bearer token", "X-Cpki-User-Id": "u2" },
      metadata: fakeMetadataConnection("jc-2"),
    });
    await flushEffects();

    expect(store.getState().realtimeStatus).toBe("connecting");

    store.stop();
  });

  it("resets realtimeStatus to 'connecting' on stop", async () => {
    const store = await connectedRealtimeStore();

    memoryChannel().triggerJoin("ok");
    await flushEffects();
    expect(store.getState().realtimeStatus).toBe("connected");

    store.stop();
    await flushEffects();

    expect(store.getState().realtimeStatus).toBe("connecting");
  });

  it("subscribe failure -> silent degrade (store stays alive, realtimeStatus 'unavailable')", async () => {
    // The shared metadata connection's `fetchSubscription` rejects (a transient
    // non-2xx on `/threads/subscribe`), which errors `joinCode$`. Micro-redux is
    // fail-fast, so without the socket effect's `catchError` this would kill the
    // whole store — `getState()` would throw and the REST list/mutations would
    // break. It must instead degrade silently: the store stays alive, the REST
    // list & `available`/`error` are untouched, and only `realtimeStatus` flips.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ memories: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext({
      ...realtimeContext,
      metadata: ɵcreateMetadataRealtimeConnection({
        wsUrl: "wss://gw/client",
        fetchSubscription: async () => {
          throw new Error("boom");
        },
      }),
    });
    await flushEffects();

    // The store did NOT crash: getState()/select still work.
    expect(() => store.getState()).not.toThrow();
    // The REST-backed list settled from its own fetch, unaffected by realtime.
    expect(store.getState().memories).toEqual([]);
    expect(store.getState().available).toBe(true);
    expect(store.getState().error).toBeNull();
    // Realtime degraded to unavailable rather than getting stuck "connecting".
    expect(store.getState().realtimeStatus).toBe("unavailable");

    warn.mockRestore();
    store.stop();
  });
});

const sampleContext = {
  runtimeUrl: "https://runtime.example.com",
  headers: { Authorization: "Bearer token", "X-Cpki-User-Id": "u1" },
  metadata: null,
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

  it("appends ?includeInvalidated=true to the list URL when the context opts in", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext({ ...sampleContext, includeInvalidated: true });
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/memories?includeInvalidated=true",
      expect.objectContaining({ method: "GET" }),
    );

    store.stop();
  });

  it("surfaces a fetch failure as state.error and clears isLoading", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
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

  it("surfaces a list failure as a MemoryError carrying a stable code", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    const error = store.getState().error;
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MemoryError);
    expect((error as MemoryError).code).toBe("MEMORY_LIST_FAILED");
    expect((error as MemoryError).category).toBe("dependency");
    // 500 is transient, so retryable.
    expect((error as MemoryError).retryable).toBe(true);
    // The human-readable message (with status) is preserved.
    expect(error?.message).toBe("Failed to fetch memories: 500");

    store.stop();
  });

  it("marks a 4xx list failure as non-retryable", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    const error = store.getState().error as MemoryError;
    expect(error.code).toBe("MEMORY_LIST_FAILED");
    expect(error.retryable).toBe(false);

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

    // 2 calls: initial list GET + refresh list GET
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
      // The refresh's list pull never settles on its own: the store is
      // stopped first.
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

    const lastCall = fetchMock.mock.calls.at(-1) as [string, { body: string }];
    const body = JSON.parse(lastCall[1].body);
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

    const lastCall = fetchMock.mock.calls.at(-1) as [string, { body: string }];
    const body = JSON.parse(lastCall[1].body);
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

  // CORE: a mutation dispatched while no runtime context is configured must
  // REJECT via the "Runtime URL is not configured" failure path — it must not
  // hang waiting for a fetch that never fires (no context => no runtimeUrl).
  it("rejects a mutation with 'Runtime URL is not configured' when no context is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    // Deliberately NO setContext: there is no runtimeUrl.

    await expect(
      Promise.race([
        store.addMemory({ content: "x", kind: "topical" }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("mutation hung")), 1000),
        ),
      ]),
    ).rejects.toThrow("Runtime URL is not configured");

    // No fetch should have been attempted, and the error lands in state.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().error).toBeInstanceOf(Error);

    store.stop();
  });

  it("surfaces a mutation failure as a MemoryError carrying a stable code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    const store = await connectedStore(fetchMock);

    const rejection = await store
      .addMemory({ content: "x", kind: "topical" })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toBeInstanceOf(MemoryError);
    expect((rejection as MemoryError).code).toBe("MEMORY_MUTATION_FAILED");
    expect((rejection as MemoryError).category).toBe("dependency");
    expect((rejection as MemoryError).retryable).toBe(true);
    expect((rejection as MemoryError).message).toBe("Request failed: 500");

    // The same error lands in the `error` selector for the UI.
    const stateError = store.getState().error;
    expect(stateError).toBeInstanceOf(MemoryError);
    expect((stateError as MemoryError).code).toBe("MEMORY_MUTATION_FAILED");

    store.stop();
  });
});

test("snapshot 404 → available: false, error: null, memories: []", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 });
  vi.stubGlobal("fetch", fetchMock);

  const store = createMemoryStore(memoryEnvironment(fetchMock));
  store.start();
  store.setContext(sampleContext);
  await flushEffects();

  expect(store.getState().memories).toEqual([]);
  expect(store.getState().isLoading).toBe(false);
  expect(store.getState().error).toBeNull();
  expect(store.getState().available).toBe(false);

  store.stop();
});

test("snapshot 500 → error not null, available: true", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 });
  vi.stubGlobal("fetch", fetchMock);

  const store = createMemoryStore(memoryEnvironment(fetchMock));
  store.start();
  store.setContext(sampleContext);
  await flushEffects();

  expect(store.getState().error).not.toBeNull();
  expect(store.getState().available).toBe(true);

  store.stop();
});

// CF3: 422 is the runtime's MISSING_INTELLIGENCE (not-configured) signal — it
// must take the graceful "not available" path (listUnavailable), not a hard
// listFailed/error.
test("snapshot 422 → available: false, error: null, memories: []", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 422 });
  vi.stubGlobal("fetch", fetchMock);

  const store = createMemoryStore(memoryEnvironment(fetchMock));
  store.start();
  store.setContext(sampleContext);
  await flushEffects();

  expect(store.getState().memories).toEqual([]);
  expect(store.getState().isLoading).toBe(false);
  expect(store.getState().error).toBeNull();
  expect(store.getState().available).toBe(false);

  store.stop();
});

// 501 (route unimplemented) joins 404/422 in ROUTE_UNAVAILABLE_STATUSES — it
// must take the graceful listUnavailable path (available:false, error:null), not
// a hard listFailed/error.
test("snapshot 501 → available: false, error: null, memories: []", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 501 });
  vi.stubGlobal("fetch", fetchMock);

  const store = createMemoryStore(memoryEnvironment(fetchMock));
  store.start();
  store.setContext(sampleContext);
  await flushEffects();

  expect(store.getState().memories).toEqual([]);
  expect(store.getState().isLoading).toBe(false);
  expect(store.getState().error).toBeNull();
  expect(store.getState().available).toBe(false);

  store.stop();
});

// CF2: refresh() against an unavailable (404/501) route must SETTLE rather than
// hang — `listUnavailable` is the third terminal outcome of the list fetch.
test("refresh() against a 404 route resolves (does not hang) and leaves available:false", async () => {
  const fetchMock = vi
    .fn()
    // initial bootstrap: list unavailable
    .mockResolvedValueOnce({ ok: false, status: 404 })
    // refresh's re-pulled list: also unavailable
    .mockResolvedValueOnce({ ok: false, status: 404 });
  vi.stubGlobal("fetch", fetchMock);

  const store = createMemoryStore(memoryEnvironment(fetchMock));
  store.start();
  store.setContext(sampleContext);
  await flushEffects();

  await expect(
    Promise.race([
      store.refresh(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("refresh() hung")), 1000),
      ),
    ]),
  ).resolves.toBeUndefined();

  expect(store.getState().available).toBe(false);

  store.stop();
});

// H1: a `contextChanged` after refresh()'s `listRequested` but before the fetch
// settles tears down the list fetch (its `takeUntil(contextChanged)`) with no
// terminal list action for the captured session — refresh() must still SETTLE
// (resolve, as a superseded refresh), not hang forever.
test("refresh() resolves when a new setContext supersedes it before the fetch settles", async () => {
  let resolveSecondList: ((value: unknown) => void) | undefined;
  const fetchMock = vi
    .fn()
    // initial bootstrap: list
    .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
    // refresh's re-pulled list: never settles on its own — we drive the
    // supersede before it resolves.
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecondList = resolve;
      }),
    )
    // the new context's bootstrap (list)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) });
  vi.stubGlobal("fetch", fetchMock);

  const store = createMemoryStore(memoryEnvironment(fetchMock));
  store.start();
  store.setContext(sampleContext);
  await flushEffects();

  const pending = store.refresh();
  // Supersede with a new context before the refresh's list fetch settles.
  store.setContext({ ...sampleContext, headers: { "X-Cpki-User-Id": "u2" } });
  await flushEffects();

  await expect(
    Promise.race([
      pending,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("refresh() hung")), 1000),
      ),
    ]),
  ).resolves.toBeUndefined();

  // Tidy up the dangling first-refresh fetch promise.
  resolveSecondList?.({ ok: true, json: async () => ({ memories: [] }) });
  store.stop();
});

it("setContext stores the metadata connection alongside runtimeUrl", () => {
  const store = createMemoryStore(memoryEnvironment(vi.fn()));
  store.start();
  const metadata = ɵcreateMetadataRealtimeConnection({
    wsUrl: "wss://gw.example.com/client",
    fetchSubscription: async () => ({ joinToken: "jt-1", joinCode: "jc-1" }),
  });
  store.setContext({
    runtimeUrl: "https://runtime.example.com",
    headers: {},
    metadata,
  });
  expect(store.getState().context?.metadata).toBe(metadata);
  store.stop();
});

describe("memory selectors", () => {
  it("project the relevant state slices", () => {
    const state = memoryReducer(
      undefined,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1")],
      }),
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

describe("memory mutation session guard and error handling", () => {
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

  // A1: a mutation failing AFTER a setContext bump must not write its stale
  // error into the new session.
  test("a mutation failing after a context switch does not error the new session", () => {
    const requested = memoryReducer(
      undefined,
      memoryAdapterEvents.addRequested({
        requestId: "r1",
        input: { content: "x", kind: "topical" },
      }),
    );
    expect(requested.sessionId).toBe(0);
    expect(requested.inFlightMutationCount).toBe(1);

    const switched = memoryReducer(
      requested,
      memoryAdapterEvents.contextChanged({ context: sampleContext }),
    );
    expect(switched.sessionId).toBe(1);
    expect(switched.inFlightMutationCount).toBe(0);

    const afterStaleFailure = memoryReducer(
      switched,
      memoryRestEvents.mutationFinished({
        outcome: {
          requestId: "r1",
          sessionId: 0,
          ok: false,
          error: new Error("stale failure"),
        },
      }),
    );

    expect(afterStaleFailure.error).toBeNull();
    expect(afterStaleFailure.inFlightMutationCount).toBe(0);
  });

  // RC2: a successful mutation clears a previously surfaced mutation error.
  test("a successful mutation clears a prior sticky error", () => {
    const withError = memoryReducer(
      undefined,
      memoryRestEvents.mutationFinished({
        outcome: {
          requestId: "r1",
          sessionId: 0,
          ok: false,
          error: new Error("boom"),
        },
      }),
    );
    expect(withError.error).toBeInstanceOf(Error);

    const cleared = memoryReducer(
      withError,
      memoryRestEvents.mutationFinished({
        outcome: { requestId: "r2", sessionId: 0, ok: true, memory: null },
      }),
    );

    expect(cleared.error).toBeNull();
  });

  // A4: a successful list proves the route is available.
  test("listSucceeded sets available:true", () => {
    const unavailable = memoryReducer(
      undefined,
      memoryRestEvents.listUnavailable({ sessionId: 0 }),
    );
    expect(unavailable.available).toBe(false);

    const next = memoryReducer(
      unavailable,
      memoryRestEvents.listSucceeded({
        sessionId: 0,
        memories: [memory("m1")],
      }),
    );

    expect(ɵselectMemoriesAvailable(next)).toBe(true);
  });

  // A5: concurrent mutations — the count stays > 0 until both settle, and a
  // context switch resets it.
  test("inFlightMutationCount tracks concurrent mutations and resets on contextChanged", () => {
    let state = memoryReducer(
      undefined,
      memoryAdapterEvents.addRequested({
        requestId: "r1",
        input: { content: "a", kind: "topical" },
      }),
    );
    state = memoryReducer(
      state,
      memoryAdapterEvents.addRequested({
        requestId: "r2",
        input: { content: "b", kind: "topical" },
      }),
    );
    expect(state.inFlightMutationCount).toBe(2);
    expect(ɵselectMemoriesIsMutating(state)).toBe(true);

    state = memoryReducer(
      state,
      memoryRestEvents.mutationFinished({
        outcome: { requestId: "r1", sessionId: 0, ok: true, memory: null },
      }),
    );
    expect(state.inFlightMutationCount).toBe(1);
    expect(ɵselectMemoriesIsMutating(state)).toBe(true);

    const reset = memoryReducer(
      state,
      memoryAdapterEvents.contextChanged({ context: sampleContext }),
    );
    expect(reset.inFlightMutationCount).toBe(0);
    expect(ɵselectMemoriesIsMutating(reset)).toBe(false);
  });

  test("stopped resets inFlightMutationCount", () => {
    const requested = memoryReducer(
      undefined,
      memoryAdapterEvents.removeRequested({ requestId: "r1", id: "m1" }),
    );
    expect(requested.inFlightMutationCount).toBe(1);

    const stopped = memoryReducer(requested, memoryAdapterEvents.stopped());

    expect(stopped.inFlightMutationCount).toBe(0);
  });

  // CORE-6a: `stopped` must reset `available` back to its default (`true`),
  // matching `contextChanged`. Otherwise a `stop()` then `start()` WITHOUT a new
  // `setContext` retains a stale `available: false` from a prior unconfigured
  // session.
  test("stopped resets available back to true", () => {
    const unavailable = memoryReducer(
      undefined,
      memoryRestEvents.listUnavailable({ sessionId: 0 }),
    );
    expect(unavailable.available).toBe(false);

    const stopped = memoryReducer(unavailable, memoryAdapterEvents.stopped());

    expect(ɵselectMemoriesAvailable(stopped)).toBe(true);
  });

  // A3: a supersede response without retiredId must reject (no duplicate).
  test("updateMemory rejects when the supersede response omits retiredId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memories: [userMemory("m1", "old")] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        // No retiredId on the response.
        json: async () => ({ ...userMemory("m2", "new") }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    await expect(
      store.updateMemory("m1", { content: "new", kind: "topical" }),
    ).rejects.toThrow("missing retiredId");

    // The old memory remains; the new one was NOT inserted as a duplicate.
    expect(store.getState().memories.map((m) => m.id)).toEqual(["m1"]);

    store.stop();
  });

  // H2: a create whose 200 body omits `id` must reject and must not upsert a
  // corrupt Memory with undefined fields into state.
  test("addMemory rejects when the create response omits id (no corrupt memory)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        // No `id` on the response.
        json: async () => ({
          kind: "topical",
          scope: "user",
          content: "hi",
          sourceThreadIds: [],
          invalidatedAt: null,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    await expect(
      store.addMemory({ content: "hi", kind: "topical" }),
    ).rejects.toThrow("missing/invalid id");

    expect(store.getState().memories).toEqual([]);

    store.stop();
  });

  // CORE-2: a create whose 200 body carries a non-array `sourceThreadIds` must
  // reject — `Memory.sourceThreadIds` is `readonly string[]`, so a non-array
  // would otherwise corrupt state with a Memory whose field is undefined/wrong.
  test("addMemory rejects when the create response has a non-array sourceThreadIds (no corrupt memory)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        // `sourceThreadIds` is missing (effectively non-array / undefined).
        json: async () => ({
          id: "m1",
          kind: "topical",
          scope: "user",
          content: "hi",
          invalidatedAt: null,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    await expect(
      store.addMemory({ content: "hi", kind: "topical" }),
    ).rejects.toThrow("missing/invalid sourceThreadIds");

    expect(store.getState().memories).toEqual([]);

    store.stop();
  });

  // H2: an invalid `kind` is rejected the same way.
  test("addMemory rejects when the create response has an invalid kind", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ memories: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "m1",
          kind: "bogus",
          scope: "user",
          content: "hi",
          sourceThreadIds: [],
          invalidatedAt: null,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const store = createMemoryStore(memoryEnvironment(fetchMock));
    store.start();
    store.setContext(sampleContext);
    await flushEffects();

    await expect(
      store.addMemory({ content: "hi", kind: "topical" }),
    ).rejects.toThrow("missing/invalid kind");

    expect(store.getState().memories).toEqual([]);

    store.stop();
  });
});

// A11: getServerState returns an empty, stable, render-safe state for SSR.
test("getServerState returns the empty initial state and is stable", () => {
  const store = createMemoryStore(memoryEnvironment(vi.fn()));

  const serverState = store.getServerState();

  expect(serverState.memories).toEqual([]);
  expect(serverState.isLoading).toBe(false);
  expect(serverState.error).toBeNull();
  expect(serverState.inFlightMutationCount).toBe(0);
  // Stable reference across calls so React's useSyncExternalStore does not loop.
  expect(store.getServerState()).toBe(serverState);
});
