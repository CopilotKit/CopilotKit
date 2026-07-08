import type {
  AbstractAgent,
  SubagentStartedEvent,
  SubagentFinishedEvent,
  SubagentErrorEvent,
} from "@ag-ui/client";
import type { CopilotKitCore } from "./core";
import type { CopilotKitCoreFriendsAccess } from "./core";

export type SubagentStatus = "running" | "finished" | "error";

/**
 * The observed lifecycle state of a single subagent invocation, keyed in the
 * registry by its `subagentId`. `name`/`description` come from SUBAGENT_STARTED
 * so the UI can show a friendly label instead of the opaque id.
 */
export interface SubagentState {
  subagentId: string;
  name: string;
  description?: string;
  parentSubagentId?: string;
  status: SubagentStatus;
  /** Set only when `status === "error"` (from SUBAGENT_ERROR.message). */
  error?: string;
}

/**
 * Tracks subagent lifecycle events (SUBAGENT_STARTED / FINISHED / ERROR) per
 * owning agent so consumers can resolve a message's `subagentId` to a name,
 * description, and running status.
 *
 * Modeled on {@link SuggestionEngine}: an in-memory `Record` keyed by (owning)
 * agentId, mutated from streamed AG-UI events, made reactive by calling
 * `notifySubscribers(onSubagentsChanged)` after every change. It owns its own
 * per-agent `agent.subscribe` (like {@link StateManager}) so it is fully
 * self-contained and adds no coupling to the state/message tracking path.
 *
 * No-op for runs without subagents (a normal LangGraph run never emits
 * SUBAGENT_* events), so the registry simply stays empty.
 */
export class SubagentRegistry {
  // agentId -> subagentId -> state
  private _subagents: Record<string, Record<string, SubagentState>> = {};

  // agentId -> unsubscribe fn (for cleanup + idempotent re-subscription)
  private agentSubscriptions: Map<string, () => void> = new Map();

  constructor(private core: CopilotKitCore) {}

  /**
   * Subscribe to an agent's subagent lifecycle events. Idempotent per agentId:
   * an existing subscription for the same agent is revoked and replaced.
   */
  subscribeToAgent(agent: AbstractAgent): void {
    if (!agent.agentId) {
      return; // Skip agents without IDs
    }
    const agentId = agent.agentId;

    const existingUnsubscribe = this.agentSubscriptions.get(agentId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
      this.agentSubscriptions.delete(agentId);
    }

    // `revoked` turns the callbacks into no-ops once this subscription is
    // replaced, mirroring StateManager's revocation guard: a still-running
    // ag-ui pipeline captured at runAgent() start may keep calling these.
    let revoked = false;
    const { unsubscribe } = agent.subscribe({
      onSubagentStartedEvent: ({ event }) => {
        if (revoked) return;
        this.handleStarted(agentId, event);
      },
      onSubagentFinishedEvent: ({ event }) => {
        if (revoked) return;
        this.handleFinished(agentId, event);
      },
      onSubagentErrorEvent: ({ event }) => {
        if (revoked) return;
        this.handleError(agentId, event);
      },
    });

    this.agentSubscriptions.set(agentId, () => {
      revoked = true;
      unsubscribe();
    });
  }

  /**
   * Unsubscribe an agent's subscription (symmetric with StateManager cleanup).
   */
  unsubscribeFromAgent(agentId: string): void {
    const unsubscribe = this.agentSubscriptions.get(agentId);
    if (unsubscribe) {
      unsubscribe();
      this.agentSubscriptions.delete(agentId);
    }
  }

  /**
   * Get the subagents observed for an owning agent, keyed by subagentId.
   * Returns a fresh shallow copy each call so consumers (and React state) see
   * a new reference when anything changed.
   */
  getSubagents(agentId: string): Record<string, SubagentState> {
    return { ...this._subagents[agentId] };
  }

  private handleStarted(agentId: string, event: SubagentStartedEvent): void {
    const bucket = (this._subagents[agentId] ??= {});
    bucket[event.subagentId] = {
      subagentId: event.subagentId,
      name: event.name,
      description: event.description,
      parentSubagentId: event.parentSubagentId,
      status: "running",
    };
    void this.notifySubagentsChanged(agentId);
  }

  private handleFinished(agentId: string, event: SubagentFinishedEvent): void {
    const existing = this._subagents[agentId]?.[event.subagentId];
    if (!existing) {
      return; // FINISHED without a prior STARTED — nothing to update
    }
    // Replace (not mutate) so the object identity changes for React consumers.
    this._subagents[agentId][event.subagentId] = {
      ...existing,
      status: "finished",
    };
    void this.notifySubagentsChanged(agentId);
  }

  private handleError(agentId: string, event: SubagentErrorEvent): void {
    const bucket = (this._subagents[agentId] ??= {});
    const existing = bucket[event.subagentId];
    bucket[event.subagentId] = existing
      ? { ...existing, status: "error", error: event.message }
      : {
          subagentId: event.subagentId,
          // No prior STARTED seen — fall back to the id as the display name.
          name: event.subagentId,
          status: "error",
          error: event.message,
        };
    void this.notifySubagentsChanged(agentId);
  }

  private async notifySubagentsChanged(agentId: string): Promise<void> {
    const subagents = this.getSubagents(agentId);
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber) =>
        subscriber.onSubagentsChanged?.({
          copilotkit: this.core,
          agentId,
          subagents,
        }),
      "Subscriber onSubagentsChanged error:",
    );
  }
}
