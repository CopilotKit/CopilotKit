import type { Context } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import type { CopilotKitCore } from "./core";
import type { CopilotKitCoreFriendsAccess } from "./core";

/**
 * A context entry with optional per-agent scoping.
 * When `agentIds` is set, the entry is forwarded only to runs of those agents;
 * when omitted, the entry is forwarded to every agent run.
 */
export interface ScopedContext extends Context {
  agentIds?: string[];
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
  addContext({ description, value, agentIds }: ScopedContext): string {
    const id = randomUUID();
    this._context[id] = {
      description,
      value,
      ...(agentIds ? { agentIds } : {}),
    };
    void this.notifySubscribers();
    return id;
  }

  /**
   * Build the context array for a run of the given agent: entries scoped to
   * other agents are dropped, and the scoping metadata is stripped so only
   * protocol-shaped `{ description, value }` entries go over the wire.
   */
  getContextForAgent(agentId?: string): Context[] {
    return Object.values(this._context)
      .filter(
        (entry) =>
          !entry.agentIds ||
          (agentId !== undefined && entry.agentIds.includes(agentId)),
      )
      .map(({ description, value }) => ({ description, value }));
  }

  /**
   * Remove a context entry by ID
   */
  removeContext(id: string): void {
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
