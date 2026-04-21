import { type ɵThreadStore } from "../threads";
import type { CopilotKitCore } from "./core";
import { CopilotKitCoreFriendsAccess, CopilotKitCoreSubscriber } from "./core";

export class ThreadStoreRegistry {
  private _stores: Record<string, ɵThreadStore> = {};

  constructor(private core: CopilotKitCore) {}

  get stores(): Readonly<Record<string, ɵThreadStore>> {
    return this._stores;
  }

  register(agentId: string, store: ɵThreadStore): void {
    this._stores[agentId] = store;
    void this.notifyRegistered(agentId, store);
  }

  unregister(agentId: string): void {
    if (!(agentId in this._stores)) return;
    delete this._stores[agentId];
    void this.notifyUnregistered(agentId);
  }

  get(agentId: string): ɵThreadStore | undefined {
    return this._stores[agentId];
  }

  getAll(): Readonly<Record<string, ɵThreadStore>> {
    return this._stores;
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

  private async notifyUnregistered(agentId: string): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber: CopilotKitCoreSubscriber) =>
        subscriber.onThreadStoreUnregistered?.({
          copilotkit: this.core,
          agentId,
        }),
      "Subscriber onThreadStoreUnregistered error:",
    );
  }
}
