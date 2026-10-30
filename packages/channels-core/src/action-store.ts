import type { ApplicationUser, ProviderActor } from "@copilotkit/channels-ui";

/** Trusted principal captured when one HITL run chain starts. */
export interface ActionContinuationInitiator {
  user: ApplicationUser | null;
  actor: ProviderActor;
}

/** Trusted facts bound to every one-use action rendered by a HITL run chain. */
export interface ActionContinuationContext {
  channelName: string;
  conversationKey: string;
  threadId: string;
  runChainId: string;
  initiator: ActionContinuationInitiator;
  /**
   * Shared by every action rendered in one leg of a run chain (the run up to
   * its interrupt), so that only one of them can resume it. Absent on
   * snapshots stored before this field existed; those are limited per action.
   */
  resumeGateId?: string;
}

/** Server-derived delivery facts used to validate a presented continuation. */
export type ActionContinuationBinding = Pick<
  ActionContinuationContext,
  "channelName" | "conversationKey" | "threadId"
>;

/** Persisted continuation binding, including its random action capability. */
export interface ActionContinuationSnapshot extends ActionContinuationContext {
  actionId: string;
}

export interface ActionSnapshot {
  component?: string;
  props?: unknown;
  path: (string | number)[];
  locator?: {
    key: string | number;
    eventProp: "onClick" | "onSelect" | "onSubmit";
  };
  platform?: string;
  actionValue?: unknown;
  boundArgs?: unknown;
  conversationKey: string;
  continuation?: ActionContinuationSnapshot;
  /**
   * The only provider account allowed to click an `answerableBy: "initiator"`
   * picker control. Absent on every other action, and on picker controls
   * stored before this field existed; those stay clickable by anyone in the
   * conversation, since nothing tells them apart from an ordinary action.
   */
  ownerActorId?: string;
}
/** @deprecated Configure `createChannel({ state })` instead. Action snapshots are stored via `StateStore.kv`. */
export interface ActionStore {
  put(id: string, snap: ActionSnapshot, ttlMs?: number): Promise<void>;
  get(id: string): Promise<ActionSnapshot | undefined>;
  consume(id: string): Promise<ActionSnapshot | undefined>;
  delete(id: string): Promise<void>;
}
/** @deprecated Configure `createChannel({ state })` instead. Action snapshots are stored via `StateStore.kv`. */
export class InMemoryActionStore implements ActionStore {
  private map = new Map<string, { snap: ActionSnapshot; expiresAt?: number }>();
  private writesSinceSweep = 0;
  async put(id: string, snap: ActionSnapshot, ttlMs?: number): Promise<void> {
    // Expired snapshots nobody reads again are purged every 256 writes.
    if (++this.writesSinceSweep >= 256) {
      this.writesSinceSweep = 0;
      const now = Date.now();
      for (const [key, entry] of this.map) {
        if (entry.expiresAt !== undefined && now > entry.expiresAt) {
          this.map.delete(key);
        }
      }
    }
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
  async consume(id: string): Promise<ActionSnapshot | undefined> {
    const entry = this.map.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.map.delete(id);
      return undefined;
    }
    this.map.delete(id);
    return entry.snap;
  }
}
