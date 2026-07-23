import { act, renderHook, waitFor } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useCopilotKit } from "../../context";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateMetadataSocket,
  ɵcreateMemoryStore,
} from "@copilotkit/core";
import type { ɵMetadataSocket, ɵMemoryStore } from "@copilotkit/core";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

// Shape of the mock socket exposed via the hoisted `phoenix.sockets`
// array. Defined as a named type so test-side assertions can drop the
// blanket `any[]` cast and surface socket-API typos at compile time.
interface MockChannelLike {
  topic: string;
  params: Record<string, unknown>;
  left: boolean;
  serverPush(event: string, payload: unknown): void;
}
interface MockSocketLike {
  url: string;
  connected: boolean;
  disconnected: boolean;
  channels: MockChannelLike[];
  triggerError(error?: unknown): void;
  triggerOpen(): void;
}

const phoenix = vi.hoisted(() => ({
  sockets: [] as MockSocketLike[],
}));

vi.mock("phoenix", () => {
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

    private handlers = new Map<
      string,
      Array<{ ref: number; callback: (payload: unknown) => void }>
    >();
    private nextRef = 1;

    constructor(topic = "", params: Record<string, unknown> = {}) {
      this.topic = topic;
      this.params = params;
    }

    on(event: string, callback: (payload: unknown) => void): number {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, []);
      }
      const ref = this.nextRef++;
      this.handlers.get(event)!.push({ ref, callback });
      return ref;
    }

    off(event: string, ref?: number): void {
      if (!this.handlers.has(event)) {
        return;
      }
      if (ref === undefined) {
        this.handlers.delete(event);
        return;
      }

      // Re-check after the early returns above: `off(event)` deletes the
      // entry, so a subsequent `off(event, ref)` would otherwise hit a
      // non-null assertion that lies and `.filter` on undefined.
      const entries = this.handlers.get(event);
      if (entries === undefined) {
        return;
      }
      this.handlers.set(
        event,
        entries.filter((entry) => entry.ref !== ref),
      );
    }

    join(): MockPush {
      // Each rejoin must produce a distinct push instance — sharing
      // one across joins lets stale "ok"/"error" callbacks from a
      // prior join fire against a new join's listeners.
      return new MockPush();
    }

    leave(): void {
      this.left = true;
    }

    serverPush(event: string, payload: unknown): void {
      for (const entry of this.handlers.get(event) ?? []) {
        entry.callback(payload);
      }
    }
  }

  class MockSocket {
    url: string;
    opts: Record<string, unknown>;
    connected = false;
    disconnected = false;
    channels: MockChannel[] = [];

    private errorHandlers: Array<(error?: unknown) => void> = [];
    private openHandlers: Array<() => void> = [];

    constructor(url = "", opts: Record<string, unknown> = {}) {
      this.url = url;
      this.opts = opts;
      phoenix.sockets.push(this);
    }

    connect(): void {
      // Phoenix sockets fire `onOpen` exactly once per WebSocket upgrade,
      // and the upgrade is asynchronous. Tests must drive that transition
      // explicitly via `triggerOpen()` so we exercise one open per
      // connection — auto-firing here would either double-fire (when a
      // test also calls `triggerOpen()`) or hide cases where production
      // code forgets to await the open before joining a channel.
      this.connected = true;
    }

    disconnect(): void {
      // Real Phoenix sockets flip `connected` back to false on disconnect —
      // a mock that only sets `disconnected = true` lets a regression that
      // forgets to clear `connected` slip through, since assertions like
      // `socket.connected === false` would be vacuously satisfied by the
      // initial value but never re-checked after a reconnect cycle.
      this.connected = false;
      this.disconnected = true;
    }

    channel(topic: string, params: Record<string, unknown> = {}): MockChannel {
      const channel = new MockChannel(topic, params);
      this.channels.push(channel);
      return channel;
    }

    onError(callback: (error?: unknown) => void): void {
      this.errorHandlers.push(callback);
    }

    onOpen(callback: () => void): void {
      this.openHandlers.push(callback);
    }

    triggerError(error?: unknown): void {
      for (const handler of this.errorHandlers) {
        handler(error);
      }
    }

    triggerOpen(): void {
      for (const handler of this.openHandlers) {
        handler();
      }
    }
  }

  return { Socket: MockSocket };
});

const fetchMock = vi.fn();
// Use `vi.stubGlobal` so the original `fetch` is restored automatically
// by `vi.unstubAllGlobals()` below — direct `globalThis.fetch = ...`
// assignment leaks the mock across test files in the same vitest worker.
vi.stubGlobal("fetch", fetchMock);

function getMockSockets(): MockSocketLike[] {
  return phoenix.sockets;
}

const supportedThreadEndpoints = {
  list: true,
  inspect: true,
  mutations: true,
  realtimeMetadata: true,
};

/**
 * Builds a `ɵgetMetadataSocket(joinToken)` stand-in that mirrors
 * `CopilotKitCore`'s real lazy-memoized behavior: the ONE shared,
 * credential-agnostic metadata socket is created on first call (via the real
 * `ɵcreateMetadataSocket`) and the same instance is returned on subsequent
 * calls regardless of `joinToken`, so the mocked `phoenix` module exercises the
 * same code path production wiring does. Mirrors `makeGetMetadataSocket` in
 * `@copilotkit/core`'s `threads.test.ts`/`memory.test.ts`.
 *
 * The store fetches its OWN realtime credentials (join token via
 * `/threads/subscribe`, join code from the list response) through the shared
 * `fetchMock`, then hands the token here to resolve the shared socket.
 */
function createMetadataSocketFactory(
  wsUrl: string,
): (joinToken: string) => ɵMetadataSocket {
  let socket: ɵMetadataSocket | undefined;
  return (joinToken: string) => {
    if (!socket) {
      socket = ɵcreateMetadataSocket({ wsUrl, joinToken }).socket;
    }
    return socket;
  };
}

function setupCopilotKit(runtimeUrl = "http://localhost:4000") {
  const headers = { Authorization: "Bearer test-token" };
  const wsUrl = "ws://localhost:4000/client";
  mockUseCopilotKit.mockReturnValue({
    copilotkit: {
      runtimeUrl,
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      headers,
      threadEndpoints: supportedThreadEndpoints,
      intelligence: { wsUrl },
      ɵgetMetadataSocket: createMetadataSocketFactory(wsUrl),
      registerThreadStore: vi.fn(),
      unregisterThreadStore: vi.fn(),
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

/**
 * Primes `fetchMock` for the store's two initial requests: the `/threads` list
 * GET (carries the realtime `joinCode`) and the `/threads/subscribe` POST (mints
 * the realtime `joinToken`). The store now fetches its OWN realtime credentials,
 * so realtime-asserting tests must answer both — routing by URL keeps the two
 * responses independent of call order.
 */
function primeThreadFetches(
  threads: unknown = sampleThreads,
  joinCode = "jc-1",
) {
  fetchMock.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/threads/subscribe")) {
      return jsonResponse({ joinToken: "jt-1" });
    }
    if (typeof url === "string" && url.includes("/threads")) {
      return jsonResponse({ threads, joinCode });
    }
    return jsonResponse({}, 404);
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

let useThreads: typeof import("../use-threads").useThreads;

beforeAll(async () => {
  ({ useThreads } = await import("../use-threads"));
});

describe("useThreads", () => {
  beforeEach(() => {
    phoenix.sockets.splice(0);
    fetchMock.mockReset();
    // Reset before re-priming. setupCopilotKit() uses mockReturnValue, so a
    // future test that uses mockReturnValueOnce would otherwise leak any
    // un-consumed queued returns into the next test.
    mockUseCopilotKit.mockReset();
    setupCopilotKit();
  });

  afterAll(() => {
    // Pair with `vi.stubGlobal("fetch", fetchMock)` above. Without this
    // restoration the mock leaks into any sibling test file that runs in
    // the same vitest worker and assumes a real `fetch`.
    vi.unstubAllGlobals();
  });

  it("fetches threads and subscribes to the user metadata channel", async () => {
    primeThreadFetches();

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
      expect.stringContaining("/threads?agentId=agent-1"),
      expect.objectContaining({ method: "GET" }),
    );
    // The store fetches its OWN realtime join-token via `POST /threads/subscribe`
    // (join code comes from the list response), then joins the
    // `user_meta:<joinCode>` channel off the shared core-owned socket resolved
    // via `getMetadataSocket(joinToken)`.
    await waitFor(() => {
      expect(getMockSockets()[0]?.channels[0]?.topic).toBe("user_meta:jc-1");
    });
    const socket = getMockSockets()[0];
    expect(socket.connected).toBe(true);
    expect(socket.channels[0].topic).toBe("user_meta:jc-1");
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
    expect(result.current.error?.message).toBe("Runtime URL is not configured");
    // The runtime/config error must NOT leak into the end-user list-error
    // channel — only genuine list-load failures surface there.
    expect(result.current.listError).toBeNull();
  });

  it("startNewThread clears the runtime-config error banner", async () => {
    setupCopilotKit("");

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.error?.message).toBe(
        "Runtime URL is not configured",
      );
    });

    act(() => {
      result.current.startNewThread();
    });

    // "New thread" presents a clean welcome surface: the config error is
    // dismissed even though it outranks the store's own (cleared) error.
    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
  });

  it("does not register the thread store when disabled (avoids evicting a live store for the same agent)", () => {
    const registerThreadStore = vi.fn();
    const unregisterThreadStore = vi.fn();
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runtimeUrl: "http://localhost:4000",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        headers: {},
        threadEndpoints: supportedThreadEndpoints,
        intelligence: { wsUrl: "ws://localhost:4000/client" },
        ɵgetMetadataSocket: createMetadataSocketFactory(
          "ws://localhost:4000/client",
        ),
        registerThreadStore,
        unregisterThreadStore,
      },
    });

    renderHook(() => useThreads({ ...defaultInput, enabled: false }));

    expect(registerThreadStore).not.toHaveBeenCalled();
  });

  it("does not fetch when the runtime does not advertise thread endpoints", async () => {
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runtimeUrl: "http://localhost:4000",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        headers: { Authorization: "Bearer test-token" },
        threadEndpoints: {
          list: false,
          inspect: false,
          mutations: false,
          realtimeMetadata: false,
        },
        intelligence: undefined,
        ɵgetMetadataSocket: () => undefined,
        registerThreadStore: vi.fn(),
        unregisterThreadStore: vi.fn(),
      },
    });

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.threads).toEqual([]);
    expect(result.current.error?.message).toBe(
      "Thread endpoints are not available on this CopilotKit runtime",
    );
  });

  it("uses legacy thread behavior when connected runtime omits thread endpoint info", async () => {
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runtimeUrl: "http://localhost:4000",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        headers: { Authorization: "Bearer test-token" },
        threadEndpoints: undefined,
        intelligence: undefined,
        ɵgetMetadataSocket: () => undefined,
        registerThreadStore: vi.fn(),
        unregisterThreadStore: vi.fn(),
      },
    });
    fetchMock.mockReturnValueOnce(jsonResponse({ threads: sampleThreads }));

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/threads?agentId=agent-1"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.current.threads.map((thread) => thread.id)).toEqual([
      "t-2",
      "t-1",
    ]);
    expect(result.current.error).toBeNull();
  });

  it("rejects mutations locally when the runtime reports mutations are unsupported", async () => {
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runtimeUrl: "http://localhost:4000",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        headers: { Authorization: "Bearer test-token" },
        threadEndpoints: {
          list: true,
          inspect: true,
          mutations: false,
          realtimeMetadata: false,
        },
        intelligence: undefined,
        ɵgetMetadataSocket: () => undefined,
        registerThreadStore: vi.fn(),
        unregisterThreadStore: vi.fn(),
      },
    });
    fetchMock.mockReturnValueOnce(jsonResponse({ threads: sampleThreads }));

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    fetchMock.mockClear();

    await expect(result.current.renameThread("t-1", "Renamed")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );
    await expect(result.current.archiveThread("t-1")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );
    await expect(result.current.deleteThread("t-1")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates local state directly from realtime metadata events", async () => {
    primeThreadFetches();

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(getMockSockets()[0]?.channels[0]).toBeDefined();
    });
    const channel = getMockSockets()[0].channels[0];

    act(() => {
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
    });

    await waitFor(() => {
      expect(result.current.threads[0].name).toBe("Renamed Thread");
    });

    // The realtime metadata push updates the store directly — it must NOT
    // trigger an extra REST refetch beyond the two initial calls (the list GET
    // plus the `/threads/subscribe` credentials POST).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("applies realtime metadata without client-side user filtering", async () => {
    primeThreadFetches();

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(getMockSockets()[0]?.channels[0]).toBeDefined();
    });
    act(() => {
      getMockSockets()[0].channels[0].serverPush("thread_metadata", {
        operation: "deleted",
        threadId: "t-2",
        userId: "user-2",
        organizationId: "org-1",
        occurredAt: "2026-01-03T00:00:00Z",
        deleted: { id: "t-2" },
      });
    });

    await waitFor(() => {
      expect(result.current.threads).toHaveLength(1);
    });
    // Identity-check the remaining thread so a regression that removes
    // the wrong thread (e.g. a swapped index) is caught.
    expect(result.current.threads[0].id).toBe("t-1");
  });

  it("renames a thread through the runtime contract", async () => {
    // URL-routed so the store's own `/threads/subscribe` POST resolves cleanly
    // without consuming the mutation's response (mutations only check `ok`).
    primeThreadFetches();

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.renameThread("t-1", "Renamed");
    });

    // Find the PATCH call by URL+method rather than a hardcoded index —
    // a future change to the fetch order (or an extra startup fetch) must
    // not silently miss the actual rename request.
    const renameCall = fetchMock.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("/threads/t-1") &&
        (args[1] as { method?: string } | undefined)?.method === "PATCH",
    );
    expect(renameCall).toBeDefined();
    const [, renameOptions] = renameCall!;
    expect(JSON.parse((renameOptions as { body: string }).body)).toMatchObject({
      agentId: "agent-1",
      name: "Renamed",
    });
  });

  it("archives and deletes threads through the runtime contract", async () => {
    primeThreadFetches();

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.archiveThread("t-2");
      await result.current.deleteThread("t-1");
    });

    // Filter by URL+method rather than fixed indices (mirrors the rename
    // test above). A future change to the startup fetch order — adding an
    // /info call, splitting the join token, etc. — must not silently miss
    // the actual archive/delete requests.
    const archiveCall = fetchMock.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("/threads/t-2/archive") &&
        (args[1] as { method?: string } | undefined)?.method === "POST",
    );
    expect(archiveCall).toBeDefined();
    expect(
      JSON.parse((archiveCall![1] as { body: string }).body),
    ).toMatchObject({ agentId: "agent-1" });

    const deleteCall = fetchMock.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("/threads/t-1") &&
        (args[1] as { method?: string } | undefined)?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();
    expect(JSON.parse((deleteCall![1] as { body: string }).body)).toMatchObject(
      { agentId: "agent-1" },
    );
  });

  it("unarchives a thread through the runtime contract", async () => {
    primeThreadFetches();

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.unarchiveThread("t-2");
    });

    const unarchiveCall = fetchMock.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("/threads/t-2") &&
        (args[1] as { method?: string } | undefined)?.method === "PATCH",
    );
    expect(unarchiveCall).toBeDefined();
    expect(
      JSON.parse((unarchiveCall![1] as { body: string }).body),
    ).toMatchObject({ agentId: "agent-1", archived: false });
  });

  it("exposes thread-scoped pagination properties", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        threads: sampleThreads,
        joinCode: "jc-1",
        nextCursor: "cursor-abc",
      }),
    );

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current).toHaveProperty("hasMoreThreads");
    expect(result.current).toHaveProperty("isFetchingMoreThreads");
    expect(result.current).toHaveProperty("fetchMoreThreads");
    expect(result.current).not.toHaveProperty("hasNextPage");
    expect(result.current).not.toHaveProperty("isFetchingNextPage");
    expect(result.current).not.toHaveProperty("fetchNextPage");

    expect(result.current.hasMoreThreads).toBe(true);
    expect(result.current.isFetchingMoreThreads).toBe(false);
    expect(typeof result.current.fetchMoreThreads).toBe("function");
  });

  it("fetchMoreThreads fetches the next page with the cursor and appends threads", async () => {
    const nextPageThreads = [
      {
        id: "t-3",
        organizationId: "org-1",
        agentId: "agent-1",
        createdById: "user-1",
        name: "Thread Three",
        archived: false,
        createdAt: "2026-01-03T00:00:00Z",
        updatedAt: "2026-01-03T00:00:00Z",
      },
    ];

    // URL-routed so the store's own `/threads/subscribe` POST doesn't consume
    // the next-page response: the first list GET (no cursor) carries the
    // nextCursor, the cursor GET returns the next page.
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/threads/subscribe")) {
        return jsonResponse({ joinToken: "jt-1" });
      }
      if (typeof url === "string" && url.includes("cursor=cursor-abc")) {
        return jsonResponse({ threads: nextPageThreads, joinCode: "jc-1" });
      }
      if (typeof url === "string" && url.includes("/threads")) {
        return jsonResponse({
          threads: sampleThreads,
          joinCode: "jc-1",
          nextCursor: "cursor-abc",
        });
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.threads).toHaveLength(2);
    expect(result.current.hasMoreThreads).toBe(true);

    act(() => {
      result.current.fetchMoreThreads();
    });

    await waitFor(() => {
      expect(result.current.threads).toHaveLength(3);
    });

    const nextPageCall = fetchMock.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("cursor=cursor-abc"),
    );
    expect(nextPageCall).toBeDefined();
    expect(nextPageCall![0]).toContain("agentId=agent-1");
    expect(result.current.threads.map((t: { id: string }) => t.id)).toContain(
      "t-3",
    );
    expect(result.current.threads).toHaveLength(3);
  });

  it("does not expose organizationId or createdById on threads", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
    );

    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    for (const thread of result.current.threads) {
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

  // NOTE: a "tears down sockets after repeated connection failures" test
  // previously lived here, asserting that the thread store itself gave up
  // and disconnected its socket after `ɵMAX_SOCKET_RETRIES` consecutive
  // errors. That behavior has moved: the shared metadata socket
  // (`ɵcreateMetadataSocket` in `@copilotkit/core`) now owns
  // socket retry/give-up, and `threads.ts` no longer references
  // `ɵMETADATA_MAX_SOCKET_RETRIES`, `dispose()`, or the socket's `error`
  // signal at all — it only joins a channel off the shared `socket$`. The
  // give-up path is covered where it now lives: `metadata-realtime.test.ts`
  // and `memory.test.ts` in `@copilotkit/core`.

  it("leaves the channel on unmount but keeps the shared socket alive for other consumers", async () => {
    primeThreadFetches();

    const { unmount } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(getMockSockets().length).toBe(1);
    });
    await waitFor(() => {
      expect(getMockSockets()[0]?.channels[0]).toBeDefined();
    });

    const socket = getMockSockets()[0];
    const channel = socket.channels[0];

    unmount();

    // The store leaves ITS channel on unmount...
    expect(channel.left).toBe(true);
    // ...but the underlying socket is owned by the shared core-owned socket
    // (`CopilotKitCore.ɵgetMetadataSocket()`, refCount:false), not by this one
    // hook instance, so a single consumer unmounting must not disconnect it out
    // from under other consumers (e.g. the memory store) sharing it.
    expect(socket.disconnected).toBe(false);
  });

  it("registers thread store on mount and unregisters on unmount", async () => {
    const registerThreadStore = vi.fn();
    const unregisterThreadStore = vi.fn();
    // Use mockReturnValue (not mockReturnValueOnce) so the same spies are
    // returned across all renders, including the cleanup render where
    // unmount triggers the effect's cleanup function.
    // runtimeConnectionStatus is set explicitly to Connected — the hook
    // treats anything other than Connected as "do not dispatch context",
    // and we want this test to exercise a fully-wired flow.
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runtimeUrl: "http://localhost:4000",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        headers: { Authorization: "Bearer test-token" },
        threadEndpoints: supportedThreadEndpoints,
        intelligence: { wsUrl: "ws://localhost:4000/client" },
        ɵgetMetadataSocket: createMetadataSocketFactory(
          "ws://localhost:4000/client",
        ),
        registerThreadStore,
        unregisterThreadStore,
      },
    });

    fetchMock.mockReturnValueOnce(
      jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
    );

    const { unmount } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(registerThreadStore).toHaveBeenCalledWith(
        "agent-1",
        expect.objectContaining({ select: expect.any(Function) }),
      );
    });

    unmount();

    expect(unregisterThreadStore).toHaveBeenCalledWith("agent-1");
  });

  it("waits for runtimeConnectionStatus=Connected before fetching /threads", async () => {
    // Start in Connecting — hook should hold off on dispatching any request
    // so the initial list fetch includes wsUrl and avoids a redundant second
    // call once /info resolves.
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runtimeUrl: "http://localhost:4000",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connecting,
        headers: { Authorization: "Bearer test-token" },
        threadEndpoints: supportedThreadEndpoints,
        intelligence: undefined,
        ɵgetMetadataSocket: () => undefined,
        registerThreadStore: vi.fn(),
        unregisterThreadStore: vi.fn(),
      },
    });

    fetchMock.mockReturnValueOnce(
      jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
    );

    const { result, rerender } = renderHook(() => useThreads(defaultInput));

    // Flush React effects + microtasks deterministically. A bare
    // setTimeout(20) raced the store-effect under load on slow machines.
    // Chained microtask flushes inside `act` give every queued effect a
    // chance to run without depending on real-time delay.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // While waiting for Connected, the hook must surface isLoading=true so
    // consumers don't render an empty-state flash before the first fetch
    // is even dispatched. The store's own isLoading is false at this
    // point (no contextChanged action yet), so the hook synthesizes it.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.threads).toEqual([]);

    // Flip to Connected with wsUrl populated, re-render. The effect now
    // dispatches exactly one list fetch (+ one subscribe after it lands).
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runtimeUrl: "http://localhost:4000",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        headers: { Authorization: "Bearer test-token" },
        threadEndpoints: supportedThreadEndpoints,
        intelligence: { wsUrl: "ws://localhost:4000/client" },
        ɵgetMetadataSocket: createMetadataSocketFactory(
          "ws://localhost:4000/client",
        ),
        registerThreadStore: vi.fn(),
        unregisterThreadStore: vi.fn(),
      },
    });

    rerender();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/threads?agentId=agent-1"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    // Exactly the expected pair — no speculative list call before Connected.
    const listCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && /\/threads\?agentId=/.test(url),
    );
    expect(listCalls).toHaveLength(1);

    // After the fetch settles, isLoading returns to false.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("threads + memory share a single core-owned socket (one socket, two channels)", async () => {
    // Both feeds must resolve their socket from the SAME memoized factory the
    // real `CopilotKitCore.ɵgetMetadataSocket()` would produce — mirrors
    // `core.ts`'s own `_metadataSocket` memoization so the thread store (via the
    // hook) and the memory store (via `getMemoryStore()`) ride one shared
    // `ɵMetadataSocket`, exactly like production `syncMemoryContext()` does off
    // the same core instance. Each store fetches its own realtime credentials
    // and joins its own channel off that ONE socket.
    const wsUrl = "ws://localhost:4000/client";
    const runtimeUrl = "http://localhost:4000";
    const headers = { Authorization: "Bearer test-token" };
    const metadataSocketFactory = createMetadataSocketFactory(wsUrl);

    let memoryStore: ɵMemoryStore | undefined;
    function getMemoryStore(): ɵMemoryStore {
      if (!memoryStore) {
        memoryStore = ɵcreateMemoryStore({
          fetch: fetchMock as unknown as typeof fetch,
        });
        memoryStore.start();
        memoryStore.setContext({
          runtimeUrl,
          headers,
          // The SAME factory instance the hook's core mock uses: the first
          // caller creates the ONE shared socket, every later call returns it —
          // so both stores ride a single socket regardless of who resolves it
          // first.
          getMetadataSocket: metadataSocketFactory,
        });
      }
      return memoryStore;
    }

    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        runtimeUrl,
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        headers,
        threadEndpoints: supportedThreadEndpoints,
        intelligence: { wsUrl },
        ɵgetMetadataSocket: metadataSocketFactory,
        registerThreadStore: vi.fn(),
        unregisterThreadStore: vi.fn(),
      },
    });

    fetchMock.mockImplementation((url: string) => {
      // Each store fetches its OWN realtime credentials before joining its
      // channel off the shared socket — route the subscribe endpoints first so
      // the broader `/threads`/`/memories` matches don't swallow them.
      if (url.includes("/threads/subscribe")) {
        return jsonResponse({ joinToken: "jt-1" });
      }
      if (url.includes("/memories/subscribe")) {
        return jsonResponse({ joinToken: "jt-1", joinCode: "jc-1" });
      }
      if (url.includes("/threads")) {
        return jsonResponse({ threads: sampleThreads, joinCode: "jc-1" });
      }
      if (url.includes("/memories")) {
        return jsonResponse({ memories: [] });
      }
      return jsonResponse({}, 404);
    });

    // 1. Mount `useThreads` — joins `user_meta:jc-1` off the shared connection.
    const { result } = renderHook(() => useThreads(defaultInput));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // 2. Pull the core-owned memory store — joins `user_meta:memories:jc-1`
    // off the SAME shared connection.
    const store = getMemoryStore();

    // Headline assertion: exactly ONE phoenix socket was ever constructed,
    // even though two independent stores each opened their own channel. If
    // the lift-websocket-creation refactor were reverted (each store minting
    // its own socket instead of riding the core-owned one), this would fail
    // with `phoenix.sockets.length === 2`.
    await waitFor(() => {
      expect(phoenix.sockets.length).toBe(1);
    });

    const socket = phoenix.sockets[0];
    await waitFor(() => {
      expect(socket.channels.length).toBe(2);
    });

    const topics = socket.channels.map((channel) => channel.topic);
    expect(topics).toContain("user_meta:jc-1");
    expect(topics).toContain("user_meta:memories:jc-1");

    store.stop();
  });
});
