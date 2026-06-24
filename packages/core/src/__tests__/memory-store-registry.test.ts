import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStoreRegistry } from "../core/memory-store-registry";
import type { CopilotKitCore, CopilotKitCoreSubscriber } from "../core/core";
import type { ɵMemoryStore } from "../memory";

function createMockCore() {
  const subscribers = new Set<CopilotKitCoreSubscriber>();

  const core = {
    notifySubscribers: vi.fn(
      async (
        fn: (s: CopilotKitCoreSubscriber) => unknown,
        errorMessage: string,
      ) => {
        await Promise.all(
          Array.from(subscribers).map(async (subscriber) => {
            try {
              await fn(subscriber);
            } catch (err) {
              console.error(errorMessage, err);
            }
          }),
        );
      },
    ),
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
  } as unknown as CopilotKitCore;

  return { core, subscribers };
}

function makeStore(id = "store-a"): ɵMemoryStore & { __testId: string } {
  const store: ɵMemoryStore = {
    start: vi.fn(),
    stop: vi.fn(),
    setContext: vi.fn(),
    refresh: vi.fn(),
    addMemory: vi.fn(),
    updateMemory: vi.fn(),
    removeMemory: vi.fn(),
    getState: vi.fn(),
    select: vi.fn(),
  };
  return Object.assign(store, { __testId: id });
}

describe("MemoryStoreRegistry", () => {
  let registry: MemoryStoreRegistry;
  let core: CopilotKitCore;

  beforeEach(() => {
    ({ core } = createMockCore());
    registry = new MemoryStoreRegistry(core);
  });

  it("register then get returns the same store", () => {
    const store = makeStore();
    registry.register("agent-1", store);
    expect(registry.get("agent-1")).toBe(store);
  });

  it("getAll returns all registered stores", () => {
    const storeA = makeStore("a");
    const storeB = makeStore("b");
    registry.register("agent-1", storeA);
    registry.register("agent-2", storeB);
    const all = registry.getAll();
    expect(all["agent-1"]).toBe(storeA);
    expect(all["agent-2"]).toBe(storeB);
  });

  it("second register for the same agentId replaces and fires unregistered then registered", async () => {
    const onRegistered = vi.fn();
    const onUnregistered = vi.fn();
    core.subscribe({
      onMemoryStoreRegistered: onRegistered,
      onMemoryStoreUnregistered: onUnregistered,
    });

    const first = makeStore("first");
    const second = makeStore("second");
    registry.register("agent-1", first);
    await Promise.resolve();
    registry.register("agent-1", second);
    await Promise.resolve();

    expect(registry.get("agent-1")).toBe(second);
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", prevStore: first }),
    );
    expect(onRegistered).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agent-1", store: second }),
    );
    const unregisterOrder = onUnregistered.mock.invocationCallOrder[0];
    const secondRegisterOrder = onRegistered.mock.invocationCallOrder[1];
    expect(unregisterOrder!).toBeLessThan(secondRegisterOrder!);
  });

  it("unregister removes the store", () => {
    registry.register("agent-1", makeStore());
    registry.unregister("agent-1");
    expect(registry.get("agent-1")).toBeUndefined();
  });

  it("unregister on a missing key is a no-op and does not fire", async () => {
    const onUnregistered = vi.fn();
    core.subscribe({ onMemoryStoreUnregistered: onUnregistered });
    expect(() => registry.unregister("nonexistent")).not.toThrow();
    await Promise.resolve();
    expect(onUnregistered).not.toHaveBeenCalled();
  });

  it("register fires onMemoryStoreRegistered with the store", async () => {
    const onRegistered = vi.fn();
    core.subscribe({ onMemoryStoreRegistered: onRegistered });
    const store = makeStore();
    registry.register("agent-1", store);
    await Promise.resolve();
    expect(onRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", store }),
    );
  });

  it("unregister fires onMemoryStoreUnregistered forwarding the previous store", async () => {
    const onUnregistered = vi.fn();
    core.subscribe({ onMemoryStoreUnregistered: onUnregistered });
    const store = makeStore();
    registry.register("agent-1", store);
    registry.unregister("agent-1");
    await Promise.resolve();
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", prevStore: store }),
    );
  });

  it("getAll returns a frozen, identity-stable snapshot invalidated on writes", () => {
    registry.register("agent-1", makeStore("a"));
    const a = registry.getAll();
    const b = registry.getAll();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);

    registry.register("agent-2", makeStore("b"));
    const c = registry.getAll();
    expect(c).not.toBe(a);
    expect(c["agent-2"]).toBeDefined();
  });

  describe("subscriber error isolation", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("a throwing subscriber does not prevent register or other subscribers", async () => {
      const throwing = vi.fn(() => {
        throw new Error("subscriber boom");
      });
      const ok = vi.fn();
      core.subscribe({ onMemoryStoreRegistered: throwing });
      core.subscribe({ onMemoryStoreRegistered: ok });

      const store = makeStore();
      registry.register("agent-1", store);
      expect(registry.get("agent-1")).toBe(store);

      await Promise.resolve();
      expect(throwing).toHaveBeenCalledTimes(1);
      expect(ok).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Subscriber onMemoryStoreRegistered error"),
        expect.any(Error),
      );
    });
  });
});
