import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCoreRuntimeConnectionStatus } from "../core";
import {
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
} from "../threads";
import type { ɵThread, ɵThreadRuntimeContext } from "../threads";

interface FetchCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

type JsonFetch = typeof fetch & {
  calls: FetchCall[];
};

const threadEndpoints = {
  list: true,
  inspect: true,
  mutations: true,
  realtimeMetadata: true,
};

const sampleThreads: ɵThread[] = [
  {
    id: "thread-1",
    organizationId: "org-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "Thread One",
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

function jsonFetch(responses: unknown[], status = 200): JsonFetch {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ input, init });
    const body = responses[Math.min(index, responses.length - 1)] ?? {};
    index += 1;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return Object.assign(fetchImpl, { calls });
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function context(
  overrides: Partial<ɵThreadRuntimeContext> = {},
): ɵThreadRuntimeContext {
  return {
    runtimeUrl: "https://runtime.example.com",
    headers: {},
    agentId: "agent-1",
    threadEndpoints,
    ...overrides,
  };
}

describe("shared thread store context behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reset or refetch when setContext receives the same context reference", async () => {
    const fetch = jsonFetch([{ threads: sampleThreads }]);
    vi.stubGlobal("fetch", fetch);
    const store = ɵcreateThreadStore({ fetch });
    const stableContext = context();

    store.start();
    store.setContext(stableContext);
    await flushEffects();

    expect(fetch.calls).toHaveLength(1);
    expect(ɵselectThreads(store.getState())).toHaveLength(1);

    store.setContext(stableContext);
    await flushEffects();

    expect(fetch.calls).toHaveLength(1);
    expect(ɵselectThreads(store.getState())).toHaveLength(1);
    store.stop();
  });

  it("surfaces unavailable thread list endpoints as an error without fetching", async () => {
    const fetch = jsonFetch([{ threads: sampleThreads }]);
    vi.stubGlobal("fetch", fetch);
    const store = ɵcreateThreadStore({ fetch });

    store.start();
    store.setContext(
      context({
        threadEndpoints: {
          list: false,
          inspect: false,
          mutations: false,
          realtimeMetadata: false,
        },
      }),
    );
    await flushEffects();

    expect(fetch.calls).toHaveLength(0);
    expect(ɵselectThreads(store.getState())).toEqual([]);
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "Thread endpoints are not available on this CopilotKit runtime",
    );
    store.stop();
  });

  it("surfaces missing thread endpoint capability info as an error without fetching", async () => {
    const fetch = jsonFetch([{ threads: sampleThreads }]);
    vi.stubGlobal("fetch", fetch);
    const store = ɵcreateThreadStore({ fetch });

    store.start();
    store.setContext(context({ threadEndpoints: undefined }));
    await flushEffects();

    expect(fetch.calls).toHaveLength(0);
    expect(ɵselectThreads(store.getState())).toEqual([]);
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "Thread endpoints are not available on this CopilotKit runtime",
    );
    store.stop();
  });

  it("surfaces runtime info failures as an error without fetching", async () => {
    const fetch = jsonFetch([{ threads: sampleThreads }]);
    vi.stubGlobal("fetch", fetch);
    const store = ɵcreateThreadStore({ fetch });

    store.start();
    store.setContext(
      context({
        runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Error,
      }),
    );
    await flushEffects();

    expect(fetch.calls).toHaveLength(0);
    expect(ɵselectThreads(store.getState())).toEqual([]);
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "CopilotKit runtime info is unavailable",
    );
    store.stop();
  });

  it("revalidates list capability changes without requiring a new context reference", async () => {
    const fetch = jsonFetch([{ threads: sampleThreads }]);
    vi.stubGlobal("fetch", fetch);
    const store = ɵcreateThreadStore({ fetch });
    const stableContext = context();

    store.start();
    store.setContext(stableContext);
    await flushEffects();

    expect(fetch.calls).toHaveLength(1);
    expect(ɵselectThreads(store.getState())).toHaveLength(1);

    stableContext.threadEndpoints = {
      list: false,
      inspect: true,
      mutations: true,
      realtimeMetadata: true,
    };
    store.setContext(stableContext);
    await flushEffects();

    expect(fetch.calls).toHaveLength(1);
    expect(ɵselectThreads(store.getState())).toEqual([]);
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "Thread endpoints are not available on this CopilotKit runtime",
    );
    store.stop();
  });

  it("rejects mutations in core when the runtime reports mutations are unsupported", async () => {
    const fetch = jsonFetch([{ threads: sampleThreads }]);
    vi.stubGlobal("fetch", fetch);
    const store = ɵcreateThreadStore({ fetch });

    store.start();
    store.setContext(
      context({
        threadEndpoints: {
          list: true,
          inspect: true,
          mutations: false,
          realtimeMetadata: false,
        },
      }),
    );
    await flushEffects();
    fetch.calls.splice(0);

    await expect(store.renameThread("thread-1", "Renamed")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );

    expect(fetch.calls).toHaveLength(0);
    expect(ɵselectThreadsError(store.getState())?.message).toBe(
      "Thread mutations are not available on this CopilotKit runtime",
    );
    store.stop();
  });
});
