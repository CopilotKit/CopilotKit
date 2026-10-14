import type { Context } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import type { CopilotKitCore } from "./core";
import type { CopilotKitCoreFriendsAccess } from "./core";

/**
 * A context entry with optional per-agent and per-thread scoping.
 * When `agentIds` is set, the entry is forwarded only to runs of those agents;
 * when omitted, the entry is forwarded to every agent run.
 * When `threadId` is set, the entry is forwarded only to runs (and suggestion
 * requests) of that conversation; a consumer with no thread id never gets it.
 */
export interface ScopedContext extends Context {
  agentIds?: string[];
  threadId?: string;
}

/** Copy only the fields a stored entry keeps, dropping absent scopes. */
function toStoredEntry({
  description,
  value,
  agentIds,
  threadId,
}: ScopedContext): ScopedContext {
  return {
    description,
    value,
    ...(agentIds ? { agentIds: [...agentIds] } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
  };
}

/**
 * Manages context storage and lifecycle for CopilotKitCore.
 * Context represents additional information available to agents during execution.
 */
export class ContextStore {
  private _context: Record<string, ScopedContext> = {};

  constructor(private core: CopilotKitCore) {}

  /**
   * Get all context entries as a readonly record
   */
  get context(): Readonly<Record<string, ScopedContext>> {
    return this._context;
  }

  /**
   * Add a new context entry. Pass `agentIds` to restrict the entry to runs of
   * specific agents (#5369); omit it for context every agent should receive.
   * @returns The ID of the created context entry
   */
  addContext(context: ScopedContext): string {
    const id = randomUUID();
    this._context[id] = toStoredEntry(context);
    void this.notifySubscribers();
    return id;
  }

  /**
   * Create or replace the entry stored under a caller-chosen, stable `id`, in
   * one step: a consumer never observes the old and the new entry together,
   * nor neither of them. Replacing an entry with an identical one is a no-op
   * and does not notify subscribers.
   */
  upsertContext(id: string, context: ScopedContext): void {
    const next = toStoredEntry(context);
    const current = this._context[id];
    if (current && JSON.stringify(current) === JSON.stringify(next)) return;
    this._context[id] = next;
    void this.notifySubscribers();
  }

  /**
   * Build the context array for a run of the given agent in the given thread:
   * entries scoped to other agents or other threads are dropped, and the
   * scoping metadata is stripped so only protocol-shaped
   * `{ description, value }` entries go over the wire.
   */
  getContextForAgent(agentId?: string, threadId?: string): Context[] {
    return Object.values(this._context)
      .filter(
        (entry) =>
          (!entry.agentIds ||
            (agentId !== undefined && entry.agentIds.includes(agentId))) &&
          (entry.threadId === undefined ||
            (threadId !== undefined && entry.threadId === threadId)),
      )
      .map(({ description, value }) => ({ description, value }));
  }

  /**
   * Withdraw the entries scoped to a conversation of `agentId` that no longer
   * exists. An entry shared with other agents loses `agentId` only and stays
   * for the others; an entry left with no agent, or scoped to every agent, is
   * removed.
   */
  removeThreadContext(agentId: string, threadId: string): void {
    let changed = false;
    for (const [id, entry] of Object.entries(this._context)) {
      if (entry.threadId !== threadId) continue;
      if (entry.agentIds && !entry.agentIds.includes(agentId)) continue;
      const remaining = entry.agentIds?.filter((other) => other !== agentId);
      if (remaining && remaining.length > 0) {
        this._context[id] = { ...entry, agentIds: remaining };
      } else {
        delete this._context[id];
      }
      changed = true;
    }
    if (changed) void this.notifySubscribers();
  }

  /**
   * Remove a context entry by ID
   */
  removeContext(id: string): void {
    if (!(id in this._context)) return;
    delete this._context[id];
    void this.notifySubscribers();
  }

  /**
   * Notify all subscribers of context changes
   */
  private async notifySubscribers(): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber) =>
        subscriber.onContextChanged?.({
          copilotkit: this.core,
          context: this._context,
        }),
      "Subscriber onContextChanged error:",
    );
  }
}
