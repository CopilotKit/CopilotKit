import { type ɵMemoryStore } from "../memory";
import type { CopilotKitCore } from "./core";
import { CopilotKitCoreFriendsAccess, CopilotKitCoreSubscriber } from "./core";

export class MemoryStoreRegistry {
  private _stores: Record<string, ɵMemoryStore> = {};
  // Cached frozen snapshot of `_stores`. Invalidated to `null` on every
  // `register`/`unregister` so the next `getAll()` rebuilds it. Stable
  // references between mutations matter for `useSyncExternalStore` consumers
  // that compare snapshot identity to decide whether to re-render.
  private _snapshot: Readonly<Record<string, ɵMemoryStore>> | null = null;

  constructor(private core: CopilotKitCore) {}

  register(agentId: string, store: ɵMemoryStore): void {
    if (agentId in this._stores) {
      // Capture the previous store before deleting it. `notifyUnregistered`
      // dispatches via `Promise.all` and returns control to this synchronous
      // body before async subscribers resume — by then `this._stores[agentId]`
      // already holds the new store, so the previous store must be forwarded
      // explicitly via the payload. Subscribers MUST NOT call
      // `registry.get(agentId)` from `onMemoryStoreUnregistered` to recover
      // the previous store; use the `prevStore` field on the payload instead.
      const prevStore = this._stores[agentId]!;
      delete this._stores[agentId];
      this._snapshot = null;
      this.notifyUnregistered(agentId, prevStore).catch((err) => {
        console.error("MemoryStoreRegistry notifyUnregistered failed:", err);
      });
    }
    this._stores[agentId] = store;
    this._snapshot = null;
    this.notifyRegistered(agentId, store).catch((err) => {
      console.error("MemoryStoreRegistry notifyRegistered failed:", err);
    });
  }

  unregister(agentId: string): void {
    if (!(agentId in this._stores)) return;
    // Capture before delete for the same reason as `register()` above.
    const prevStore = this._stores[agentId]!;
    delete this._stores[agentId];
    this._snapshot = null;
    this.notifyUnregistered(agentId, prevStore).catch((err) => {
      console.error("MemoryStoreRegistry notifyUnregistered failed:", err);
    });
  }

  get(agentId: string): ɵMemoryStore | undefined {
    return this._stores[agentId];
  }

  getAll(): Readonly<Record<string, ɵMemoryStore>> {
    // Cache a frozen snapshot so consecutive calls return the same reference.
    // `useSyncExternalStore` and other identity-comparing consumers depend on
    // this stability to skip re-renders when nothing has actually changed.
    if (this._snapshot === null) {
      this._snapshot = Object.freeze({ ...this._stores });
    }
    return this._snapshot;
  }

  private async notifyRegistered(
    agentId: string,
    store: ɵMemoryStore,
  ): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber: CopilotKitCoreSubscriber) =>
        subscriber.onMemoryStoreRegistered?.({
          copilotkit: this.core,
          agentId,
          store,
        }),
      "Subscriber onMemoryStoreRegistered error:",
    );
  }

  private async notifyUnregistered(
    agentId: string,
    prevStore: ɵMemoryStore,
  ): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber: CopilotKitCoreSubscriber) =>
        subscriber.onMemoryStoreUnregistered?.({
          copilotkit: this.core,
          agentId,
          prevStore,
        }),
      "Subscriber onMemoryStoreUnregistered error:",
    );
  }
}
