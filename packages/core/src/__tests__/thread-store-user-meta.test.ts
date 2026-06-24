import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { MockChannel } from "./test-utils";
import { MockSocket } from "./test-utils";

const phoenix = vi.hoisted(() => ({
  sockets: [] as MockSocket[],
}));

vi.mock("phoenix", () => ({
  Socket: class extends MockSocket {
    constructor(url = "", opts: Record<string, any> = {}) {
      super(url, opts);
      phoenix.sockets.push(this);
    }
  },
}));

const { ɵcreateThreadStore } = await import("../threads");

const flushEffects = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function getChannel(): MockChannel {
  const channel = phoenix.sockets[0]?.channels[0];
  if (!channel) {
    throw new Error("expected a phoenix channel to exist");
  }
  return channel;
}

function createEnvironment(fetchImpl: Mock) {
  return { fetch: fetchImpl as unknown as typeof fetch };
}

async function bootstrapConnectedStore() {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ threads: [], joinCode: "jc-1" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ joinToken: "jt-1" }),
    });
  vi.stubGlobal("fetch", fetchMock);

  const store = ɵcreateThreadStore(createEnvironment(fetchMock));
  store.start();
  store.setContext({
    runtimeUrl: "https://runtime.example.com",
    headers: {},
    wsUrl: "ws://localhost:4000/client",
    agentId: "agent-1",
  });
  await flushEffects();
  return store;
}

describe("thread store ɵobserveUserMetaEvent", () => {
  const stores: Array<ReturnType<typeof ɵcreateThreadStore>> = [];

  beforeEach(() => {
    phoenix.sockets.splice(0);
  });

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.stop();
    }
    vi.unstubAllGlobals();
  });

  it("relays a named event from the live user_meta channel to outside subscribers", async () => {
    const store = await bootstrapConnectedStore();
    stores.push(store);

    const received: unknown[] = [];
    const sub = store
      .ɵobserveUserMetaEvent("memory_metadata")
      .subscribe((payload) => received.push(payload));

    getChannel().serverPush("memory_metadata", {
      operation: "created",
      memoryId: "m1",
    });

    sub.unsubscribe();

    expect(received).toEqual([{ operation: "created", memoryId: "m1" }]);
  });

  it("fans the same event out to multiple subscribers", async () => {
    const store = await bootstrapConnectedStore();
    stores.push(store);

    const a: unknown[] = [];
    const b: unknown[] = [];
    const subA = store
      .ɵobserveUserMetaEvent("memory_metadata")
      .subscribe((p) => a.push(p));
    const subB = store
      .ɵobserveUserMetaEvent("memory_metadata")
      .subscribe((p) => b.push(p));

    getChannel().serverPush("memory_metadata", { operation: "invalidated" });

    subA.unsubscribe();
    subB.unsubscribe();

    expect(a).toEqual([{ operation: "invalidated" }]);
    expect(b).toEqual([{ operation: "invalidated" }]);
  });
});
