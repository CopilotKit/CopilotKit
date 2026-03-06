import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "@/providers/CopilotKitProvider";

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted, so all helpers must be inline.
// ---------------------------------------------------------------------------

vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

// We store created sockets on a global array so tests can inspect them.
// The array is attached to globalThis to survive hoisting.
(globalThis as any).__mockSockets = [] as any[];

vi.mock("phoenix", () => {
  class MockPush {
    private callbacks = new Map<string, Function>();
    receive(status: string, cb: Function): MockPush {
      this.callbacks.set(status, cb);
      return this;
    }
    trigger(status: string, resp?: unknown) {
      this.callbacks.get(status)?.(resp);
    }
  }

  class MockChannel {
    topic: string;
    params: Record<string, unknown>;
    left = false;
    private joinPush = new MockPush();
    private handlers = new Map<string, Array<(p: unknown) => void>>();

    constructor(topic = "", params: Record<string, unknown> = {}) {
      this.topic = topic;
      this.params = params;
    }

    on(event: string, cb: (p: unknown) => void) {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event)!.push(cb);
    }

    join(): MockPush {
      return this.joinPush;
    }

    leave() {
      this.left = true;
    }

    triggerJoin(status: "ok" | "error" | "timeout", resp?: unknown) {
      this.joinPush.trigger(status, resp);
    }

    serverPush(event: string, payload: unknown) {
      for (const h of this.handlers.get(event) ?? []) h(payload);
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
    connect() {
      this.connected = true;
    }
    disconnect() {
      this.disconnected = true;
    }
    channel(topic: string, params: Record<string, unknown> = {}): MockChannel {
      const ch = new MockChannel(topic, params);
      this.channels.push(ch);
      return ch;
    }
    onError(cb: () => void) {
      this.errorCallbacks.push(cb);
    }
    onOpen(cb: () => void) {
      this.openCallbacks.push(cb);
    }
    simulateError() {
      for (const cb of this.errorCallbacks) cb();
    }
    simulateOpen() {
      for (const cb of this.openCallbacks) cb();
    }
  }

  return { Socket: MockSocket, Channel: MockChannel };
});

// Global fetch mock
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMockSockets(): any[] {
  return (globalThis as any).__mockSockets;
}

function setupCopilotKit(runtimeUrl = "http://localhost:4000") {
  mockUseCopilotKit.mockReturnValue({
    copilotkit: {
      runtimeUrl,
      headers: { Authorization: "Bearer test-token" },
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
    name: "Thread One",
    lastRunAt: "2026-01-01T00:00:00Z",
    lastUpdatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "t-2",
    name: "Thread Two",
    lastRunAt: "2026-01-02T00:00:00Z",
    lastUpdatedAt: "2026-01-02T00:00:00Z",
  },
];

// Must import after mocks are set up
const { useThreads } = await import("../use-threads");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useThreads", () => {
  beforeEach(() => {
    (globalThis as any).__mockSockets = [];
    fetchMock.mockReset();
    setupCopilotKit();
  });

  describe("fetchThreads", () => {
    it("fetches threads and sets state", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.threads).toEqual(sampleThreads);
      expect(result.current.error).toBeNull();

      // Verify the correct URL was fetched
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/threads?"),
        expect.objectContaining({ method: "GET" }),
      );
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("userId=user-1");
      expect(url).toContain("agentId=agent-1");
    });

    it("sets error state on fetch failure", async () => {
      fetchMock.mockReturnValue(jsonResponse({}, 500));

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error!.message).toContain("500");
      expect(result.current.threads).toEqual([]);
    });

    it("sets error when runtimeUrl is not configured", async () => {
      setupCopilotKit("");

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error!.message).toContain(
        "Runtime URL is not configured",
      );
    });
  });

  describe("subscribeToUpdates", () => {
    it("creates Phoenix socket and channel with joinCode after fetch", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-sub" }),
      );

      renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(getMockSockets().length).toBeGreaterThan(0);
      });

      const socket = getMockSockets()[0];
      expect(socket.connected).toBe(true);
      expect(socket.channels).toHaveLength(1);

      const ch = socket.channels[0];
      expect(ch.topic).toBe("threads:user-1");
      expect(ch.params).toMatchObject({ joinCode: "jc-sub" });
    });

    it("tears down socket on channel join error", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-err" }),
      );

      renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(getMockSockets().length).toBeGreaterThan(0);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];
      act(() => {
        ch.triggerJoin("error", { reason: "denied" });
      });

      expect(ch.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });

    it("tears down socket after MAX_SOCKET_RETRIES consecutive errors", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-retry" }),
      );

      renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(getMockSockets().length).toBeGreaterThan(0);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];

      // 4 errors should not tear down (MAX_SOCKET_RETRIES = 5)
      act(() => {
        for (let i = 0; i < 4; i++) socket.simulateError();
      });

      expect(ch.left).toBe(false);
      expect(socket.disconnected).toBe(false);

      // 5th error should trigger teardown
      act(() => {
        socket.simulateError();
      });

      expect(ch.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });

    it("resets error count on successful connection", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-reset" }),
      );

      renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(getMockSockets().length).toBeGreaterThan(0);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];

      // 4 errors, then a successful open resets the counter
      act(() => {
        for (let i = 0; i < 4; i++) socket.simulateError();
        socket.simulateOpen();
      });

      // Another 4 errors should not tear down since counter was reset
      act(() => {
        for (let i = 0; i < 4; i++) socket.simulateError();
      });

      expect(ch.left).toBe(false);
      expect(socket.disconnected).toBe(false);
    });

    it("tears down socket on channel join timeout", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-timeout" }),
      );

      renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(getMockSockets().length).toBeGreaterThan(0);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];
      act(() => {
        ch.triggerJoin("timeout");
      });

      expect(ch.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });
  });

  describe("CRUD operations", () => {
    it("updateThread calls PATCH with correct body", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-crud" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      fetchMock.mockReturnValue(jsonResponse({}));

      await act(async () => {
        await result.current.updateThread("t-1", { name: "Renamed" });
      });

      const [url, opts] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(url).toContain("/threads/t-1");
      expect(opts.method).toBe("PATCH");
      const body = JSON.parse(opts.body);
      expect(body).toMatchObject({
        name: "Renamed",
        userId: "user-1",
      });
      expect(body).not.toHaveProperty("agentId");
    });

    it("archiveThread calls POST to archive endpoint", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-archive" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      fetchMock.mockReturnValue(jsonResponse({}));

      await act(async () => {
        await result.current.archiveThread("t-2");
      });

      const [url, opts] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(url).toContain("/threads/t-2/archive");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body).toMatchObject({ userId: "user-1" });
      expect(body).not.toHaveProperty("agentId");
    });

    it("deleteThread calls DELETE with correct body", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-delete" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      fetchMock.mockReturnValue(jsonResponse({}));

      await act(async () => {
        await result.current.deleteThread("t-1");
      });

      const [url, opts] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(url).toContain("/threads/t-1");
      expect(opts.method).toBe("DELETE");
      const body = JSON.parse(opts.body);
      expect(body).toMatchObject({ userId: "user-1" });
      expect(body).not.toHaveProperty("agentId");
    });
  });

  describe("real-time updates via channel", () => {
    it("adds a new thread when receiving a 'created' event", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-rt" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];

      const newThread = {
        id: "t-3",
        name: "Thread Three",
        lastRunAt: "2026-01-03T00:00:00Z",
        lastUpdatedAt: "2026-01-03T00:00:00Z",
      };

      act(() => {
        ch.serverPush("threads:update", {
          action: "created",
          thread: newThread,
        });
      });

      expect(result.current.threads).toHaveLength(3);
      expect(result.current.threads[0]).toEqual(newThread);
    });

    it("updates a thread in-place when receiving an 'updated' event", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-rt2" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];

      const updatedThread = {
        ...sampleThreads[0],
        name: "Renamed Thread",
      };

      act(() => {
        ch.serverPush("threads:update", {
          action: "updated",
          thread: updatedThread,
        });
      });

      expect(result.current.threads).toHaveLength(2);
      expect(result.current.threads[0].name).toBe("Renamed Thread");
    });

    it("removes a thread when receiving a 'deleted' event", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-rt3" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];

      act(() => {
        ch.serverPush("threads:update", {
          action: "deleted",
          threadId: "t-1",
        });
      });

      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0].id).toBe("t-2");
    });

    it("removes a thread when receiving an 'archived' event", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-rt4" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];

      act(() => {
        ch.serverPush("threads:update", {
          action: "archived",
          threadId: "t-2",
        });
      });

      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0].id).toBe("t-1");
    });
  });

  describe("cleanup", () => {
    it("tears down channel and socket on unmount", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-unmount" }),
      );

      const { unmount } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(getMockSockets().length).toBeGreaterThan(0);
      });

      const socket = getMockSockets()[0];
      const ch = socket.channels[0];

      unmount();

      expect(ch.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });
  });

  describe("refetch", () => {
    it("re-fetches threads and sets up a new subscription", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-first" }),
      );

      const { result } = renderHook(() => useThreads(defaultInput));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstSocket = getMockSockets()[0];

      fetchMock.mockReturnValue(
        jsonResponse({
          threads: [sampleThreads[0]],
          joinCode: "jc-second",
        }),
      );

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.threads).toHaveLength(1);

      // Old socket should be torn down
      expect(firstSocket.disconnected).toBe(true);

      // New socket should be created with the new join code
      const newSocket = getMockSockets()[getMockSockets().length - 1];
      expect(newSocket).not.toBe(firstSocket);
      expect(newSocket.channels[0].params).toMatchObject({
        joinCode: "jc-second",
      });
    });
  });
});
