export interface ActionSnapshot {
  component?: string;
  props?: unknown;
  path: (string | number)[];
  boundArgs?: unknown;
  conversationKey: string;
}
/** @deprecated Configure `createChannel({ state })` instead. Action snapshots are stored via `StateStore.kv`. */
export interface ActionStore {
  put(id: string, snap: ActionSnapshot, ttlMs?: number): Promise<void>;
  get(id: string): Promise<ActionSnapshot | undefined>;
  delete(id: string): Promise<void>;
}
/** @deprecated Configure `createChannel({ state })` instead. Action snapshots are stored via `StateStore.kv`. */
export class InMemoryActionStore implements ActionStore {
  private map = new Map<string, { snap: ActionSnapshot; expiresAt?: number }>();
  async put(id: string, snap: ActionSnapshot, ttlMs?: number): Promise<void> {
    this.map.set(id, {
      snap,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }
  async get(id: string): Promise<ActionSnapshot | undefined> {
    const e = this.map.get(id);
    if (!e) return undefined;
    if (e.expiresAt !== undefined && Date.now() > e.expiresAt) {
      this.map.delete(id);
      return undefined;
    }
    return e.snap;
  }
  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }
}
