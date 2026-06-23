import type { ɵThreadStore } from "../threads";
import type { CopilotKitCore } from "./core";
import type {
  CopilotKitCoreFriendsAccess,
  CopilotKitCoreSubscriber,
} from "./core";

export class ThreadStoreRegistry {
  private _stores: Record<string, ɵThreadStore> = {};
  private _storeStacks: Record<string, ɵThreadStore[]> = {};
  private _notificationQueues = new Map<string, Promise<void>>();
  // Cached frozen snapshot of `_stores`. Invalidated to `null` on every
  // `register`/`unregister` so the next `getAll()` rebuilds it. Stable
  // references between mutations matter for `useSyncExternalStore` consumers
  // that compare snapshot identity to decide whether to re-render.
  private _snapshot: Readonly<Record<string, ɵThreadStore>> | null = null;

  constructor(private core: CopilotKitCore) {}

  register(agentId: string, store: ɵThreadStore): void {
    const stack = (this._storeStacks[agentId] ??= []);
    const currentStore = this._stores[agentId];
    if (currentStore === store) {
      return;
    }

    const existingIndex = stack.indexOf(store);
    if (existingIndex !== -1) {
      stack.splice(existingIndex, 1);
    }

    if (currentStore) {
      // Capture the previous active store before replacing it. `notifyUnregistered`
      // dispatches via `Promise.all` and returns control to this synchronous
      // body before async subscribers resume — by then `this._stores[agentId]`
      // already holds the new store, so the previous store must be forwarded
      // explicitly via the payload. Subscribers MUST NOT call
      // `registry.get(agentId)` from `onThreadStoreUnregistered` to recover
      // the previous store; use the `prevStore` field on the payload instead.
      const prevStore = this._stores[agentId]!;
      delete this._stores[agentId];
      this._snapshot = null;
      this.enqueueNotification(
        agentId,
        this.createUnregisteredNotification(agentId, prevStore),
      );
    }

    stack.push(store);
    this._stores[agentId] = store;
    this._snapshot = null;
    this.enqueueNotification(
      agentId,
      this.createRegisteredNotification(agentId, store),
    );
  }

  unregister(agentId: string, store?: ɵThreadStore): void {
    const stack = this._storeStacks[agentId];
    if (!stack || stack.length === 0) return;

    const storeIndex = store ? stack.indexOf(store) : stack.length - 1;
    if (storeIndex === -1) return;

    const isActiveStore = storeIndex === stack.length - 1;
    const [removedStore] = stack.splice(storeIndex, 1);

    if (stack.length === 0) {
      delete this._storeStacks[agentId];
    }

    if (!isActiveStore) {
      return;
    }

    // Capture before delete for the same reason as `register()` above.
    delete this._stores[agentId];
    this._snapshot = null;
    this.enqueueNotification(
      agentId,
      this.createUnregisteredNotification(agentId, removedStore),
    );

    const restoredStore = stack[stack.length - 1];
    if (restoredStore) {
      this._stores[agentId] = restoredStore;
      this._snapshot = null;
      this.enqueueNotification(
        agentId,
        this.createRegisteredNotification(agentId, restoredStore),
      );
    }
  }

  unregisterAll(agentId: string): void {
    const stack = this._storeStacks[agentId];
    if (!stack || stack.length === 0) return;

    // oxlint-disable-next-line unicorn/no-array-reverse -- toReversed is not available in all supported runtimes.
    const removedStores = [...stack].reverse();
    delete this._storeStacks[agentId];
    delete this._stores[agentId];
    this._snapshot = null;

    for (const removedStore of removedStores) {
      this.enqueueNotification(
        agentId,
        this.createUnregisteredNotification(agentId, removedStore),
      );
    }
  }

  get(agentId: string): ɵThreadStore | undefined {
    return this._stores[agentId];
  }

  getAll(): Readonly<Record<string, ɵThreadStore>> {
    // Cache a frozen snapshot so consecutive calls return the same reference.
    // `useSyncExternalStore` and other identity-comparing consumers depend on
    // this stability to skip re-renders when nothing has actually changed.
    // `Object.freeze` makes the `Readonly<>` claim true at runtime, not just
    // at the type level — attempts to mutate the snapshot throw in strict
    // mode and are silently ignored in sloppy mode (rather than corrupting
    // the registry). Invalidated to `null` by `register`/`unregister`.
    if (this._snapshot === null) {
      this._snapshot = Object.freeze({ ...this._stores });
    }
    return this._snapshot;
  }

  private createRegisteredNotification(
    agentId: string,
    store: ɵThreadStore,
  ): () => Promise<void> {
    const subscribers = this.getSubscriberSnapshot();
    return () =>
      this.notifySubscriberSnapshot(
        subscribers,
        (subscriber: CopilotKitCoreSubscriber) =>
          subscriber.onThreadStoreRegistered?.({
            copilotkit: this.core,
            agentId,
            store,
          }),
        "Subscriber onThreadStoreRegistered error:",
      );
  }

  private createUnregisteredNotification(
    agentId: string,
    prevStore: ɵThreadStore,
  ): () => Promise<void> {
    const subscribers = this.getSubscriberSnapshot();
    return () =>
      this.notifySubscriberSnapshot(
        subscribers,
        (subscriber: CopilotKitCoreSubscriber) =>
          subscriber.onThreadStoreUnregistered?.({
            copilotkit: this.core,
            agentId,
            prevStore,
          }),
        "Subscriber onThreadStoreUnregistered error:",
      );
  }

  private getSubscriberSnapshot(): CopilotKitCoreSubscriber[] {
    return (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).getSubscribersSnapshot();
  }

  private async notifySubscriberSnapshot(
    subscribers: CopilotKitCoreSubscriber[],
    handler: (subscriber: CopilotKitCoreSubscriber) => void | Promise<void>,
    errorMessage: string,
  ): Promise<void> {
    await Promise.all(
      subscribers.map(async (subscriber) => {
        try {
          await handler(subscriber);
        } catch (error) {
          console.error(errorMessage, error);
        }
      }),
    );
  }

  private enqueueNotification(
    agentId: string,
    callback: () => Promise<void>,
  ): void {
    const run = () => callback();
    const previous = this._notificationQueues.get(agentId);
    const current = previous ? previous.then(run, run) : run();

    this._notificationQueues.set(agentId, current);
    void current
      .catch((err) => {
        console.error("ThreadStoreRegistry notification failed:", err);
      })
      .finally(() => {
        if (this._notificationQueues.get(agentId) === current) {
          this._notificationQueues.delete(agentId);
        }
      });
  }
}
