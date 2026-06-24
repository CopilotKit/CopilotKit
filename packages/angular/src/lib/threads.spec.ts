import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  type ThreadEndpointRuntimeInfo,
} from "@copilotkit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKit } from "./copilotkit";
import { injectThreads } from "./threads";
import type { InjectThreadsResult } from "./threads";

interface FetchCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

type QueuedFetch = typeof fetch & {
  calls: FetchCall[];
  enqueue(body: unknown | Promise<unknown>, status?: number): void;
};

const supportedThreadEndpoints: ThreadEndpointRuntimeInfo = {
  list: true,
  inspect: true,
  mutations: true,
  realtimeMetadata: true,
};

const sampleThreads = [
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

const ignoreDeferredResolution = (): void => {};

class CopilotKitThreadsStub {
  readonly #runtimeConnectionStatus = signal(
    CopilotKitCoreRuntimeConnectionStatus.Connected,
  );
  readonly #runtimeUrl = signal<string | undefined>(
    "https://runtime.example.com",
  );
  readonly #headers = signal<Record<string, string>>({
    Authorization: "Bearer token",
  });
  readonly #intelligence = signal<{ wsUrl: string } | undefined>(undefined);
  readonly #threadEndpoints = signal<ThreadEndpointRuntimeInfo | undefined>(
    supportedThreadEndpoints,
  );

  readonly runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  readonly runtimeUrl = this.#runtimeUrl.asReadonly();
  readonly headers = this.#headers.asReadonly();
  readonly intelligence = this.#intelligence.asReadonly();
  readonly threadEndpoints = this.#threadEndpoints.asReadonly();
  readonly core = {
    registerThreadStore: vi.fn(),
    unregisterThreadStore: vi.fn(),
  };

  setRuntimeUrl(runtimeUrl: string | undefined): void {
    this.#runtimeUrl.set(runtimeUrl);
  }

  setRuntimeConnectionStatus(
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus,
  ): void {
    this.#runtimeConnectionStatus.set(runtimeConnectionStatus);
  }

  setThreadEndpoints(
    threadEndpoints: ThreadEndpointRuntimeInfo | undefined,
  ): void {
    this.#threadEndpoints.set(threadEndpoints);
  }
}

function createQueuedFetch(): QueuedFetch {
  const calls: FetchCall[] = [];
  const queue: Array<{ body: unknown | Promise<unknown>; status: number }> = [];
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ input, init });
    const next = queue.shift() ?? { body: {}, status: 200 };
    const body = await next.body;
    return new Response(JSON.stringify(body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return Object.assign(fetchImpl, {
    calls,
    enqueue(body: unknown | Promise<unknown>, status = 200): void {
      queue.push({ body, status });
    },
  });
}

function deferredFetchBody() {
  let resolve: (body: unknown) => void = ignoreDeferredResolution;
  const promise = new Promise<unknown>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function threadIds(result: InjectThreadsResult): string[] {
  return result.threads().map((thread) => thread.id);
}

async function waitForCondition(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

describe("injectThreads", () => {
  let copilotKit: CopilotKitThreadsStub;
  let fetchMock: QueuedFetch;

  beforeEach(() => {
    TestBed.resetTestingModule();
    fetchMock = createQueuedFetch();
    vi.stubGlobal("fetch", fetchMock);
    copilotKit = new CopilotKitThreadsStub();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useValue: copilotKit }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches static input threads and exposes Angular signals", async () => {
    fetchMock.enqueue({ threads: sampleThreads });

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    expect(typeof result.threads).toBe("function");
    expect(typeof result.isLoading).toBe("function");
    expect(typeof result.error).toBe("function");

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(false);
      expect(result.threads()).toHaveLength(1);
    });

    expect(fetchMock.calls[0]?.input).toBe(
      "https://runtime.example.com/threads?agentId=agent-1",
    );
    expect(result.threads()[0]).toEqual({
      id: "thread-1",
      agentId: "agent-1",
      name: "Thread One",
      archived: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("resets immediately and refetches when signal inputs change", async () => {
    const secondFetch = deferredFetchBody();
    fetchMock.enqueue({ threads: sampleThreads });
    fetchMock.enqueue(secondFetch.promise);
    const agentId = signal<string | undefined>("agent-1");

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({ agentId });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    await waitForCondition(() => {
      expect(result.threads().map((thread) => thread.id)).toEqual(["thread-1"]);
    });

    agentId.set("agent-2");

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(true);
      expect(result.threads()).toEqual([]);
    });

    secondFetch.resolve({
      threads: [{ ...sampleThreads[0], id: "thread-2", agentId: "agent-2" }],
    });

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(false);
      expect(result.threads().map((thread) => thread.id)).toEqual(["thread-2"]);
    });
  });

  it("forwards mutation methods to the shared store and returns promises", async () => {
    fetchMock.enqueue({ threads: sampleThreads });
    fetchMock.enqueue({});
    fetchMock.enqueue({});

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    await waitForCondition(() => {
      expect(result.threads()).toHaveLength(1);
    });

    await result.renameThread("thread-1", "Renamed");

    const renameCall = fetchMock.calls.find(
      (call) =>
        call.input === "https://runtime.example.com/threads/thread-1" &&
        call.init?.method === "PATCH",
    );
    expect(renameCall).toBeDefined();
    expect(renameCall?.init?.body).toBe(
      JSON.stringify({ agentId: "agent-1", name: "Renamed" }),
    );

    await result.unarchiveThread("thread-1");

    const unarchiveCall = fetchMock.calls.find(
      (call) =>
        call.input === "https://runtime.example.com/threads/thread-1" &&
        call.init?.method === "PATCH" &&
        call.init.body ===
          JSON.stringify({ agentId: "agent-1", archived: false }),
    );
    expect(unarchiveCall).toBeDefined();
  });

  it("shows loading before the runtime connects without fetching threads", async () => {
    copilotKit.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    fetchMock.enqueue({ threads: sampleThreads });

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock.calls).toHaveLength(0);
    expect(result.isLoading()).toBe(true);
    expect(result.threads()).toEqual([]);

    copilotKit.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    fixture.detectChanges();

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(false);
      expect(result.threads()).toHaveLength(1);
    });
    expect(fetchMock.calls).toHaveLength(1);
  });

  it("preserves fetched threads during transient runtime reconnects", async () => {
    fetchMock.enqueue({ threads: sampleThreads });

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(false);
      expect(result.threads().map((thread) => thread.id)).toEqual(["thread-1"]);
    });

    copilotKit.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    fixture.detectChanges();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.isLoading()).toBe(false);
    expect(threadIds(result)).toEqual(["thread-1"]);
    expect(fetchMock.calls).toHaveLength(1);
  });

  it("clears fetched threads without refetching when inputs change during transient reconnects", async () => {
    fetchMock.enqueue({ threads: sampleThreads });
    fetchMock.enqueue({
      threads: [{ ...sampleThreads[0], id: "thread-2", archived: true }],
    });
    const includeArchived = signal<boolean | undefined>(false);

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({
        agentId: "agent-1",
        includeArchived,
      });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(false);
      expect(threadIds(result)).toEqual(["thread-1"]);
    });

    copilotKit.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    fixture.detectChanges();

    includeArchived.set(true);
    fixture.detectChanges();

    await waitForCondition(() => {
      expect(result.threads()).toEqual([]);
      expect(result.isLoading()).toBe(true);
    });
    expect(fetchMock.calls).toHaveLength(1);

    copilotKit.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    fixture.detectChanges();

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(false);
      expect(threadIds(result)).toEqual(["thread-2"]);
    });
    expect(fetchMock.calls[1]?.input).toBe(
      "https://runtime.example.com/threads?agentId=agent-1&includeArchived=true",
    );
  });

  it("unregisters and stops the store when the injection context is destroyed", async () => {
    fetchMock.enqueue({ threads: sampleThreads });

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads: InjectThreadsResult = injectThreads({
        agentId: "agent-1",
      });
    }

    const fixture = TestBed.createComponent(HostComponent);

    await waitForCondition(() => {
      expect(copilotKit.core.registerThreadStore).toHaveBeenCalledWith(
        "agent-1",
        expect.objectContaining({ stop: expect.any(Function) }),
      );
    });

    fixture.destroy();

    expect(copilotKit.core.unregisterThreadStore).toHaveBeenCalledWith(
      "agent-1",
    );
  });

  it("surfaces Enterprise Intelligence configuration errors visibly", async () => {
    copilotKit.setRuntimeUrl(undefined);

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(false);
      expect(result.threads()).toEqual([]);
      expect(result.error()?.message).toBe("Runtime URL is not configured");
    });
    expect(fetchMock.calls).toHaveLength(0);
  });

  it("surfaces runtime info failures with a configured runtime URL visibly", async () => {
    copilotKit.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    await waitForCondition(() => {
      expect(result.isLoading()).toBe(false);
      expect(result.threads()).toEqual([]);
      expect(result.error()?.message).toBe(
        "CopilotKit runtime info is unavailable",
      );
    });
    expect(fetchMock.calls).toHaveLength(0);
  });

  it("does not refetch or reset threads for mutation-only endpoint capability changes", async () => {
    fetchMock.enqueue({ threads: sampleThreads });

    @Component({
      standalone: true,
      template: "",
    })
    class HostComponent {
      readonly threads = injectThreads({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(HostComponent);
    const result = fixture.componentInstance.threads;

    await waitForCondition(() => {
      expect(result.threads()).toHaveLength(1);
    });

    copilotKit.setThreadEndpoints({
      list: true,
      inspect: true,
      mutations: false,
      realtimeMetadata: true,
    });
    fixture.detectChanges();

    await waitForCondition(() => {
      expect(fetchMock.calls).toHaveLength(1);
      expect(result.threads()).toHaveLength(1);
    });

    await expect(result.renameThread("thread-1", "Renamed")).rejects.toThrow(
      "Thread mutations are not available on this CopilotKit runtime",
    );
  });
});
