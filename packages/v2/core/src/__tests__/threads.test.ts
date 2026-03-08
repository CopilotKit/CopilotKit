import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
  type ɵThread as ThreadRecord,
  type ɵThreadEnvironment as ThreadEnvironment,
} from "../threads";

const flushEffects = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

class MockPush {
  private callbacks = new Map<string, (payload?: unknown) => void>();

  receive(status: string, callback: (payload?: unknown) => void): MockPush {
    this.callbacks.set(status, callback);
    return this;
  }

  trigger(status: string, payload?: unknown): void {
    this.callbacks.get(status)?.(payload);
  }
}

class MockChannel {
  topic: string;
  params: Record<string, unknown>;
  left = false;
  private handlers = new Map<string, Array<(payload: unknown) => void>>();
  private joinPush = new MockPush();

  constructor(topic: string, params: Record<string, unknown> = {}) {
    this.topic = topic;
    this.params = params;
  }

  on(event: string, callback: (payload: unknown) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }

    this.handlers.get(event)!.push(callback);
  }

  join(): MockPush {
    return this.joinPush;
  }

  leave(): void {
    this.left = true;
  }

  serverPush(event: string, payload: unknown): void {
    for (const callback of this.handlers.get(event) ?? []) {
      callback(payload);
    }
  }

  triggerJoin(status: "ok" | "error" | "timeout", payload?: unknown): void {
    this.joinPush.trigger(status, payload);
  }
}

class MockSocket {
  static instances: MockSocket[] = [];

  connected = false;
  disconnected = false;
  channels: MockChannel[] = [];
  private errorCallbacks: Array<() => void> = [];
  private openCallbacks: Array<() => void> = [];

  constructor(
    _url: string,
    _options: {
      params: Record<string, unknown>;
      reconnectAfterMs: (tries: number) => number;
      rejoinAfterMs: (tries: number) => number;
    },
  ) {
    MockSocket.instances.push(this);
  }

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  channel(topic: string, params: Record<string, unknown> = {}): MockChannel {
    const channel = new MockChannel(topic, params);
    this.channels.push(channel);
    return channel;
  }

  onError(callback: () => void): void {
    this.errorCallbacks.push(callback);
  }

  onOpen(callback: () => void): void {
    this.openCallbacks.push(callback);
  }

  simulateError(): void {
    for (const callback of this.errorCallbacks) {
      callback();
    }
  }

  simulateOpen(): void {
    for (const callback of this.openCallbacks) {
      callback();
    }
  }
}

const sampleThreads: ThreadRecord[] = [
  {
    id: "thread-1",
    tenantId: "tenant-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "Older Thread",
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "thread-2",
    tenantId: "tenant-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "Newest Thread",
    archived: false,
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
];

function createEnvironment(fetchImpl: typeof fetch): ThreadEnvironment {
  return {
    fetch: fetchImpl,
    Socket: MockSocket,
  };
}

describe("thread store", () => {
  const stores: Array<ReturnType<typeof ɵcreateThreadStore>> = [];

  beforeEach(() => {
    MockSocket.instances = [];
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
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-1",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock as typeof fetch));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: { Authorization: "Bearer token" },
      wsUrl: "ws://localhost:4000/client",
      userId: "user-1",
      agentId: "agent-1",
    });

    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/threads?userId=user-1&agentId=agent-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/threads/subscribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(ɵselectThreads(store.getState()).map((thread) => thread.id)).toEqual([
      "thread-2",
      "thread-1",
    ]);
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(false);
    expect(MockSocket.instances).toHaveLength(1);
    expect(MockSocket.instances[0].channels[0].topic).toBe("user_meta:user-1");
  });

  it("upserts realtime thread metadata without refetching", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-1",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock as typeof fetch));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      userId: "user-1",
      agentId: "agent-1",
    });

    await flushEffects();

    const channel = MockSocket.instances[0].channels[0];
    channel.serverPush("thread_metadata", {
      operation: "renamed",
      threadId: "thread-1",
      userId: "user-1",
      tenantId: "tenant-1",
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

  it("ignores realtime events for a different user", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-1",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock as typeof fetch));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      userId: "user-1",
      agentId: "agent-1",
    });

    await flushEffects();

    MockSocket.instances[0].channels[0].serverPush("thread_metadata", {
      operation: "deleted",
      threadId: "thread-2",
      userId: "user-2",
      tenantId: "tenant-1",
      occurredAt: "2026-01-03T00:00:00Z",
      deleted: { id: "thread-2" },
    });

    await flushEffects();

    expect(ɵselectThreads(store.getState())).toHaveLength(2);
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
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinToken: "jt-2",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock as typeof fetch));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      userId: "user-1",
      agentId: "agent-1",
    });
    await flushEffects();

    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      userId: "user-1",
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

  it("sends rename, archive, and delete requests with userId and agentId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: sampleThreads,
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

    const store = ɵcreateThreadStore(createEnvironment(fetchMock as typeof fetch));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: { Authorization: "Bearer token" },
      wsUrl: "ws://localhost:4000/client",
      userId: "user-1",
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
      userId: "user-1",
      agentId: "agent-1",
      name: "Renamed",
    });

    const archiveCall = fetchMock.mock.calls[3];
    expect(archiveCall[0]).toBe(
      "https://runtime.example.com/threads/thread-2/archive",
    );
    expect(JSON.parse(archiveCall[1].body)).toMatchObject({
      userId: "user-1",
      agentId: "agent-1",
    });

    const deleteCall = fetchMock.mock.calls[4];
    expect(deleteCall[0]).toBe("https://runtime.example.com/threads/thread-2");
    expect(deleteCall[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(deleteCall[1].body)).toMatchObject({
      userId: "user-1",
      agentId: "agent-1",
    });
  });

  it("stores fetch failures in error state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = ɵcreateThreadStore(createEnvironment(fetchMock as typeof fetch));
    stores.push(store);
    store.start();
    store.setContext({
      runtimeUrl: "https://runtime.example.com",
      headers: {},
      wsUrl: "ws://localhost:4000/client",
      userId: "user-1",
      agentId: "agent-1",
    });

    await flushEffects();

    expect(ɵselectThreadsError(store.getState())?.message).toContain("500");
  });
});
