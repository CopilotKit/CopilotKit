import { type ɵThreadStore } from "../threads";
import type { CopilotKitCore } from "./core";
import { CopilotKitCoreFriendsAccess, CopilotKitCoreSubscriber } from "./core";

export class ThreadStoreRegistry {
  private _stores: Record<string, ɵThreadStore> = {};
  // Cached frozen snapshot of `_stores`. Invalidated to `null` on every
  // `register`/`unregister` so the next `getAll()` rebuilds it. Stable
  // references between mutations matter for `useSyncExternalStore` consumers
  // that compare snapshot identity to decide whether to re-render.
  private _snapshot: Readonly<Record<string, ɵThreadStore>> | null = null;

  constructor(private core: CopilotKitCore) {}

  register(agentId: string, store: ɵThreadStore): void {
    if (agentId in this._stores) {
      // Capture the previous store before deleting it. `notifyUnregistered`
      // dispatches via `Promise.all` and returns control to this synchronous
      // body before async subscribers resume — by then `this._stores[agentId]`
      // already holds the new store, so the previous store must be forwarded
      // explicitly via the payload. Subscribers MUST NOT call
      // `registry.get(agentId)` from `onThreadStoreUnregistered` to recover
      // the previous store; use the `prevStore` field on the payload instead.
      const prevStore = this._stores[agentId]!;
      delete this._stores[agentId];
      this._snapshot = null;
      this.notifyUnregistered(agentId, prevStore).catch((err) => {
        console.error("ThreadStoreRegistry notifyUnregistered failed:", err);
      });
    }
    this._stores[agentId] = store;
    this._snapshot = null;
    this.notifyRegistered(agentId, store).catch((err) => {
      console.error("ThreadStoreRegistry notifyRegistered failed:", err);
    });
  }

  unregister(agentId: string): void {
    if (!(agentId in this._stores)) return;
    // Capture before delete for the same reason as `register()` above.
    const prevStore = this._stores[agentId]!;
    delete this._stores[agentId];
    this._snapshot = null;
    this.notifyUnregistered(agentId, prevStore).catch((err) => {
      console.error("ThreadStoreRegistry notifyUnregistered failed:", err);
    });
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

  private async notifyRegistered(
    agentId: string,
    store: ɵThreadStore,
  ): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber: CopilotKitCoreSubscriber) =>
        subscriber.onThreadStoreRegistered?.({
          copilotkit: this.core,
          agentId,
          store,
        }),
      "Subscriber onThreadStoreRegistered error:",
    );
  }

  private async notifyUnregistered(
    agentId: string,
    prevStore: ɵThreadStore,
  ): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber: CopilotKitCoreSubscriber) =>
        subscriber.onThreadStoreUnregistered?.({
          copilotkit: this.core,
          agentId,
          prevStore,
        }),
      "Subscriber onThreadStoreUnregistered error:",
    );
  }
}
