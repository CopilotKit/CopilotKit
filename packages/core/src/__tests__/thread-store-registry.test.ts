import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThreadStoreRegistry } from "../core/thread-store-registry";
import type { CopilotKitCore, CopilotKitCoreSubscriber } from "../core/core";
import type { ɵThreadStore } from "../threads";

// Minimal mock of CopilotKitCore that supports subscribing and notification.
// Mirrors the real CopilotKitCore.notifySubscribers contract: dispatches in
// parallel via Promise.all with per-subscriber try/catch, so a single
// throwing subscriber does not abort delivery to siblings. The parallel
// shape matters for tests that exercise async subscribers — a sequential
// mock would mask races that production hits but tests miss.
function createMockCore() {
  const subscribers = new Set<CopilotKitCoreSubscriber>();

  const core = {
    subscribers,
    getSubscribersSnapshot: vi.fn(() => Array.from(subscribers)),
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

function testIdFor(store: ɵThreadStore): string {
  return (store as unknown as { __testId: string }).__testId;
}

// Build a typed minimal stub of ɵThreadStore. The registry only stores and
// hands the reference back to subscribers; the methods are never invoked in
// these tests. Using `vi.fn()` for every property keeps the shape honest
// against the real interface without an `as unknown` cast. The `id` tag is
// attached through an intersection so callers can distinguish stubs at a
// glance during debugging — `makeStore("a") !== makeStore("b")` carries
// semantic meaning, not just identity-by-allocation.
function makeStore(id = "store-a"): ɵThreadStore & { __testId: string } {
  const store: ɵThreadStore = {
    start: vi.fn(),
    stop: vi.fn(),
    setContext: vi.fn(),
    refresh: vi.fn(),
    fetchNextPage: vi.fn(),
    renameThread: vi.fn(),
    archiveThread: vi.fn(),
    deleteThread: vi.fn(),
    getState: vi.fn(),
    select: vi.fn(),
  };
  return Object.assign(store, { __testId: id });
}

async function flushNotifications(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    await flushNotifications();
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(onUnregistered).not.toHaveBeenCalled();

    registry.register("agent-1", second);
    await flushNotifications();

    expect(registry.get("agent-1")).toBe(second);
    expect(onUnregistered).toHaveBeenCalledTimes(1);
    // Payload must carry the previous store as `prevStore`. Subscribers rely
    // on this to tear down state for the unregistered instance without
    // calling `registry.get(agentId)` — which by the time an async subscriber
    // resumes would already return the new store.
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", prevStore: first }),
    );
    expect(onRegistered).toHaveBeenCalledTimes(2);
    expect(onRegistered).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agent-1", store: second }),
    );
    // The unregister notification for the previous store must fire before
    // the second register notification — subscribers rely on this ordering
    // to tear down stale subscriptions before wiring up the replacement.
    const unregisterOrder = onUnregistered.mock.invocationCallOrder[0];
    const secondRegisterOrder = onRegistered.mock.invocationCallOrder[1];
    expect(unregisterOrder).toBeDefined();
    expect(secondRegisterOrder).toBeDefined();
    expect(unregisterOrder!).toBeLessThan(secondRegisterOrder!);
  });

  it("waits for async unregister subscribers before notifying replacement registration", async () => {
    const calls: string[] = [];
    let finishUnregister: (() => void) | undefined;
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreRegistered: ({ store }) => {
        calls.push(`registered:${testIdFor(store)}`);
      },
      onThreadStoreUnregistered: ({ prevStore }) =>
        new Promise<void>((resolve) => {
          calls.push(`unregister-start:${testIdFor(prevStore)}`);
          finishUnregister = () => {
            calls.push(`unregister-end:${testIdFor(prevStore)}`);
            resolve();
          };
        }),
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    registry.register("agent-1", makeStore("first"));
    await flushNotifications();
    registry.register("agent-1", makeStore("second"));
    await flushNotifications();

    expect(calls).toEqual(["registered:first", "unregister-start:first"]);

    finishUnregister?.();
    await flushNotifications();

    expect(calls).toEqual([
      "registered:first",
      "unregister-start:first",
      "unregister-end:first",
      "registered:second",
    ]);
  });

  it("does not let a pending same-agent unregister block unrelated agent notifications", async () => {
    const calls: string[] = [];
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreRegistered: ({ agentId, store }) => {
        calls.push(`registered:${agentId}:${testIdFor(store)}`);
      },
      onThreadStoreUnregistered: ({ agentId, prevStore }) => {
        calls.push(`unregister-start:${agentId}:${testIdFor(prevStore)}`);
        return new Promise<void>(() => {});
      },
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    registry.register("agent-1", makeStore("first"));
    await flushNotifications();
    registry.register("agent-1", makeStore("second"));
    await flushNotifications();

    registry.register("agent-2", makeStore("unrelated"));
    await flushNotifications();

    expect(calls).toEqual([
      "registered:agent-1:first",
      "unregister-start:agent-1:first",
      "registered:agent-2:unrelated",
    ]);
  });

  it("restores the previous same-agent store when the active replacement unregisters", async () => {
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
    registry.register("agent-1", second);
    await flushNotifications();

    expect(registry.get("agent-1")).toBe(second);

    registry.unregister("agent-1", second);
    await flushNotifications();

    expect(registry.get("agent-1")).toBe(first);
    expect(registry.getAll()["agent-1"]).toBe(first);
    expect(onUnregistered).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agent-1", prevStore: second }),
    );
    expect(onRegistered).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agent-1", store: first }),
    );
  });

  it("removes a non-active same-agent store without unregistering the active store", async () => {
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
    registry.register("agent-1", second);
    await flushNotifications();

    registry.unregister("agent-1", first);
    await flushNotifications();

    expect(registry.get("agent-1")).toBe(second);
    expect(registry.getAll()["agent-1"]).toBe(second);
    expect(onRegistered).toHaveBeenCalledTimes(2);
    expect(onUnregistered).toHaveBeenCalledTimes(1);

    registry.unregister("agent-1", second);
    await flushNotifications();

    expect(registry.get("agent-1")).toBeUndefined();
    expect(onUnregistered).toHaveBeenCalledTimes(2);
    expect(onRegistered).toHaveBeenCalledTimes(2);
  });

  it("unregisterAll clears every same-agent store without restoring an older store", async () => {
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
    registry.register("agent-1", second);
    await flushNotifications();

    registry.unregisterAll("agent-1");
    await flushNotifications();

    expect(registry.get("agent-1")).toBeUndefined();
    expect(registry.getAll()["agent-1"]).toBeUndefined();
    expect(onRegistered).toHaveBeenCalledTimes(2);
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", prevStore: second }),
    );
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", prevStore: first }),
    );
  });

  it("unregisterAll works without Array.prototype.toReversed", async () => {
    const arrayPrototype = Array.prototype as { toReversed?: unknown };
    const originalToReversed = arrayPrototype.toReversed;
    try {
      delete arrayPrototype.toReversed;
      const first = makeStore("first");
      const second = makeStore("second");
      registry.register("agent-1", first);
      registry.register("agent-1", second);
      await flushNotifications();

      expect(() => registry.unregisterAll("agent-1")).not.toThrow();
      await flushNotifications();

      expect(registry.get("agent-1")).toBeUndefined();
    } finally {
      if (originalToReversed !== undefined) {
        arrayPrototype.toReversed = originalToReversed;
      }
    }
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
    await flushNotifications();

    expect(onRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", store }),
    );
  });

  it("unregister fires onThreadStoreUnregistered on subscribers and forwards the previous store", async () => {
    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: onUnregistered,
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    const store = makeStore();
    registry.register("agent-1", store);
    await flushNotifications();
    registry.unregister("agent-1");

    await flushNotifications();

    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", prevStore: store }),
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
    await flushNotifications();

    expect(onUnregistered).not.toHaveBeenCalled();
  });

  describe("subscriber error isolation", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("a throwing subscriber does not prevent register from succeeding or other subscribers from firing", async () => {
      const throwing = vi.fn(() => {
        throw new Error("subscriber boom");
      });
      const ok = vi.fn();
      const subscriberA: CopilotKitCoreSubscriber = {
        onThreadStoreRegistered: throwing,
      };
      const subscriberB: CopilotKitCoreSubscriber = {
        onThreadStoreRegistered: ok,
      };
      (
        core as unknown as {
          subscribe: (s: CopilotKitCoreSubscriber) => unknown;
        }
      ).subscribe(subscriberA);
      (
        core as unknown as {
          subscribe: (s: CopilotKitCoreSubscriber) => unknown;
        }
      ).subscribe(subscriberB);

      const store = makeStore();
      registry.register("agent-1", store);

      // Registration must complete synchronously and the store must be
      // retrievable even though one subscriber threw.
      expect(registry.get("agent-1")).toBe(store);

      await flushNotifications();

      expect(throwing).toHaveBeenCalledTimes(1);
      expect(ok).toHaveBeenCalledTimes(1);
      // Verify the diagnostic content, not just that *some* error was logged
      // — a regression that swapped the message for an opaque "error" string
      // would silently pass a bare `toHaveBeenCalled()` assertion.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Subscriber onThreadStoreRegistered error"),
        expect.any(Error),
      );
    });
  });

  describe("getAll() snapshot isolation", () => {
    it("returns a frozen snapshot — mutation throws in strict mode and the registry is unaffected", () => {
      const storeA = makeStore("a");
      const storeB = makeStore("b");
      registry.register("agent-1", storeA);
      registry.register("agent-2", storeB);

      const snapshot = registry.getAll();
      // The snapshot must be frozen so the `Readonly<>` claim is honest at
      // runtime, not just in the type system. Vitest source files run under
      // strict mode, so mutating a frozen object throws synchronously.
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(() => {
        (snapshot as Record<string, ɵThreadStore>)["agent-3"] = makeStore("c");
      }).toThrow();
      expect(() => {
        delete (snapshot as Record<string, ɵThreadStore>)["agent-1"];
      }).toThrow();

      // Registry remains intact regardless of the failed mutation attempts.
      expect(registry.get("agent-1")).toBe(storeA);
      expect(registry.get("agent-2")).toBe(storeB);
      expect(registry.get("agent-3")).toBeUndefined();
    });

    it("returns the same reference between mutations so identity-comparing consumers stay stable", () => {
      registry.register("agent-1", makeStore("a"));
      const a = registry.getAll();
      const b = registry.getAll();
      // useSyncExternalStore compares snapshots by identity — returning a new
      // object on every call would force a re-render even when nothing
      // changed. The cached snapshot keeps consumers quiet between writes.
      expect(a).toBe(b);
    });

    it("invalidates the cached snapshot on register so a subsequent getAll() reflects the new store", () => {
      registry.register("agent-1", makeStore("a"));
      const before = registry.getAll();

      const storeB = makeStore("b");
      registry.register("agent-2", storeB);
      const after = registry.getAll();

      expect(after).not.toBe(before);
      expect(after["agent-2"]).toBe(storeB);
    });

    it("invalidates the cached snapshot on unregister so a subsequent getAll() omits the removed store", () => {
      registry.register("agent-1", makeStore("a"));
      registry.register("agent-2", makeStore("b"));
      const before = registry.getAll();

      registry.unregister("agent-1");
      const after = registry.getAll();

      expect(after).not.toBe(before);
      expect(after["agent-1"]).toBeUndefined();
    });
  });
});
