import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  type ɵThreadStore,
} from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";
import { injectThreads, ThreadsStore } from "./threads";

/**
 * Minimal thread record matching the platform `/threads` list payload, with
 * sensible defaults so tests only specify the fields they assert on.
 */
function threadRecord(
  overrides: Partial<{
    id: string;
    organizationId: string;
    agentId: string;
    createdById: string;
    name: string | null;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
    lastRunAt: string;
  }>,
): Record<string, unknown> {
  return {
    id: "t-1",
    organizationId: "org-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: null,
    archived: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Builds a Response-like object accepted by rxjs `fromFetch`. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  const ok = init?.ok ?? true;
  return {
    ok,
    status: init?.status ?? (ok ? 200 : 500),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Stub of the ambient {@link CopilotKit} service. Exposes the signals and the
 * `core` surface that {@link ThreadsStore} reads, plus spies for the thread
 * store registry.
 */
type ThreadEndpointsStub = {
  list: boolean;
  inspect: boolean;
  mutations: boolean;
  realtimeMetadata: boolean;
};

class CopilotKitStub {
  readonly #runtimeConnectionStatus =
    signal<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );
  readonly #runtimeUrl = signal<string | undefined>(undefined);
  readonly #headers = signal<Record<string, string>>({});
  // `threadEndpoints`/`intelligence` are signals (mirroring the real
  // CopilotKit wrapper) so the threads store's context-sync effect re-runs
  // when `/info` populates them — including `wsUrl` arriving after Connected.
  readonly #threadEndpoints = signal<ThreadEndpointsStub | undefined>(
    undefined,
  );
  readonly #intelligence = signal<{ wsUrl: string } | undefined>(undefined);

  readonly runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  readonly runtimeUrl = this.#runtimeUrl.asReadonly();
  readonly headers = this.#headers.asReadonly();
  readonly threadEndpoints = this.#threadEndpoints.asReadonly();
  readonly intelligence = this.#intelligence.asReadonly();

  readonly registerThreadStore =
    vi.fn<(id: string, store: ɵThreadStore) => void>();
  readonly unregisterThreadStore = vi.fn<(id: string) => void>();

  readonly core = {
    registerThreadStore: this.registerThreadStore,
    unregisterThreadStore: this.unregisterThreadStore,
    get intelligence() {
      return stub.intelligence();
    },
    get threadEndpoints() {
      return stub.threadEndpoints();
    },
  };

  setRuntimeUrl(value: string | undefined): void {
    this.#runtimeUrl.set(value);
  }
  setRuntimeConnectionStatus(
    value: CopilotKitCoreRuntimeConnectionStatus,
  ): void {
    this.#runtimeConnectionStatus.set(value);
  }
  setHeaders(value: Record<string, string>): void {
    this.#headers.set(value);
  }
  setThreadEndpoints(value: ThreadEndpointsStub | undefined): void {
    this.#threadEndpoints.set(value);
  }
  setIntelligence(value: { wsUrl: string } | undefined): void {
    this.#intelligence.set(value);
  }
}

// Referenced by the `core` getters above so they always read live stub state.
let stub: CopilotKitStub;

/**
 * Sets up a TestBed with the stubbed CopilotKit service and a configurable
 * fetch mock, and returns helpers for driving the runtime and flushing async
 * work. Follows the SIFERS pattern.
 */
function setup() {
  TestBed.resetTestingModule();
  stub = new CopilotKitStub();
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn<typeof fetch>();
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  TestBed.configureTestingModule({
    providers: [{ provide: CopilotKit, useValue: stub }],
  });

  const connect = (
    options: {
      list?: boolean;
      mutations?: boolean;
      wsUrl?: string;
    } = {},
  ): void => {
    stub.setThreadEndpoints({
      list: options.list ?? true,
      inspect: true,
      mutations: options.mutations ?? true,
      realtimeMetadata: false,
    });
    if (options.wsUrl) {
      stub.setIntelligence({ wsUrl: options.wsUrl });
    }
    stub.setRuntimeUrl("https://runtime.local");
    stub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  };

  // Drains the microtask/macrotask queue so the rxjs fetch pipeline (defer →
  // fromFetch → json() → reducer) and the signal bridges settle.
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const teardown = (): void => {
    globalThis.fetch = originalFetch;
  };

  return { stub, fetchMock, connect, flush, teardown };
}

describe("injectThreads", () => {
  let active: ReturnType<typeof setup> | undefined;

  beforeEach(() => {
    active = setup();
  });

  afterEach(() => {
    active?.teardown();
    active = undefined;
  });

  it("registers a thread store with core for the active agent", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(fixture.componentInstance.threads).toBeInstanceOf(ThreadsStore);
    expect(active!.stub.registerThreadStore).toHaveBeenCalledWith(
      "agent-1",
      expect.anything(),
    );
  });

  it("does not register the thread store when disabled (avoids evicting a live store for the same agent)", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1", enabled: false });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(active!.stub.registerThreadStore).not.toHaveBeenCalled();
  });

  it("reports a configuration error when no runtime URL is set", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const result = fixture.componentInstance.threads;
    expect(result.error()?.message).toBe("Runtime URL is not configured");
    expect(result.isLoading()).toBe(false);
  });

  it("synthesizes loading before the first context dispatch", () => {
    active!.fetchMock.mockReturnValue(
      new Promise<Response>(() => {
        /* never resolves: keep the list fetch pending */
      }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    // Runtime URL is set but not yet Connected: pre-connect loading is on.
    active!.stub.setRuntimeUrl("https://runtime.local");
    fixture.detectChanges();

    expect(fixture.componentInstance.threads.isLoading()).toBe(true);
  });

  it("fetches and sorts threads once the runtime is connected", async () => {
    active!.fetchMock.mockResolvedValue(
      jsonResponse({
        threads: [
          threadRecord({
            id: "older",
            lastRunAt: "2024-01-01T00:00:00.000Z",
          }),
          threadRecord({
            id: "newer",
            lastRunAt: "2024-02-01T00:00:00.000Z",
          }),
        ],
      }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    const result = fixture.componentInstance.threads;
    expect(result.threads().map((t) => t.id)).toEqual(["newer", "older"]);
    expect(result.isLoading()).toBe(false);
    expect(result.error()).toBeNull();
  });

  it("includes the WebSocket URL in the dispatched context when connected", async () => {
    active!.fetchMock.mockResolvedValue(jsonResponse({ threads: [] }));

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect({ wsUrl: "wss://runtime.local/ws" });
    fixture.detectChanges();
    await active!.flush();

    // The list endpoint is hit exactly once: the context carried wsUrl from
    // the start, so no redundant second fetch is issued.
    const listCalls = active!.fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/threads?"),
    );
    expect(listCalls.length).toBe(1);
  });

  it("optimistically renames a thread before the server responds", async () => {
    active!.fetchMock.mockResolvedValueOnce(
      jsonResponse({ threads: [threadRecord({ id: "t-1", name: "Old" })] }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    const result = fixture.componentInstance.threads;
    expect(result.threads()[0].name).toBe("Old");

    // Hold the rename request open so we can observe the optimistic state.
    let resolveRename: (value: Response) => void = () => {};
    active!.fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRename = resolve;
      }),
    );

    const renamePromise = result.renameThread("t-1", "New");
    expect(result.threads()[0].name).toBe("New");
    expect(result.isMutating()).toBe(true);

    resolveRename(jsonResponse(null));
    await renamePromise;
    await active!.flush();
    expect(result.isMutating()).toBe(false);
  });

  it("rolls back an optimistic delete when the server rejects it", async () => {
    active!.fetchMock.mockResolvedValueOnce(
      jsonResponse({ threads: [threadRecord({ id: "t-1", name: "Keep" })] }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    const result = fixture.componentInstance.threads;
    expect(result.threads().map((t) => t.id)).toEqual(["t-1"]);

    active!.fetchMock.mockResolvedValueOnce(
      jsonResponse(null, { ok: false, status: 500 }),
    );

    const deletePromise = result.deleteThread("t-1");
    // Optimistically removed.
    expect(result.threads()).toEqual([]);

    await expect(deletePromise).rejects.toThrow();
    await active!.flush();
    // Rolled back: the row is restored.
    expect(result.threads().map((t) => t.id)).toEqual(["t-1"]);
  });

  it("rejects mutations when the runtime does not support them", async () => {
    active!.fetchMock.mockResolvedValue(
      jsonResponse({ threads: [threadRecord({ id: "t-1" })] }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect({ mutations: false });
    fixture.detectChanges();
    await active!.flush();

    const result = fixture.componentInstance.threads;
    await expect(result.renameThread("t-1", "x")).rejects.toThrow(
      /Thread mutations are not available/,
    );
  });

  it("refetchThreads re-issues the list request without clearing the list", async () => {
    active!.fetchMock.mockResolvedValue(
      jsonResponse({ threads: [threadRecord({ id: "t-1" })] }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    const result = fixture.componentInstance.threads;
    const before = active!.fetchMock.mock.calls.length;

    result.refetchThreads();
    await active!.flush();

    const listCalls = active!.fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/threads?"),
    );
    expect(active!.fetchMock.mock.calls.length).toBeGreaterThan(before);
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
    // The list is preserved across the refetch.
    expect(result.threads().map((t) => t.id)).toEqual(["t-1"]);
  });

  it("startNewThread clears any error without adding a phantom row", async () => {
    active!.fetchMock.mockResolvedValue(
      jsonResponse(null, { ok: false, status: 500 }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    const result = fixture.componentInstance.threads;
    expect(result.error()).not.toBeNull();

    result.startNewThread();
    await active!.flush();

    expect(result.error()).toBeNull();
    expect(result.threads()).toEqual([]);
  });

  it("re-dispatches a single fetch carrying wsUrl when it arrives after Connected", async () => {
    active!.fetchMock.mockResolvedValue(jsonResponse({ threads: [] }));

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    // Connect WITHOUT wsUrl first: the runtime reports Connected before
    // `/info` has populated `intelligence.wsUrl`.
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    // wsUrl lands later, without any connection-status transition.
    active!.stub.setIntelligence({ wsUrl: "wss://runtime.local/ws" });
    fixture.detectChanges();
    await active!.flush();

    // The effect re-ran when wsUrl landed (its signature changed), so a second
    // list fetch — this one for the wsUrl-bearing context — was dispatched.
    // Before the reactive-wsUrl fix the effect would not re-run and only one
    // fetch (with wsUrl undefined) would ever be issued. Two total proves the
    // re-dispatch fired exactly once (no loop, no silent drop).
    const listCalls = active!.fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/threads?"),
    );
    expect(listCalls.length).toBe(2);
  });

  it("does not re-dispatch when headers change key order only", async () => {
    active!.fetchMock.mockResolvedValue(jsonResponse({ threads: [] }));
    active!.stub.setHeaders({ a: "1", b: "2" });

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    const before = active!.fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/threads?"),
    ).length;

    // Same entries, different insertion order: signature must be unchanged.
    active!.stub.setHeaders({ b: "2", a: "1" });
    fixture.detectChanges();
    await active!.flush();

    const after = active!.fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/threads?"),
    ).length;
    expect(after).toBe(before);
  });

  it("keeps destructured fetchMoreThreads/refetchThreads/startNewThread callable", async () => {
    active!.fetchMock.mockResolvedValue(
      jsonResponse({ threads: [threadRecord({ id: "t-1" })] }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1", limit: 10 });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    const { fetchMoreThreads, refetchThreads, startNewThread } =
      fixture.componentInstance.threads;

    expect(() => fetchMoreThreads()).not.toThrow();
    expect(() => refetchThreads()).not.toThrow();
    expect(() => startNewThread()).not.toThrow();
  });

  it("stays inert and issues no fetch when enabled is false", async () => {
    active!.fetchMock.mockResolvedValue(jsonResponse({ threads: [] }));

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1", enabled: false });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect({ wsUrl: "wss://runtime.local/ws" });
    fixture.detectChanges();
    await active!.flush();

    const result = fixture.componentInstance.threads;
    const listCalls = active!.fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/threads?"),
    );
    expect(listCalls.length).toBe(0);
    // No synthesized perpetual loading state for a gated surface.
    expect(result.isLoading()).toBe(false);
  });

  it("activates and fetches once a signal-driven enabled flag flips true", async () => {
    active!.fetchMock.mockResolvedValue(jsonResponse({ threads: [] }));
    const enabled = signal(false);

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1", enabled });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    expect(
      active!.fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/threads?"),
      ).length,
    ).toBe(0);

    enabled.set(true);
    fixture.detectChanges();
    await active!.flush();

    expect(
      active!.fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/threads?"),
      ).length,
    ).toBe(1);
  });

  it("listError is null when only a dev/config error is present (runtime URL not configured)", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const result = fixture.componentInstance.threads;
    // No runtime URL set: error() reports the dev/config error, listError() must be null.
    expect(result.error()?.message).toBe("Runtime URL is not configured");
    expect(result.listError()).toBeNull();
  });

  it("listError is null when only an endpoints-unavailable dev error is present", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    // Connect with list=false so the endpoints dev error fires.
    active!.connect({ list: false });
    fixture.detectChanges();

    const result = fixture.componentInstance.threads;
    expect(result.error()?.message).toMatch(
      /Thread endpoints are not available/,
    );
    expect(result.listError()).toBeNull();
  });

  it("listError returns the genuine store error when a list fetch fails", async () => {
    active!.fetchMock.mockResolvedValue(
      jsonResponse(null, { ok: false, status: 500 }),
    );

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    active!.connect();
    fixture.detectChanges();
    await active!.flush();

    const result = fixture.componentInstance.threads;
    // A genuine fetch failure should surface on both error() and listError().
    expect(result.error()).not.toBeNull();
    expect(result.listError()).not.toBeNull();
    expect(result.listError()?.message).toBe(result.error()?.message);
  });

  it("unregisters the thread store and stops the core store on destroy", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const store = fixture.componentInstance.threads as ThreadsStore;
    const teardownSpy = vi.spyOn(store, "teardown");

    fixture.destroy();

    expect(teardownSpy).toHaveBeenCalled();
    expect(active!.stub.unregisterThreadStore).toHaveBeenCalledWith("agent-1");
  });
});
