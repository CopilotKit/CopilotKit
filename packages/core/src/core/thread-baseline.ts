import type { AbstractAgent } from "@ag-ui/client";

/**
 * Forgets the replay and reconnect cursors an agent keeps for `threadId`, so
 * the next connect to that thread replays it from the start. Some agents keep
 * them (the Intelligence agent does); for plain AG-UI agents this is a no-op.
 */
export function ɵclearAgentThreadCursors(
  agent: AbstractAgent,
  threadId: string,
) {
  if (
    "clearReplayCursor" in agent &&
    typeof agent.clearReplayCursor === "function"
  ) {
    agent.clearReplayCursor(threadId);
  }
  if (
    "clearReconnectCursor" in agent &&
    typeof agent.clearReconnectCursor === "function"
  ) {
    agent.clearReconnectCursor(threadId);
  }
}

/** Options for {@link ɵresetAgentThreadBaseline}. */
export interface ɵThreadBaselineResetOptions {
  /** The thread whose replay and reconnect cursors to clear. No cursor is cleared when unset. */
  cursorThreadId?: string | null;
  /** Whether to drop interrupts still waiting for an answer. Defaults to `true`. */
  clearPendingInterrupts?: boolean;
}

/**
 * Empties an agent's view of its thread: no messages, empty state, no pending
 * interrupts, and no cursors for `cursorThreadId`. The chats call it when the
 * user moves to a fresh thread; the run handler calls it before a connect
 * restores a different thread.
 *
 * @example
 * ```ts
 * ɵresetAgentThreadBaseline(agent, { cursorThreadId: discardedThreadId });
 * ```
 */
export function ɵresetAgentThreadBaseline(
  agent: AbstractAgent,
  options: ɵThreadBaselineResetOptions = {},
) {
  agent.setMessages([]);
  agent.setState({});
  if (options.clearPendingInterrupts ?? true) {
    agent.pendingInterrupts = [];
  }
  if (options.cursorThreadId) {
    ɵclearAgentThreadCursors(agent, options.cursorThreadId);
  }
}
