import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { MockChannel } from "./test-utils";
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
  ɵselectIsMutating,
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

function createEnvironment(fetchImpl: Mock) {
  return {
    fetch: fetchImpl as unknown as typeof fetch,
  };
}

function getChannel(): MockChannel {
  const channel = phoenix.sockets[0]?.channels[0];
  if (!channel) {
    throw new Error("expected a phoenix channel to exist");
  }
  return channel;
}

function getFetchCall(fetchMock: Mock, index: number) {
  const call = fetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`expected fetch call at index ${index}`);
  }
  return call;
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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
    expect(getChannel().topic).toBe("user_meta:jc-1");
  });

  it("uses the thread environment fetch instead of global fetch", async () => {
    const globalFetch = vi.fn(async () => {
      throw new Error("global fetch should not be used");
    });
    const environmentFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        threads: [sampleThreads[0]],
        joinCode: null,
      }),
    });
    vi.stubGlobal("fetch", globalFetch);

    const store = ɵcreateThreadStore(createEnvironment(environmentFetch));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      agentId: "agent-1",
    });

    await flushEffects();

    expect(globalFetch).not.toHaveBeenCalled();
    expect(environmentFetch).toHaveBeenCalledWith(
      "https://runtime.example.com/threads?agentId=agent-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual(
      ["thread-1"],
    );
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    const channel = getChannel();
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    getChannel().serverPush("thread_metadata", {
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

  it("notifies run-activity subscribers without mutating the thread list", async () => {
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    const notifications: import("../threads").ThreadRunActivityNotification[] =
      [];
    const subscription = store.subscribeToRunActivity!((notification) => {
      notifications.push(notification);
    });
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    const threadsBefore = ɵselectThreads(store.getState());
    getChannel().serverPush("thread_run_activity", {
      thread_id: "thread-1",
      agent_id: "agent-1",
      run_id: "run-1",
      event_type: "text_message_content",
      latest_event_id: "event-1",
    });

    await flushEffects();

    expect(notifications).toEqual([
      {
        type: "thread_run_activity",
        threadId: "thread-1",
        agentId: "agent-1",
        runId: "run-1",
        eventType: "text_message_content",
        latestEventId: "event-1",
      },
    ]);
    expect(ɵselectThreads(store.getState())).toBe(threadsBefore);
    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual(
      ["thread-2", "thread-1"],
    );

    subscription.unsubscribe();
  });

  it("switches sessions when context changes and ignores stale results", async () => {
    let resolveFirstFetch: (value: unknown) => void = () => {};
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    resolveFirstFetch({
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    const renameCall = getFetchCall(fetchMock, 2);
    expect(renameCall[0]).toBe("https://runtime.example.com/threads/thread-1");
    expect(renameCall[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(renameCall[1].body)).toMatchObject({
      agentId: "agent-1",
      name: "Renamed",
    });

    const archiveCall = getFetchCall(fetchMock, 3);
    expect(archiveCall[0]).toBe(
      "https://runtime.example.com/threads/thread-2/archive",
    );
    expect(JSON.parse(archiveCall[1].body)).toMatchObject({
      agentId: "agent-1",
    });

    const deleteCall = getFetchCall(fetchMock, 4);
    expect(deleteCall[0]).toBe("https://runtime.example.com/threads/thread-2");
    expect(deleteCall[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(deleteCall[1].body)).toMatchObject({
      agentId: "agent-1",
    });
  });

  it("unarchives a thread via a PATCH with archived:false", async () => {
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: { Authorization: "Bearer token" },
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });

    await flushEffects();

    await store.unarchiveThread("thread-2");

    const unarchiveCall = getFetchCall(fetchMock, 2);
    expect(unarchiveCall[0]).toBe(
      "https://runtime.example.com/threads/thread-2",
    );
    expect(unarchiveCall[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(unarchiveCall[1].body)).toMatchObject({
      agentId: "agent-1",
      archived: false,
    });
  });

  it("stores fetch failures in error state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

  it("records a failed fetch-more on fetchMoreError (not error) and preserves the list; a later success clears it", async () => {
    const { ɵselectFetchMoreError } = await import("../threads");
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
      // initial list
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
          joinCode: "jc-1",
          nextCursor: "cursor-abc",
        }),
      })
      // metadata credentials
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      // first fetch-more: FAILS
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
      // retried fetch-more: SUCCEEDS
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: [page2Thread], nextCursor: null }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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
    expect(ɵselectThreads(store.getState())).toHaveLength(2);
    expect(ɵselectHasNextPage(store.getState())).toBe(true);

    // Failed fetch-more.
    store.fetchNextPage();
    await flushEffects();

    // The failure lands on the dedicated fetch-more channel, NOT `error`, and
    // the already-loaded list is preserved.
    expect(ɵselectFetchMoreError(store.getState())).toBeInstanceOf(Error);
    expect(ɵselectThreadsError(store.getState())).toBeNull();
    expect(ɵselectThreads(store.getState())).toHaveLength(2);
    expect(ɵselectIsFetchingNextPage(store.getState())).toBe(false);
    // A failed fetch-more keeps the cursor so the load can be retried.
    expect(ɵselectHasNextPage(store.getState())).toBe(true);

    // Successful retry clears the fetch-more error and appends the page.
    store.fetchNextPage();
    await flushEffects();

    expect(ɵselectFetchMoreError(store.getState())).toBeNull();
    expect(ɵselectThreads(store.getState())).toHaveLength(3);
    expect(ɵselectHasNextPage(store.getState())).toBe(false);
  });

  it("clears a lingering fetchMoreError when a full list refetch succeeds", async () => {
    const { ɵselectFetchMoreError } = await import("../threads");
    const fetchMock = vi
      .fn()
      // initial list
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
          joinCode: "jc-1",
          nextCursor: "cursor-abc",
        }),
      })
      // metadata credentials
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      // fetch-more: FAILS
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
      // full refetch: SUCCEEDS
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    // Fetch-more fails → error lands on the dedicated channel.
    store.fetchNextPage();
    await flushEffects();
    expect(ɵselectFetchMoreError(store.getState())).toBeInstanceOf(Error);

    // A full refetch (e.g. filter-change / retry) replaces the list; the stale
    // fetch-more banner must NOT survive onto the fresh list.
    store.refetchThreads();
    await flushEffects();
    expect(ɵselectFetchMoreError(store.getState())).toBeNull();
    expect(ɵselectThreads(store.getState())).toHaveLength(2);
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    const channel = getChannel();
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
    expect(ɵselectThreads(store.getState())[0]?.id).toBe("thread-2");
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    const channel = getChannel();
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

  it("optimistically removes a thread on delete, before the server responds", async () => {
    let resolveDelete: (value: unknown) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveDelete = resolve)),
      );
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    const deletePromise = store.deleteThread("thread-1");
    await flushEffects();

    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual(
      ["thread-2"],
    );
    expect(ɵselectIsMutating(store.getState())).toBe(true);

    resolveDelete({ ok: true, json: async () => ({}) });
    await deletePromise;
    await flushEffects();

    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual(
      ["thread-2"],
    );
    expect(ɵselectIsMutating(store.getState())).toBe(false);
  });

  it("rolls back an optimistically-deleted thread when the server rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    await expect(store.deleteThread("thread-1")).rejects.toThrow();
    await flushEffects();

    // The optimistically-removed row is restored.
    const ids = ɵselectThreads(store.getState())
      .map((thread) => thread.id)
      .sort();
    expect(ids).toEqual(["thread-1", "thread-2"]);
    expect(ɵselectThreadsError(store.getState())?.message).toContain("500");
    expect(ɵselectIsMutating(store.getState())).toBe(false);
  });

  it("does NOT roll back a rejected rename (optimistic no-rollback)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    await expect(
      store.renameThread("thread-1", "Optimistic"),
    ).rejects.toThrow();
    await flushEffects();

    // Row stays renamed locally; only the error surfaces.
    const renamed = ɵselectThreads(store.getState()).find(
      (thread) => thread.id === "thread-1",
    );
    expect(renamed?.name).toBe("Optimistic");
    expect(ɵselectThreadsError(store.getState())?.message).toContain("500");
  });

  it("invokes the onError environment callback on a rejected mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const onError = vi.fn();
    const store = ɵcreateThreadStore({
      fetch: fetchMock as unknown as typeof fetch,
      onError,
    });
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    await expect(store.deleteThread("thread-1")).rejects.toThrow();
    await flushEffects();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("startNewThread does not add a phantom row and clears any error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    // The failed initial fetch leaves an error behind.
    expect(ɵselectThreadsError(store.getState())).not.toBeNull();

    store.startNewThread();

    expect(ɵselectThreads(store.getState())).toHaveLength(0);
    expect(ɵselectThreadsError(store.getState())).toBeNull();
  });

  it("refetchThreads re-fetches the list without clearing it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: [sampleThreads[0]] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    store.refetchThreads();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/threads?agentId=agent-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(ɵselectThreads(store.getState())).toHaveLength(1);
  });

  it("drops a mutation that rejects after the context changed (no stale-session error)", async () => {
    let resolveDelete: (value: unknown) => void = () => {};
    const fetchMock = vi
      .fn()
      // session 1: initial list + subscribe
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      // session 1: the DELETE — left pending until after the context switches
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveDelete = resolve)),
      )
      // session 2 (after contextChanged): new list + subscribe
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
        json: async () => ({ joinToken: "jt-2" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const onError = vi.fn();
    const store = ɵcreateThreadStore({
      fetch: fetchMock as unknown as typeof fetch,
      onError,
    });
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    const deletePromise = store.deleteThread("thread-1");
    await flushEffects();

    // Switch context BEFORE the delete resolves — this opens session 2.
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-2",
    });
    await flushEffects();

    // Now reject the session-1 delete.
    resolveDelete({ ok: false, status: 500 });
    await expect(deletePromise).rejects.toThrow();
    await flushEffects();

    // The new session is intact: no error leaked, onError never fired, and the
    // stale deleted row is NOT rolled back into the new list.
    expect(ɵselectThreadsError(store.getState())).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual(
      ["thread-next"],
    );
  });

  it("isolates selector memo caches across concurrent stores", async () => {
    // Route a single stub by request host so both concurrent stores share the
    // same deterministic environment fetch while receiving distinct lists.
    const routedFetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      const id = href.includes("a.example.com") ? "thread-a" : "thread-b";
      return {
        ok: true,
        json: async () => ({
          threads: [{ ...sampleThreads[0], id }],
          joinCode: "jc",
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", routedFetch);

    const env = createEnvironment(routedFetch as unknown as Mock);
    const storeA = ɵcreateThreadStore(env);
    const storeB = ɵcreateThreadStore(env);
    stores.push(storeA, storeB);

    storeA.start();
    storeB.start();
    storeA.setContext({
      runtimeUrl: "https://a.example.com",
      headers: {},
      agentId: "agent-1",
    });
    storeB.setContext({
      runtimeUrl: "https://b.example.com",
      headers: {},
      agentId: "agent-1",
    });
    await flushEffects();

    // Each store exposes its own selector bundle, distinct from the other.
    expect(storeA.selectors).not.toBe(storeB.selectors);
    expect(storeA.selectors.threads).not.toBe(storeB.selectors.threads);

    // A per-store selector returns the SAME reference on repeated reads of the
    // same state (memo hit) and is not corrupted by the other store's state.
    const aThreads1 = storeA.selectors.threads(storeA.getState());
    const aThreads2 = storeA.selectors.threads(storeA.getState());
    expect(aThreads1).toBe(aThreads2);
    expect(aThreads1.map((thread) => thread.id)).toEqual(["thread-a"]);

    // Reading store B through B's selector does not evict A's cache: A's
    // selector still returns A's memoized reference afterwards.
    storeB.selectors.threads(storeB.getState());
    expect(storeA.selectors.threads(storeA.getState())).toBe(aThreads1);
    expect(
      storeB.selectors.threads(storeB.getState()).map((thread) => thread.id),
    ).toEqual(["thread-b"]);
  });

  it("warns and keeps the list on a realtime channel join failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
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

    getChannel().triggerJoin("error", { reason: "unauthorized" });
    await flushEffects();

    // Non-fatal: the (already fetched) list survives, no hard list error, but a
    // diagnostic warning is emitted so the failure is not silent.
    expect(ɵselectThreadsError(store.getState())).toBeNull();
    expect(ɵselectThreads(store.getState())).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("realtime"));

    warnSpy.mockRestore();
  });

  it("keeps the list and warns when the realtime metadata-credentials fetch fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      // The realtime join-token fetch (runs after the list) fails.
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    // Non-fatal: the realtime credential fetch ran after a successful list, so
    // the already-loaded list survives, no hard list error is set, but the
    // failure is surfaced as a diagnostic warning.
    expect(ɵselectThreads(store.getState()).length).toBeGreaterThan(0);
    expect(ɵselectThreadsError(store.getState())).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("realtime"));

    warnSpy.mockRestore();
  });

  it("retries realtime metadata credentials after a failed credential fetch", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-2" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    store.refetchThreads();
    await flushEffects();

    expect(
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.endsWith("/threads/subscribe")),
    ).toEqual([
      "https://runtime.example.com/threads/subscribe",
      "https://runtime.example.com/threads/subscribe",
    ]);
    expect(phoenix.sockets).toHaveLength(1);
    expect(getChannel().topic).toBe("user_meta:jc-1");

    warnSpy.mockRestore();
  });

  it("refreshes realtime metadata credentials when a refetch rotates the join code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: sampleThreads, joinCode: "jc-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ joinToken: "jt-2" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      agentId: "agent-1",
    });
    await flushEffects();

    store.refetchThreads();
    await flushEffects();

    expect(
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.endsWith("/threads/subscribe")),
    ).toEqual([
      "https://runtime.example.com/threads/subscribe",
      "https://runtime.example.com/threads/subscribe",
    ]);
    expect(phoenix.sockets).toHaveLength(2);
    expect(phoenix.sockets[0]?.channels[0]?.topic).toBe("user_meta:jc-1");
    expect(phoenix.sockets[1]?.channels[0]?.topic).toBe("user_meta:jc-2");
  });

  it("exposes a stable empty server snapshot for SSR", () => {
    const fetchMock = vi.fn();
    const store = ɵcreateThreadStore(createEnvironment(fetchMock));
    stores.push(store);

    const serverState = store.getServerState();

    expect(ɵselectThreads(serverState)).toEqual([]);
    expect(ɵselectThreadsIsLoading(serverState)).toBe(false);
    expect(ɵselectThreadsError(serverState)).toBeNull();
    // Stable reference across calls so useSyncExternalStore does not loop.
    expect(store.getServerState()).toBe(serverState);
    // fetch is never touched during prerender.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
