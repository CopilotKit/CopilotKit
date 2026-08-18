import type {
  AbstractAgent,
  Message,
  State,
  RunAgentInput,
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
} from "@ag-ui/client";
import { randomUUID } from "@ag-ui/client";
import type { CopilotKitCore } from "./core";

const isContinuation = (input: RunAgentInput): boolean =>
  input.resume !== undefined ||
  Object.prototype.hasOwnProperty.call(
    (input.forwardedProps as { command?: object } | undefined)?.command ?? {},
    "resume",
  );

export interface CopilotKitCoreContinuationHandoff {
  cancel(): void;
  bind(input: object): void;
}

interface PendingContinuation extends CopilotKitCoreContinuationHandoff {
  expectedInput?: object;
  active: boolean;
  /**
   * The logical run id this continuation belongs to. Events arriving on the
   * continuation are re-stamped with it, so the run reads as ONE run to
   * everything downstream (state/message association, external tracing) even
   * though the transport minted a fresh id for the follow-up invocation.
   */
  expectedRunId?: string;
}

/**
 * Manages state and message tracking by run for CopilotKitCore.
 * Tracks agent state snapshots and message-to-run associations.
 */
export class StateManager {
  // State tracking: agentId -> threadId -> runId -> state
  private stateByRun: Map<string, Map<string, Map<string, State>>> = new Map();

  // Message tracking: agentId -> threadId -> messageId -> runId
  private messageToRun: Map<string, Map<string, Map<string, string>>> =
    new Map();

  // Active run tracking: `agentId:threadId` -> runId (used when messages arrive without input)
  private activeRun: Map<string, string> = new Map();

  // Agent subscriptions for cleanup
  private agentSubscriptions: Map<string, () => void> = new Map();

  // Internal follow-ups are marked in memory so the marker never reaches a
  // runtime or becomes user-controlled forwardedProps data.
  private pendingContinuations = new WeakMap<
    AbstractAgent,
    Set<PendingContinuation>
  >();

  constructor(private core: CopilotKitCore) {}

  /**
   * Initialize state tracking for an agent
   */
  initialize(): void {
    // Will be called when CopilotKitCore is initialized
  }

  markNextRunAsContinuation(
    agent: AbstractAgent,
    expectedRunId?: string,
  ): CopilotKitCoreContinuationHandoff {
    let pendingForAgent = this.pendingContinuations.get(agent);
    if (!pendingForAgent) {
      pendingForAgent = new Set();
      this.pendingContinuations.set(agent, pendingForAgent);
    }

    const pending: PendingContinuation = {
      active: true,
      expectedRunId,
      bind: (input) => {
        if (pending.active) pending.expectedInput = input;
      },
      cancel: () => {
        if (!pending.active) return;
        pending.active = false;
        pendingForAgent!.delete(pending);
        if (pendingForAgent!.size === 0) {
          this.pendingContinuations.delete(agent);
        }
      },
    };
    pendingForAgent.add(pending);
    return pending;
  }

  /**
   * Subscribe to an agent's events to track state and messages.
   */
  subscribeToAgent(agent: AbstractAgent): void {
    if (!agent.agentId) {
      return; // Skip agents without IDs
    }

    const agentId = agent.agentId;

    // Unsubscribe existing subscription for this agent only
    const existingUnsubscribe = this.agentSubscriptions.get(agentId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
      this.agentSubscriptions.delete(agentId);
    }

    // Subscribe to agent events.
    //
    // Two invariants this subscription must uphold:
    //
    // 1. Revocation: the ag-ui pipeline captures `o = [...agent.subscribers]` at
    //    runAgent() start. If this subscription is replaced by a newer one before
    //    the pipeline finishes, the old pipeline may still call these callbacks
    //    with the old input.runId. `revoked = true` turns them into no-ops once
    //    the replacement subscription is in place.
    //
    // 2. Run isolation within one subscription: in tests (and edge cases), a new
    //    run's events can arrive through the same subscription before the new
    //    pipeline is set up. An explicit standard or legacy resume input is a
    //    continuation, so only an ordinary new run gets a fresh ID after
    //    RUN_FINISHED.
    let revoked = false;
    let subRunId: string | undefined; // runId assigned to the current logical run
    let runFinished = false; // true after RUN_FINISHED, reset on next RUN_STARTED

    const effectiveInput = (input: RunAgentInput): RunAgentInput => ({
      ...input,
      runId: subRunId ?? input.runId,
    });

    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: ({ event, input, state }) => {
        if (revoked) return;
        const pendingForAgent = this.pendingContinuations.get(agent);
        const internalContinuation = [...(pendingForAgent ?? [])].find(
          (pending) => pending.expectedInput === input,
        );
        internalContinuation?.cancel();

        if (internalContinuation) {
          // An internal continuation re-stamps onto the run id it continues, so
          // the follow-up does not have to reuse that id on the wire.
          subRunId =
            internalContinuation.expectedRunId ?? event.runId ?? input.runId;
        } else if (
          runFinished &&
          input.runId === subRunId &&
          !isContinuation(input) &&
          (event.runId == null || event.runId === subRunId)
        ) {
          // A new logical run's events are arriving through this same (old)
          // subscription. This happens when the test emits events before
          // copilotkit.runAgent() has had a chance to set up the new pipeline:
          // the old pipeline reuses input1.runId for all events, so
          // input.runId equals the previous run's runId. Generate a fresh
          // runId so the new run's state doesn't collide with the old one.
          subRunId = randomUUID();
        } else {
          // A connect replay may contain multiple server runs under one input.runId.
          subRunId = event.runId || input.runId;
        }
        runFinished = false;
        this.handleRunStarted(agent, effectiveInput(input), state);
      },
      onRunFinishedEvent: ({ input, state }) => {
        if (revoked) return;
        runFinished = true;
        this.handleRunFinished(agent, effectiveInput(input), state);
      },
      // A run error terminates the run — treat identically to finished for cleanup
      onRunErrorEvent: ({ input, state }) => {
        if (revoked) return;
        runFinished = true;
        this.handleRunFinished(agent, effectiveInput(input), state);
      },
      onStateSnapshotEvent: ({ event, input, state }) => {
        if (revoked) return;
        this.handleStateSnapshot(agent, event, effectiveInput(input), state);
      },
      onStateDeltaEvent: ({ event, input, state }) => {
        if (revoked) return;
        this.handleStateDelta(agent, event, effectiveInput(input), state);
      },
      onMessagesSnapshotEvent: ({ event, input, messages }) => {
        if (revoked) return;
        this.handleMessagesSnapshot(
          agent,
          event,
          effectiveInput(input),
          messages,
        );
      },
      onNewMessage: ({ message, input }) => {
        if (revoked) return;
        this.handleNewMessage(
          agent,
          message,
          input ? effectiveInput(input) : undefined,
        );
      },
    });

    this.agentSubscriptions.set(agentId, () => {
      revoked = true;
      this.pendingContinuations.delete(agent);
      unsubscribe();
    });
  }

  /**
   * Unsubscribe an agent's subscription.
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
  getStateByRun(
    agentId: string,
    threadId: string,
    runId: string,
  ): State | undefined {
    const state = this.stateByRun.get(agentId)?.get(threadId)?.get(runId);
    if (!state) return undefined;
    // Return a deep copy to prevent mutations
    return JSON.parse(JSON.stringify(state));
  }

  /**
   * Get runId associated with a message
   */
  getRunIdForMessage(
    agentId: string,
    threadId: string,
    messageId: string,
  ): string | undefined {
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
  private handleRunStarted(
    agent: AbstractAgent,
    input: RunAgentInput,
    state: State,
  ): void {
    if (!agent.agentId) return;

    const { threadId, runId } = input;
    this.activeRun.set(`${agent.agentId}:${threadId}`, runId);
    // Only persist state when it carries real data. An empty {} from an
    // initial-state-less run would cause getStateByRun to return {} instead
    // of undefined, breaking renderers that rely on undefined to mean "no
    // state snapshot received yet".
    if (state && Object.keys(state).length > 0) {
      this.saveState(agent.agentId, threadId, runId, state);
    }
  }

  /**
   * Handle run finished event
   */
  private handleRunFinished(
    agent: AbstractAgent,
    input: RunAgentInput,
    state: State,
  ): void {
    if (!agent.agentId) return;

    const { threadId, runId } = input;
    this.activeRun.delete(`${agent.agentId}:${threadId}`);
    if (state && Object.keys(state).length > 0) {
      this.saveState(agent.agentId, threadId, runId, state);
    }
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
  private handleStateDelta(
    agent: AbstractAgent,
    event: StateDeltaEvent,
    input: RunAgentInput,
    state: State,
  ): void {
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
    messages: readonly Message[],
  ): void {
    if (!agent.agentId) return;

    const { threadId, runId } = input;

    // Cumulative snapshots repeat messages from earlier runs, so only assign
    // messages that do not already have a run association.
    for (const message of event.messages) {
      if (
        this.getRunIdForMessage(agent.agentId, threadId, message.id) ===
        undefined
      ) {
        this.associateMessageWithRun(
          agent.agentId,
          threadId,
          message.id,
          runId,
        );
      }
    }
  }

  /**
   * Handle new message event
   */
  private handleNewMessage(
    agent: AbstractAgent,
    message: Message,
    input?: RunAgentInput,
  ): void {
    if (!agent.agentId) return;

    if (!input) {
      // ag-ui calls addMessage() without input, so input is undefined here.
      // Fall back to the currently-active run for this agent's thread.
      const threadId = agent.threadId ?? "";
      const runId = this.activeRun.get(`${agent.agentId}:${threadId}`);
      if (runId) {
        this.associateMessageWithRun(
          agent.agentId,
          threadId,
          message.id,
          runId,
        );
      }
      return;
    }

    const { threadId, runId } = input;
    this.associateMessageWithRun(agent.agentId, threadId, message.id, runId);
  }

  /**
   * Save state for a specific run
   */
  private saveState(
    agentId: string,
    threadId: string,
    runId: string,
    state: State,
  ): void {
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
  private associateMessageWithRun(
    agentId: string,
    threadId: string,
    messageId: string,
    runId: string,
  ): void {
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
