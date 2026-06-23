import { Component, Signal, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  type ɵThreadRuntimeContext,
} from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";
import { injectThreads } from "./threads";

const mockCreateThreadStore = vi.hoisted(() => vi.fn());

class MockThreadStore {
  readonly start = vi.fn();
  readonly stop = vi.fn();
  readonly setContext = vi.fn((context: ɵThreadRuntimeContext | null) => {
    if (context === this.context) return;
    this.context = context;
    if (context === null) {
      this.state = {
        ...this.state,
        threads: [],
        isLoading: false,
        error: null,
        nextCursor: null,
        isFetchingNextPage: false,
      };
      this.emit();
      return;
    }
    if (context?.threadEndpoints?.list === false) {
      this.state = {
        ...this.state,
        threads: [],
        isLoading: false,
        error: new Error(
          "Thread endpoints are not available on this CopilotKit runtime",
        ),
      };
      this.emit();
    }
  });
  readonly fetchNextPage = vi.fn();
  readonly renameThread = vi.fn(async (_threadId: string, _name: string) => {
    if (this.context?.threadEndpoints?.mutations === false) {
      throw new Error(
        "Thread mutations are not available on this CopilotKit runtime",
      );
    }
  });
  readonly archiveThread = vi.fn(async (_threadId: string) => {
    if (this.context?.threadEndpoints?.mutations === false) {
      throw new Error(
        "Thread mutations are not available on this CopilotKit runtime",
      );
    }
  });
  readonly deleteThread = vi.fn(async (_threadId: string) => {
    if (this.context?.threadEndpoints?.mutations === false) {
      throw new Error(
        "Thread mutations are not available on this CopilotKit runtime",
      );
    }
  });

  context: ɵThreadRuntimeContext | null = null;
  state = {
    threads: [] as Array<{
      id: string;
      organizationId: string;
      agentId: string;
      createdById: string;
      name: string | null;
      archived: boolean;
      createdAt: string;
      updatedAt: string;
      lastRunAt?: string;
    }>,
    isLoading: false,
    error: null as Error | null,
    nextCursor: null as string | null,
    isFetchingNextPage: false,
  };
  #listeners = new Set<() => void>();

  getState() {
    return this.state;
  }

  select(selector: (state: MockThreadStore["state"]) => unknown) {
    return {
      subscribe: (listener: () => void) => {
        this.#listeners.add(listener);
        return {
          unsubscribe: () => {
            this.#listeners.delete(listener);
          },
        };
      },
      getValue: () => selector(this.state),
    };
  }

  setState(nextState: Partial<MockThreadStore["state"]>) {
    this.state = { ...this.state, ...nextState };
    this.emit();
  }

  emit() {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

vi.mock("@copilotkit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@copilotkit/core")>();

  return {
    ...actual,
    ɵcreateThreadStore: mockCreateThreadStore,
  };
});

class CopilotKitStub {
  readonly #runtimeUrl = signal<string | undefined>("https://runtime.local");
  readonly runtimeUrl = this.#runtimeUrl.asReadonly();
  readonly #runtimeConnectionStatus =
    signal<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  readonly runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  readonly #headers = signal<Record<string, string>>({
    Authorization: "token",
  });
  readonly headers = this.#headers.asReadonly();
  readonly #intelligence = signal<{ wsUrl: string } | undefined>({
    wsUrl: "wss://runtime.local/client",
  });
  readonly intelligence = this.#intelligence.asReadonly();
  readonly #threadEndpoints = signal<
    | {
        list: boolean;
        inspect: boolean;
        mutations: boolean;
        realtimeMetadata: boolean;
      }
    | undefined
  >({
    list: true,
    inspect: true,
    mutations: true,
    realtimeMetadata: true,
  });
  readonly threadEndpoints = this.#threadEndpoints.asReadonly();
  readonly registerThreadStore = vi.fn();
  readonly unregisterThreadStore = vi.fn();

  setRuntimeUrl(runtimeUrl: string | undefined) {
    this.#runtimeUrl.set(runtimeUrl);
  }

  setRuntimeConnectionStatus(status: CopilotKitCoreRuntimeConnectionStatus) {
    this.#runtimeConnectionStatus.set(status);
  }

  setHeaders(headers: Record<string, string>) {
    this.#headers.set(headers);
  }

  setIntelligence(intelligence: { wsUrl: string } | undefined) {
    this.#intelligence.set(intelligence);
  }

  setThreadEndpoints(
    threadEndpoints:
      | {
          list: boolean;
          inspect: boolean;
          mutations: boolean;
          realtimeMetadata: boolean;
        }
      | undefined,
  ) {
    this.#threadEndpoints.set(threadEndpoints);
  }
}

describe("injectThreads", () => {
  let copilotKitStub: CopilotKitStub;
  let store: MockThreadStore;

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    store = new MockThreadStore();
    mockCreateThreadStore.mockReturnValue(store);
    copilotKitStub = new CopilotKitStub();

    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useValue: copilotKitStub }],
    });
  });

  it("works in an injection context with static inputs", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      threadsResult = injectThreads({
        agentId: "agent-1",
        includeArchived: true,
        limit: 25,
      });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(mockCreateThreadStore).toHaveBeenCalledWith({
      fetch: globalThis.fetch,
    });
    expect(store.start).toHaveBeenCalledTimes(1);
    expect(copilotKitStub.registerThreadStore).toHaveBeenCalledWith(
      "agent-1",
      store,
    );
    expect(store.setContext).toHaveBeenLastCalledWith({
      runtimeUrl: "https://runtime.local",
      headers: { Authorization: "token" },
      wsUrl: "wss://runtime.local/client",
      agentId: "agent-1",
      includeArchived: true,
      limit: 25,
      threadEndpoints: {
        list: true,
        inspect: true,
        mutations: true,
        realtimeMetadata: true,
      },
    });
    expect(fixture.componentInstance.threadsResult.isLoading()).toBe(false);
  });

  it("updates context and registration when signal inputs change", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      agentId = signal<string | undefined>("agent-1");
      includeArchived = signal<boolean | undefined>(false);
      limit = signal<number | undefined>(10);
      threadsResult = injectThreads({
        agentId: this.agentId,
        includeArchived: this.includeArchived,
        limit: this.limit,
      });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const firstContext = store.context;
    fixture.componentInstance.includeArchived.set(true);
    fixture.componentInstance.limit.set(20);
    fixture.detectChanges();

    expect(store.context).toEqual(
      expect.objectContaining({
        agentId: "agent-1",
        includeArchived: true,
        limit: 20,
      }),
    );
    expect(store.context).not.toBe(firstContext);

    fixture.componentInstance.agentId.set("agent-2");
    fixture.detectChanges();

    expect(copilotKitStub.unregisterThreadStore).toHaveBeenCalledWith(
      "agent-1",
      store,
    );
    expect(copilotKitStub.registerThreadStore).toHaveBeenCalledWith(
      "agent-2",
      store,
    );
    expect(store.context).toEqual(
      expect.objectContaining({ agentId: "agent-2" }),
    );
  });

  it("returns read fields as Angular signals with the public thread shape", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      threadsResult = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const result = fixture.componentInstance.threadsResult;

    assertSignal(result.threads);
    assertSignal(result.isLoading);
    assertSignal(result.error);
    assertSignal(result.hasMoreThreads);
    assertSignal(result.isFetchingMoreThreads);

    store.setState({
      threads: [
        {
          id: "thread-1",
          organizationId: "org-1",
          agentId: "agent-1",
          createdById: "user-1",
          name: "Plan",
          archived: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          lastRunAt: "2026-01-03T00:00:00.000Z",
        },
      ],
      nextCursor: "next",
      isFetchingNextPage: true,
    });

    expect(result.threads()).toEqual([
      {
        id: "thread-1",
        agentId: "agent-1",
        name: "Plan",
        archived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        lastRunAt: "2026-01-03T00:00:00.000Z",
      },
    ]);
    expect(result.hasMoreThreads()).toBe(true);
    expect(result.isFetchingMoreThreads()).toBe(true);
  });

  it("surfaces a visible error and no thread list when thread listing is disabled", () => {
    copilotKitStub.setThreadEndpoints({
      list: false,
      inspect: true,
      mutations: true,
      realtimeMetadata: false,
    });

    @Component({ standalone: true, template: "" })
    class Host {
      threadsResult = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(store.context?.threadEndpoints?.list).toBe(false);
    expect(fixture.componentInstance.threadsResult.threads()).toEqual([]);
    expect(fixture.componentInstance.threadsResult.error()?.message).toBe(
      "Thread endpoints are not available on this CopilotKit runtime",
    );
  });

  it("rejects mutations through the core store when thread mutations are disabled", async () => {
    copilotKitStub.setThreadEndpoints({
      list: true,
      inspect: true,
      mutations: false,
      realtimeMetadata: true,
    });

    @Component({ standalone: true, template: "" })
    class Host {
      threadsResult = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    await expect(
      fixture.componentInstance.threadsResult.renameThread("thread-1", "New"),
    ).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );
  });

  it("forwards mutation methods and fetchMoreThreads to the shared store", async () => {
    @Component({ standalone: true, template: "" })
    class Host {
      threadsResult = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const result = fixture.componentInstance.threadsResult;

    result.fetchMoreThreads();
    await result.renameThread("thread-1", "Renamed");
    await result.archiveThread("thread-1");
    await result.deleteThread("thread-1");

    expect(store.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(store.renameThread).toHaveBeenCalledWith("thread-1", "Renamed");
    expect(store.archiveThread).toHaveBeenCalledWith("thread-1");
    expect(store.deleteThread).toHaveBeenCalledWith("thread-1");
  });

  it("unregisters and stops the store on cleanup", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      threadsResult = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    fixture.destroy();

    expect(copilotKitStub.unregisterThreadStore).toHaveBeenCalledWith(
      "agent-1",
      store,
    );
    expect(store.stop).toHaveBeenCalledTimes(1);
  });

  it("does not show preconnect loading when the agent id signal is unresolved", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      agentId = signal<string | undefined>(undefined);
      threadsResult = injectThreads({ agentId: this.agentId });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(fixture.componentInstance.threadsResult.isLoading()).toBe(false);
    expect(store.setContext).toHaveBeenCalledWith(null);
    expect(copilotKitStub.registerThreadStore).not.toHaveBeenCalled();
  });

  it("clears stale threads when input changes while runtime is disconnected", () => {
    @Component({ standalone: true, template: "" })
    class Host {
      agentId = signal<string | undefined>("agent-1");
      threadsResult = injectThreads({ agentId: this.agentId });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    store.setState({
      threads: [
        {
          id: "thread-1",
          organizationId: "org-1",
          agentId: "agent-1",
          createdById: "user-1",
          name: "Plan",
          archived: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    expect(fixture.componentInstance.threadsResult.threads()).toHaveLength(1);

    copilotKitStub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    fixture.componentInstance.agentId.set("agent-2");
    fixture.detectChanges();

    expect(store.setContext).toHaveBeenLastCalledWith(null);
    expect(fixture.componentInstance.threadsResult.threads()).toEqual([]);
    expect(fixture.componentInstance.threadsResult.isLoading()).toBe(true);
  });

  it("waits for the connected runtime before setting context and shows preconnect loading", () => {
    copilotKitStub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );

    @Component({ standalone: true, template: "" })
    class Host {
      threadsResult = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(store.setContext).not.toHaveBeenCalled();
    expect(fixture.componentInstance.threadsResult.isLoading()).toBe(true);

    copilotKitStub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    fixture.detectChanges();

    expect(store.setContext).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1" }),
    );
  });
});

function assertSignal<T>(value: Signal<T>): void {
  expect(typeof value).toBe("function");
}
