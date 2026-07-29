import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ɵcreateMemoryStore, ɵcreateMetadataSocket } from "@copilotkit/core";
import type { ɵMemoryStore, ɵMetadataSocket } from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";
import { injectMemories, type MemoriesController } from "./memories";

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

/** Minimal wire memory matching the platform `/memories` list payload. */
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

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
};

/**
 * Routes the store's fetches by URL + method. Activating the store fires two
 * concurrent calls — the REST snapshot `GET /memories` and the realtime
 * `POST /memories/subscribe` (socket join credentials). Routing by request
 * (rather than call ordering) keeps the subscribe call from perturbing the
 * snapshot/mutation assertions. `subscribe` always resolves to benign join
 * credentials; the phoenix socket never connects under jsdom (covered by core's
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

/**
 * Stub of the ambient {@link CopilotKit} service. The binding reads only
 * `core.getMemoryStore()`, so the stub holds one REAL `ɵcreateMemoryStore`
 * (started) and hands it back — core owns the store's lifecycle, the binding
 * just bridges it.
 */
class CopilotKitStub {
  readonly store: ɵMemoryStore;

  constructor(fetchMock: Mock) {
    // rxjs `fromFetch` ultimately calls `globalThis.fetch`, so stub it with the
    // same routed mock that is injected into the store (mirrors the React test).
    vi.stubGlobal("fetch", fetchMock);
    this.store = ɵcreateMemoryStore({
      fetch: fetchMock as unknown as typeof fetch,
    });
    this.store.start();
  }

  readonly core = {
    getMemoryStore: (): ɵMemoryStore => this.store,
  };

  /**
   * Activates the store the way core does once the runtime is connected:
   * dispatches a real runtime context, which fires the snapshot fetch through
   * the real reducer/effects/selectors.
   */
  #metadataSocket: ɵMetadataSocket | undefined;

  activate(): void {
    this.store.setContext({
      runtimeUrl: RUNTIME_URL,
      // Mirror `CopilotKitCore.ɵgetMetadataSocket`: ONE credential-agnostic
      // socket, memoized so repeated resolves return the same instance. The
      // store fetches its own `/memories/subscribe` creds and hands the token
      // here.
      getMetadataSocket: (joinToken: string): ɵMetadataSocket => {
        this.#metadataSocket ??= ɵcreateMetadataSocket({
          wsUrl: WS_URL,
          joinToken,
        }).socket;
        return this.#metadataSocket;
      },
      headers: {},
    });
  }
}

@Component({ standalone: true, template: "" })
class MemoriesHost {
  controller: MemoriesController = injectMemories();
}

/**
 * Sets up a TestBed with the stubbed CopilotKit service wrapping a real memory
 * store driven by `fetchMock`, and mounts the host. Follows the SIFERS pattern.
 */
function setup(fetchMock: Mock): {
  stub: CopilotKitStub;
  fixture: ReturnType<typeof TestBed.createComponent<MemoriesHost>>;
  controller: MemoriesController;
  teardown: () => void;
} {
  TestBed.resetTestingModule();
  const stub = new CopilotKitStub(fetchMock);
  TestBed.configureTestingModule({
    providers: [{ provide: CopilotKit, useValue: stub }],
  });

  const fixture = TestBed.createComponent(MemoriesHost);
  fixture.detectChanges();

  // SIFERS teardown: stop the started store (frees its rxjs effects / pending
  // fetches) and tear down the TestBed so nothing leaks across tests.
  const teardown = (): void => {
    stub.store.stop();
    TestBed.resetTestingModule();
  };

  return {
    stub,
    fixture,
    controller: fixture.componentInstance.controller,
    teardown,
  };
}

/** Runs change detection then drains microtasks so the rxjs pipeline + signals settle. */
async function flush(
  fixture: ReturnType<typeof TestBed.createComponent<MemoriesHost>>,
): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  fixture.detectChanges();
  await fixture.whenStable();
}

describe("injectMemories", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = routedFetch({
      snapshot: { ok: true, json: async () => ({ memories: [] }) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads the snapshot once the store is activated", async () => {
    fetchMock = routedFetch({
      snapshot: {
        ok: true,
        json: async () => ({ memories: [wireMemory("m1"), wireMemory("m2")] }),
      },
    });

    const { stub, fixture, controller, teardown } = setup(fetchMock);
    stub.activate();
    await flush(fixture);

    expect(controller.memories().map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(controller.isLoading()).toBe(false);
    expect(controller.error()).toBeNull();
    expect(controller.isAvailable()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories`,
      expect.objectContaining({ method: "GET" }),
    );

    teardown();
  });

  it("exposes realtimeStatus, defaulting to 'connecting'", async () => {
    const { stub, fixture, controller, teardown } = setup(fetchMock);
    stub.activate();
    await flush(fixture);

    // The phoenix socket never connects under the test harness, so the status
    // stays at its "connecting" default; core's memory.test.ts covers the
    // connected/unavailable transitions. This asserts the binding bridges the
    // selector onto a signal.
    expect(controller.realtimeStatus()).toBe("connecting");

    teardown();
  });

  it("addMemory passes through the store, resolving to the created memory and adding it to the list", async () => {
    fetchMock = routedFetch({
      snapshot: { ok: true, json: async () => ({ memories: [] }) },
      mutation: {
        ok: true,
        json: async () => ({ ...wireMemory("m1", "hi"), absorbed: false }),
      },
    });

    const { stub, fixture, controller, teardown } = setup(fetchMock);
    stub.activate();
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

    teardown();
  });

  it("updateMemory supersedes: resolves to the new id, old id gone from the list", async () => {
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

    const { stub, fixture, controller, teardown } = setup(fetchMock);
    stub.activate();
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

    teardown();
  });

  it("removeMemory DELETEs and removes the memory from the list", async () => {
    fetchMock = routedFetch({
      snapshot: {
        ok: true,
        json: async () => ({ memories: [wireMemory("m1")] }),
      },
    });

    const { stub, fixture, controller, teardown } = setup(fetchMock);
    stub.activate();
    await flush(fixture);
    expect(controller.memories().map((m) => m.id)).toEqual(["m1"]);

    await controller.removeMemory("m1");
    await flush(fixture);

    expect(controller.memories()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNTIME_URL}/memories/m1`,
      expect.objectContaining({ method: "DELETE" }),
    );

    teardown();
  });

  it("surfaces a mutation failure via the error signal and rejects the promise", async () => {
    fetchMock = routedFetch({
      snapshot: { ok: true, json: async () => ({ memories: [] }) },
      mutation: { ok: false, status: 500 },
    });

    const { stub, fixture, controller, teardown } = setup(fetchMock);
    stub.activate();
    await flush(fixture);

    await expect(
      controller.addMemory({ content: "x", kind: "topical" }),
    ).rejects.toThrow();
    await flush(fixture);

    expect(controller.error()).toBeInstanceOf(Error);

    teardown();
  });

  it("silently degrades to unavailable when the memory route is missing (404)", async () => {
    fetchMock = routedFetch({
      snapshot: { ok: false, status: 404 },
    });

    const { stub, fixture, controller, teardown } = setup(fetchMock);
    stub.activate();
    await flush(fixture);

    expect(controller.isAvailable()).toBe(false);
    expect(controller.error()).toBeNull();
    expect(controller.isLoading()).toBe(false);
    expect(controller.memories()).toEqual([]);

    teardown();
  });
});
