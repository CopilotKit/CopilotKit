import * as React from "react";
import { renderToString } from "react-dom/server";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Mock } from "vitest";
import { useCopilotKit } from "../../context";
import { ɵcreateMemoryStore, ɵcreateMetadataSocket } from "@copilotkit/core";
import type { ɵMemoryStore, ɵMetadataSocket } from "@copilotkit/core";
import { useMemories } from "../use-memories";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

const RUNTIME_URL = "https://runtime.example.com";

type WireMemory = {
  id: string;
  kind: "topical";
  scope: "user";
  content: string;
  sourceThreadIds: string[];
  invalidatedAt: string | null;
};

function wireMemory(id: string, content = `content-${id}`): WireMemory {
  return {
    id,
    kind: "topical",
    scope: "user",
    content,
    sourceThreadIds: [],
    invalidatedAt: null,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

/**
 * Builds a fetch mock that routes by URL + method. The store always POSTs
 * `/memories/subscribe` for realtime join credentials on `setContext`, so the
 * mock must answer that endpoint alongside the snapshot GET and the mutation
 * call. The phoenix socket never connects under jsdom; that path is covered by
 * core's `memory.test.ts`. `onMutation` returns the body for the create /
 * supersede / retire request (or `undefined` for a bodyless DELETE).
 *
 * Pass `snapshotStatus` (default `200`) to make the snapshot GET return a
 * non-ok response — e.g. `500` to exercise the error path or `404` to exercise
 * the "memory not configured" (isAvailable=false) branch.
 */
function makeFetchMock(
  snapshot: WireMemory[],
  onMutation?: (url: string, method: string) => unknown,
  snapshotStatus = 200,
): Mock {
  return vi.fn((input: string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url === `${RUNTIME_URL}/memories` && method === "GET") {
      if (snapshotStatus !== 200) {
        return Promise.resolve(errorResponse(snapshotStatus));
      }
      return Promise.resolve(jsonResponse({ memories: snapshot }));
    }
    if (url === `${RUNTIME_URL}/memories/subscribe` && method === "POST") {
      return Promise.resolve(
        jsonResponse({ joinToken: "tok", joinCode: "code" }),
      );
    }
    const body = onMutation?.(url, method);
    return Promise.resolve(
      method === "DELETE" ? ({ ok: true } as Response) : jsonResponse(body),
    );
  });
}

// Stub the global fetch once for the entire module — RxJS's fromFetch always
// calls globalThis.fetch, so injected fetch in ɵcreateMemoryStore is a
// pass-through. vi.stubGlobal restores the original automatically on afterAll.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let store: ɵMemoryStore;

function setupCopilotKit(mock: Mock): void {
  store = ɵcreateMemoryStore({ fetch: mock });
  store.start();

  mockUseCopilotKit.mockReturnValue({
    copilotkit: {
      getMemoryStore: () => store,
    },
    executingToolCallIds: new Set(),
  });
}

/**
 * Triggers the store's first context dispatch so the snapshot fetch fires.
 * Must be called inside `act(...)` after `renderHook` so the hook is already
 * subscribed when the async response arrives.
 */
function activateStore(): void {
  // Mirror `CopilotKitCore.ɵgetMetadataSocket`: ONE credential-agnostic socket
  // created on first call and memoized, so repeated resolves return the same
  // instance. The store fetches its own `/memories/subscribe` creds and hands
  // the token here.
  let socket: ɵMetadataSocket | undefined;
  store.setContext({
    runtimeUrl: RUNTIME_URL,
    getMetadataSocket: (joinToken: string) => {
      if (!socket) {
        socket = ɵcreateMetadataSocket({
          wsUrl: "wss://gw.example.com/client",
          joinToken,
        }).socket;
      }
      return socket;
    },
    headers: {},
  });
}

describe("useMemories", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mockUseCopilotKit.mockReset();
    // Default: empty snapshot with no mutations expected.
    fetchMock.mockImplementation(makeFetchMock([]));
    setupCopilotKit(fetchMock);
  });

  afterEach(() => {
    // Tear down the store started in setupCopilotKit so its rxjs effects /
    // pending fetches don't leak across tests.
    store?.stop();
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("exposes empty memories and isAvailable true on initial render", () => {
    const { result } = renderHook(() => useMemories());

    expect(result.current.memories).toEqual([]);
    expect(result.current.isAvailable).toBe(true);
  });

  it("exposes realtimeStatus, defaulting to 'connecting'", () => {
    const { result } = renderHook(() => useMemories());

    // The phoenix socket never connects under jsdom (see makeFetchMock note), so
    // the status stays at its "connecting" default; core's memory.test.ts covers
    // the connected/unavailable transitions. This asserts the hook surfaces the
    // field at all and wires it through the store selector.
    expect(result.current.realtimeStatus).toBe("connecting");
  });

  it("loads the snapshot on mount", async () => {
    fetchMock.mockImplementation(
      makeFetchMock([wireMemory("m1"), wireMemory("m2")]),
    );
    setupCopilotKit(fetchMock);

    const { result } = renderHook(() => useMemories());

    act(() => {
      activateStore();
    });

    await waitFor(() => {
      expect(result.current.memories.map((m) => m.id)).toEqual(["m1", "m2"]);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("addMemory POSTs and resolves to the created memory, adding it to the list", async () => {
    fetchMock.mockImplementation(
      makeFetchMock([], () => ({
        ...wireMemory("m1", "hi"),
        absorbed: false,
      })),
    );
    setupCopilotKit(fetchMock);

    const { result } = renderHook(() => useMemories());

    act(() => {
      activateStore();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.addMemory({
        content: "hi",
        kind: "topical",
      });
    });

    expect(created?.id).toBe("m1");
    await waitFor(() => {
      expect(result.current.memories.map((m) => m.id)).toEqual(["m1"]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updateMemory supersedes: resolves to the new id and the list shows it (old id gone)", async () => {
    fetchMock.mockImplementation(
      makeFetchMock([wireMemory("m1", "old")], () => ({
        ...wireMemory("m2", "new"),
        retiredId: "m1",
      })),
    );
    setupCopilotKit(fetchMock);

    const { result } = renderHook(() => useMemories());

    act(() => {
      activateStore();
    });

    await waitFor(() =>
      expect(result.current.memories.map((m) => m.id)).toEqual(["m1"]),
    );

    let updated: { id: string } | undefined;
    await act(async () => {
      updated = await result.current.updateMemory("m1", {
        content: "new",
        kind: "topical",
      });
    });

    expect(updated?.id).toBe("m2");
    await waitFor(() => {
      expect(result.current.memories.map((m) => m.id)).toEqual(["m2"]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories/m1`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("removeMemory DELETEs and removes the memory from the list", async () => {
    fetchMock.mockImplementation(makeFetchMock([wireMemory("m1")]));
    setupCopilotKit(fetchMock);

    const { result } = renderHook(() => useMemories());

    act(() => {
      activateStore();
    });

    await waitFor(() =>
      expect(result.current.memories.map((m) => m.id)).toEqual(["m1"]),
    );

    await act(async () => {
      await result.current.removeMemory("m1");
    });

    await waitFor(() => expect(result.current.memories).toEqual([]));
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories/m1`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  // A11: useMemories must not crash under SSR/Next.js prerender. Before the fix
  // (useSyncExternalStore called with only 2 args) renderToString throws
  // "Missing getServerSnapshot"; after the fix it renders the empty server
  // snapshot. This test is red before the third-arg fix and green after.
  it("server-renders without throwing 'Missing getServerSnapshot' (SSR smoke)", () => {
    function MemoryProbe(): React.ReactElement {
      const { memories, isLoading, isAvailable } = useMemories();
      // Single text child so SSR doesn't interleave comment markers, keeping
      // the sanity assertion below a simple substring check.
      return <div>{`${isLoading}:${isAvailable}:${memories.length}`}</div>;
    }

    expect(() => renderToString(<MemoryProbe />)).not.toThrow();
    // Sanity: the server snapshot is the empty initial state.
    expect(renderToString(<MemoryProbe />)).toContain("false:true:0");
  });

  it("surfaces a non-null Error when the snapshot GET fails (500)", async () => {
    fetchMock.mockImplementation(makeFetchMock([], undefined, 500));
    setupCopilotKit(fetchMock);

    const { result } = renderHook(() => useMemories());

    act(() => {
      activateStore();
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAvailable).toBe(true);
  });

  it("flips isAvailable to false (error stays null) when the snapshot GET 404s", async () => {
    fetchMock.mockImplementation(makeFetchMock([], undefined, 404));
    setupCopilotKit(fetchMock);

    const { result } = renderHook(() => useMemories());

    act(() => {
      activateStore();
    });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(false);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("refresh() re-pulls the snapshot and resolves", async () => {
    fetchMock.mockImplementation(makeFetchMock([wireMemory("m1")]));
    setupCopilotKit(fetchMock);

    const { result } = renderHook(() => useMemories());

    act(() => {
      activateStore();
    });

    await waitFor(() =>
      expect(result.current.memories.map((m) => m.id)).toEqual(["m1"]),
    );

    const callsBefore = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === `${RUNTIME_URL}/memories` &&
        (init?.method ?? "GET").toUpperCase() === "GET",
    ).length;

    await act(async () => {
      await result.current.refresh();
    });

    const callsAfter = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === `${RUNTIME_URL}/memories` &&
        (init?.method ?? "GET").toUpperCase() === "GET",
    ).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("refresh() rejects when the re-pull fails", async () => {
    fetchMock.mockImplementation(makeFetchMock([wireMemory("m1")]));
    setupCopilotKit(fetchMock);

    const { result } = renderHook(() => useMemories());

    act(() => {
      activateStore();
    });

    await waitFor(() =>
      expect(result.current.memories.map((m) => m.id)).toEqual(["m1"]),
    );

    fetchMock.mockImplementation(makeFetchMock([], undefined, 500));

    await expect(
      act(async () => {
        await result.current.refresh();
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
