import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  type ɵThreadStore,
} from "@copilotkit/core";
import type { IntelligenceRuntimeInfo } from "@copilotkit/shared";
import { CopilotKit } from "./copilotkit";
import { injectThreads, ThreadsStore } from "./threads";

interface ThreadRecord {
  id: string;
  organizationId: string;
  agentId: string;
  createdById: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

const flushEffects = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function threadRecord(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "thread-1",
    organizationId: "org-1",
    agentId: "agent-1",
    createdById: "user-1",
    name: "First Thread",
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Minimal `core` surface that {@link ThreadsStore} reads/writes. */
class CoreStub {
  threadEndpoints:
    | {
        list: boolean;
        inspect: boolean;
        mutations: boolean;
        realtimeMetadata: boolean;
      }
    | undefined = {
    list: true,
    inspect: true,
    mutations: true,
    realtimeMetadata: false,
  };
  intelligence: IntelligenceRuntimeInfo | undefined = undefined;

  readonly registered = new Map<string, ɵThreadStore>();
  registerThreadStore = vi.fn((agentId: string, store: ɵThreadStore) => {
    this.registered.set(agentId, store);
  });
  unregisterThreadStore = vi.fn((agentId: string) => {
    this.registered.delete(agentId);
  });
}

class CopilotKitStub {
  readonly #runtimeConnectionStatus =
    signal<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );
  readonly #runtimeUrl = signal<string | undefined>(undefined);
  readonly #headers = signal<Record<string, string>>({});

  runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  runtimeUrl = this.#runtimeUrl.asReadonly();
  headers = this.#headers.asReadonly();
  core = new CoreStub();
  getAgent = vi.fn();

  setRuntimeConnectionStatus(value: CopilotKitCoreRuntimeConnectionStatus) {
    this.#runtimeConnectionStatus.set(value);
  }

  setRuntimeUrl(value: string | undefined) {
    this.#runtimeUrl.set(value);
  }

  setHeaders(value: Record<string, string>) {
    this.#headers.set(value);
  }
}

interface SetupOptions {
  runtimeUrl?: string;
  status?: CopilotKitCoreRuntimeConnectionStatus;
  headers?: Record<string, string>;
  fetchMock?: Mock;
}

function setup(options: SetupOptions = {}) {
  const stub = new CopilotKitStub();
  if (options.runtimeUrl !== undefined) stub.setRuntimeUrl(options.runtimeUrl);
  if (options.headers !== undefined) stub.setHeaders(options.headers);
  if (options.status !== undefined) {
    stub.setRuntimeConnectionStatus(options.status);
  }

  if (options.fetchMock) {
    vi.stubGlobal("fetch", options.fetchMock);
  }

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: CopilotKit, useValue: stub }],
  });

  return { stub };
}

@Component({ standalone: true, template: "" })
class ThreadsHost {
  threads = injectThreads({ agentId: "agent-1" });
}

function createHost() {
  const fixture = TestBed.createComponent(ThreadsHost);
  fixture.detectChanges();
  return fixture;
}

describe("injectThreads", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a ThreadsStore and registers it with core for the agent", () => {
    const { stub } = setup();
    const fixture = createHost();

    expect(fixture.componentInstance.threads).toBeInstanceOf(ThreadsStore);
    expect(stub.core.registerThreadStore).toHaveBeenCalledWith(
      "agent-1",
      expect.anything(),
    );
  });

  it("surfaces a configuration error when no runtime URL is set", () => {
    setup();
    const fixture = createHost();

    const store = fixture.componentInstance.threads;
    expect(store.error()?.message).toBe("Runtime URL is not configured");
    // No runtime URL means we never enter the loading state.
    expect(store.isLoading()).toBe(false);
    expect(store.threads()).toEqual([]);
  });

  it("synthesizes a loading state before context is dispatched", () => {
    setup({
      runtimeUrl: "https://runtime.example.com",
      status: CopilotKitCoreRuntimeConnectionStatus.Connecting,
    });
    const fixture = createHost();

    const store = fixture.componentInstance.threads;
    expect(store.isLoading()).toBe(true);
    expect(store.error()).toBeNull();
  });

  it("fetches and exposes the thread list once the runtime connects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        threads: [
          threadRecord({ id: "thread-1", updatedAt: "2026-01-01T00:00:00Z" }),
          threadRecord({
            id: "thread-2",
            name: "Newer Thread",
            updatedAt: "2026-01-02T00:00:00Z",
          }),
        ],
      }),
    });
    setup({
      runtimeUrl: "https://runtime.example.com",
      status: CopilotKitCoreRuntimeConnectionStatus.Connected,
      headers: { Authorization: "Bearer token" },
      fetchMock,
    });
    const fixture = createHost();

    await flushEffects();
    fixture.detectChanges();

    const store = fixture.componentInstance.threads;
    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/threads?agentId=agent-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(store.threads().map((thread) => thread.id)).toEqual([
      "thread-2",
      "thread-1",
    ]);
    expect(store.isLoading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it("exposes a fetch error and clears loading on a failed list request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    setup({
      runtimeUrl: "https://runtime.example.com",
      status: CopilotKitCoreRuntimeConnectionStatus.Connected,
      fetchMock,
    });
    const fixture = createHost();

    await flushEffects();
    fixture.detectChanges();

    const store = fixture.componentInstance.threads;
    expect(store.error()?.message).toMatch(/Failed to fetch threads: 500/);
    expect(store.isLoading()).toBe(false);
  });

  it("issues mutation requests for rename/archive/unarchive/delete", async () => {
    const listResponse = {
      ok: true,
      json: async () => ({ threads: [threadRecord()] }),
    };
    const mutationResponse = { ok: true, json: async () => null };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listResponse)
      .mockResolvedValue(mutationResponse);
    setup({
      runtimeUrl: "https://runtime.example.com",
      status: CopilotKitCoreRuntimeConnectionStatus.Connected,
      fetchMock,
    });
    const fixture = createHost();
    await flushEffects();

    const store = fixture.componentInstance.threads;
    await expect(
      store.renameThread("thread-1", "Renamed"),
    ).resolves.toBeUndefined();
    await expect(store.archiveThread("thread-1")).resolves.toBeUndefined();
    await expect(store.unarchiveThread("thread-1")).resolves.toBeUndefined();
    await expect(store.deleteThread("thread-1")).resolves.toBeUndefined();

    const calledPaths = fetchMock.mock.calls.map((call) => call[0]);
    expect(calledPaths).toContain(
      "https://runtime.example.com/threads/thread-1",
    );
    expect(calledPaths).toContain(
      "https://runtime.example.com/threads/thread-1/archive",
    );
  });

  it("rejects mutations when the runtime reports mutations are unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ threads: [] }),
    });
    const { stub } = setup({
      runtimeUrl: "https://runtime.example.com",
      status: CopilotKitCoreRuntimeConnectionStatus.Connected,
      fetchMock,
    });
    stub.core.threadEndpoints = {
      list: true,
      inspect: true,
      mutations: false,
      realtimeMetadata: false,
    };
    const fixture = createHost();
    await flushEffects();

    const store = fixture.componentInstance.threads;
    await expect(store.renameThread("thread-1", "Nope")).rejects.toThrow(
      /Thread mutations are not available/,
    );
  });

  it("reports an endpoint error and does not fetch when the list endpoint is unsupported", async () => {
    const fetchMock = vi.fn();
    const { stub } = setup({
      runtimeUrl: "https://runtime.example.com",
      status: CopilotKitCoreRuntimeConnectionStatus.Connected,
      fetchMock,
    });
    stub.core.threadEndpoints = {
      list: false,
      inspect: false,
      mutations: false,
      realtimeMetadata: false,
    };
    const fixture = createHost();
    await flushEffects();

    const store = fixture.componentInstance.threads;
    expect(store.error()?.message).toMatch(
      /Thread endpoints are not available/,
    );
    expect(store.isLoading()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unregisters the store and stops listening on destroy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ threads: [] }),
    });
    const { stub } = setup({
      runtimeUrl: "https://runtime.example.com",
      status: CopilotKitCoreRuntimeConnectionStatus.Connected,
      fetchMock,
    });
    const fixture = createHost();
    await flushEffects();

    fixture.destroy();

    expect(stub.core.unregisterThreadStore).toHaveBeenCalledWith("agent-1");
  });
});
