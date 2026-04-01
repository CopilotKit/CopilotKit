import { Context } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import type { CopilotKitCore } from "./core";
import { CopilotKitCoreFriendsAccess } from "./core";

/**
 * A context entry with an optional agent scope.
 */
export interface FrontendContext extends Context {
  agentId?: string;
}

/**
 * Manages context storage and lifecycle for CopilotKitCore.
 * Context represents additional information available to agents during execution.
 */
export class ContextStore {
  private _context: Record<string, FrontendContext> = {};

  constructor(private core: CopilotKitCore) {}

  /**
   * Get all context entries as a readonly record
   */
  get context(): Readonly<Record<string, FrontendContext>> {
    return this._context;
  }

  /**
   * Add a new context entry
   * @returns The ID of the created context entry
   */
  addContext({ description, value, agentId }: FrontendContext): string {
    const id = randomUUID();
    this._context[id] = { description, value, ...(agentId && { agentId }) };
    void this.notifySubscribers();
    return id;
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
