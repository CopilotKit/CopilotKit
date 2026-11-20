import { ToolCallStatus } from "@copilotkit/core";

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

function isAbortedCall(result: unknown, error: string | undefined): boolean {
  if (error === HUMAN_IN_THE_LOOP_ABORTED_MESSAGE) return true;
  // A restored message whose `error` lost its text. Requiring `error` keeps
  // an answer that happens to read like the abort text from counting: an
  // answer never carries `error`.
  return !!error && result === HUMAN_IN_THE_LOOP_ABORTED_RESULT;
}

/**
 * An abandoned request must not look like an answer: on a Complete render
 * whose tool message records the abort, drop the failure text from `result`
 * and flag `aborted` instead. `error` is always the abort message, whatever
 * form the tool message carried it in.
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
