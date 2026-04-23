import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockSocket } from "./test-utils";

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
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
  ɵselectHasNextPage,
  ɵselectIsFetchingNextPage,
} = await import("../threads");

type ThreadRecord = import("../threads").ɵThread;

const flushEffects = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const sampleThreads: ThreadRecord[] = [
  {
    id: "thread-1",
    organizationId: "org-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "Older Thread",
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "thread-2",
    organizationId: "org-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "Newest Thread",
    archived: false,
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
];

function createEnvironment(fetchImpl: typeof fetch) {
  return {
    fetch: fetchImpl,
  };
}

describe("thread store", () => {
  const stores: Array<ReturnType<typeof ɵcreateThreadStore>> = [];

  beforeEach(() => {
    phoenix.sockets.splice(0);
  });

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.stop();
    }
    vi.unstubAllGlobals();
  });

  it("bootstraps threads and sorts them by updatedAt descending", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [sampleThreads[0], sampleThreads[1]],
          joinCode: "jc-1",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-1",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: { Authorization: "Bearer token" },
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/threads?agentId=agent-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/threads/subscribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual(
      ["thread-2", "thread-1"],
    );
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(false);
    expect(phoenix.sockets).toHaveLength(1);
    expect(phoenix.sockets[0].channels[0].topic).toBe("user_meta:jc-1");
  });

  it("upserts realtime thread metadata without refetching", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
          joinCode: "jc-1",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-1",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    const channel = phoenix.sockets[0].channels[0];
    channel.serverPush("thread_metadata", {
      operation: "renamed",
      threadId: "thread-1",
      userId: "user-1",
      organizationId: "org-1",
      occurredAt: "2026-01-03T00:00:00Z",
      thread: {
        ...sampleThreads[0],
        name: "Renamed Thread",
        updatedAt: "2026-01-03T00:00:00Z",
      },
    });

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ɵselectThreads(store.getState())[0]).toMatchObject({
      id: "thread-1",
      name: "Renamed Thread",
    });
  });

  it("applies realtime events without client-side user filtering", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
          joinCode: "jc-1",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-1",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    phoenix.sockets[0].channels[0].serverPush("thread_metadata", {
      operation: "deleted",
      threadId: "thread-2",
      userId: "user-2",
      organizationId: "org-1",
      occurredAt: "2026-01-03T00:00:00Z",
      deleted: { id: "thread-2" },
    });

    await flushEffects();

    expect(ɵselectThreads(store.getState())).toHaveLength(1);
  });

  it("switches sessions when context changes and ignores stale results", async () => {
    let resolveFirstFetch: ((value: unknown) => void) | null = null;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstFetch = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [
            {
              ...sampleThreads[0],
              id: "thread-next",
              agentId: "agent-2",
              updatedAt: "2026-02-01T00:00:00Z",
            },
          ],
          joinCode: "jc-2",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-2",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-2",
    });

    resolveFirstFetch?.({
      ok: true,
      json: async () => ({
        threads: sampleThreads,
      }),
    });

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(ɵselectThreads(store.getState())).toEqual([
      expect.objectContaining({
        id: "thread-next",
        agentId: "agent-2",
      }),
    ]);
  });

  it("sends rename, archive, and delete requests with agentId only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
          joinCode: "jc-1",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-1",
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: { Authorization: "Bearer token" },
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    await store.renameThread("thread-1", "Renamed");
    await store.archiveThread("thread-2");
    await store.deleteThread("thread-2");

    const renameCall = fetchMock.mock.calls[2];
    expect(renameCall[0]).toBe("https://runtime.example.com/threads/thread-1");
    expect(renameCall[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(renameCall[1].body)).toMatchObject({
      agentId: "agent-1",
      name: "Renamed",
    });

    const archiveCall = fetchMock.mock.calls[3];
    expect(archiveCall[0]).toBe(
      "https://runtime.example.com/threads/thread-2/archive",
    );
    expect(JSON.parse(archiveCall[1].body)).toMatchObject({
      agentId: "agent-1",
    });

    const deleteCall = fetchMock.mock.calls[4];
    expect(deleteCall[0]).toBe("https://runtime.example.com/threads/thread-2");
    expect(deleteCall[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(deleteCall[1].body)).toMatchObject({
      agentId: "agent-1",
    });
  });

  it("stores fetch failures in error state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    expect(ɵselectThreadsError(store.getState())?.message).toContain("500");
  });

  it("passes includeArchived=true as a query param when set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
      includeArchived: true,
    });

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("includeArchived=true"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("passes limit as a query param when set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
      limit: 10,
    });

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("limit=10"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("tracks nextCursor and fetches next page", async () => {
    const page2Thread: ThreadRecord = {
      id: "thread-3",
      organizationId: "organization-1",
      agentId: "agent-1",
      createdById: "user-1",
      name: "Page 2 Thread",
      archived: false,
      createdAt: "2025-12-01T00:00:00Z",
      updatedAt: "2025-12-01T00:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
          joinCode: "jc-1",
          nextCursor: "cursor-abc",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [page2Thread],
          nextCursor: null,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
      limit: 2,
    });

    await flushEffects();

    expect(ɵselectHasNextPage(store.getState())).toBe(true);
    expect(ɵselectThreads(store.getState())).toHaveLength(2);

    store.fetchNextPage();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("cursor=cursor-abc"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(ɵselectThreads(store.getState())).toHaveLength(3);
    expect(ɵselectHasNextPage(store.getState())).toBe(false);
    expect(ɵselectIsFetchingNextPage(store.getState())).toBe(false);
  });

  it("removes thread on archived WS event when includeArchived is false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();
    expect(ɵselectThreads(store.getState())).toHaveLength(2);

    const channel = phoenix.sockets[0].channels[0];
    channel.serverPush("thread_metadata", {
      operation: "archived",
      threadId: "thread-1",
      userId: "user-1",
      organizationId: "organization-1",
      occurredAt: "2026-01-03T00:00:00Z",
      thread: { ...sampleThreads[0], archived: true },
    });

    await flushEffects();

    expect(ɵselectThreads(store.getState())).toHaveLength(1);
    expect(ɵselectThreads(store.getState())[0].id).toBe("thread-2");
  });

  it("keeps thread on archived WS event when includeArchived is true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
      includeArchived: true,
    });

    await flushEffects();
    expect(ɵselectThreads(store.getState())).toHaveLength(2);

    const channel = phoenix.sockets[0].channels[0];
    channel.serverPush("thread_metadata", {
      operation: "archived",
      threadId: "thread-1",
      userId: "user-1",
      organizationId: "organization-1",
      occurredAt: "2026-01-03T00:00:00Z",
      thread: {
        ...sampleThreads[0],
        archived: true,
        updatedAt: "2026-01-03T00:00:00Z",
      },
    });

    await flushEffects();

    expect(ɵselectThreads(store.getState())).toHaveLength(2);
    expect(ɵselectThreads(store.getState())[0]).toMatchObject({
      id: "thread-1",
      archived: true,
    });
  });

  it("sorts by lastRunAt when present, falling back to updatedAt", async () => {
    // thread-newest-run: oldest updatedAt, but most recent lastRunAt → should sort first
    // thread-recent-meta: newer updatedAt, no lastRunAt → second (by updatedAt)
    // thread-stale: oldest updatedAt, no lastRunAt → last
    // This simulates the "archive bumps updatedAt" scenario: lastRunAt reflects
    // actual agent activity, so ordering stays stable across metadata-only edits.
    const mixedThreads: ThreadRecord[] = [
      {
        id: "thread-stale",
        organizationId: "org-1",
        agentId: "agent-1",
        createdById: "user-1",
        name: "Stale",
        archived: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "thread-recent-meta",
        organizationId: "org-1",
        agentId: "agent-1",
        createdById: "user-1",
        name: "Recent metadata edit",
        archived: true,
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-04-20T10:00:00Z",
      },
      {
        id: "thread-newest-run",
        organizationId: "org-1",
        agentId: "agent-1",
        createdById: "user-1",
        name: "Newest run",
        archived: false,
        createdAt: "2026-01-03T00:00:00Z",
        updatedAt: "2026-01-05T00:00:00Z",
        lastRunAt: "2026-04-21T12:00:00Z",
      },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: mixedThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
      includeArchived: true,
    });

    await flushEffects();

    const ids = ɵselectThreads(store.getState()).map((thread) => thread.id);
    expect(ids).toEqual([
      "thread-newest-run", // lastRunAt 2026-04-21
      "thread-recent-meta", // no lastRunAt, updatedAt 2026-04-20
      "thread-stale", // no lastRunAt, updatedAt 2026-01-01
    ]);
  });
});
