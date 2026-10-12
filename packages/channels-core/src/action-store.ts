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
  /** Named agent that posted this action, when the post happened during a run. */
  agentId?: string;
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
