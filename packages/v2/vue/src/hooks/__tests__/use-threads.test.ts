import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useCopilotKit } from "../../providers/useCopilotKit";

vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const threadMocks = vi.hoisted(() => ({
  sockets: [] as any[],
}));

vi.mock("@copilotkitnext/core", () => {
  type ThreadRecord = {
    id: string;
    tenantId: string;
    agentId: string;
    createdById: string;
    name: string | null;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
  };

  type ThreadState = {
    threads: ThreadRecord[];
    isLoading: boolean;
    error: Error | null;
    context: {
      runtimeUrl: string;
      headers: Record<string, string>;
      wsUrl?: string;
      userId: string;
      agentId: string;
    } | null;
  };

  const select = <T,>(selector: (state: ThreadState) => T) => selector;

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
      this.notify();
      void this.fetchThreads(context);
    }

    private async fetchThreads(context: NonNullable<ThreadState["context"]>) {
      try {
        const listResponse = await fetchMock(
          `${context.runtimeUrl}/threads?userId=${context.userId}&agentId=${context.agentId}`,
          { method: "GET", headers: context.headers },
        );
        if (!listResponse.ok) {
          this.state.error = new Error(String(listResponse.status));
          this.state.isLoading = false;
          this.state.threads = [];
          this.notify();
          return;
        }

        const listData = await listResponse.json();
        this.state.threads = [...listData.threads].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        );
        this.state.isLoading = false;
        this.state.error = null;
        this.notify();

        await fetchMock(`${context.runtimeUrl}/threads/subscribe`, {
          method: "POST",
          headers: context.headers,
          body: JSON.stringify({
            userId: context.userId,
            agentId: context.agentId,
          }),
        });

        this.socket = new MockSocket(this);
        this.socket.addChannel(new MockChannel(`user_meta:${context.userId}`, this));
      } catch (error) {
        this.state.error = error as Error;
        this.state.isLoading = false;
        this.state.threads = [];
        this.notify();
      }
    }

    applyMetadata(payload: any): void {
      if (!this.state.context || payload.userId !== this.state.context.userId) {
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
        this.state.threads.sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        );
      }
      this.notify();
    }

    async renameThread(threadId: string, name: string): Promise<void> {
      const context = this.requireContext();
      await fetchMock(`${context.runtimeUrl}/threads/${threadId}`, {
        method: "PATCH",
        headers: context.headers,
        body: JSON.stringify({
          userId: context.userId,
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
          userId: context.userId,
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
          userId: context.userId,
          agentId: context.agentId,
        }),
      });
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
    ɵcreateThreadStore: () => new MockThreadStore(),
    ɵselectThreads: select((state) => state.threads),
    ɵselectThreadsIsLoading: select((state) => state.isLoading),
    ɵselectThreadsError: select((state) => state.error),
  };
});

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

function getMockSockets(): any[] {
  return threadMocks.sockets;
}

function setupCopilotKit(runtimeUrl = "http://localhost:4000") {
  const copilotkit = ref({
    runtimeUrl,
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

const defaultInput = { userId: "user-1", agentId: "agent-1" };

const sampleThreads = [
  {
    id: "t-1",
    tenantId: "tenant-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "Thread One",
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "t-2",
    tenantId: "tenant-1",
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
    userId: string | ReturnType<typeof ref<string>>;
    agentId: string | ReturnType<typeof ref<string>>;
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
    fetchMock.mockReset();
    setupCopilotKit();
  });

  it("fetches threads and subscribes to the user metadata channel", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
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
      expect.stringContaining("/threads?userId=user-1&agentId=agent-1"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/threads/subscribe"),
      expect.objectContaining({ method: "POST" }),
    );

    const socket = getMockSockets()[0];
    expect(socket.connected).toBe(true);
    expect(socket.channels[0].topic).toBe("user_meta:user-1");
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
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
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
      tenantId: "tenant-1",
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

  it("ignores realtime metadata for a different user", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { getResult } = mountHook();

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    getMockSockets()[0].channels[0].serverPush("thread_metadata", {
      operation: "deleted",
      threadId: "t-2",
      userId: "user-2",
      tenantId: "tenant-1",
      occurredAt: "2026-01-03T00:00:00Z",
      deleted: { id: "t-2" },
    });

    await nextTick();
    expect(getResult().threads.value).toHaveLength(2);
  });

  it("renames a thread through the runtime contract", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
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
      userId: "user-1",
      agentId: "agent-1",
      name: "Renamed",
    });
  });

  it("archives and deletes threads through the runtime contract", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
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
      userId: "user-1",
      agentId: "agent-1",
    });

    expect(fetchMock.mock.calls[3][0]).toContain("/threads/t-1");
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toMatchObject({
      userId: "user-1",
      agentId: "agent-1",
    });
  });

  it("tears down sockets after repeated connection failures", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
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
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
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

  it("reacts to reactive input changes", async () => {
    const copilotkit = setupCopilotKit();
    const userId = ref("user-1");
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
              createdById: "user-2",
            },
          ],
        }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-2" }));

    const { getResult } = mountHook({ userId, agentId });

    await vi.waitFor(() => {
      expect(getResult().isLoading.value).toBe(false);
    });

    userId.value = "user-2";
    copilotkit.value = {
      ...copilotkit.value,
      headers: { Authorization: "Bearer updated" },
    };

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/threads?userId=user-2&agentId=agent-1"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    expect(getResult().threads.value[0].id).toBe("t-3");
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
        expect.stringContaining("/threads?userId=user-1&agentId=agent-1"),
        expect.objectContaining({
          method: "GET",
          headers: { Authorization: "Bearer mutated" },
        }),
      );
    });

    expect(getResult().threads.value[0].id).toBe("t-4");
  });
});
