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
import { ɵcreateMemoryStore } from "@copilotkit/core";
import type { ɵMemoryStore } from "@copilotkit/core";
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

/**
 * Builds a fetch mock that routes by URL + method. The store always POSTs
 * `/memories/subscribe` for realtime join credentials on `setContext`, so the
 * mock must answer that endpoint alongside the snapshot GET and the mutation
 * call. The phoenix socket never connects under jsdom; that path is covered by
 * core's `memory.test.ts`. `onMutation` returns the body for the create /
 * supersede / retire request (or `undefined` for a bodyless DELETE).
 */
function makeFetchMock(
  snapshot: WireMemory[],
  onMutation?: (url: string, method: string) => unknown,
): Mock {
  return vi.fn((input: string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url === `${RUNTIME_URL}/memories` && method === "GET") {
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
  store.setContext({
    runtimeUrl: RUNTIME_URL,
    wsUrl: "wss://gw.example.com/client",
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
});
