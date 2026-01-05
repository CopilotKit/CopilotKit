import {
  AbstractAgent,
  Message,
  State,
  RunAgentInput,
  RunStartedEvent,
  RunFinishedEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
} from "@ag-ui/client";
import type { CopilotKitCore } from "./core";

/**
 * Manages state and message tracking by run for CopilotKitCore.
 * Tracks agent state snapshots and message-to-run associations.
 */
export class StateManager {
  // State tracking: agentId -> threadId -> runId -> state
  private stateByRun: Map<string, Map<string, Map<string, State>>> = new Map();

  // Message tracking: agentId -> threadId -> messageId -> runId
  private messageToRun: Map<string, Map<string, Map<string, string>>> = new Map();

  // Agent subscriptions for cleanup
  private agentSubscriptions: Map<string, () => void> = new Map();

  constructor(private core: CopilotKitCore) {}

  /**
   * Initialize state tracking for an agent
   */
  initialize(): void {
    // Will be called when CopilotKitCore is initialized
  }

  /**
   * Subscribe to an agent's events to track state and messages
   */
  subscribeToAgent(agent: AbstractAgent): void {
    if (!agent.agentId) {
      return; // Skip agents without IDs
    }

    const agentId = agent.agentId;

    // Unsubscribe existing subscription if any
    this.unsubscribeFromAgent(agentId);

    // Subscribe to agent events
    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: ({ event, state }) => {
        this.handleRunStarted(agent, event, state);
      },
      onRunFinishedEvent: ({ event, state }) => {
        this.handleRunFinished(agent, event, state);
      },
      onStateSnapshotEvent: ({ event, input, state }) => {
        this.handleStateSnapshot(agent, event, input, state);
      },
      onStateDeltaEvent: ({ event, input, state }) => {
        this.handleStateDelta(agent, event, input, state);
      },
      onMessagesSnapshotEvent: ({ event, input, messages }) => {
        this.handleMessagesSnapshot(agent, event, input, messages);
      },
      onNewMessage: ({ message, input }) => {
        this.handleNewMessage(agent, message, input);
      },
    });

    this.agentSubscriptions.set(agentId, unsubscribe);
  }

  /**
   * Unsubscribe from an agent's events
   */
  unsubscribeFromAgent(agentId: string): void {
    const unsubscribe = this.agentSubscriptions.get(agentId);
    if (unsubscribe) {
      unsubscribe();
      this.agentSubscriptions.delete(agentId);
    }
  }

  /**
   * Get state for a specific run
   * Returns a deep copy to prevent external mutations
   */
  getStateByRun(agentId: string, threadId: string, runId: string): State | undefined {
    const state = this.stateByRun.get(agentId)?.get(threadId)?.get(runId);
    if (!state) return undefined;
    // Return a deep copy to prevent mutations
    return JSON.parse(JSON.stringify(state));
  }

  /**
   * Get runId associated with a message
   */
  getRunIdForMessage(agentId: string, threadId: string, messageId: string): string | undefined {
    return this.messageToRun.get(agentId)?.get(threadId)?.get(messageId);
  }

  /**
   * Get all states for an agent's thread
   */
  getStatesForThread(agentId: string, threadId: string): Map<string, State> {
    return this.stateByRun.get(agentId)?.get(threadId) ?? new Map();
  }

  /**
   * Get all run IDs for an agent's thread
   */
  getRunIdsForThread(agentId: string, threadId: string): string[] {
    const threadStates = this.stateByRun.get(agentId)?.get(threadId);
    return threadStates ? Array.from(threadStates.keys()) : [];
  }

  /**
   * Handle run started event
   */
  private handleRunStarted(agent: AbstractAgent, event: RunStartedEvent, state: State): void {
    if (!agent.agentId) return;

    const { threadId, runId } = event;
    this.saveState(agent.agentId, threadId, runId, state);
  }

  /**
   * Handle run finished event
   */
  private handleRunFinished(agent: AbstractAgent, event: RunFinishedEvent, state: State): void {
    if (!agent.agentId) return;

    const { threadId, runId } = event;
    this.saveState(agent.agentId, threadId, runId, state);
  }

  /**
   * Handle state snapshot event
   */
  private handleStateSnapshot(
    agent: AbstractAgent,
    event: StateSnapshotEvent,
    input: RunAgentInput,
    state: State,
  ): void {
    if (!agent.agentId) return;

    const { threadId, runId } = input;
    // Merge snapshot into current state
    const mergedState = { ...state, ...event.snapshot };
    this.saveState(agent.agentId, threadId, runId, mergedState);
  }

  /**
   * Handle state delta event
   */
  private handleStateDelta(agent: AbstractAgent, event: StateDeltaEvent, input: RunAgentInput, state: State): void {
    if (!agent.agentId) return;

    const { threadId, runId } = input;
    // State is already updated by the agent, just save it
    this.saveState(agent.agentId, threadId, runId, state);
  }

  /**
   * Handle messages snapshot event
   */
  private handleMessagesSnapshot(
    agent: AbstractAgent,
    event: MessagesSnapshotEvent,
    input: RunAgentInput,
    messages: Message[],
  ): void {
    if (!agent.agentId) return;

    const { threadId, runId } = input;

    // Associate all messages in the snapshot with this run
    for (const message of event.messages) {
      this.associateMessageWithRun(agent.agentId, threadId, message.id, runId);
    }
  }

  /**
   * Handle new message event
   */
  private handleNewMessage(agent: AbstractAgent, message: Message, input?: RunAgentInput): void {
    if (!agent.agentId || !input) return;

    const { threadId, runId } = input;
    this.associateMessageWithRun(agent.agentId, threadId, message.id, runId);
  }

  /**
   * Save state for a specific run
   */
  private saveState(agentId: string, threadId: string, runId: string, state: State): void {
    // Ensure nested maps exist
    if (!this.stateByRun.has(agentId)) {
      this.stateByRun.set(agentId, new Map());
    }
    const agentStates = this.stateByRun.get(agentId)!;

    if (!agentStates.has(threadId)) {
      agentStates.set(threadId, new Map());
    }
    const threadStates = agentStates.get(threadId)!;

    // Deep copy the state to prevent mutations
    threadStates.set(runId, JSON.parse(JSON.stringify(state)));
  }

  /**
   * Associate a message with a run
   */
  private associateMessageWithRun(agentId: string, threadId: string, messageId: string, runId: string): void {
    // Ensure nested maps exist
    if (!this.messageToRun.has(agentId)) {
      this.messageToRun.set(agentId, new Map());
    }
    const agentMessages = this.messageToRun.get(agentId)!;

    if (!agentMessages.has(threadId)) {
      agentMessages.set(threadId, new Map());
    }
    const threadMessages = agentMessages.get(threadId)!;

    threadMessages.set(messageId, runId);
  }

  /**
   * Clear all state for an agent
   */
  clearAgentState(agentId: string): void {
    this.stateByRun.delete(agentId);
    this.messageToRun.delete(agentId);
  }

  /**
   * Clear all state for a thread
   */
  clearThreadState(agentId: string, threadId: string): void {
    this.stateByRun.get(agentId)?.delete(threadId);
    this.messageToRun.get(agentId)?.delete(threadId);
  }
}
