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
type ThreadRuntimeContext = import("../threads").ɵThreadRuntimeContext;

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

  it("does not subscribe to realtime metadata when the endpoint is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        threads: sampleThreads,
        joinCode: "jc-1",
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
      threadEndpoints: {
        realtimeMetadata: false,
      },
    });

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://runtime.example.com/threads/subscribe",
      expect.anything(),
    );
    expect(phoenix.sockets).toHaveLength(0);
  });

  it("ignores realtime upserts for other agents", async () => {
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
      operation: "created",
      threadId: "thread-other",
      userId: "user-1",
      organizationId: "org-1",
      occurredAt: "2026-01-03T00:00:00Z",
      thread: {
        ...sampleThreads[0],
        id: "thread-other",
        agentId: "agent-2",
      },
    });

    await flushEffects();

    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual(
      ["thread-2", "thread-1"],
    );
  });

  it("retries realtime credential fetches after a failed subscribe request", async () => {
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
        ok: false,
        status: 503,
      })
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

    expect(ɵselectThreadsError(store.getState())?.message).toContain("503");

    store.refresh();
    await flushEffects();

    const subscribeCalls = fetchMock.mock.calls.filter(
      ([url]) => url === "https://runtime.example.com/threads/subscribe",
    );
    expect(subscribeCalls).toHaveLength(2);
    expect(phoenix.sockets).toHaveLength(1);
    expect(ɵselectThreadsError(store.getState())).toBeNull();
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

  it("treats the same context reference as unchanged and a new object as a reset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        threads: sampleThreads,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();

    const context: ThreadRuntimeContext = {
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-1",
    };

    store.setContext(context);
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ɵselectThreads(store.getState())).toHaveLength(2);

    store.setContext(context);
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ɵselectThreads(store.getState())).toHaveLength(2);

    store.setContext({ ...context });

    expect(ɵselectThreads(store.getState())).toEqual([]);
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(true);

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ɵselectThreads(store.getState())).toHaveLength(2);
  });

  it("clears context on stop so restarting with the same context ref fetches again", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        threads: sampleThreads,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    const context: ThreadRuntimeContext = {
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-1",
    };

    store.start();
    store.setContext(context);
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    store.stop();
    store.start();
    store.setContext(context);
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the injected fetch implementation instead of global fetch", async () => {
    const globalFetch = vi.fn().mockRejectedValue(new Error("global fetch"));
    vi.stubGlobal("fetch", globalFetch);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        threads: sampleThreads,
      }),
    });

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-1",
    });

    await flushEffects();
    await store.renameThread("thread-1", "Renamed");

    expect(globalFetch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ɵselectThreadsError(store.getState())).toBeNull();
  });

  it("passes configured credentials to list, subscribe, pagination, and mutation requests", async () => {
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
        json: async () => ({
          joinToken: "jt-1",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [],
          nextCursor: null,
        }),
      })
      .mockResolvedValueOnce({
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
      headers: {},
      credentials: "include",
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();
    store.fetchNextPage();
    await flushEffects();
    await store.renameThread("thread-1", "Renamed");

    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ credentials: "include" });
    }
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

  it("fails visibly without fetching when runtimeUrl is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as unknown as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "",
      headers: {},
      agentId: "agent-1",
    });

    await flushEffects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ɵselectThreads(store.getState())).toEqual([]);
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(false);
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "Runtime URL is not configured",
    );
  });

  it("fails visibly without fetching when the list endpoint is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as unknown as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-1",
      threadEndpoints: {
        list: false,
      },
    });

    await flushEffects();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ɵselectThreads(store.getState())).toEqual([]);
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(false);
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "Thread endpoints are not available on this CopilotKit runtime",
    );
  });

  it("keeps undefined endpoint capabilities legacy-compatible", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
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
      agentId: "agent-1",
      threadEndpoints: undefined,
    });

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/threads?agentId=agent-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(ɵselectThreads(store.getState())).toHaveLength(2);
    expect(ɵselectThreadsError(store.getState())).toBeNull();
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

  it("clears a stale pagination error after a successful fetchMoreThreads retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
          nextCursor: "cursor-abc",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [],
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
      agentId: "agent-1",
    });

    await flushEffects();
    store.fetchNextPage();
    await flushEffects();

    expect(ɵselectThreadsError(store.getState())?.message).toContain("500");

    store.fetchNextPage();
    await flushEffects();

    expect(ɵselectThreadsError(store.getState())).toBeNull();
    expect(ɵselectIsFetchingNextPage(store.getState())).toBe(false);
  });

  it("does not fetch more threads when no next cursor is available", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ threads: sampleThreads, nextCursor: null }),
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
      agentId: "agent-1",
    });

    await flushEffects();

    store.fetchNextPage();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ɵselectIsFetchingNextPage(store.getState())).toBe(false);
  });

  it("does not start a duplicate fetchMoreThreads request while already fetching", async () => {
    let resolveNextPage: ((value: unknown) => void) | null = null;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
          nextCursor: "cursor-abc",
        }),
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNextPage = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-1",
      limit: 2,
    });

    await flushEffects();

    store.fetchNextPage();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ɵselectIsFetchingNextPage(store.getState())).toBe(true);

    store.fetchNextPage();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveNextPage?.({
      ok: true,
      json: async () => ({
        threads: [],
        nextCursor: null,
      }),
    });
    await flushEffects();
  });

  it("rejects mutations and records an error when mutation endpoints are disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ threads: sampleThreads }),
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
      agentId: "agent-1",
      threadEndpoints: {
        list: true,
        mutations: false,
      },
    });

    await flushEffects();

    await expect(store.renameThread("thread-1", "Renamed")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );
    await expect(store.archiveThread("thread-1")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );
    await expect(store.deleteThread("thread-1")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "Thread mutations are not available on this CopilotKit runtime",
    );
  });

  it("captures mutation context before synchronous context changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [
            {
              ...sampleThreads[0],
              id: "thread-agent-2",
              agentId: "agent-2",
            },
          ],
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
      agentId: "agent-1",
    });

    await flushEffects();

    const mutation = store.renameThread("thread-1", "Renamed");
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-2",
    });

    await mutation;
    await flushEffects();

    const renameCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "https://runtime.example.com/threads/thread-1" &&
        init?.method === "PATCH",
    );
    expect(renameCall).toBeDefined();
    expect(JSON.parse(renameCall![1].body)).toMatchObject({
      agentId: "agent-1",
      name: "Renamed",
    });
  });

  it("applies successful mutations locally when realtime metadata is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads }),
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
      headers: {},
      agentId: "agent-1",
      threadEndpoints: {
        realtimeMetadata: false,
      },
    });

    await flushEffects();

    await store.renameThread("thread-1", "Renamed");
    expect(ɵselectThreads(store.getState())).toContainEqual(
      expect.objectContaining({ id: "thread-1", name: "Renamed" }),
    );
    expect(ɵselectThreadsError(store.getState())).toBeNull();

    await store.archiveThread("thread-1");
    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual(
      ["thread-2"],
    );

    await store.deleteThread("thread-2");
    expect(ɵselectThreads(store.getState())).toEqual([]);
  });

  it("rejects mutation failures and records the error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
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
      agentId: "agent-1",
    });

    await flushEffects();

    await expect(store.renameThread("thread-1", "Renamed")).rejects.toThrow(
      "Request failed: 503",
    );
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "Request failed: 503",
    );
  });

  it("rejects timed-out mutations instead of leaving callers pending forever", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads }),
      })
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(
      createEnvironment(fetchMock as typeof fetch),
    );
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-1",
    });

    await flushEffects();

    vi.useFakeTimers();
    try {
      const mutation = store.renameThread("thread-1", "Renamed");
      const rejection = expect(mutation).rejects.toThrow("Request timed out");
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not apply mutation failures to a newer context session", async () => {
    let rejectMutation: ((error: unknown) => void) | null = null;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads }),
      })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectMutation = reject;
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
            },
          ],
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
      agentId: "agent-1",
    });

    await flushEffects();

    const mutation = store.renameThread("thread-1", "Renamed");
    await flushEffects();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-2",
    });
    rejectMutation?.(new Error("stale mutation failed"));

    await expect(mutation).rejects.toThrow("stale mutation failed");
    await flushEffects();

    expect(ɵselectThreads(store.getState())).toEqual([
      expect.objectContaining({
        id: "thread-next",
        agentId: "agent-2",
      }),
    ]);
    expect(ɵselectThreadsError(store.getState())).toBeNull();
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
