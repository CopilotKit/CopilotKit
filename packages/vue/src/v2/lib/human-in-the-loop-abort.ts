import { ToolCallStatus } from "@copilotkit/core";

/**
 * Message a human-in-the-loop handler rejects with when its run is stopped
 * while the request is still waiting on the user. Core records it as the tool
 * message's `error`. It matches React's, so an abandoned request reads the
 * same across frameworks (see #5554).
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
 * and `result` is exactly the `Error: <abort message>` content — the form left
 * when a history adapter restored only a marker as `error`. An answer never
 * carries `error`, so text that merely reads like the abort is not an abort.
 */
function isAbortedCall(result: unknown, error: string | undefined): boolean {
  if (error === HUMAN_IN_THE_LOOP_ABORTED_MESSAGE) return true;
  return !!error && result === HUMAN_IN_THE_LOOP_ABORTED_RESULT;
}

/**
 * An abandoned request must not look like an answer: on a Complete render
 * whose tool message records the abort, drop the failure text from `result`
 * and flag `aborted` instead. `error` is always the abort message, whatever
 * form the tool message carried it in. Any other props are returned as is.
 */
export function withAbortedState<
  P extends { status: ToolCallStatus; result?: unknown; error?: string },
>(
  props: P,
):
  | P
  | (Omit<P, "result" | "error"> & {
      result: undefined;
      aborted: true;
      error: string;
    }) {
  if (
    props.status === ToolCallStatus.Complete &&
    isAbortedCall(props.result, props.error)
  ) {
    return {
      ...props,
      result: undefined,
      aborted: true,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    };
  }
  return props;
}
