import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import Harness from "./create-threads-harness.svelte";
import ReactiveHarness from "./create-threads-reactive-harness.svelte";

const LIVE_URL = "https://runtime.local/api/copilotkit";

function mockCore(overrides?: Partial<CopilotKitCoreSvelte>) {
  return {
    agents: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    runtimeUrl: undefined,
    runtimeTransport: "auto" as const,
    headers: {},
    getAgent: vi.fn(),
    subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    getTool: vi.fn(),
    addTool: vi.fn(),
    removeTool: vi.fn(),
    getSuggestions: vi.fn(() => ({ suggestions: [], isLoading: false })),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    reloadSuggestions: vi.fn(),
    clearSuggestions: vi.fn(),
    addSuggestionsConfig: vi.fn(),
    removeSuggestionsConfig: vi.fn(),
    addHookRenderToolCall: vi.fn(),
    removeHookRenderToolCall: vi.fn(),
    removeHookRenderToolCallByName: vi.fn(),
    addPropRenderToolCall: vi.fn(),
    removePropRenderToolCall: vi.fn(),
    setInterruptState: vi.fn(),
    registerThreadStore: vi.fn(),
    unregisterThreadStore: vi.fn(),
    ɵruntimeFetch: vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ threads: [] }),
        text: () => Promise.resolve(JSON.stringify({ threads: [] })),
      }),
    ),
    addContext: vi.fn(),
    removeContext: vi.fn(),
    ...overrides,
  } as unknown as CopilotKitCoreSvelte;
}

function mockContext(core: CopilotKitCoreSvelte): CopilotKitContextValue {
  return {
    copilotkit: core,
    executingToolCallIds: new Set<string>(),
    agents: core.agents,
    runtimeConnectionStatus: core.runtimeConnectionStatus,
    runtimeUrl: core.runtimeUrl,
    runtimeTransport: core.runtimeTransport,
    headers: core.headers,
    threadEndpoints: undefined,
    intelligence: undefined,
    licenseStatus: undefined,
  } as CopilotKitContextValue;
}

describe("createThreads", () => {
  it("shows error when runtime is not configured", async () => {
    const core = mockCore();
    const context = mockContext(core);
    const view = render(Harness, { props: { context, agentId: "test-agent" } });

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("threads").textContent!);
      expect(parsed.isLoading).toBe(false);
      expect(parsed.error).toBe("Runtime URL is not configured");
    });

    view.unmount();
  });

  it("returns empty threads when runtime is connected", async () => {
    const core = mockCore({
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeUrl: "http://localhost:4000",
      threadEndpoints: {
        list: true,
        mutations: true,
        inspect: true,
        realtimeMetadata: true,
      },
      registerThreadStore: vi.fn(),
      unregisterThreadStore: vi.fn(),
    });
    const context = mockContext(core);
    const view = render(Harness, { props: { context, agentId: "test-agent" } });

    await waitFor(() => {
      expect(core.registerThreadStore).toHaveBeenCalledWith(
        "test-agent",
        expect.anything(),
      );
    });

    view.unmount();
    expect(core.unregisterThreadStore).toHaveBeenCalledWith("test-agent");
  });

  it("throws if used outside CopilotKitProvider", () => {
    expect(() => {
      render(Harness, {
        props: {
          context: null as unknown as CopilotKitContextValue,
          agentId: "test",
        },
      });
    }).toThrow("createThreads must be used within CopilotKitProvider");
  });
});

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

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/**
 * The core mock carries STALE non-reactive fields on purpose (a stale
 * runtimeUrl, stale headers, list:false endpoints, Disconnected status). The
 * reactive harness drives the live values through the provider getters, so a
 * hook that reads stale core fields instead of the getters fetches the wrong
 * URL, sends the wrong headers, or never fetches at all.
 */
function setupLifecycleCore() {
  const fetchMock = vi.fn(async () => jsonResponse({ threads: sampleThreads }));
  const runtimeFetchMock = vi.fn((...args: unknown[]) =>
    (fetchMock as (...a: unknown[]) => unknown)(...args),
  );
  const registerThreadStore = vi.fn();
  const unregisterThreadStore = vi.fn();
  const core = {
    agents: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    runtimeUrl: "https://stale.test",
    runtimeTransport: "rest" as const,
    headers: { "X-Stale": "stale" },
    threadEndpoints: {
      list: false,
      inspect: false,
      mutations: false,
      realtimeMetadata: false,
    },
    intelligence: undefined,
    ɵruntimeFetch: runtimeFetchMock,
    registerThreadStore,
    unregisterThreadStore,
  } as unknown as CopilotKitCoreSvelte;
  return {
    core,
    fetchMock,
    runtimeFetchMock,
    registerThreadStore,
    unregisterThreadStore,
  };
}

type ThreadsView = {
  getByTestId: (testId: string) => HTMLElement;
};

function lifecycleState(view: ThreadsView) {
  return JSON.parse(view.getByTestId("threads").textContent!) as {
    threadIds: string[];
    isLoading: boolean;
    error: string | null;
    listError: string | null;
  };
}

type ListCallsMock = {
  mock: { calls: Array<Array<unknown>> };
};

function listCalls(runtimeFetchMock: ListCallsMock) {
  return runtimeFetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/threads?"),
  );
}

async function settle(ms = 80) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createThreads lifecycle parity", () => {
  const globalFetchMock = vi.fn(() =>
    Promise.reject(new Error("global fetch must not be used")),
  );

  afterEach(() => {
    vi.unstubAllGlobals();
    globalFetchMock.mockClear();
  });

  it("routes the list request through the exact core.ɵruntimeFetch and preserves the single-route runtime URL", async () => {
    vi.stubGlobal("fetch", globalFetchMock);
    const { core, fetchMock, runtimeFetchMock } = setupLifecycleCore();
    const view = render(ReactiveHarness, { props: { core } });

    await fireEvent.click(view.getByTestId("connect"));

    await waitFor(() => {
      expect(lifecycleState(view).threadIds).toEqual(["t-2", "t-1"]);
    });
    expect(lifecycleState(view).error).toBeNull();

    const calls = listCalls(runtimeFetchMock);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const [firstUrl, firstInit] = calls[0] ?? [];
    // Single-route base preserved: the request targets the configured
    // runtime URL verbatim rather than a bare origin or the stale core URL.
    expect(String(firstUrl)).toContain(
      "runtime.local/api/copilotkit/threads?agentId=agent-1",
    );
    expect(String(firstUrl)).not.toContain("stale");
    for (const [url] of runtimeFetchMock.mock.calls) {
      expect(String(url).startsWith(LIVE_URL)).toBe(true);
    }
    // Reactive headers flow into the request; stale core headers do not.
    expect(JSON.stringify(firstInit ?? {})).toContain("Bearer live-token");
    expect(JSON.stringify(firstInit ?? {})).not.toContain("stale");
    // Exact function identity: every request went through core.ɵruntimeFetch
    // and the global fetch was never touched.
    expect(fetchMock.mock.calls.length).toBe(
      runtimeFetchMock.mock.calls.length,
    );
    expect(globalFetchMock).not.toHaveBeenCalled();

    view.unmount();
  });

  it("does not register, unregister, or fetch while initially disabled", async () => {
    vi.stubGlobal("fetch", globalFetchMock);
    const {
      core,
      runtimeFetchMock,
      registerThreadStore,
      unregisterThreadStore,
    } = setupLifecycleCore();
    const view = render(ReactiveHarness, {
      props: { core, initialEnabled: false },
    });

    await fireEvent.click(view.getByTestId("connect"));
    await waitFor(() => {
      expect(lifecycleState(view).isLoading).toBe(false);
    });
    await settle();

    expect(registerThreadStore).not.toHaveBeenCalled();
    expect(unregisterThreadStore).not.toHaveBeenCalled();
    expect(listCalls(runtimeFetchMock)).toHaveLength(0);
    expect(lifecycleState(view).error).toBeNull();
    expect(globalFetchMock).not.toHaveBeenCalled();

    // Unmounting a never-registered hook unregisters nothing.
    view.unmount();
    expect(unregisterThreadStore).not.toHaveBeenCalled();
  });

  it("enabling registers and fetches; disabling unregisters the active id and stops further work", async () => {
    vi.stubGlobal("fetch", globalFetchMock);
    const {
      core,
      runtimeFetchMock,
      registerThreadStore,
      unregisterThreadStore,
    } = setupLifecycleCore();
    const view = render(ReactiveHarness, {
      props: { core, initialEnabled: false },
    });

    await fireEvent.click(view.getByTestId("connect"));
    await settle();
    expect(registerThreadStore).not.toHaveBeenCalled();

    await fireEvent.click(view.getByTestId("enable"));
    await waitFor(() => {
      expect(registerThreadStore).toHaveBeenCalledWith(
        "agent-1",
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(lifecycleState(view).threadIds).toEqual(["t-2", "t-1"]);
    });
    const fetchedAfterEnable = listCalls(runtimeFetchMock).length;
    expect(fetchedAfterEnable).toBeGreaterThanOrEqual(1);

    await fireEvent.click(view.getByTestId("disable"));
    await waitFor(() => {
      expect(unregisterThreadStore).toHaveBeenCalledWith("agent-1");
    });
    expect(registerThreadStore).toHaveBeenCalledTimes(1);
    expect(unregisterThreadStore).toHaveBeenCalledTimes(1);

    // Disabled: reactive changes must not dispatch context or fetch.
    await fireEvent.click(view.getByTestId("rotate-headers"));
    await fireEvent.click(view.getByTestId("show-endpoints"));
    await settle();
    expect(listCalls(runtimeFetchMock)).toHaveLength(fetchedAfterEnable);
    expect(lifecycleState(view).isLoading).toBe(false);

    // Already unregistered on disable: unmount must not unregister again.
    view.unmount();
    expect(unregisterThreadStore).toHaveBeenCalledTimes(1);
  });

  it("changing agentId unregisters the previous id and registers the next exactly once", async () => {
    const {
      core,
      runtimeFetchMock,
      registerThreadStore,
      unregisterThreadStore,
    } = setupLifecycleCore();
    const view = render(ReactiveHarness, { props: { core } });

    await fireEvent.click(view.getByTestId("connect"));
    await waitFor(() => {
      expect(registerThreadStore).toHaveBeenCalledWith(
        "agent-1",
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(lifecycleState(view).threadIds).toEqual(["t-2", "t-1"]);
    });

    await fireEvent.click(view.getByTestId("set-agent-2"));
    await waitFor(() => {
      expect(registerThreadStore).toHaveBeenCalledWith(
        "agent-2",
        expect.anything(),
      );
    });

    expect(registerThreadStore.mock.calls.map(([id]) => id)).toEqual([
      "agent-1",
      "agent-2",
    ]);
    expect(unregisterThreadStore.mock.calls.map(([id]) => id)).toEqual([
      "agent-1",
    ]);
    expect(
      listCalls(runtimeFetchMock).some(([url]) =>
        String(url).includes("agentId=agent-2"),
      ),
    ).toBe(true);

    view.unmount();
    expect(unregisterThreadStore.mock.calls.map(([id]) => id)).toEqual([
      "agent-1",
      "agent-2",
    ]);
  });

  it("unmount stops the store, clears its context, and unregisters only the active id", async () => {
    const {
      core,
      runtimeFetchMock,
      registerThreadStore,
      unregisterThreadStore,
    } = setupLifecycleCore();
    const view = render(ReactiveHarness, { props: { core } });

    await fireEvent.click(view.getByTestId("connect"));
    await waitFor(() => {
      expect(registerThreadStore).toHaveBeenCalledWith(
        "agent-1",
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(lifecycleState(view).threadIds).toEqual(["t-2", "t-1"]);
    });

    const [, registeredStore] = registerThreadStore.mock.calls[0] ?? [];
    const store = registeredStore as {
      setContext: (context: unknown) => void;
      stop: () => void;
    };
    const setContextSpy = vi.spyOn(store, "setContext");
    const stopSpy = vi.spyOn(store, "stop");

    view.unmount();

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(setContextSpy).toHaveBeenCalledWith(null);
    expect(unregisterThreadStore).toHaveBeenCalledTimes(1);
    expect(unregisterThreadStore).toHaveBeenCalledWith("agent-1");

    // No stray request or subscription work survives unmount.
    const frozen = runtimeFetchMock.mock.calls.length;
    await settle();
    expect(runtimeFetchMock.mock.calls.length).toBe(frozen);
  });

  it("observes reactive capability/runtime getter changes instead of stale core fields", async () => {
    const { core, runtimeFetchMock } = setupLifecycleCore();
    const view = render(ReactiveHarness, { props: { core } });

    await fireEvent.click(view.getByTestId("connect"));

    // The stale core fields (list:false endpoints, stale URL/headers) are
    // ignored: the live getters drive a successful fetch.
    await waitFor(() => {
      expect(lifecycleState(view).threadIds).toEqual(["t-2", "t-1"]);
    });
    expect(lifecycleState(view).error).toBeNull();

    // Revoking the list capability through the reactive getter surfaces the
    // dev error (kept out of the end-user listError channel) and freezes
    // fetching without touching the stale core fields.
    await fireEvent.click(view.getByTestId("hide-endpoints"));
    await waitFor(() => {
      expect(lifecycleState(view).error).toBe(
        "Thread endpoints are not available on this CopilotKit runtime",
      );
    });
    expect(lifecycleState(view).isLoading).toBe(false);
    expect(lifecycleState(view).listError).toBeNull();
    const frozen = listCalls(runtimeFetchMock).length;
    await settle(60);
    expect(listCalls(runtimeFetchMock)).toHaveLength(frozen);

    // Restoring the capability refetches and clears the error.
    await fireEvent.click(view.getByTestId("show-endpoints"));
    await waitFor(() => {
      expect(listCalls(runtimeFetchMock).length).toBeGreaterThan(frozen);
    });
    await waitFor(() => {
      expect(lifecycleState(view).error).toBeNull();
    });

    // Clearing the runtime URL through the reactive getter reports the
    // config error and issues no further list request.
    const frozenBeforeClear = listCalls(runtimeFetchMock).length;
    await fireEvent.click(view.getByTestId("clear-url"));
    await waitFor(() => {
      expect(lifecycleState(view).error).toBe("Runtime URL is not configured");
    });
    await settle(60);
    expect(listCalls(runtimeFetchMock)).toHaveLength(frozenBeforeClear);

    view.unmount();
  });

  it("refetches with the new params when limit/includeArchived getters change", async () => {
    const { core, runtimeFetchMock } = setupLifecycleCore();
    const view = render(ReactiveHarness, { props: { core } });

    await fireEvent.click(view.getByTestId("connect"));
    await waitFor(() => {
      expect(lifecycleState(view).threadIds).toEqual(["t-2", "t-1"]);
    });

    await fireEvent.click(view.getByTestId("set-limit"));
    await waitFor(() => {
      expect(
        listCalls(runtimeFetchMock).some(([url]) =>
          String(url).includes("limit=1"),
        ),
      ).toBe(true);
    });

    await fireEvent.click(view.getByTestId("set-archived"));
    await waitFor(() => {
      expect(
        listCalls(runtimeFetchMock).some(([url]) =>
          String(url).includes("includeArchived=true"),
        ),
      ).toBe(true);
    });

    view.unmount();
  });
});
