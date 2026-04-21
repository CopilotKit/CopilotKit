import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThreadStoreRegistry } from "../core/thread-store-registry";
import type { CopilotKitCore, CopilotKitCoreSubscriber } from "../core/core";
import type { ɵThreadStore } from "../threads";

// Minimal mock of CopilotKitCore that supports subscribing and notification
function createMockCore() {
  const subscribers = new Set<CopilotKitCoreSubscriber>();

  const core = {
    // Friends-access method used by ThreadStoreRegistry internally
    notifySubscribers: vi.fn(
      async (fn: (s: CopilotKitCoreSubscriber) => unknown) => {
        for (const subscriber of subscribers) {
          await fn(subscriber);
        }
      },
    ),
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
  } as unknown as CopilotKitCore;

  return { core, subscribers };
}

function makeStore(id = "store-a"): ɵThreadStore {
  return {
    id,
    select: vi.fn(),
    getState: vi.fn(),
    dispatch: vi.fn(),
  } as unknown as ɵThreadStore;
}

describe("ThreadStoreRegistry", () => {
  let registry: ThreadStoreRegistry;
  let core: CopilotKitCore;

  beforeEach(() => {
    ({ core } = createMockCore());
    registry = new ThreadStoreRegistry(core);
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

  it("second register for the same agentId replaces the first and fires unregistered then registered", async () => {
    const onRegistered = vi.fn();
    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreRegistered: onRegistered,
      onThreadStoreUnregistered: onUnregistered,
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    const first = makeStore("first");
    const second = makeStore("second");
    registry.register("agent-1", first);
    await Promise.resolve();
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(onUnregistered).not.toHaveBeenCalled();

    registry.register("agent-1", second);
    await Promise.resolve();

    expect(registry.get("agent-1")).toBe(second);
    expect(onUnregistered).toHaveBeenCalledTimes(1);
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1" }),
    );
    expect(onRegistered).toHaveBeenCalledTimes(2);
    expect(onRegistered).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agent-1", store: second }),
    );
  });

  it("unregister removes the store", () => {
    registry.register("agent-1", makeStore());
    registry.unregister("agent-1");
    expect(registry.get("agent-1")).toBeUndefined();
  });

  it("unregister on a missing key is a no-op and does not throw", () => {
    expect(() => registry.unregister("nonexistent")).not.toThrow();
  });

  it("register fires onThreadStoreRegistered on subscribers", async () => {
    const onRegistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreRegistered: onRegistered,
    };
    // Attach subscriber directly so notifySubscribers reaches it
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    const store = makeStore();
    registry.register("agent-1", store);

    // notifyRegistered is fire-and-forget (void); flush microtasks
    await Promise.resolve();

    expect(onRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", store }),
    );
  });

  it("unregister fires onThreadStoreUnregistered on subscribers", async () => {
    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: onUnregistered,
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    registry.register("agent-1", makeStore());
    registry.unregister("agent-1");

    await Promise.resolve();

    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1" }),
    );
  });

  it("unregister does not fire event when key was never registered", async () => {
    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: onUnregistered,
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    registry.unregister("nonexistent");
    await Promise.resolve();

    expect(onUnregistered).not.toHaveBeenCalled();
  });
});
