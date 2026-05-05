import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKit } from "./copilotkit";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { injectThreadStore } from "./threads";

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
      this.connected = true;
    }

    disconnect(): void {
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
vi.stubGlobal("fetch", fetchMock);

function getMockSockets(): MockSocketLike[] {
  return phoenix.sockets;
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

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

class CopilotKitStub {
  readonly #runtimeUrl = signal<string | undefined>("http://localhost:4000");
  readonly #runtimeConnectionStatus =
    signal<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  readonly #headers = signal<Record<string, string>>({
    Authorization: "Bearer test-token",
  });

  runtimeUrl = this.#runtimeUrl.asReadonly();
  runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  headers = this.#headers.asReadonly();

  registerCalls: Array<{ agentId: string; store: unknown }> = [];
  unregisterCalls: string[] = [];

  core = {
    intelligence: { wsUrl: "ws://localhost:4000/client" } as
      | { wsUrl?: string }
      | undefined,
    registerThreadStore: (agentId: string, store: unknown) => {
      this.registerCalls.push({ agentId, store });
    },
    unregisterThreadStore: (agentId: string) => {
      this.unregisterCalls.push(agentId);
    },
  };

  setRuntimeUrl(value: string | undefined) {
    this.#runtimeUrl.set(value);
  }

  setRuntimeConnectionStatus(value: CopilotKitCoreRuntimeConnectionStatus) {
    this.#runtimeConnectionStatus.set(value);
  }

  setHeaders(value: Record<string, string>) {
    this.#headers.set(value);
  }

  setIntelligence(value: { wsUrl?: string } | undefined) {
    this.core.intelligence = value;
  }
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

async function flushAsync(): Promise<void> {
  // fromFetch + phoenix sockets bounce through both microtasks and macrotasks.
  // Drain a generous mix so the list fetch -> credentials fetch -> socket
  // creation chain settles before assertions.
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushMicrotasks(20);
  }
}

describe("injectThreadStore", () => {
  let stub: CopilotKitStub;

  beforeEach(() => {
    phoenix.sockets.splice(0);
    fetchMock.mockReset();
    TestBed.resetTestingModule();
    stub = new CopilotKitStub();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotKit, useValue: stub }],
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("fetches threads and subscribes to the user metadata channel", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const store = fixture.componentInstance.store;
    expect(store.isLoading()).toBe(false);
    expect(store.threads().map((t) => t.id)).toEqual(["t-2", "t-1"]);
    expect(store.error()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/threads?agentId=agent-1"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/threads/subscribe"),
      expect.objectContaining({ method: "POST" }),
    );

    const socket = getMockSockets()[0];
    expect(socket.connected).toBe(true);
    expect(socket.channels[0].topic).toBe("user_meta:jc-1");

    fixture.destroy();
  });

  it("stores fetch failures in error state", async () => {
    fetchMock.mockReturnValue(jsonResponse({}, 500));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const store = fixture.componentInstance.store;
    expect(store.isLoading()).toBe(false);
    expect(store.error()?.message).toContain("500");
    expect(store.threads()).toEqual([]);

    fixture.destroy();
  });

  it("does not fetch when runtimeUrl is not configured", async () => {
    stub.setRuntimeUrl(undefined);

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const store = fixture.componentInstance.store;
    expect(store.isLoading()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.error()?.message).toBe("Runtime URL is not configured");

    fixture.destroy();
  });

  it("updates local state directly from realtime metadata events", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const channel = getMockSockets()[0].channels[0];
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

    await flushMicrotasks(10);
    fixture.detectChanges();

    const store = fixture.componentInstance.store;
    expect(store.threads()[0].name).toBe("Renamed Thread");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fixture.destroy();
  });

  it("removes threads on a deleted realtime event regardless of payload userId", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    getMockSockets()[0].channels[0].serverPush("thread_metadata", {
      operation: "deleted",
      threadId: "t-2",
      userId: "user-2",
      organizationId: "org-1",
      occurredAt: "2026-01-03T00:00:00Z",
      deleted: { id: "t-2" },
    });

    await flushMicrotasks(10);
    fixture.detectChanges();

    const store = fixture.componentInstance.store;
    expect(store.threads()).toHaveLength(1);
    expect(store.threads()[0].id).toBe("t-1");

    fixture.destroy();
  });

  it("renames a thread through the runtime contract", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
      .mockReturnValueOnce(jsonResponse({}));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    await fixture.componentInstance.store.renameThread("t-1", "Renamed");

    const renameCall = fetchMock.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("/threads/t-1") &&
        (args[1] as { method?: string } | undefined)?.method === "PATCH",
    );
    expect(renameCall).toBeDefined();
    expect(JSON.parse((renameCall![1] as { body: string }).body)).toMatchObject(
      {
        agentId: "agent-1",
        name: "Renamed",
      },
    );

    fixture.destroy();
  });

  it("archives and deletes threads through the runtime contract", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
      .mockReturnValueOnce(jsonResponse({}))
      .mockReturnValueOnce(jsonResponse({}));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    await fixture.componentInstance.store.archiveThread("t-2");
    await fixture.componentInstance.store.deleteThread("t-1");

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

    fixture.destroy();
  });

  it("exposes thread-scoped pagination signals and methods", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({
          threads: sampleThreads,
          joinCode: "jc-1",
          nextCursor: "cursor-abc",
        }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const store = fixture.componentInstance.store;
    expect(store).toHaveProperty("hasMoreThreads");
    expect(store).toHaveProperty("isFetchingMoreThreads");
    expect(store).toHaveProperty("fetchMoreThreads");
    expect(store).not.toHaveProperty("hasNextPage");
    expect(store).not.toHaveProperty("isFetchingNextPage");
    expect(store).not.toHaveProperty("fetchNextPage");

    expect(store.hasMoreThreads()).toBe(true);
    expect(store.isFetchingMoreThreads()).toBe(false);
    expect(typeof store.fetchMoreThreads).toBe("function");

    fixture.destroy();
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

    fetchMock
      .mockReturnValueOnce(
        jsonResponse({
          threads: sampleThreads,
          joinCode: "jc-1",
          nextCursor: "cursor-abc",
        }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }))
      .mockReturnValueOnce(
        jsonResponse({ threads: nextPageThreads, joinCode: "jc-1" }),
      );

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const store = fixture.componentInstance.store;
    expect(store.threads()).toHaveLength(2);
    expect(store.hasMoreThreads()).toBe(true);

    store.fetchMoreThreads();

    await flushAsync();
    fixture.detectChanges();

    expect(store.threads()).toHaveLength(3);

    const nextPageCall = fetchMock.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("cursor=cursor-abc"),
    );
    expect(nextPageCall).toBeDefined();
    expect(nextPageCall![0]).toContain("agentId=agent-1");
    expect(store.threads().map((t) => t.id)).toContain("t-3");

    fixture.destroy();
  });

  it("does not expose organizationId or createdById on threads", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    for (const thread of fixture.componentInstance.store.threads()) {
      expect(thread).not.toHaveProperty("organizationId");
      expect(thread).not.toHaveProperty("createdById");
      expect(thread).toHaveProperty("id");
      expect(thread).toHaveProperty("agentId");
      expect(thread).toHaveProperty("name");
      expect(thread).toHaveProperty("archived");
      expect(thread).toHaveProperty("createdAt");
      expect(thread).toHaveProperty("updatedAt");
    }

    fixture.destroy();
  });

  it("tears down the active socket on destroy", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const socket = getMockSockets()[0];
    const channel = socket.channels[0];

    fixture.destroy();

    expect(channel.left).toBe(true);
    expect(socket.disconnected).toBe(true);
  });

  it("registers thread store on creation and unregisters on destroy", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    expect(stub.registerCalls).toHaveLength(1);
    expect(stub.registerCalls[0].agentId).toBe("agent-1");
    expect(stub.registerCalls[0].store).toMatchObject({
      select: expect.any(Function),
    });

    fixture.destroy();

    expect(stub.unregisterCalls).toContain("agent-1");
  });

  it("synthesizes isLoading=true while waiting for runtimeConnectionStatus=Connected", async () => {
    stub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    stub.setIntelligence(undefined);

    fetchMock
      .mockReturnValueOnce(
        jsonResponse({ threads: sampleThreads, joinCode: "jc-1" }),
      )
      .mockReturnValueOnce(jsonResponse({ joinToken: "jt-1" }));

    @Component({ standalone: true, template: "" })
    class Host {
      store = injectThreadStore({ agentId: "agent-1" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const store = fixture.componentInstance.store;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.isLoading()).toBe(true);
    expect(store.threads()).toEqual([]);

    stub.setIntelligence({ wsUrl: "ws://localhost:4000/client" });
    stub.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const listCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && /\/threads\?agentId=/.test(url),
    );
    expect(listCalls).toHaveLength(1);

    expect(store.isLoading()).toBe(false);

    fixture.destroy();
  });

  it("re-registers store when agentId signal changes", async () => {
    fetchMock.mockReturnValue(jsonResponse({ threads: [], joinCode: null }));

    @Component({ standalone: true, template: "" })
    class Host {
      agentId = signal<string>("agent-1");
      store = injectThreadStore({ agentId: this.agentId });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    expect(stub.registerCalls.map((c) => c.agentId)).toEqual(["agent-1"]);

    fixture.componentInstance.agentId.set("agent-2");
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    expect(stub.unregisterCalls).toContain("agent-1");
    expect(stub.registerCalls.map((c) => c.agentId)).toEqual([
      "agent-1",
      "agent-2",
    ]);

    fixture.destroy();
  });
});
