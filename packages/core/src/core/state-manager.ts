import type {
  AbstractAgent,
  Message,
  State,
  RunAgentInput,
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
  ToolCallResultEvent,
  ToolMessage,
} from "@ag-ui/client";
import { randomUUID } from "@ag-ui/client";
import type { CopilotKitCore } from "./core";
import {
  insertToolResultMessage,
  isForwardedToClientPlaceholder,
} from "./tool-result-history";

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
    _expectedRunId?: string,
  ): CopilotKitCoreContinuationHandoff {
    let pendingForAgent = this.pendingContinuations.get(agent);
    if (!pendingForAgent) {
      pendingForAgent = new Set();
      this.pendingContinuations.set(agent, pendingForAgent);
    }

    const pending: PendingContinuation = {
      active: true,
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
    // 2. Run isolation within one subscription: each callback captures the
    //    effective ID for its input, so late callbacks from an older pipeline
    //    cannot use the current run's ID or active-run slot. A new logical run
    //    that reuses a settled input's run ID gets a fresh ID, unless the input
    //    is an internal continuation handoff or an explicit standard/legacy
    //    resume input, which preserve their logical run identity.
    const findInternalContinuation = (
      input: RunAgentInput,
    ): PendingContinuation | undefined => {
      const pendingForAgent = this.pendingContinuations.get(agent);
      return [...(pendingForAgent ?? [])].find(
        (pending) => pending.expectedInput === input,
      );
    };
    let revoked = false;
    const effectiveRunIds = new WeakMap<RunAgentInput, string>();
    const settledInputs = new WeakSet<RunAgentInput>();
    let lastStartedInput: RunAgentInput | undefined;
    let lastStartedInputRunId: string | undefined;
    let subRunId: string | undefined;
    let runFinished = false;
    const pendingResults = new Map<string, Map<string, ToolCallResultEvent>>();

    const captureEffectiveRunId = (
      input: RunAgentInput,
      isRunStart = false,
    ): string => {
      const existing = effectiveRunIds.get(input);
      if (existing) return existing;

      let effectiveRunId: string;
      if (isRunStart) {
        const internalContinuation = findInternalContinuation(input);
        internalContinuation?.cancel();
        if (
          runFinished &&
          input.runId === subRunId &&
          !internalContinuation &&
          !isContinuation(input)
        ) {
          effectiveRunId = randomUUID();
        } else {
          effectiveRunId = input.runId;
        }
        subRunId = effectiveRunId;
        runFinished = false;
        lastStartedInput = input;
        lastStartedInputRunId = input.runId;
      } else {
        effectiveRunId = subRunId ?? input.runId;
      }
      effectiveRunIds.set(input, effectiveRunId);

      return effectiveRunId;
    };

    const effectiveInput = (
      input: RunAgentInput,
      isRunStart = false,
    ): RunAgentInput => ({
      ...input,
      runId: captureEffectiveRunId(input, isRunStart),
    });

    const clearPendingResults = (input: RunAgentInput): void => {
      pendingResults.delete(effectiveInput(input).runId);
    };

    const replacePendingPlaceholder = (
      historyAgent: AbstractAgent,
      event: ToolCallResultEvent,
      input: RunAgentInput,
    ): boolean => {
      const matchingIndexes = historyAgent.messages.reduce<number[]>(
        (indexes, message, index) => {
          if (
            message.role === "tool" &&
            message.toolCallId === event.toolCallId
          ) {
            indexes.push(index);
          }
          return indexes;
        },
        [],
      );
      const hasOwner = historyAgent.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.toolCalls?.some(
            (toolCall) => toolCall.id === event.toolCallId,
          ),
      );
      if (
        matchingIndexes.length === 0 ||
        !hasOwner ||
        !matchingIndexes.some((index) =>
          isForwardedToClientPlaceholder(historyAgent.messages[index]?.content),
        )
      ) {
        return false;
      }

      const firstIndex = matchingIndexes[0];
      if (firstIndex === undefined) return false;
      const realIndex = matchingIndexes.find(
        (index) =>
          !isForwardedToClientPlaceholder(
            historyAgent.messages[index]?.content,
          ),
      );
      const keepIndex = realIndex ?? firstIndex;
      if (realIndex === undefined) {
        const existing = historyAgent.messages[keepIndex];
        historyAgent.messages.splice(keepIndex, 1, {
          ...existing,
          id: event.messageId,
          content: event.content,
        } as ToolMessage);
        this.associateMessageWithRun(
          agentId,
          input.threadId,
          event.messageId,
          input.runId,
        );
      }

      for (const index of matchingIndexes
        .filter((candidate) => candidate !== keepIndex)
        .sort((a, b) => b - a)) {
        historyAgent.messages.splice(index, 1);
      }
      return true;
    };

    const restorePendingPlaceholders = (
      historyAgent: AbstractAgent,
      input: RunAgentInput,
    ): boolean => {
      const runResults = pendingResults.get(input.runId);
      if (!runResults) return false;

      let changed = false;
      for (const event of runResults.values()) {
        changed =
          replacePendingPlaceholder(historyAgent, event, input) || changed;
      }
      if (changed) historyAgent.setMessages([...historyAgent.messages]);
      return changed;
    };

    const reconcilePendingResults = (
      historyAgent: AbstractAgent,
      input: RunAgentInput,
    ): boolean => {
      const runResults = pendingResults.get(input.runId);
      if (!runResults) return false;

      let changed = false;

      for (const event of runResults.values()) {
        const toolMessage: ToolMessage = {
          id: event.messageId,
          role: "tool",
          toolCallId: event.toolCallId,
          content: event.content,
        };
        if (replacePendingPlaceholder(historyAgent, event, input)) {
          changed = true;
          continue;
        }
        const result = insertToolResultMessage(
          historyAgent.messages,
          toolMessage,
          undefined,
          "skip",
        );
        if (result.status === "inserted") {
          this.associateMessageWithRun(
            agentId,
            input.threadId,
            result.message.id,
            input.runId,
          );
          changed = true;
        }
      }

      pendingResults.delete(input.runId);
      if (changed) {
        historyAgent.setMessages([...historyAgent.messages]);
      }
      return changed;
    };

    const settleRun = (input: RunAgentInput): RunAgentInput => {
      const effective = effectiveInput(input);
      settledInputs.add(input);
      runFinished = true;
      return effective;
    };

    const clearActiveRun = (input: RunAgentInput): void => {
      const key = `${agentId}:${input.threadId}`;
      if (this.activeRun.get(key) === input.runId) {
        this.activeRun.delete(key);
      }
    };

    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: ({ input, state }) => {
        if (revoked) return;
        if (
          lastStartedInput &&
          lastStartedInput !== input &&
          effectiveRunIds.has(input)
        ) {
          return;
        }
        this.handleRunStarted(agent, effectiveInput(input, true), state);
      },
      onRunFinishedEvent: ({ input, state, agent: eventAgent }) => {
        if (revoked) return;
        const effective = effectiveInput(input);
        reconcilePendingResults(eventAgent, effective);
        this.handleRunFinished(agent, settleRun(input), state);
      },
      // A run error terminates the run — treat identically to finished for cleanup
      onRunErrorEvent: ({ input, state, agent: eventAgent }) => {
        if (revoked) return;
        const effective = effectiveInput(input);
        reconcilePendingResults(eventAgent, effective);
        this.handleRunFinished(agent, settleRun(input), state);
      },
      onRunFailed: ({ input }) => {
        if (revoked) return;
        const effective = settleRun(input);
        clearPendingResults(effective);
        clearActiveRun(effective);
      },
      onRunFinalized: ({ input, agent: eventAgent }) => {
        if (revoked) return;
        const effective = effectiveInput(input);
        reconcilePendingResults(eventAgent, effective);
        clearPendingResults(effective);
        clearActiveRun(settleRun(input));
      },
      onToolCallResultEvent: ({ event, input, agent: eventAgent }) => {
        if (revoked || settledInputs.has(input)) return;
        const effective = effectiveInput(input);
        let runResults = pendingResults.get(effective.runId);
        if (!runResults) {
          runResults = new Map();
          pendingResults.set(effective.runId, runResults);
        }
        runResults.set(event.toolCallId, event);

        if (replacePendingPlaceholder(eventAgent, event, effective)) {
          eventAgent.setMessages([...eventAgent.messages]);
        }
        if (
          eventAgent.messages.some(
            (message) =>
              message.role === "tool" &&
              message.toolCallId === event.toolCallId,
          )
        ) {
          return { stopPropagation: true };
        }
      },
      onStateSnapshotEvent: ({ event, input, state }) => {
        if (revoked) return;
        this.handleStateSnapshot(agent, event, effectiveInput(input), state);
      },
      onStateDeltaEvent: ({ event, input, state }) => {
        if (revoked) return;
        this.handleStateDelta(agent, event, effectiveInput(input), state);
      },
      onMessagesSnapshotEvent: ({ event, input, agent: eventAgent }) => {
        if (revoked) return;
        const effective = effectiveInput(input);
        this.handleMessagesSnapshot(agent, event, effective);
        restorePendingPlaceholders(eventAgent, effective);
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
      pendingResults.clear();
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
    const activePrefix = `${agentId}:`;
    for (const activeKey of this.activeRun.keys()) {
      if (activeKey.startsWith(activePrefix)) {
        this.activeRun.delete(activeKey);
      }
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
    const activeRunKey = `${agent.agentId}:${threadId}`;
    if (this.activeRun.get(activeRunKey) === runId) {
      this.activeRun.delete(activeRunKey);
    }
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
