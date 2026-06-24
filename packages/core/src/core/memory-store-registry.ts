import type { ɵMemoryStore } from "../memories";
import type { CopilotKitCore } from "./core";

export class MemoryStoreRegistry {
  private _stores: Record<string, ɵMemoryStore> = {};
  // Cached frozen snapshot of `_stores`. Invalidated to `null` on every
  // `register`/`unregister` so the next `getAll()` rebuilds it. Stable
  // references between mutations matter for `useSyncExternalStore` consumers
  // that compare snapshot identity to decide whether to re-render.
  private _snapshot: Readonly<Record<string, ɵMemoryStore>> | null = null;

  constructor(private core: CopilotKitCore) {}

  register(agentId: string, store: ɵMemoryStore): void {
    this._stores[agentId] = store;
    this._snapshot = null;
  }

  unregister(agentId: string): void {
    if (!(agentId in this._stores)) return;
    delete this._stores[agentId];
    this._snapshot = null;
  }

  get(agentId: string): ɵMemoryStore | undefined {
    return this._stores[agentId];
  }

  getAll(): Readonly<Record<string, ɵMemoryStore>> {
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
}
