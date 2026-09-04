import { expect, test, vi } from "vitest";

import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from "../core";

const RUNTIME_URL = "https://runtime.example.com/api/copilotkit";

interface SetupOptions {
  capability?: boolean;
  transport?: "rest" | "single";
}

/** Connects a core to a mocked runtime and returns isolated cleanup. */
async function setup(options: SetupOptions = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};

  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          mode: "intelligence",
          intelligence: { wsUrl: "wss://runtime.example.com/client" },
          threadEndpoints: {
            list: false,
            inspect: false,
            mutations: false,
            realtimeMetadata: false,
          },
          ...(options.capability
            ? {
                singleRoute: {
                  resourceOperations: true,
                  threadEndpoints: {
                    list: true,
                    inspect: true,
                    mutations: true,
                    realtimeMetadata: true,
                  },
                },
              }
            : {}),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  globalThis.fetch = fetchMock;

  const core = new CopilotKitCore({
    runtimeUrl: RUNTIME_URL,
    runtimeTransport: options.transport ?? "single",
  });
  await vi.waitFor(() => {
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  return {
    core,
    fetchMock,
    teardown: () => {
      core.setRuntimeUrl(undefined);
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
      vi.restoreAllMocks();
    },
  };
}

test("single transport sends every Intelligence resource operation to one URL", async () => {
  const context = await setup({ capability: true });
  const controller = new AbortController();
  const cases = [
    { path: "/threads?agentId=researcher", method: "GET" },
    { path: "/threads/subscribe", method: "POST", body: {} },
    { path: "/threads/thread-1", method: "PATCH", body: { name: "New" } },
    { path: "/threads/thread-1", method: "DELETE", body: {} },
    {
      path: "/threads/thread-1/archive",
      method: "POST",
      body: { archived: true },
    },
    { path: "/threads/thread-1/messages", method: "GET" },
    { path: "/threads/thread-1/events", method: "GET" },
    { path: "/threads/thread-1/state", method: "GET" },
    { path: "/threads/clear", method: "POST", body: {} },
    { path: "/memories", method: "GET" },
    { path: "/memories", method: "POST", body: { content: "Fact" } },
    { path: "/memories/recall", method: "POST", body: { query: "Fact" } },
    { path: "/memories/subscribe", method: "POST", body: {} },
    {
      path: "/memories/memory-1",
      method: "PATCH",
      body: { content: "New fact" },
    },
    { path: "/memories/memory-1", method: "DELETE", body: {} },
    { path: "/annotate", method: "POST", body: { threadId: "thread-1" } },
  ];

  try {
    context.fetchMock.mockClear();
    for (const input of cases) {
      await context.core.ɵruntimeFetch(`${RUNTIME_URL}${input.path}`, {
        method: input.method,
        headers: {
          Authorization: "Bearer browser-token",
          ...(input.body ? { "Content-Type": "application/json" } : {}),
        },
        credentials: "include",
        signal: controller.signal,
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      });
    }

    expect(context.fetchMock).toHaveBeenCalledTimes(cases.length);
    for (const [index, input] of cases.entries()) {
      const [url, init] = context.fetchMock.mock.calls[index] as [
        RequestInfo | URL,
        RequestInit,
      ];
      expect(url).toBe(RUNTIME_URL);
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(init.signal).toBe(controller.signal);
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer browser-token",
      );
      expect(JSON.parse(init.body as string)).toEqual({
        method: "resource/request",
        params: { path: input.path, httpMethod: input.method },
        ...(input.body ? { body: input.body } : {}),
      });
    }
    expect(context.core.threadEndpoints).toEqual({
      list: true,
      inspect: true,
      mutations: true,
      realtimeMetadata: true,
    });
  } finally {
    context.teardown();
  }
});

test("single transport keeps legacy resource behavior without the capability", async () => {
  const context = await setup();
  const url = `${RUNTIME_URL}/threads`;

  try {
    context.fetchMock.mockClear();
    await context.core.ɵruntimeFetch(url, { method: "GET" });

    expect(context.fetchMock).toHaveBeenCalledWith(url, { method: "GET" });
    expect(context.core.threadEndpoints).toEqual({
      list: false,
      inspect: false,
      mutations: false,
      realtimeMetadata: false,
    });
  } finally {
    context.teardown();
  }
});

test("REST transport ignores the single-route capability", async () => {
  const context = await setup({ capability: true, transport: "rest" });
  const url = `${RUNTIME_URL}/threads`;

  try {
    context.fetchMock.mockClear();
    await context.core.ɵruntimeFetch(url, { method: "GET" });

    expect(context.fetchMock).toHaveBeenCalledWith(url, { method: "GET" });
    expect(context.core.threadEndpoints).toEqual({
      list: false,
      inspect: false,
      mutations: false,
      realtimeMetadata: false,
    });
  } finally {
    context.teardown();
  }
});

test("the core memory store uses the single-route resource transport", async () => {
  const context = await setup({ capability: true });

  try {
    context.fetchMock.mockClear();
    context.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ memories: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const store = context.core.getMemoryStore();
    const refresh = store.refresh();
    await vi.waitFor(() => {
      expect(context.fetchMock).toHaveBeenCalled();
    });

    const [url, init] = context.fetchMock.mock.calls[0] as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(url).toBe(RUNTIME_URL);
    expect(JSON.parse(init.body as string)).toMatchObject({
      method: "resource/request",
      params: { path: "/memories", httpMethod: "GET" },
    });
    await refresh;
  } finally {
    context.teardown();
  }
});
