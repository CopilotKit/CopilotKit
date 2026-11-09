/**
 * Message a human-in-the-loop handler rejects with when its run is stopped
 * while the request is still waiting on the user. Core records it as the tool
 * message's `error`.
 */
export const HUMAN_IN_THE_LOOP_ABORTED_MESSAGE =
  "Human-in-the-loop interaction aborted";

/**
 * Tool message content core records for the abort: it sends a failed call to
 * the agent as `Error: <message>`. Some adapters keep only that the call
 * failed, not why: `@ag-ui/langgraph` restores a checkpointed tool error as
 * `error: "error"`. This content is then the only record of the abort.
 */
const HUMAN_IN_THE_LOOP_ABORTED_RESULT = `Error: ${HUMAN_IN_THE_LOOP_ABORTED_MESSAGE}`;

/**
 * True when `error` is the abort message, or when `error` is set (any value)
 * and `result` is exactly `Error: <abort message>` — the form a history
 * adapter leaves when it restored only a marker as `error`. An answer never
 * carries `error`, so text that merely reads like the abort is not an abort.
 */
function isAbortedCall(result: unknown, error: string | undefined): boolean {
  if (error === HUMAN_IN_THE_LOOP_ABORTED_MESSAGE) return true;
  return !!error && result === HUMAN_IN_THE_LOOP_ABORTED_RESULT;
}

/**
 * An abandoned request must not look like an answer: on a `complete` tool
 * call whose tool message records the abort, drop the failure text from
 * `result` and flag `aborted` instead. `error` is always the abort message,
 * whatever form the tool message carried it in. Any other call is returned
 * unchanged.
 *
 * @param toolCall - The tool call as built from the assistant's tool call and
 *   its tool message, with the message's raw `error` field.
 * @returns The same tool call, or its aborted form.
 */
export function withAbortedState<
  T extends { status: string; result?: unknown; error?: string },
>(
  toolCall: T,
):
  | T
  | (Omit<T, "result" | "error"> & {
      result: undefined;
      aborted: true;
      error: string;
    }) {
  if (
    toolCall.status === "complete" &&
    isAbortedCall(toolCall.result, toolCall.error)
  ) {
    return {
      ...toolCall,
      result: undefined,
      aborted: true,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    };
  }
  return toolCall;
}
