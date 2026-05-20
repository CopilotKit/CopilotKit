import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import type { Ref } from "vue";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useCopilotKit } from "../../providers/useCopilotKit";

type ThreadRecord = {
  id: string;
  organizationId: string;
  agentId: string;
  createdById: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
};

type ThreadState = {
  threads: ThreadRecord[];
  isLoading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  context: {
    runtimeUrl: string;
    headers: Record<string, string>;
    wsUrl?: string;
    agentId: string;
    includeArchived?: boolean;
    limit?: number;
  } | null;
};

const select = <T>(selector: (state: ThreadState) => T) => selector;

vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const threadMocks = vi.hoisted(() => ({
  sockets: [] as any[],
  dispatchedContexts: [] as Array<ThreadState["context"]>,
}));

function compareThreadsByActivity(left: ThreadRecord, right: ThreadRecord) {
  const leftKey = left.lastRunAt ?? left.updatedAt ?? left.createdAt;
  const rightKey = right.lastRunAt ?? right.updatedAt ?? right.createdAt;
  return rightKey.localeCompare(leftKey);
}

vi.mock("@copilotkit/core", () => {
  class MockChannel {
    topic: string;
    left = false;
    private readonly store: MockThreadStore;

    constructor(topic: string, store: MockThreadStore) {
      this.topic = topic;
      this.store = store;
    }

    leave(): void {
      this.left = true;
    }

    serverPush(event: string, payload: any): void {
      if (event !== "thread_metadata") return;
      this.store.applyMetadata(payload);
    }
  }

  class MockSocket {
    connected = true;
    disconnected = false;
    channels: MockChannel[] = [];
    private consecutiveErrors = 0;

    constructor(public readonly store: MockThreadStore) {
      threadMocks.sockets.push(this);
    }

    addChannel(channel: MockChannel): void {
      this.channels.push(channel);
    }

    disconnect(): void {
      this.disconnected = true;
    }

    triggerError(): void {
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors >= 5) {
        for (const channel of this.channels) {
          channel.leave();
        }
        this.disconnect();
      }
    }
  }

  class MockThreadStore {
    private state: ThreadState = {
      threads: [],
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      context: null,
    };
    private listeners = new Set<() => void>();
    private socket: MockSocket | null = null;

    start(): void {}

    stop(): void {
      this.state = {
        threads: [],
        isLoading: false,
        error: null,
        hasNextPage: false,
        isFetchingNextPage: false,
        context: null,
      };
      if (this.socket) {
        for (const channel of this.socket.channels) {
          channel.leave();
        }
        this.socket.disconnect();
      }
      this.notify();
    }

    setContext(context: ThreadState["context"]): void {
      threadMocks.dispatchedContexts.push(context);
      this.state.context = context;
      if (!context) {
        this.state.threads = [];
        this.state.isLoading = false;
        this.state.error = null;
        this.notify();
        return;
      }

      this.state.threads = [];
      this.state.isLoading = true;
      this.state.error = null;
      this.state.hasNextPage = false;
      this.state.isFetchingNextPage = false;
      this.notify();
      void this.fetchThreads(context);
    }

    private async fetchThreads(context: NonNullable<ThreadState["context"]>) {
      try {
        const query = new URLSearchParams({ agentId: context.agentId });
        if (context.includeArchived !== undefined) {
          query.set("includeArchived", String(context.includeArchived));
        }
        if (context.limit !== undefined) {
          query.set("limit", String(context.limit));
        }
        const listResponse = await fetchMock(
          `${context.runtimeUrl}/threads?${query}`,
          {
            method: "GET",
            headers: context.headers,
          },
        );
        if (!listResponse.ok) {
          this.state.error = new Error(String(listResponse.status));
          this.state.isLoading = false;
          this.state.threads = [];
          this.state.hasNextPage = false;
          this.notify();
          return;
        }

        const listData = await listResponse.json();
        this.state.threads = [...listData.threads].sort(
          compareThreadsByActivity,
        );
        this.state.hasNextPage = typeof listData.nextCursor === "string";
        this.state.isLoading = false;
        this.state.error = null;
        this.notify();

        await fetchMock(`${context.runtimeUrl}/threads/subscribe`, {
          method: "POST",
          headers: context.headers,
          body: JSON.stringify({
            agentId: context.agentId,
          }),
        });

        const joinCode =
          typeof listData.joinCode === "string" ? listData.joinCode : "unknown";
        this.socket = new MockSocket(this);
        this.socket.addChannel(new MockChannel(`user_meta:${joinCode}`, this));
      } catch (error) {
        this.state.error = error as Error;
        this.state.isLoading = false;
        this.state.threads = [];
        this.notify();
      }
    }

    applyMetadata(payload: any): void {
      if (!this.state.context) {
        return;
      }

      if (payload.operation === "deleted") {
        this.state.threads = this.state.threads.filter(
          (thread) => thread.id !== payload.deleted.id,
        );
      } else {
        const thread = payload.thread as ThreadRecord;
        const existingIndex = this.state.threads.findIndex(
          (item) => item.id === thread.id,
        );
        if (existingIndex === -1) {
          this.state.threads = [...this.state.threads, thread];
        } else {
          const next = [...this.state.threads];
          next[existingIndex] = thread;
          this.state.threads = next;
        }
        this.state.threads.sort(compareThreadsByActivity);
      }
      this.notify();
    }

    async renameThread(threadId: string, name: string): Promise<void> {
      const context = this.requireContext();
      await fetchMock(`${context.runtimeUrl}/threads/${threadId}`, {
        method: "PATCH",
        headers: context.headers,
        body: JSON.stringify({
          agentId: context.agentId,
          name,
        }),
      });
    }

    async archiveThread(threadId: string): Promise<void> {
      const context = this.requireContext();
      await fetchMock(`${context.runtimeUrl}/threads/${threadId}/archive`, {
        method: "POST",
        headers: context.headers,
        body: JSON.stringify({
          agentId: context.agentId,
        }),
      });
    }

    async deleteThread(threadId: string): Promise<void> {
      const context = this.requireContext();
      await fetchMock(`${context.runtimeUrl}/threads/${threadId}`, {
        method: "DELETE",
        headers: context.headers,
        body: JSON.stringify({
          agentId: context.agentId,
        }),
      });
    }

    fetchNextPage(): void {
      this.state.isFetchingNextPage = true;
      this.notify();
      this.state.isFetchingNextPage = false;
      this.notify();
    }

    private requireContext() {
      if (!this.state.context) {
        throw new Error("Missing thread context");
      }
      return this.state.context;
    }

    getState(): ThreadState {
      return this.state;
    }

    select<T>(selector: (state: ThreadState) => T) {
      return {
        subscribe: (callback: () => void) => {
          const listener = () => {
            selector(this.state);
            callback();
          };
          this.listeners.add(listener);
          return {
            unsubscribe: () => this.listeners.delete(listener),
          };
        },
      };
    }

    private notify(): void {
      for (const listener of this.listeners) {
        listener();
      }
    }
  }

  return {
    CopilotKitCoreRuntimeConnectionStatus: {
      Disconnected: "disconnected",
      Connecting: "connecting",
      Connected: "connected",
      Error: "error",
    },
    ɵcreateThreadStore: () => new MockThreadStore(),
    ɵselectThreads: select((state) => state.threads),
    ɵselectThreadsIsLoading: select((state) => state.isLoading),
    ɵselectThreadsError: select((state) => state.error),
    ɵselectHasNextPage: select((state) => state.hasNextPage),
    ɵselectIsFetchingNextPage: select((state) => state.isFetchingNextPage),
  };
});

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

const { CopilotKitCoreRuntimeConnectionStatus } =
  await import("@copilotkit/core");

function getMockSockets(): any[] {
  return threadMocks.sockets;
}

function getDispatchedContexts(): Array<ThreadState["context"]> {
  return threadMocks.dispatchedContexts;
}

function setupCopilotKit(
  runtimeUrl: string | undefined = "http://localhost:4000",
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus = CopilotKitCoreRuntimeConnectionStatus.Connected,
) {
  const copilotkit = ref<{
    runtimeUrl: string | undefined;
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
    headers: Record<string, string>;
    intelligence: { wsUrl?: string } | undefined;
  }>({
    runtimeUrl,
    runtimeConnectionStatus,
    headers: { Authorization: "Bearer test-token" },
    intelligence: {
      wsUrl: "ws://localhost:4000/client",
    },
  });
  mockUseCopilotKit.mockReturnValue({ copilotkit });
  return copilotkit;
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const defaultInput = { agentId: "agent-1" };

const sampleThreads = [
  {
    id: "t-1",
    organizationId: "org-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "Thread One",
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "t-2",
    organizationId: "org-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "Thread Two",
    archived: false,
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
];

const { useThreads } = await import("../use-threads");
type UseThreadsResult = ReturnType<typeof useThreads>;

function mountHook(
  input: {
    agentId: string | Ref<string>;
    includeArchived?: boolean | Ref<boolean | undefined>;
    limit?: number | Ref<number | undefined>;
  } = defaultInput,
) {
  let result: UseThreadsResult | undefined;

  const Harness = defineComponent({
    setup() {
      result = useThreads(input);
      return () => h("div");
    },
  });

  const wrapper = mount(Harness);

  return {
    wrapper,
    getResult: () => {
      if (!result) {
        throw new Error("useThreads result not initialized");
      }
      return result;
    },
  };
}

describe("useThreads", () => {
  beforeEach(() => {
    threadMocks.sockets.splice(0);
    threadMocks.dispatchedContexts.splice(0);
    fetchMock.mockReset();
    setupCopilotKit();
  });

  it("fetches threads and subscribes to the user metadata channel", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    expect(getResult().threads.value.map((thread) => thread.id)).toEqual([
      "t-2",
      "t-1",
    ]);
    expect(getResult().error.value).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/threads?agentId=agent-1"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/threads/subscribe"),
      expect.objectContaining({ method: "POST" }),
    );

    const socket = getMockSockets()[0];
    expect(socket.connected).toBe(true);
    expect(socket.channels[0].topic).toBe("user_meta:jc-1");
  });

  it("stores fetch failures in error state", async () => {
    fetchMock.mockReturnValue(jsonResponse({}, 500));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    expect(getResult().error.value?.message).toContain("500");
    expect(getResult().threads.value).toEqual([]);
  });

  it("does not fetch when runtimeUrl is not configured", async () => {
    setupCopilotKit("");

    const { getResult } = mountHook();

    await nextTick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getResult().isLoading.value).toBe(false);
    expect(getResult().error.value?.message).toBe(
      "Runtime URL is not configured",
    );
  });

  it("updates local state directly from realtime metadata events", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    const channel = getMockSockets()[0].channels[0];
    channel.serverPush("thread_metadata", {
      operation: "updated",
      threadId: "t-1",
      userId: "user-1",
      organizationId: "org-1",
      occurredAt: "2026-01-03T00:00:00Z",
      thread: {
        ...sampleThreads[0],
        name: "Renamed Thread",
        updatedAt: "2026-01-03T00:00:00Z",
      },
    });

    await vi.waitFor(() => {
      expect(getResult().threads.value[0].name).toBe("Renamed Thread");
    });
  });

  it("applies realtime metadata without client-side user filtering", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    getMockSockets()[0].channels[0].serverPush("thread_metadata", {
      operation: "deleted",
      threadId: "t-2",
      userId: "user-2",
      organizationId: "org-1",
      occurredAt: "2026-01-03T00:00:00Z",
      deleted: { id: "t-2" },
    });

    await vi.waitFor(() => {
      expect(getResult().threads.value).toHaveLength(1);
    });
  });

  it("renames a thread through the runtime contract", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
      .mockReturnValueOnce(jsonResponse({}));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    await getResult().renameThread("t-1", "Renamed");

    const [url, options] = fetchMock.mock.calls[2];
    expect(url).toContain("/threads/t-1");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toMatchObject({
      agentId: "agent-1",
      name: "Renamed",
    });
  });

  it("archives and deletes threads through the runtime contract", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
      .mockReturnValueOnce(jsonResponse({}))
      .mockReturnValueOnce(jsonResponse({}));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    await getResult().archiveThread("t-2");
    await getResult().deleteThread("t-1");

    expect(fetchMock.mock.calls[2][0]).toContain("/threads/t-2/archive");
    expect(fetchMock.mock.calls[2][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      agentId: "agent-1",
    });

    expect(fetchMock.mock.calls[3][0]).toContain("/threads/t-1");
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toMatchObject({
      agentId: "agent-1",
    });
  });

  it("exposes thread-scoped pagination properties", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({
          threads: sampleThreads,
          joinCode: "jc-1",
          nextCursor: "cursor-abc",
        }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    expect(getResult()).toHaveProperty("hasMoreThreads");
    expect(getResult()).toHaveProperty("isFetchingMoreThreads");
    expect(getResult()).toHaveProperty("fetchMoreThreads");
    expect(getResult()).not.toHaveProperty("hasNextPage");
    expect(getResult()).not.toHaveProperty("isFetchingNextPage");
    expect(getResult()).not.toHaveProperty("fetchNextPage");

    expect(getResult().hasMoreThreads.value).toBe(true);
    expect(getResult().isFetchingMoreThreads.value).toBe(false);
    expect(typeof getResult().fetchMoreThreads).toBe("function");
  });

  it("does not expose organizationId or createdById on threads", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    for (const thread of getResult().threads.value) {
      expect(thread).not.toHaveProperty("organizationId");
      expect(thread).not.toHaveProperty("createdById");
      expect(thread).toHaveProperty("id");
      expect(thread).toHaveProperty("agentId");
      expect(thread).toHaveProperty("name");
      expect(thread).toHaveProperty("archived");
      expect(thread).toHaveProperty("createdAt");
      expect(thread).toHaveProperty("updatedAt");
    }
  });

  it("tears down sockets after repeated connection failures", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    mountHook();

    await vi.waitFor(() => {
      expect(getMockSockets().length).toBe(1);
    });

    const socket = getMockSockets()[0];
    const channel = socket.channels[0];

    for (let index = 0; index < 5; index += 1) {
      socket.triggerError();
    }

    expect(channel.left).toBe(true);
    expect(socket.disconnected).toBe(true);
  });

  it("tears down the active socket on unmount", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { wrapper } = mountHook();

    await vi.waitFor(() => {
      expect(getMockSockets().length).toBe(1);
    });

    const socket = getMockSockets()[0];
    const channel = socket.channels[0];

    wrapper.unmount();

    expect(channel.left).toBe(true);
    expect(socket.disconnected).toBe(true);
  });

  describe("Vue-specific reactive semantics", () => {
    it("reacts to reactive input changes", async () => {
      const copilotkit = setupCopilotKit();
      const agentId = ref("agent-1");

      fetchMock
        .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
        .mockReturnValueOnce(
          jsonResponse({
            threads: [
              {
                ...sampleThreads[0],
                id: "t-3",
                agentId: "agent-2",
                createdById: "user-2",
              },
            ],
          }),
        )
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-2" }));

      const { getResult } = mountHook({ agentId });

      await vi.waitFor(() => {
        expect(getResult().isLoading.value).toBe(false);
      });

      agentId.value = "agent-2";
      copilotkit.value = {
        ...copilotkit.value,
        headers: { Authorization: "Bearer updated" },
      };

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/threads?agentId=agent-2"),
          expect.objectContaining({ method: "GET" }),
        );
      });

      await vi.waitFor(() => {
        expect(getResult().threads.value[0]?.id).toBe("t-3");
      });
    });

    it("reacts to in-place header mutations", async () => {
      const copilotkit = setupCopilotKit();

      fetchMock
        .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
        .mockReturnValueOnce(
          jsonResponse({
            threads: [
              {
                ...sampleThreads[0],
                id: "t-4",
              },
            ],
          }),
        )
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-2" }));

      const { getResult } = mountHook();

      await vi.waitFor(() => {
        expect(getResult().isLoading.value).toBe(false);
      });

      copilotkit.value.headers.Authorization = "Bearer mutated";

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/threads?agentId=agent-1"),
          expect.objectContaining({
            method: "GET",
            headers: { Authorization: "Bearer mutated" },
          }),
        );
      });

      expect(getResult().threads.value[0].id).toBe("t-4");
    });

    it("reacts to includeArchived and limit changes", async () => {
      const includeArchived = ref(false);
      const limit = ref(10);

      fetchMock
        .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
        .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-2" }));

      mountHook({ agentId: "agent-1", includeArchived, limit });

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining(
            "/threads?agentId=agent-1&includeArchived=false&limit=10",
          ),
          expect.objectContaining({ method: "GET" }),
        );
      });

      includeArchived.value = true;
      limit.value = 5;

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining(
            "/threads?agentId=agent-1&includeArchived=true&limit=5",
          ),
          expect.objectContaining({ method: "GET" }),
        );
      });
    });
  });

  describe("Connected-gate", () => {
    it("waits for runtimeConnectionStatus=Connected before fetching /threads", async () => {
      // Start in Connecting — hook should hold off on dispatching any request
      // so the initial list fetch includes wsUrl and avoids a redundant second
      // call once /info resolves.
      const copilotkit = setupCopilotKit(
        "http://localhost:4000",
        CopilotKitCoreRuntimeConnectionStatus.Connecting,
      );
      copilotkit.value = {
        ...copilotkit.value,
        intelligence: undefined,
      };

      fetchMock
        .mockReturnValueOnce(
          jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
        )
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

      const { getResult } = mountHook();

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetchMock).not.toHaveBeenCalled();

      // While waiting for Connected, the hook must surface isLoading=true so
      // consumers don't render an empty-state flash before the first fetch
      // is even dispatched. The store's own isLoading is false at this
      // point (no setContext call yet), so the hook synthesizes it.
      expect(getResult().isLoading.value).toBe(true);
      expect(getResult().threads.value).toEqual([]);

      // Flip to Connected with wsUrl populated. The watcher now dispatches
      // exactly one list fetch (+ one subscribe after it lands).
      copilotkit.value = {
        ...copilotkit.value,
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        intelligence: { wsUrl: "ws://localhost:4000/client" },
      };

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/threads?agentId=agent-1"),
          expect.objectContaining({ method: "GET" }),
        );
      });

      const listCalls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === "string" && /\/threads\?agentId=/.test(url),
      );
      expect(listCalls).toHaveLength(1);

      // The dispatched context must carry wsUrl, otherwise the store would
      // re-fetch once /info eventually populates it.
      const nonNullContexts = getDispatchedContexts().filter(
        (context) => context !== null,
      );
      expect(nonNullContexts).toHaveLength(1);
      expect(nonNullContexts[0]).toMatchObject({
        runtimeUrl: "http://localhost:4000",
        wsUrl: "ws://localhost:4000/client",
        agentId: "agent-1",
      });

      await vi.waitFor(() => {
        expect(getResult().isLoading.value).toBe(false);
      });
    });

    it("does not re-dispatch context across transient Disconnected states", async () => {
      const copilotkit = setupCopilotKit();

      fetchMock
        .mockReturnValueOnce(
          jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
        )
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

      const { getResult } = mountHook();

      await vi.waitFor(() => {
        expect(getResult().isLoading.value).toBe(false);
      });

      const baselineContexts = getDispatchedContexts().filter(
        (context) => context !== null,
      ).length;

      copilotkit.value = {
        ...copilotkit.value,
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      };

      await new Promise((resolve) => setTimeout(resolve, 20));

      const afterTransient = getDispatchedContexts().filter(
        (context) => context !== null,
      ).length;
      expect(afterTransient).toBe(baselineContexts);
    });

    it("clears the store when runtimeUrl is removed even before Connected", async () => {
      const copilotkit = setupCopilotKit();

      fetchMock
        .mockReturnValueOnce(
          jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
        )
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

      const { getResult } = mountHook();

      await vi.waitFor(() => {
        expect(getResult().isLoading.value).toBe(false);
      });

      copilotkit.value = {
        ...copilotkit.value,
        runtimeUrl: undefined,
      };

      await vi.waitFor(() => {
        expect(getResult().error.value?.message).toBe(
          "Runtime URL is not configured",
        );
      });

      const lastDispatched = getDispatchedContexts().at(-1);
      expect(lastDispatched).toBeNull();
    });
  });

  describe("lastRunAt", () => {
    it("exposes lastRunAt on threads when present", async () => {
      const threadsWithLastRun = [
        {
          ...sampleThreads[0],
          lastRunAt: "2026-02-01T00:00:00Z",
        },
        sampleThreads[1],
      ];

      fetchMock
        .mockReturnValueOnce(
          jsonResponse({ threads: threadsWithLastRun, joinCode: "jc-1" }),
        )
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

      const { getResult } = mountHook();

      await vi.waitFor(() => {
        expect(getResult().isLoading.value).toBe(false);
      });

      const byId = Object.fromEntries(
        getResult().threads.value.map((thread) => [thread.id, thread]),
      );
      expect(byId["t-1"].lastRunAt).toBe("2026-02-01T00:00:00Z");
      expect(byId["t-2"]).not.toHaveProperty("lastRunAt");
    });

    it("orders threads by lastRunAt with fallback to updatedAt then createdAt", async () => {
      const mixed = [
        {
          ...sampleThreads[0],
          id: "u-only",
          lastRunAt: undefined,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
        },
        {
          ...sampleThreads[0],
          id: "lr-new",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          lastRunAt: "2026-02-01T00:00:00Z",
        },
        {
          ...sampleThreads[0],
          id: "lr-old",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-10T00:00:00Z",
          lastRunAt: "2026-01-15T00:00:00Z",
        },
        {
          ...sampleThreads[0],
          id: "c-only",
          lastRunAt: undefined,
          createdAt: "2026-01-03T00:00:00Z",
          updatedAt: undefined as unknown as string,
        },
      ];

      fetchMock
        .mockReturnValueOnce(jsonResponse({ threads: mixed, joinCode: "jc-1" }))
        .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

      const { getResult } = mountHook();

      await vi.waitFor(() => {
        expect(getResult().isLoading.value).toBe(false);
      });

      expect(getResult().threads.value.map((thread) => thread.id)).toEqual([
        "lr-new",
        "lr-old",
        "u-only",
        "c-only",
      ]);
    });
  });
});
