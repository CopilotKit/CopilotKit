import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "@/providers/CopilotKitProvider";

vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

(globalThis as any).__mockSockets = [] as any[];

vi.mock("phoenix", () => {
  class MockPush {
    private callbacks = new Map<string, Function>();

    receive(status: string, callback: Function): MockPush {
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
    private joinPush = new MockPush();
    private handlers = new Map<string, Array<(payload: unknown) => void>>();

    constructor(topic = "", params: Record<string, unknown> = {}) {
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

    triggerJoin(status: "ok" | "error" | "timeout", payload?: unknown): void {
      this.joinPush.trigger(status, payload);
    }

    serverPush(event: string, payload: unknown): void {
      for (const callback of this.handlers.get(event) ?? []) {
        callback(payload);
      }
    }
  }

  class MockSocket {
    connected = false;
    disconnected = false;
    channels: MockChannel[] = [];
    private errorCallbacks: Array<() => void> = [];
    private openCallbacks: Array<() => void> = [];

    constructor() {
      (globalThis as any).__mockSockets.push(this);
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

  return { Socket: MockSocket, Channel: MockChannel };
});

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

function getMockSockets(): any[] {
  return (globalThis as any).__mockSockets;
}

function setupCopilotKit(runtimeUrl = "http://localhost:4000") {
  mockUseCopilotKit.mockReturnValue({
    copilotkit: {
      runtimeUrl,
      headers: { Authorization: "Bearer test-token" },
      intelligence: {
        wsUrl: "ws://localhost:4000/client",
      },
    },
  });
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

describe("useThreads", () => {
  beforeEach(() => {
    (globalThis as any).__mockSockets = [];
    fetchMock.mockReset();
    setupCopilotKit();
  });

  it("fetches threads and subscribes to the user metadata channel", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.threads.map((thread) => thread.id)).toEqual([
      "t-2",
      "t-1",
    ]);
    expect(result.current.error).toBeNull();
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

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error?.message).toContain("500");
    expect(result.current.threads).toEqual([]);
  });

  it("does not fetch when runtimeUrl is not configured", async () => {
    setupCopilotKit("");

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe(
      "Runtime URL is not configured",
    );
  });

  it("updates local state directly from realtime metadata events", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const channel = getMockSockets()[0].channels[0];

    act(() => {
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
    });

    await waitFor(() => {
      expect(result.current.threads[0].name).toBe("Renamed Thread");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores realtime metadata for a different user", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      getMockSockets()[0].channels[0].serverPush("thread_metadata", {
        operation: "deleted",
        threadId: "t-2",
        userId: "user-2",
        tenantId: "tenant-1",
        occurredAt: "2026-01-03T00:00:00Z",
        deleted: { id: "t-2" },
      });
    });

    await waitFor(() => {
      expect(result.current.threads).toHaveLength(2);
    });
  });

  it("renames a thread through the runtime contract", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
      .mockReturnValueOnce(jsonResponse({}));

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.renameThread("t-1", "Renamed");
    });

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

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.archiveThread("t-2");
      await result.current.deleteThread("t-1");
    });

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

  it("refetches threads without replacing the active socket", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-first" }))
      .mockReturnValueOnce(
        jsonResponse({
          threads: [sampleThreads[0]],
        }),
      );

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const firstSocket = getMockSockets()[0];

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getMockSockets()).toHaveLength(1);
    expect(firstSocket.disconnected).toBe(false);
    expect(firstSocket.channels[0].topic).toBe("user_meta:user-1");
  });

  it("tears down sockets after repeated connection failures", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(getMockSockets().length).toBe(1);
    });

    const socket = getMockSockets()[0];
    const channel = socket.channels[0];

    act(() => {
      for (let index = 0; index < 5; index += 1) {
        socket.simulateError();
      }
    });

    expect(channel.left).toBe(true);
    expect(socket.disconnected).toBe(true);
  });

  it("tears down the active socket on unmount", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ threads: sampleThreads }))
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    const { unmount } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(getMockSockets().length).toBe(1);
    });

    const socket = getMockSockets()[0];
    const channel = socket.channels[0];

    unmount();

    expect(channel.left).toBe(true);
    expect(socket.disconnected).toBe(true);
  });
});
