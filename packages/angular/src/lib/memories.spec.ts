import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";
import { injectMemories, type MemoriesController } from "./memories";

const AGENT_ID = "agent-1";
const RUNTIME_URL = "https://runtime.example.com";
const WS_URL = "wss://gw.example.com/client";

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

/**
 * Stub of the Angular `CopilotKit` service exposing the surface
 * `injectMemories` touches: writable runtime signals (so the internal
 * `effect()` can be driven to `Connected`) and a `core` carrying the
 * memory-store registry plus the `intelligence` runtime info (its `wsUrl`
 * is required in the memory store's context).
 */
class CopilotKitStub {
  readonly #runtimeConnectionStatus =
    signal<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  readonly #runtimeUrl = signal<string | undefined>(RUNTIME_URL);
  readonly #headers = signal<Record<string, string>>({});

  runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  runtimeUrl = this.#runtimeUrl.asReadonly();
  headers = this.#headers.asReadonly();

  registeredStore: unknown;

  core = {
    intelligence: { wsUrl: WS_URL },
    registerMemoryStore: vi.fn((_agentId: string, store: unknown) => {
      this.registeredStore = store;
    }),
    unregisterMemoryStore: vi.fn(),
  };

  setRuntimeUrl(value: string | undefined) {
    this.#runtimeUrl.set(value);
  }

  setRuntimeConnectionStatus(value: CopilotKitCoreRuntimeConnectionStatus) {
    this.#runtimeConnectionStatus.set(value);
  }
}

@Component({ standalone: true, template: "" })
class MemoriesHost {
  controller: MemoriesController = injectMemories({ agentId: AGENT_ID });
}

async function setup(): Promise<{
  stub: CopilotKitStub;
  fixture: ReturnType<typeof TestBed.createComponent<MemoriesHost>>;
  controller: MemoriesController;
}> {
  const stub = new CopilotKitStub();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: CopilotKit, useValue: stub }],
  });

  const fixture = TestBed.createComponent(MemoriesHost);
  fixture.detectChanges();
  await fixture.whenStable();

  return { stub, fixture, controller: fixture.componentInstance.controller };
}

/** Runs change detection then drains microtasks so signals settle. */
async function flush(
  fixture: ReturnType<typeof TestBed.createComponent<MemoriesHost>>,
): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
};

/**
 * Routes the store's fetches by URL + method. Setting the context fires two
 * concurrent calls — the REST snapshot `GET /memories` and the realtime
 * `POST /memories/subscribe` (for socket join credentials). Routing by
 * request (rather than `mockResolvedValueOnce` ordering) keeps the subscribe
 * call from perturbing the snapshot/mutation assertions. `subscribe` always
 * resolves to benign join credentials; the binding spec only exercises the
 * REST + selector-forwarding surface (channel realtime is covered by core's
 * `memory.test.ts`).
 */
function routedFetch(handlers: {
  snapshot: FetchResponse;
  mutation?: FetchResponse;
}): Mock {
  return vi.fn((url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (url.endsWith("/memories/subscribe")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ joinToken: "jt-1", joinCode: "jc-1" }),
      });
    }
    if (url.endsWith("/memories") && method === "GET") {
      return Promise.resolve(handlers.snapshot);
    }
    // Any mutation (POST /memories, PATCH|DELETE /memories/:id).
    return Promise.resolve(handlers.mutation ?? { ok: true });
  });
}

describe("injectMemories", () => {
  let fetchMock: Mock;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads the snapshot on mount", async () => {
    fetchMock = routedFetch({
      snapshot: {
        ok: true,
        json: async () => ({ memories: [wireMemory("m1"), wireMemory("m2")] }),
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { stub, fixture, controller } = await setup();
    await flush(fixture);

    expect(controller.memories().map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(controller.isLoading()).toBe(false);
    expect(controller.error()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(stub.registeredStore).toBeDefined();
  });

  it("addMemory POSTs and resolves to the created memory, adding it to the list", async () => {
    fetchMock = routedFetch({
      snapshot: { ok: true, json: async () => ({ memories: [] }) },
      mutation: {
        ok: true,
        json: async () => ({ ...wireMemory("m1", "hi"), absorbed: false }),
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fixture, controller } = await setup();
    await flush(fixture);
    expect(controller.isLoading()).toBe(false);

    const created = await controller.addMemory({
      content: "hi",
      kind: "topical",
    });
    await flush(fixture);

    expect(created.id).toBe("m1");
    expect(controller.memories().map((m) => m.id)).toEqual(["m1"]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updateMemory supersedes: resolves to the new id and the list shows it (old id gone)", async () => {
    fetchMock = routedFetch({
      snapshot: {
        ok: true,
        json: async () => ({ memories: [wireMemory("m1", "old")] }),
      },
      mutation: {
        ok: true,
        json: async () => ({ ...wireMemory("m2", "new"), retiredId: "m1" }),
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fixture, controller } = await setup();
    await flush(fixture);
    expect(controller.memories().map((m) => m.id)).toEqual(["m1"]);

    const updated = await controller.updateMemory("m1", {
      content: "new",
      kind: "topical",
    });
    await flush(fixture);

    expect(updated.id).toBe("m2");
    expect(controller.memories().map((m) => m.id)).toEqual(["m2"]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories/m1`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("removeMemory DELETEs and removes the memory from the list", async () => {
    fetchMock = routedFetch({
      snapshot: {
        ok: true,
        json: async () => ({ memories: [wireMemory("m1")] }),
      },
      mutation: { ok: true },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fixture, controller } = await setup();
    await flush(fixture);
    expect(controller.memories().map((m) => m.id)).toEqual(["m1"]);

    await controller.removeMemory("m1");
    await flush(fixture);

    expect(controller.memories()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories/m1`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
